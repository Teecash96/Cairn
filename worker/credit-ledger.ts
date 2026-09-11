import type { CreditRecord, Env } from './types'

interface Receipt { address: string; amount: number }

/**
 * A single, named Durable Object owns balances and globally unique receipts.
 * Its SQLite-backed storage transaction covers every balance mutation.
 * Legacy KV is read-only after cutover; never re-enable the old writer.
 */
export class CreditLedger {
  private storage: DurableObjectStorage
  private env: Env

  constructor(state: DurableObjectState, env: Env) {
    this.storage = state.storage
    this.env = env
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
    const input = await request.json<{ action: string; address: string; hash?: string; amount?: number }>()
    const { action, address } = input
    if (!['read', 'spend', 'redeem'].includes(action) || typeof address !== 'string' || !address || address.length > 64) {
      return new Response('Invalid ledger request', { status: 400 })
    }
    const hash = input.hash?.toLowerCase()
    if (action === 'redeem' && (!hash || !/^[a-z0-9-]{1,128}$/.test(hash) || !Number.isSafeInteger(input.amount) || input.amount! < 1)) {
      return new Response('Invalid redemption', { status: 400 })
    }
    const key = `credit:${address}`
    // Fetch immutable legacy data outside the transaction, then recheck inside.
    const existing = await this.storage.get<CreditRecord>(key)
    const legacy = existing === undefined ? await this.env.CAIRN.get<CreditRecord>(key, 'json') : null
    if (legacy && (!Number.isSafeInteger(legacy.paid) || legacy.paid < 0)) {
      throw new Error('Invalid legacy credit balance; reconciliation required')
    }
    const spentKey = `spent:${hash}`
    const legacySpent = action === 'redeem'
      ? (await Promise.all([...new Set([hash!, input.hash!, hash!.toUpperCase()])].map((value) => this.env.CAIRN.get(`spent:${value}`)))).find((value) => value !== null) ?? null
      : null

    const result = await this.storage.transaction(async (transaction) => {
      const record = (await transaction.get<CreditRecord>(key)) ?? legacy ?? { paid: 0, createdAt: Date.now() }
      // Persist even zero on first access: later reads must never re-import KV.
      if (action === 'read') {
        await transaction.put(key, record)
        return record
      }
      if (action === 'spend') {
        if (record.paid < 1) return null
        const updated = { ...record, paid: record.paid - 1 }
        await transaction.put(key, updated)
        return { paid: updated.paid, total: updated.paid }
      }
      const receipt = await transaction.get<Receipt>(spentKey)
      if (receipt) {
        // A lost response can be retried, but the same payment cannot mint credits again.
        if (receipt.address !== address) return null
        return { credits: { paid: record.paid, total: record.paid }, granted: 0 }
      }
      // Old receipts may represent a historical partial write: never guess a grant.
      if (legacySpent !== null) return null
      const paid = record.paid + input.amount!
      if (!Number.isSafeInteger(paid)) throw new Error('Credit balance overflow')
      await transaction.put(key, { ...record, paid })
      await transaction.put(spentKey, { address, amount: input.amount! })
      return { credits: { paid, total: paid }, granted: input.amount! }
    })
    return Response.json(result)
  }
}
