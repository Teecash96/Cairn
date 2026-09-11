/**
 * The Worker's environment, and the shapes it exchanges with the client.
 *
 * ---------------------------------------------------------------------------
 * These domain types are DUPLICATED from `src/lib/plan.ts` (Plan, Prd, FlowStep,
 * PlanInput) and `src/lib/api.ts` (ApiErrorCode and the
 * result shapes). They are copied rather than imported because those files are
 * typed against the DOM — localStorage, Crypto, Intl — and a Worker project must
 * not have DOM globals in scope.
 *
 * There is no compiler check tying the two copies together. If you change a
 * shape, change it in both places.
 * ---------------------------------------------------------------------------
 */

export interface Env {
  /** Shares, wallet sessions, team records, rate limits, and budget counters. */
  CAIRN: KVNamespace
  CREDIT_LEDGER: DurableObjectNamespace
  /** Explicit cutover gate; legacy KV must be frozen before enabling. */
  CREDIT_LEDGER_READY?: string
  /** The built app. Used for static asset fallback. */
  ASSETS: Fetcher

  /** Encrypted secret binding. Never in the repo. */
  GEMINI_API_KEY: string
  GEMINI_MODEL?: string

  PAY_TO: string
  PRICE_LUNA: string
  PLANS_PER_PAYMENT: string
  NIMIQ_RPC_URL: string
  DEV_TRUST_PAYMENTS?: string

  /** Numbers arrive as strings; the config parser validates them. */
  DAILY_BUDGET: string
  APP_URL: string
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

export interface CreditState {
  paid: number
  total: number
}

export interface PriceQuote {
  priceLuna: number
  plans: number
  payTo: string
}

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

// -- stored records ---------------------------------------------------------

export interface CreditRecord {
  paid: number
  createdAt: number
}

/** `share:<shareId>` */
export interface ShareRecord {
  plan: PublicPlan
  /** Normalized address of whoever shared it. */
  by: string
  createdAt: number
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
