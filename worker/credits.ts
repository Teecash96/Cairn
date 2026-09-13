import type { CreditRecord, CreditState, Env } from './types'

/**
 * Free tier: all users have unlimited credits.
 * Returns a sentinel value indicating unlimited access.
 */
export function stateOf(_record: CreditRecord | null): CreditState {
  return { paid: Number.MAX_SAFE_INTEGER, total: Number.MAX_SAFE_INTEGER }
}

/**
 * Credits are no longer stored - all users have unlimited free access.
 * This function is kept for backward compatibility but always returns null.
 */
export async function readCredits(_env: Env, _address: string): Promise<CreditRecord | null> {
  return null
}

/**
 * Spend one credit - always succeeds in free tier.
 * Returns unlimited credits to indicate success.
 */
export async function spendOne(_env: Env, _address: string, _operationId?: string): Promise<CreditState> {
  return { paid: Number.MAX_SAFE_INTEGER, total: Number.MAX_SAFE_INTEGER }
}

/**
 * Grant credits - no-op in free tier, returns unlimited credits.
 */
export async function grantPaid(_env: Env, _address: string, _amount: number, _operationId?: string): Promise<CreditState> {
  return { paid: Number.MAX_SAFE_INTEGER, total: Number.MAX_SAFE_INTEGER }
}

/**
 * Mark payment as spent - no-op in free tier.
 * Always returns false (not spent) since there are no payments.
 */
export async function tryMarkSpent(_env: Env, _hash: string, _address: string): Promise<boolean> {
  return false
}

/**
 * Check if payment hash was spent - always false in free tier.
 */
export async function isSpent(_env: Env, _hash: string): Promise<boolean> {
  return false
}

/**
 * Mark payment as spent - no-op in free tier.
 */
export async function markSpent(_env: Env, _hash: string, _address: string): Promise<void> {
  // No-op in free tier
}
