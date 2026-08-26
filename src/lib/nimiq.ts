/**
 * Thin wrapper over `@nimiq/mini-app-sdk`.
 *
 * Two things the published docs get wrong, both verified against the shipped
 * type definitions in `@nimiq/mini-app-sdk@0.1.0`:
 *
 *  1. Provider methods RESOLVE with `T | ErrorResponse`. They do not throw on a
 *     declined prompt. `try/catch` alone will silently treat a refusal as
 *     success, so every call goes through `unwrap()` below.
 *
 *  2. `sendBasicTransaction`'s JSDoc says it returns "the serialized
 *     transaction", while the docs site says it returns a transaction hash. The
 *     type is just `string`. We store it verbatim as an opaque `receipt` and do
 *     not assume which it is — see TODO in `payForTile`.
 */
import {
  init,
  getHostLanguage,
  requestDeviceIdentifier,
  type NimiqProvider,
  type ErrorResponse,
} from '@nimiq/mini-app-sdk'

export type { NimiqProvider }

/** A declined prompt or provider failure, normalised to something throwable. */
export class ProviderError extends Error {
  readonly type: string

  constructor(message: string, type = 'ProviderError') {
    super(message)
    this.name = 'ProviderError'
    this.type = type
  }

  /** True when the user actively refused the native dialog. */
  get isDenied(): boolean {
    return /denied|rejected|cancel/i.test(`${this.type} ${this.message}`)
  }
}

function isErrorResponse(value: unknown): value is ErrorResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as ErrorResponse).error === 'object'
  )
}

/**
 * Collapse the `T | ErrorResponse` union into `T`, throwing ProviderError
 * otherwise. Declining a prompt is a normal path in this app, not an
 * exceptional one — callers are expected to handle it.
 */
export function unwrap<T>(result: T | ErrorResponse): T {
  if (isErrorResponse(result)) {
    throw new ProviderError(
      result.error.message || 'Nimiq Pay refused the request.',
      result.error.type,
    )
  }
  return result
}

let providerPromise: Promise<NimiqProvider> | null = null

/**
 * True when Nimiq Pay has injected its host objects. `window.nimiqPay` is seeded
 * synchronously before the page script runs, so this is reliable at boot.
 */
export function isInsideNimiqPay(): boolean {
  return typeof window !== 'undefined' && (!!window.nimiq || !!window.nimiqPay)
}

/**
 * Resolve the injected provider.
 *
 * `init()` polls `window.nimiq` until its timeout — 10s by default. Outside
 * Nimiq Pay the provider is never coming, and holding a blank screen for ten
 * seconds is the worst possible first impression, so we only wait the long
 * timeout when the host objects are actually present.
 */
export function getProvider(): Promise<NimiqProvider> {
  providerPromise ??= init({ timeout: isInsideNimiqPay() ? 10_000 : 1_200 })
  return providerPromise
}

/** ISO 639-1 code chosen by the user in Nimiq Pay; falls back to the browser. */
export function detectLanguage(): string {
  return getHostLanguage() || navigator.language.split('-')[0] || 'en'
}

/**
 * Pseudonymous per-origin device id. Prompts once, then resolves silently.
 *
 * NOTE: this identifies the DEVICE, not the user, and it is NOT a wallet — the
 * competition's "unique users" criterion counts distinct Nimiq wallets, so this
 * is only ever used for local persistence, never as a substitute for
 * `listAccounts()`.
 */
export async function getDeviceId(): Promise<string | null> {
  try {
    return await requestDeviceIdentifier({
      reason: 'Remember your plot on the Ecoflow grid',
    })
  } catch {
    return null
  }
}

/** Ask for the user's wallet. This is the call that makes them a "unique user". */
export async function connectWallet(provider: NimiqProvider): Promise<string> {
  const accounts = unwrap(await provider.listAccounts())
  if (!accounts.length) {
    throw new ProviderError('Nimiq Pay returned no accounts.', 'NoAccounts')
  }
  return accounts[0]
}

export interface ChainStatus {
  consensus: boolean
  blockHeight: number
}

/** Both of these are read-only and prompt-free. */
export async function getChainStatus(provider: NimiqProvider): Promise<ChainStatus> {
  const [consensus, blockHeight] = await Promise.all([
    provider.isConsensusEstablished(),
    provider.getBlockNumber(),
  ])
  return { consensus, blockHeight }
}

/**
 * Send NIM from the current user straight to another player's address.
 *
 * Ecoflow never custodies funds: a takeover pays the previous tile holder
 * wallet-to-wallet. `fee` is deliberately omitted — Nimiq Pay picks one, and
 * uses 0 where it can.
 *
 * @param valueLuna amount in LUNA (see lib/units.ts — 1 NIM = 100,000 Luna)
 * @param note      attached to the transaction, visible in the user's history
 */
export async function payForTile(
  provider: NimiqProvider,
  recipient: string,
  valueLuna: number,
  note?: string,
): Promise<string> {
  const tx = { recipient, value: valueLuna }
  const receipt = note
    ? unwrap(await provider.sendBasicTransactionWithData({ ...tx, data: note }))
    : unwrap(await provider.sendBasicTransaction(tx))

  // TODO(device): confirm on a real handset whether this string is a tx hash or
  // a serialized transaction. Server-side payment verification depends on it —
  // if serialized, the hash must be derived before it can be looked up.
  return receipt
}
