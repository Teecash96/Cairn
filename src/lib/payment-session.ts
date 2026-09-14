export interface CompletedPayment {
  receipt: string
  sender: string
}

export interface PendingPayment {
  address: string
  receipt: string
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
    return { address: value.address, receipt: value.receipt }
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
