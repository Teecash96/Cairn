import type { Config } from './config'

interface ChainTransaction {
  hash?: string
  from?: string
  to?: string
  value?: number | string
  confirmations?: number
  blockNumber?: number
}

function compact(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase()
}

function numberValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value)
  return 0
}

function collect(value: unknown): ChainTransaction[] {
  if (Array.isArray(value)) return value.filter(isTransaction)
  if (typeof value !== 'object' || value === null) return []
  const record = value as Record<string, unknown>
  for (const key of ['transactions', 'result', 'data', 'items']) {
    const found = collect(record[key])
    if (found.length) return found
  }
  return isTransaction(value) ? [value] : []
}

function isTransaction(value: unknown): value is ChainTransaction {
  return typeof value === 'object' && value !== null && ('hash' in value || 'from' in value)
}

async function loadTransactions(rpcUrl: string, address: string): Promise<ChainTransaction[]> {
  const base = rpcUrl.replace(/\/+$/, '')
  if (!base) return []
  const candidates: Request[] = [
    new Request(`${base}/account/${encodeURIComponent(address)}/transactions`),
    new Request(`${base}/accounts/${encodeURIComponent(address)}/transactions`),
    new Request(base, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTransactionsByAddress',
        params: [address],
      }),
    }),
  ]

  for (const request of candidates) {
    try {
      const response = await fetch(request)
      if (!response.ok) continue
      const body: unknown = await response.json()
      const transactions = collect(body)
      if (transactions.length) return transactions
    } catch {
      continue
    }
  }
  return []
}

function hashOf(transaction: ChainTransaction): string | null {
  return typeof transaction.hash === 'string' && transaction.hash.length > 0
    ? transaction.hash
    : null
}

/**
 * Verify an incoming NIM payment without trusting the receipt returned by the SDK.
 *
 * The RPC URL is deliberately configuration, not a hardcoded public service. The
 * exact history endpoint can differ by node provider. No configured endpoint means
 * false, never an accidental grant.
 */
export async function verifyPayment(
  config: Config,
  address: string,
  amount: number,
  receipt: string,
): Promise<string | null> {
  if (!config.payTo || amount <= 0 || !receipt) return null

  const transactions = await loadTransactions(config.rpcUrl, config.payTo)
  const sender = compact(address)
  const recipient = compact(config.payTo)

  for (const transaction of transactions) {
    const hash = hashOf(transaction)
    if (!hash || hash === receipt) {
      if (!hash) continue
    }
    if (compact(transaction.from ?? '') !== sender) continue
    if (compact(transaction.to ?? '') !== recipient) continue
    if (numberValue(transaction.value) < amount) continue
    if (numberValue(transaction.confirmations) < 1 && numberValue(transaction.blockNumber) <= 0) continue
    return hash
  }
  return null
}
