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
  Prd,
  RealityCheckItem,
} from './plan'

/** How many generations this wallet has left. */
export interface CreditState {
  free: number
  paid: number
  total: number
}

/** What a top-up costs right now. Server-authored — never hardcode it client-side. */
export interface PriceQuote {
  /** Amount in Luna. 1 NIM = 100,000 Luna — see lib/units.ts. */
  priceLuna: number
  /** How many generations one payment buys. */
  plans: number
  /** Where to send it. */
  payTo: string
}

export interface GenerateResult {
  prd: Prd
  flow: FlowStep[]
  build: BuildPlanDraft
  realityCheck: RealityCheckItem[]
  credits: CreditState
}

export interface CreditsResult {
  credits: CreditState
  price: PriceQuote | null
}

export interface RedeemResult {
  credits: CreditState
  /** Generations added by this payment. */
  granted: number
}

export interface ShareResult {
  shareId: string
  /** Absolute URL, gift token already attached. */
  url: string
}

export interface SharedPlanResult {
  plan: Plan
  /** Present when this link still carries an unclaimed free generation. */
  gift?: string
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
  deviceId?: string | null
}

export interface RefineResult {
  /** Direct answer for a custom question, when requested. */
  answer?: string
  /** Short explanation of the proposed targeted changes. */
  explanation: string
  changes: PlanChanges
  credits: CreditState
}

/**
 * Error codes the server can return. Each maps to a distinct UI state, which is
 * why they are a closed set rather than free-text messages.
 */
export type ApiErrorCode =
  | 'payment_required'
  | 'payment_not_found'
  | 'rate_limited'
  | 'budget_exhausted'
  | 'invalid_request'
  | 'not_found'
  | 'generation_failed'
  | 'network'
  | 'server'

export class ApiError extends Error {
  readonly code: ApiErrorCode
  readonly status: number
  /** Set on `payment_required` so the pay sheet knows the amount. */
  readonly price: PriceQuote | undefined
  readonly credits: CreditState | undefined

  constructor(
    code: ApiErrorCode,
    message: string,
    status = 0,
    extra: { price?: PriceQuote; credits?: CreditState } = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.price = extra.price
    this.credits = extra.credits
  }

  /** True when the fix is "pay", not "retry". */
  get needsPayment(): boolean {
    return this.code === 'payment_required'
  }

  /** True when nothing reached the server — the only case a stub can cover. */
  get isOffline(): boolean {
    return this.code === 'network'
  }
}

const BASE: string = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/+$/, '') ?? ''

/** Generation can take a while; everything else should be quick. */
const TIMEOUT_MS = { generate: 60_000, default: 15_000 }

interface ErrorBody {
  error?: string
  message?: string
  price?: PriceQuote
  credits?: CreditState
}

function isErrorCode(value: unknown): value is ApiErrorCode {
  return (
    typeof value === 'string' &&
    [
      'payment_required',
      'payment_not_found',
      'rate_limited',
      'budget_exhausted',
      'invalid_request',
      'not_found',
      'generation_failed',
      'network',
      'server',
    ].includes(value)
  )
}

async function request<T>(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const { timeoutMs = TIMEOUT_MS.default, ...options } = init

  // AbortSignal.timeout is not in every WebView; fall back to a manual controller.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let response: Response
  try {
    response = await fetch(`${BASE}/api${path}`, {
      ...options,
      signal: controller.signal,
      headers: { 'content-type': 'application/json', ...options.headers },
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
      : response.status === 402
        ? 'payment_required'
        : response.status === 429
          ? 'rate_limited'
          : 'server'

  throw new ApiError(code, body.message ?? 'Something went wrong.', response.status, {
    price: body.price,
    credits: body.credits,
  })
}

export interface GenerateRequest {
  /** The connected wallet. Credits are ledgered against this. */
  address: string
  input: PlanInput
  /** Device identifier, so free grants can't be farmed with fresh wallets. */
  deviceId?: string | null
  /** Gift token from a shared link, claimed on first generation. */
  gift?: string | null
}

/** Throws `ApiError` with `needsPayment` when credits have run out. */
export function generatePlan(body: GenerateRequest): Promise<GenerateResult> {
  return request<GenerateResult>('/generate', {
    method: 'POST',
    body: JSON.stringify(body),
    timeoutMs: TIMEOUT_MS.generate,
  })
}

/** Balance and current price. Safe to call on load. */
export function getCredits(address: string, deviceId?: string | null): Promise<CreditsResult> {
  const params = new URLSearchParams({ address })
  if (deviceId) params.set('deviceId', deviceId)
  return request<CreditsResult>(`/credits?${params.toString()}`)
}

/**
 * Claim a payment.
 *
 * `receipt` is whatever `sendBasicTransaction` handed back — the server treats
 * it as an opaque idempotency hint, not as proof. Verification matches the
 * *sender and amount* against the receiving address's incoming transactions, so
 * this works whether the SDK returns a hash or a serialized transaction.
 */
export function redeemPayment(
  address: string,
  receipt: string,
  deviceId?: string | null,
): Promise<RedeemResult> {
  return request<RedeemResult>('/redeem', {
    method: 'POST',
    body: JSON.stringify({ address, receipt, deviceId }),
  })
}

/** Publish a read-only snapshot. Explicit user action — never automatic. */
export function sharePlan(address: string, plan: Plan): Promise<ShareResult> {
  return request<ShareResult>('/share', {
    method: 'POST',
    body: JSON.stringify({ address, plan }),
  })
}

export function getSharedPlan(shareId: string): Promise<SharedPlanResult> {
  return request<SharedPlanResult>(`/share/${encodeURIComponent(shareId)}`)
}

/** Spend one credit on a targeted planner action. */
export function refinePlan(body: RefineRequest): Promise<RefineResult> {
  return request<RefineResult>('/refine', {
    method: 'POST',
    body: JSON.stringify(body),
    timeoutMs: TIMEOUT_MS.generate,
  })
}
