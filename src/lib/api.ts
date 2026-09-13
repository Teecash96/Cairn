/**
 * Typed client for the Cairn Worker.
 *
 * In production one Cloudflare Worker serves both the static app and `/api/*`,
 * so requests are same-origin and no base URL is needed. During `vite dev` the
 * Worker isn't there — set `VITE_API_BASE` to a `wrangler dev` URL to talk to
 * it, or leave it unset and the caller falls back to the offline stub generator
 * in `lib/stub.ts`.
 */
import type {
  BuildPlanDraft,
  FlowStep,
  Plan,
  PlanChanges,
  PlanInput,
  PublicBuildPlan,
  Prd,
  RealityCheckItem,
} from './plan'

export interface GenerateResult {
  prd: Prd
  flow: FlowStep[]
  build: BuildPlanDraft
  realityCheck: RealityCheckItem[]
  /** Present only for legacy payment responses. New planning is free. */
  credits?: CreditState
}

export interface CreditState {
  paid: number
  total: number
}

export interface PriceQuote {
  priceLuna: number
  plans: number
  payTo: string
}

export interface CreditsResult {
  credits: CreditState
  price: PriceQuote | null
}

export interface RedeemResult {
  credits: CreditState
  granted: number
}

export interface ShareResult {
  shareId: string
  /** Absolute URL for the read only snapshot. */
  url: string
}

export interface SharedPlanResult {
  plan: Plan
}

export interface AuthChallenge {
  challenge: string
  message: string
  expiresAt: number
}

export interface AuthResult {
  token: string
  address: string
  expiresAt: number
}

export type TeamRole = 'viewer' | 'editor'

export interface TeamMember {
  address: string
  role: TeamRole
  createdAt: number
}

export type TeamAccess = 'owner' | TeamRole

/** Protected team state. Only the public Track projection is returned. */
export interface TeamResult {
  teamId: string
  planId: string
  name: string
  owner: string
  role: TeamAccess
  members: TeamMember[]
  build: PublicBuildPlan
  revision: number
  inviteUrl: string
}

export type RefineAction =
  | 'cut_mvp_scope'
  | 'break_into_tasks'
  | 'find_missing_risks'
  | 'improve_acceptance_tests'
  | 'custom'

export interface RefineRequest {
  address: string
  plan: Plan
  action: RefineAction
  question?: string
}

export interface RefineResult {
  /** Direct answer for a custom question, when requested. */
  answer?: string
  /** Short explanation of the proposed targeted changes. */
  explanation: string
  changes: PlanChanges
  /** Present only for legacy payment responses. New planning is free. */
  credits?: CreditState
}

/**
 * Error codes the server can return. Each maps to a distinct UI state, which is
 * why they are a closed set rather than free-text messages.
 */
export type ApiErrorCode =
  | 'payment_required'
  | 'payment_not_found'
  | 'payment_wrong_wallet'
  | 'rate_limited'
  | 'budget_exhausted'
  | 'invalid_request'
  | 'not_found'
  | 'generation_failed'
  | 'network'
  | 'auth_required'
  | 'forbidden'
  | 'conflict'
  | 'server'

export class ApiError extends Error {
  readonly code: ApiErrorCode
  readonly status: number
  readonly credits: CreditState | null
  readonly price: PriceQuote | null
  constructor(
    code: ApiErrorCode,
    message: string,
    status = 0,
    details: { credits?: CreditState; price?: PriceQuote | null } = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.credits = details.credits ?? null
    this.price = details.price ?? null
  }

  /** True when nothing reached the server — the only case a stub can cover. */
  get isOffline(): boolean {
    return this.code === 'network'
  }

  get needsPayment(): boolean {
    return this.code === 'payment_required'
  }
}

const BASE: string = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/+$/, '') ?? ''

// Sessions are deliberately memory-only. A short-lived bearer token is safer
// here than a persistent cookie because the mini app has no account system and
// must not leave wallet authority in localStorage.
let authToken: string | null = null
let authAddress: string | null = null

function canonicalAddress(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase()
}

export function setAuthToken(token: string, address: string): void {
  authToken = token
  authAddress = canonicalAddress(address)
}

export function clearAuthToken(): void {
  authToken = null
  authAddress = null
}

export function hasAuthToken(address: string): boolean {
  return Boolean(authToken && authAddress === canonicalAddress(address))
}

/** Generation can take a while; everything else should be quick. */
const TIMEOUT_MS = { generate: 60_000, payment: 20_000, default: 15_000 }

interface ErrorBody {
  error?: string
  message?: string
  credits?: CreditState
  price?: PriceQuote | null
}

function isErrorCode(value: unknown): value is ApiErrorCode {
  return (
    typeof value === 'string' &&
    [
      'rate_limited',
      'payment_required',
      'payment_not_found',
      'payment_wrong_wallet',
      'budget_exhausted',
      'invalid_request',
      'not_found',
      'generation_failed',
      'network',
      'auth_required',
      'forbidden',
      'conflict',
      'server',
    ].includes(value)
  )
}

async function request<T>(
  path: string,
  init: RequestInit & { timeoutMs?: number; auth?: boolean } = {},
): Promise<T> {
  const { timeoutMs = TIMEOUT_MS.default, auth = false, ...options } = init

  if (auth && !authToken) throw new ApiError('auth_required', 'Sign in with your Nimiq wallet first.', 401)

  // AbortSignal.timeout is not in every WebView; fall back to a manual controller.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let response: Response
  try {
    response = await fetch(`${BASE}/api${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        ...(authToken && auth ? { authorization: `Bearer ${authToken}` } : {}),
        ...options.headers,
      },
    })
  } catch (error) {
    // Network failure, CORS, or our own abort — indistinguishable and all offline.
    const aborted = error instanceof DOMException && error.name === 'AbortError'
    throw new ApiError('network', aborted ? 'That took too long.' : 'Could not reach Cairn.')
  } finally {
    clearTimeout(timer)
  }

  if (response.ok) {
    try {
      return (await response.json()) as T
    } catch {
      throw new ApiError('server', 'Cairn sent back something unreadable.', response.status)
    }
  }

  let body: ErrorBody = {}
  try {
    body = (await response.json()) as ErrorBody
  } catch {
    /* Non-JSON error body. The status is enough. */
  }

  const code: ApiErrorCode = isErrorCode(body.error)
    ? body.error
    : response.status === 404
      ? 'not_found'
      : response.status === 429
        ? 'rate_limited'
        : 'server'

  if (code === 'auth_required') clearAuthToken()

  throw new ApiError(code, body.message ?? 'Something went wrong.', response.status, {
    credits: body.credits,
    price: body.price,
  })
}

export interface GenerateRequest {
  /** The connected wallet is used only to authenticate the request. */
  address: string
  input: PlanInput
}

/** Generate a plan after a signed Nimiq wallet session. Planning is free. */
export function generatePlan(body: GenerateRequest): Promise<GenerateResult> {
  return request<GenerateResult>('/generate', {
    method: 'POST',
    body: JSON.stringify(body),
    timeoutMs: TIMEOUT_MS.generate,
    auth: true,
  })
}

export function getAuthChallenge(address?: string): Promise<AuthChallenge> {
  if (!address) return request<AuthChallenge>('/auth/challenge')
  const params = new URLSearchParams({ address })
  return request<AuthChallenge>(`/auth/challenge?${params.toString()}`)
}

export function verifyAuth(body: {
  address: string
  challenge: string
  publicKey: string
  signature: string
}): Promise<AuthResult> {
  return request<AuthResult>('/auth/verify', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function getCredits(): Promise<CreditsResult> {
  return request<CreditsResult>('/credits', { auth: true })
}

export function redeemPayment(address: string, receipt?: string): Promise<RedeemResult> {
  return request<RedeemResult>('/redeem', {
    method: 'POST',
    body: JSON.stringify({ address, ...(receipt ? { receipt } : {}) }),
    timeoutMs: TIMEOUT_MS.payment,
    auth: true,
  })
}

/** Publish a read-only snapshot. Explicit user action — never automatic. */
export function sharePlan(address: string, plan: Plan): Promise<ShareResult> {
  return request<ShareResult>('/share', {
    method: 'POST',
    body: JSON.stringify({ address, plan }),
    auth: true,
  })
}

export function getSharedPlan(shareId: string): Promise<SharedPlanResult> {
  return request<SharedPlanResult>(`/share/${encodeURIComponent(shareId)}`)
}

/** Run a targeted planner action after wallet authentication. Refinement is free. */
export function refinePlan(body: RefineRequest): Promise<RefineResult> {
  return request<RefineResult>('/refine', {
    method: 'POST',
    body: JSON.stringify(body),
    timeoutMs: TIMEOUT_MS.generate,
    auth: true,
  })
}

/** Create or recover the owner's protected team workspace for a plan. */
export function createTeam(body: {
  planId: string
  name: string
  build: PublicBuildPlan
}): Promise<TeamResult> {
  return request<TeamResult>('/team', {
    method: 'POST',
    body: JSON.stringify(body),
    auth: true,
  })
}

/** Read a protected team. The wallet session determines access and role. */
export function getTeam(teamId: string): Promise<TeamResult> {
  return request<TeamResult>(`/team/${encodeURIComponent(teamId)}`, { auth: true })
}

export function addTeamMember(teamId: string, address: string, role: TeamRole): Promise<TeamResult> {
  return request<TeamResult>(`/team/${encodeURIComponent(teamId)}/members`, {
    method: 'POST',
    body: JSON.stringify({ address, role }),
    auth: true,
  })
}

export function updateTeamMember(teamId: string, address: string, role: TeamRole): Promise<TeamResult> {
  return request<TeamResult>(`/team/${encodeURIComponent(teamId)}/members/${encodeURIComponent(address)}`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
    auth: true,
  })
}

export function removeTeamMember(teamId: string, address: string): Promise<TeamResult> {
  return request<TeamResult>(`/team/${encodeURIComponent(teamId)}/members/${encodeURIComponent(address)}`, {
    method: 'DELETE',
    auth: true,
  })
}

/** Update only the public Track projection. `revision` prevents stale writes. */
export function updateTeamTracker(
  teamId: string,
  build: PublicBuildPlan,
  revision: number,
): Promise<TeamResult> {
  return request<TeamResult>(`/team/${encodeURIComponent(teamId)}/tracker`, {
    method: 'PUT',
    body: JSON.stringify({ build, revision }),
    auth: true,
  })
}
