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

/** Bind a Hub receipt to the address that signed the actual transaction. */
export function bindPayment(
  authenticatedAddress: string,
  payment: CompletedPayment,
): { pending: PendingPayment; requiresPayerAuth: boolean } {
  return {
    pending: { address: payment.sender, receipt: payment.receipt },
    requiresPayerAuth: compactAddress(payment.sender) !== compactAddress(authenticatedAddress),
  }
}
