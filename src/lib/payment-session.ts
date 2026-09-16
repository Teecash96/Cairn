export interface CompletedPayment {
  receipt: string
  sender: string
}

export interface PendingPayment {
  address: string
  receipt: string
}

export interface PendingReward {
  teamId: string
  taskId: string
  recipient: string
  amountLuna: number
  receipt: string
  revision: number
}

function compactAddress(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase()
}

export function samePaymentAddress(left: string, right: string): boolean {
  return compactAddress(left) === compactAddress(right)
}

/** Bind a Hub receipt to the address that signed the actual transaction. */
export function bindPayment(
  authenticatedAddress: string,
  payment: CompletedPayment,
): { pending: PendingPayment; requiresPayerAuth: boolean } {
  return {
    pending: { address: payment.sender, receipt: payment.receipt },
    requiresPayerAuth: !samePaymentAddress(payment.sender, authenticatedAddress),
  }
}


const PENDING_PAYMENT_KEY = 'cairn:pending-payment:v2'
const LEGACY_PENDING_PAYMENT_KEY = 'cairn:pending-payment'
const PENDING_PAYMENT_TTL_MS = 7 * 24 * 60 * 60 * 1000
const PENDING_REWARD_KEY = 'cairn:pending-reward:v1'

interface StoredPendingPayment extends PendingPayment {
  createdAt: number
  version: 2
}

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** Keep a sent transaction recoverable when the wallet WebView or tab closes. */
export function savePendingPayment(payment: PendingPayment, storage = browserStorage()): void {
  if (!storage) return
  const value: StoredPendingPayment = { ...payment, createdAt: Date.now(), version: 2 }
  try {
    storage.setItem(PENDING_PAYMENT_KEY, JSON.stringify(value))
    storage.removeItem(LEGACY_PENDING_PAYMENT_KEY)
  } catch {
    /* Storage can be unavailable in private browsing; polling still works in memory. */
  }
}

export function loadPendingPayment(storage = browserStorage(), now = Date.now()): PendingPayment | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(PENDING_PAYMENT_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<StoredPendingPayment>
    const valid = value.version === 2
      && typeof value.address === 'string'
      && typeof value.receipt === 'string'
      && value.address.length > 0
      && value.receipt.length > 0
      && typeof value.createdAt === 'number'
      && now - value.createdAt <= PENDING_PAYMENT_TTL_MS
      && value.createdAt <= now + 60_000
    if (!valid) {
      storage.removeItem(PENDING_PAYMENT_KEY)
      return null
    }
    return { address: value.address as string, receipt: value.receipt as string }
  } catch {
    return null
  }
}

export function clearPendingPayment(storage = browserStorage()): void {
  if (!storage) return
  try {
    storage.removeItem(PENDING_PAYMENT_KEY)
    storage.removeItem(LEGACY_PENDING_PAYMENT_KEY)
  } catch {
    /* best effort */
  }
}

/** Preserve an already-sent teammate reward so reopening Cairn cannot double-pay. */
export function savePendingReward(reward: PendingReward, storage = browserStorage()): void {
  if (!storage) return
  try {
    storage.setItem(PENDING_REWARD_KEY, JSON.stringify({ ...reward, createdAt: Date.now(), version: 1 }))
  } catch {
    /* The active sheet still protects the current session. */
  }
}

export function loadPendingReward(storage = browserStorage(), now = Date.now()): PendingReward | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(PENDING_REWARD_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<PendingReward> & { createdAt?: number; version?: number }
    const valid = value.version === 1 && typeof value.teamId === 'string' && typeof value.taskId === 'string'
      && typeof value.recipient === 'string' && typeof value.amountLuna === 'number' && Number.isSafeInteger(value.amountLuna)
      && value.amountLuna > 0 && typeof value.receipt === 'string' && value.receipt.length > 0
      && typeof value.revision === 'number' && Number.isInteger(value.revision) && value.revision > 0
      && typeof value.createdAt === 'number' && now - value.createdAt <= PENDING_PAYMENT_TTL_MS && value.createdAt <= now + 60_000
    if (!valid) {
      storage.removeItem(PENDING_REWARD_KEY)
      return null
    }
    return {
      teamId: value.teamId as string,
      taskId: value.taskId as string,
      recipient: value.recipient as string,
      amountLuna: value.amountLuna as number,
      receipt: value.receipt as string,
      revision: value.revision as number,
    }
  } catch {
    return null
  }
}

export function clearPendingReward(storage = browserStorage()): void {
  if (!storage) return
  try { storage.removeItem(PENDING_REWARD_KEY) } catch { /* best effort */ }
}
