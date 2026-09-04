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
  ANTHROPIC_API_KEY: string
  ANTHROPIC_MODEL?: string

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

export interface Plan {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  input: PlanInput
  prd: Prd
  flow: FlowStep[]
  shareId?: string
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
  plan: Plan
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
