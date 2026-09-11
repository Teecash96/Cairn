import type { CreditRecord, CreditState, Env } from './types'

export class CreditLedgerUnavailable extends Error {}

export function stateOf(record: CreditRecord | null): CreditState {
  const paid = record?.paid ?? 0
  return { paid, total: paid }
}

async function ledger<T>(env: Env, body: object): Promise<T> {
  // Fail closed during cutover or a missing binding. Never fall back to KV writes.
  if (env.CREDIT_LEDGER_READY !== '1' || !env.CREDIT_LEDGER) {
    throw new CreditLedgerUnavailable('Credit ledger maintenance: finish the ledger cutover before enabling payments.')
  }
  const stub = env.CREDIT_LEDGER.get(env.CREDIT_LEDGER.idFromName('cairn-credits-v1'))
  let response: Response
  try {
    response = await stub.fetch('https://ledger.internal/', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
  } catch {
    throw new CreditLedgerUnavailable('The credit ledger is temporarily unavailable. Try again shortly.')
  }
  if (!response.ok) throw new CreditLedgerUnavailable('The credit ledger is temporarily unavailable. Try again shortly.')
  return response.json<T>()
}

export function readCredits(env: Env, address: string): Promise<CreditRecord | null> {
  return ledger(env, { action: 'read', address })
}

export function spendOne(env: Env, address: string): Promise<CreditState | null> {
  return ledger(env, { action: 'spend', address })
}

/** Verification precedes this call; receipt consumption and credit grant are atomic. */
export function redeemCredits(env: Env, address: string, hash: string, amount: number): Promise<{
  credits: CreditState; granted: number
} | null> {
  return ledger(env, { action: 'redeem', address, hash, amount })
}
