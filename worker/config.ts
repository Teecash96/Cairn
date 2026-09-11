/**
 * Settings, parsed once per request.
 *
 * Every tunable is a `[vars]` entry in `wrangler.toml`. Vars arrive as strings,
 * so parsing happens here and exactly once.
 */
import { normalizeAddress } from './http'
import type { Env, PriceQuote } from './types'

export interface Config {
  /** Gemini model name. Kept configurable for safe upgrades. */
  model: string
  priceLuna: number
  plansPerPayment: number
  /** Ceiling on generations per UTC day, across everyone. */
  dailyBudget: number
  rpcUrl: string
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
    model: (env.GEMINI_MODEL ?? 'gemini-3.1-flash-lite').trim(),
    priceLuna: int(env.PRICE_LUNA, 100_000, 1),
    plansPerPayment: int(env.PLANS_PER_PAYMENT, 10, 1),
    dailyBudget: int(env.DAILY_BUDGET, 400, 0),
    rpcUrl: (env.NIMIQ_RPC_URL ?? '').trim(),
    payTo: normalizeAddress(env.PAY_TO),
    appUrl: (env.APP_URL ?? '').trim().replace(/\/+$/, ''),
    trustPaymentsInDev: env.DEV_TRUST_PAYMENTS === '1',
  }
}

export function quote(config: Config, payTo: string): PriceQuote {
  return { priceLuna: config.priceLuna, plans: config.plansPerPayment, payTo }
}
