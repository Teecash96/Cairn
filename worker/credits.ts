import type { CreditRecord, CreditState, Env } from './types'

export function stateOf(record: CreditRecord | null): CreditState {
  const paid = record?.paid ?? 0
  return { paid, total: paid }
}

export async function readCredits(env: Env, address: string): Promise<CreditRecord | null> {
  return env.CAIRN.get<CreditRecord>(`credit:${address}`, 'json')
}

async function writeCredits(env: Env, address: string, record: CreditRecord): Promise<void> {
  await env.CAIRN.put(`credit:${address}`, JSON.stringify(record))
}

export async function spendOne(env: Env, address: string): Promise<CreditState | null> {
  const record = await readCredits(env, address)
  if (!record || record.paid < 1) return null
  const updated = { ...record, paid: record.paid - 1 }
  await writeCredits(env, address, updated)
  return stateOf(updated)
}

export async function grantPaid(env: Env, address: string, amount: number): Promise<CreditState> {
  const record = (await readCredits(env, address)) ?? { paid: 0, createdAt: Date.now() }
  const updated = { ...record, paid: record.paid + amount }
  await writeCredits(env, address, updated)
  return stateOf(updated)
}

export async function isSpent(env: Env, hash: string): Promise<boolean> {
  return (await env.CAIRN.get(`spent:${hash}`)) !== null
}

export async function markSpent(env: Env, hash: string, address: string): Promise<void> {
  await env.CAIRN.put(`spent:${hash}`, address)
}
