import type { Config } from './config'

interface ChainTransaction {
  hash?: string
  from?: string
  to?: string
  value?: number | string
  confirmations?: number
  blockNumber?: number
}

interface RpcEnvelope<T> {
  result?: { data?: T } | T
  error?: unknown
}

const RPC_TIMEOUT_MS = 5_000
const RPC_MAX_RESPONSE_BYTES = 256 * 1024
const MAX_HISTORY = 50

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

async function rpcCall<T>(base: string, method: string, params: unknown[]): Promise<T | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS)
  try {
    const response = await fetch(base, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal,
    })
    if (!response.ok) return null

    const declared = Number(response.headers.get('content-length') ?? '0')
    if (Number.isFinite(declared) && declared > RPC_MAX_RESPONSE_BYTES) return null
    const text = await response.text()
    if (new TextEncoder().encode(text).byteLength > RPC_MAX_RESPONSE_BYTES) return null
    const body = JSON.parse(text) as RpcEnvelope<T>
    if (!body.result || body.error) return null

    const result: unknown = body.result
    if (typeof result === 'object' && result !== null && 'data' in result) {
      return (result as { data?: T }).data ?? null
    }
    return result as T
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function loadTransactions(rpcUrl: string, address: string): Promise<ChainTransaction[]> {
  const base = rpcUrl.replace(/\/+$/, '')
  if (!base) return []

  // Albatross RPC exposes address history as hashes. Fetch the transaction
  // records only after the hash list succeeds, so the verifier can inspect the
  // sender, recipient, amount, and confirmation count.
  const hashes = await rpcCall<string[]>(base, 'getTransactionHashesByAddress', [address, MAX_HISTORY, null])
  if (hashes?.length) {
    const transactions: ChainTransaction[] = []
    for (const hash of hashes.slice(0, MAX_HISTORY)) {
      const transaction = await rpcCall<ChainTransaction>(base, 'getTransactionByHash', [hash])
      if (transaction) transactions.push(transaction)
    }
    if (transactions.length) return transactions
  }

  // Keep a compatibility fallback for providers that expose the older
  // convenience method instead of the two-call Albatross history API.
  const result = await rpcCall<unknown>(base, 'getTransactionsByAddress', [address])
  const transactions = collect(result)
  if (transactions.length) return transactions

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
