/**
 * Fair use limits for the free service.
 *
 * Cairn has no balance and no payment path. A short wallet rate limit stops
 * accidental loops. A global daily limit bounds the Gemini bill.
 */
import { today } from './http'
import type { Config } from './config'
import type { Env } from './types'

const REQUESTS_PER_MINUTE = 5
const KEEP_COUNTERS = 2 * 86_400

/** True when this address is asking faster than any person would. */
export async function tooFast(env: Env, address: string, scope = 'address'): Promise<boolean> {
  return tooFastByKey(env, address, scope)
}

/** Generic limiter for wallet routes and unauthenticated auth endpoints. */
export async function tooFastByKey(
  env: Env,
  keyPart: string,
  scope = 'address',
  limit = REQUESTS_PER_MINUTE,
): Promise<boolean> {
  const minute = Math.floor(Date.now() / 60_000)
  const key = `rl:${scope}:${keyPart}:${minute}`
  const used = (await env.CAIRN.get<number>(key, 'json')) ?? 0
  if (used >= limit) return true
  await env.CAIRN.put(key, JSON.stringify(used + 1), { expirationTtl: 120 })
  return false
}

/** Remaining free AI attempts for the current UTC day. */
export async function budgetLeft(env: Env, config: Config): Promise<number> {
  const used = (await env.CAIRN.get<number>(`budget:${today()}`, 'json')) ?? 0
  return Math.max(0, config.dailyBudget - used)
}

/** Count an attempt because the provider can charge even when output fails. */
export async function chargeBudget(env: Env): Promise<void> {
  const key = `budget:${today()}`
  const used = (await env.CAIRN.get<number>(key, 'json')) ?? 0
  await env.CAIRN.put(key, JSON.stringify(used + 1), { expirationTtl: KEEP_COUNTERS })
}
