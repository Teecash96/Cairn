/**
 * Settings, parsed once per request.
 *
 * Every tunable is a `[vars]` entry in `wrangler.toml`, which means repricing or
 * changing the free tier is a config edit rather than a deploy of new code. Vars
 * arrive as strings, so parsing happens here and exactly once — no `Number(...)`
 * scattered through the handlers.
 */
import { normalizeAddress } from './http'
import type { Env, PriceQuote } from './types'

export interface Config {
  /** Anthropic model name. Kept configurable for safe upgrades. */
  model: string
  /** Bundle price in Luna. 1 NIM = 100,000 Luna. */
  priceLuna: number
  /** Generations one payment buys. */
  plansPerPayment: number
  /** Free generations a new wallet starts with. */
  freePlans: number
  /** Ceiling on generations per UTC day, across everyone. */
  dailyBudget: number
  /** Empty when unset, which makes payment verification fail closed. */
  rpcUrl: string
  /** Normalized receiving address, or null when misconfigured. */
  payTo: string | null
  /** Base for share links; empty means "derive it from the request". */
  appUrl: string
  trustPaymentsInDev: boolean
}

function int(value: string | undefined, fallback: number, min: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback
}

export function readConfig(env: Env): Config {
  return {
    model: (env.ANTHROPIC_MODEL ?? 'claude-sonnet-5').trim(),
    priceLuna: int(env.PRICE_LUNA, 1_000_000, 1),
    plansPerPayment: int(env.PLANS_PER_PAYMENT, 10, 1),
    freePlans: int(env.FREE_PLANS, 3, 0),
    dailyBudget: int(env.DAILY_BUDGET, 400, 0),
    rpcUrl: (env.NIMIQ_RPC_URL ?? '').trim(),
    payTo: normalizeAddress(env.PAY_TO),
    appUrl: (env.APP_URL ?? '').trim().replace(/\/+$/, ''),
    trustPaymentsInDev: env.DEV_TRUST_PAYMENTS === '1',
  }
}

/** What the client is shown before it confirms. `payTo` is checked by the caller. */
export function quote(config: Config, payTo: string): PriceQuote {
  return { priceLuna: config.priceLuna, plans: config.plansPerPayment, payTo }
}
