/**
 * The Worker's environment, and the shapes it exchanges with the client.
 *
 * ---------------------------------------------------------------------------
 * These domain types are DUPLICATED from `src/lib/plan.ts` (Plan, Prd, FlowStep,
 * PlanInput) and `src/lib/api.ts` (CreditState, PriceQuote, ApiErrorCode, and the
 * result shapes). They are copied rather than imported because those files are
 * typed against the DOM — localStorage, Crypto, Intl — and a Worker project must
 * not have DOM globals in scope.
 *
 * There is no compiler check tying the two copies together. If you change a
 * shape, change it in both places.
 * ---------------------------------------------------------------------------
 */

export interface Env {
  /** Credits, shares, gifts, spent receipts, budget counters. */
  CAIRN: KVNamespace
  /** The built app. Used for static asset fallback. */
  ASSETS: Fetcher

  /** Encrypted secret binding. Never in the repo. */
  GEMINI_API_KEY: string
  GEMINI_MODEL?: string

  PAY_TO: string
  /** Numbers arrive as strings; `intVar()` in index.ts parses them. */
  PRICE_LUNA: string
  PLANS_PER_PAYMENT: string
  FREE_PLANS: string
  DAILY_BUDGET: string
  NIMIQ_RPC_URL: string
  APP_URL: string

  /**
   * `.dev.vars` only. Set to "1" to skip on-chain verification so the credit and
   * pay flows can be walked without a node. It is refused unless the request
   * arrived on a loopback or private-range host, which a deployed Worker never
   * is — see `payments.ts`.
   */
  DEV_TRUST_PAYMENTS?: string
}

// -- domain (mirrors src/lib/plan.ts) ---------------------------------------

export interface PlanInput {
  name: string
  idea: string
  targetUser?: string
  problem?: string
  goal?: string
}

export interface Prd {
  summary: string
  problem: string
  targetUser: string
  userGoal: string
  coreFeatures: string[]
  userStories: string[]
  successCriteria: string[]
  assumptions: string[]
  outOfScope: string[]
}

export type FlowStepKind = 'entry' | 'action' | 'decision' | 'success' | 'exit'

export interface FlowBranch {
  label: string
  result: string
}

export interface FlowStep {
  kind: FlowStepKind
  title: string
  action: string
  result: string
  branches?: [FlowBranch, FlowBranch]
}

export interface BuildMilestoneDraft {
  title: string
  outcome: string
  tasks: string[]
}

export interface BuildPlanDraft {
  mvpScope: string[]
  milestones: BuildMilestoneDraft[]
  risks: string[]
  acceptanceTests: string[]
  nextAction: string
}

export interface Task {
  id: string
  text: string
  status: 'todo' | 'in_progress' | 'done'
  priority: 'low' | 'medium' | 'high'
  labels: string[]
  notes: string
  dueDate?: string
  dependsOn: string[]
}

export interface Milestone {
  id: string
  title: string
  outcome: string
  tasks: Task[]
  startDate?: string
  dueDate?: string
  blocked: boolean
}

export interface BuildPlan {
  mvpScope: string[]
  milestones: Milestone[]
  risks: string[]
  acceptanceTests: string[]
  nextAction: string
}

/** Fields intentionally exposed by a shared snapshot. */
export interface PublicTask {
  id: string
  text: string
  status: 'todo' | 'in_progress' | 'done'
  labels: string[]
  dueDate?: string
}

export interface PublicMilestone {
  id: string
  title: string
  outcome: string
  tasks: PublicTask[]
  startDate?: string
  dueDate?: string
  blocked: boolean
}

export interface PublicBuildPlan {
  mvpScope: string[]
  milestones: PublicMilestone[]
  risks: string[]
  acceptanceTests: string[]
  nextAction: string
}

export type PublicPlan = Omit<Plan, 'build'> & { build: PublicBuildPlan }

export type RealityPriority = 'high' | 'medium' | 'low'

export interface RealityCheckItem {
  priority: RealityPriority
  concern: string
  why: string
  fix: string
}

export interface Plan {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  input: PlanInput
  prd: Prd
  flow: FlowStep[]
  build: BuildPlan
  realityCheck: RealityCheckItem[]
  shareId?: string
}

export type RefineAction =
  | 'cut_mvp_scope'
  | 'break_into_tasks'
  | 'find_missing_risks'
  | 'improve_acceptance_tests'
  | 'custom'

export interface PlanChanges {
  prd?: Partial<Prd>
  flow?: FlowStep[]
  build?: Partial<BuildPlanDraft>
  realityCheck?: RealityCheckItem[]
}

// -- wire shapes (mirrors src/lib/api.ts) -----------------------------------

export interface CreditState {
  free: number
  paid: number
  total: number
}

export interface PriceQuote {
  priceLuna: number
  plans: number
  payTo: string
}

export interface AuthChallengeRecord {
  /** Optional when the challenge was requested before Hub returns its signer. */
  address: string | null
  message: string
  expiresAt: number
  ip: string
  used?: boolean
}

export interface SessionRecord {
  address: string
  createdAt: number
  expiresAt: number
}

export type ApiErrorCode =
  | 'payment_required'
  | 'payment_not_found'
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

// -- stored records ---------------------------------------------------------

/** `credit:<address>` */
export interface CreditRecord {
  free: number
  paid: number
  createdAt: number
  /** Every free credit this address has ever been given. Kept for audit. */
  grantedFree: number
}

/** `device:<deviceId>` — which wallets this handset has already had free plans for. */
export interface DeviceRecord {
  addresses: string[]
  granted: number
}

/** `share:<shareId>` */
export interface ShareRecord {
  plan: PublicPlan
  /** Normalized address of whoever shared it. */
  by: string
  createdAt: number
  /**
   * Minted once, with the share record — not once per share call. Re-sharing an
   * edited plan reuses this token, or sharing in a loop would mint free plans.
   */
  gift: string
}

/** `gift:<token>` — single use, and never claimable by its own giver. */
export interface GiftRecord {
  from: string
  shareId: string
  claimedBy?: string
}

// -- protected teams --------------------------------------------------------

export type TeamRole = 'viewer' | 'editor'

export interface TeamMember {
  address: string
  role: TeamRole
  createdAt: number
}

/** `team:<teamId>` — only the public Track projection is stored here. */
export interface TeamRecord {
  id: string
  planId: string
  name: string
  owner: string
  members: TeamMember[]
  build: PublicBuildPlan
  revision: number
  createdAt: number
  updatedAt: number
}
