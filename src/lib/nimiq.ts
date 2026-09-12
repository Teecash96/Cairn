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
 *     type is just `string`. We store it verbatim as an opaque `receipt` and
 *     never depend on which it is — the server verifies a payment by matching
 *     sender and amount against the receiving address's incoming transactions,
 *     not by looking the receipt up. See `sendPayment` below.
 */
import {
  init,
  getHostLanguage,
  type NimiqProvider,
  type ErrorResponse,
} from '@nimiq/mini-app-sdk'
import HubApi from '@nimiq/hub-api'

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
    return /denied|rejected|cancel|closed/i.test(`${this.type} ${this.message}`)
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
 * True when this page is running in Nimiq Pay.
 *
 * The provider can arrive a little after the document starts, especially on
 * mobile. The host context is injected before page scripts. Its language marker
 * and device API are only available inside Nimiq Pay, so either is a safe early
 * signal. A browser extension may expose a `nimiqPay` helper object without
 * those host fields; that must continue down the standalone Hub path.
 */
export function isInsideNimiqPay(): boolean {
  if (typeof window === 'undefined') return false
  const host = window.nimiqPay
  const extendedHost = host as (typeof host & {
    sendBasicTransactionWithData?: unknown
  }) | undefined
  return Boolean(
    window.nimiq ||
      typeof host?.language === 'string' ||
      typeof host?.requestDeviceIdentifier === 'function' ||
      typeof extendedHost?.sendBasicTransactionWithData === 'function',
  )
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

/** Ask for the user's wallet. This is the call that makes them a "unique user". */
export async function connectWallet(provider: NimiqProvider): Promise<string> {
  const accounts = unwrap(await provider.listAccounts())
  if (!accounts.length) {
    throw new ProviderError('Nimiq Pay returned no accounts.', 'NoAccounts')
  }
  return accounts[0]
}

export interface SignedMessage {
  publicKey: string
  signature: string
}

/** Sign a server challenge without exposing a private key to the mini app. */
export async function signMessage(provider: NimiqProvider, message: string): Promise<SignedMessage> {
  return unwrap(await provider.sign({ message }))
}

const HUB_ENDPOINT = 'https://hub.nimiq.com'
const HUB_APP_NAME = 'Cairn'

const HUB_SIGN_FEATURES = 'left=200,top=75,width=800,height=850,location=yes,dependent=yes'
const HUB_CHECKOUT_FEATURES = 'left=200,top=50,width=800,height=895,location=yes,dependent=yes'

function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function hubError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error
  const message = error instanceof Error && error.message
    ? error.message
    : 'Could not reach your Nimiq wallet.'
  const type = /denied|rejected|cancel|closed/i.test(message) ? 'UserDenied' : 'HubError'
  return new ProviderError(message, type)
}

export interface BrowserSignedMessage extends SignedMessage {
  address: string
}

/**
 * Ask Hub which Nimiq address the user wants Cairn to use.
 *
 * Sign-message requests without a signer show Hub's account selector, but the
 * selected account is not returned until after the signature. That makes it
 * possible for authentication and checkout to use different accounts. The
 * explicit choose-address step gives the caller a stable address to bind to
 * both the challenge and the later payment.
 */
export async function chooseAddressInBrowser(minBalance?: number): Promise<string> {
  let popup: Window | null = null
  try {
    // Preserve the original tap's user activation for the Hub popup.
    popup = openHubPopup(HUB_SIGN_FEATURES)
    const PopupRequestBehavior = HubApi.PopupRequestBehavior
    class PreopenedPopupBehavior extends PopupRequestBehavior {
      readonly existing: Window

      constructor(existing: Window) {
        super(HUB_SIGN_FEATURES)
        this.existing = existing
      }

      override createPopup(url: string): Window {
        if (this.existing.closed) throw new Error('Nimiq Hub popup was closed.')
        this.existing.location.href = url
        return this.existing
      }
    }
    const hub = new HubApi(HUB_ENDPOINT)
    const selected = await hub.chooseAddress({
      appName: HUB_APP_NAME,
      ...(typeof minBalance === 'number' && minBalance > 0 ? { minBalance } : {}),
    }, new PreopenedPopupBehavior(popup))
    if (!selected || typeof selected.address !== 'string' || !selected.address) {
      throw new Error('Nimiq Hub returned no address.')
    }
    return selected.address
  } catch (error) {
    throw hubError(error)
  } finally {
    if (popup && !popup.closed) popup.close()
  }
}

/**
 * Open Hub while the original tap still has browser user activation.
 *
 * Chrome blocks window.open when it happens after a fetch or a lazy-import.
 * The popup starts as about:blank, then the Hub request behavior navigates it
 * once the challenge and Hub module are ready.
 */
function openHubPopup(features: string): Window {
  const popup = window.open('about:blank', 'NimiqAccounts', features)
  if (!popup) {
    throw new ProviderError(
      'Could not open Nimiq Hub. Allow pop-ups for Cairn and try again.',
      'PopupBlocked',
    )
  }
  return popup
}

/**
 * Sign a server challenge through Nimiq Hub when Cairn is opened in Chrome.
 */
export async function signMessageInBrowser(
  message: string | PromiseLike<string>,
  signer?: string,
): Promise<BrowserSignedMessage> {
  let popup: Window | null = null
  try {
    // This must be the first operation. Awaiting the challenge fetch before
    // window.open loses Chrome's transient user activation.
    popup = openHubPopup(HUB_SIGN_FEATURES)
    const text = await message
    const PopupRequestBehavior = HubApi.PopupRequestBehavior
    class PreopenedPopupBehavior extends PopupRequestBehavior {
      readonly existing: Window

      constructor(existing: Window) {
        super(HUB_SIGN_FEATURES)
        this.existing = existing
      }

      override createPopup(url: string): Window {
        if (this.existing.closed) throw new Error('Nimiq Hub popup was closed.')
        this.existing.location.href = url
        return this.existing
      }
    }
    const hub = new HubApi(HUB_ENDPOINT)
    const signed = await hub.signMessage(
      {
        appName: HUB_APP_NAME,
        message: text,
        ...(signer ? { signer } : {}),
      },
      new PreopenedPopupBehavior(popup),
    )
    if (
      typeof signed.signer !== 'string' ||
      !signed.signer ||
      !(signed.signerPublicKey instanceof Uint8Array) ||
      signed.signerPublicKey.byteLength !== 32 ||
      !(signed.signature instanceof Uint8Array) ||
      signed.signature.byteLength !== 64
    ) {
      throw new Error('Nimiq Hub returned an invalid signature.')
    }
    return {
      address: signed.signer,
      publicKey: bytesToHex(signed.signerPublicKey),
      signature: bytesToHex(signed.signature),
    }
  } catch (error) {
    throw hubError(error)
  } finally {
    if (popup && !popup.closed) popup.close()
  }
}

export interface BrowserPayment {
  receipt: string
  sender: string
}

/** Send a real NIM payment through Nimiq Hub when Cairn is opened in Chrome. */
export async function sendPaymentInBrowser(
  recipient: string,
  valueLuna: number,
  note?: string,
  sender?: string,
): Promise<BrowserPayment> {
  let popup: Window | null = null
  try {
    popup = openHubPopup(HUB_CHECKOUT_FEATURES)
    const PopupRequestBehavior = HubApi.PopupRequestBehavior
    class PreopenedPopupBehavior extends PopupRequestBehavior {
      readonly existing: Window

      constructor(existing: Window) {
        super(HUB_CHECKOUT_FEATURES)
        this.existing = existing
      }

      override createPopup(url: string): Window {
        if (this.existing.closed) throw new Error('Nimiq Hub popup was closed.')
        this.existing.location.href = url
        return this.existing
      }
    }
    const hub = new HubApi(HUB_ENDPOINT)
    const signed = await hub.checkout({
      appName: HUB_APP_NAME,
      recipient,
      value: valueLuna,
      // Hub can hold a stale local balance for an otherwise funded address.
      // Keep the authenticated sender as the preferred account, but allow Hub
      // to refresh its account selector instead of rejecting the checkout.
      ...(sender ? { sender, forceSender: false } : {}),
      ...(note ? { extraData: note } : {}),
    }, new PreopenedPopupBehavior(popup))
    if (
      !signed ||
      typeof signed.hash !== 'string' ||
      !signed.hash ||
      !signed.raw ||
      typeof signed.raw.sender !== 'string' ||
      !signed.raw.sender
    ) {
      throw new Error('Nimiq Hub returned incomplete payment details.')
    }
    return { receipt: signed.hash, sender: signed.raw.sender }
  } catch (error) {
    throw hubError(error)
  } finally {
    if (popup && !popup.closed) popup.close()
  }
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
 * Send NIM from the current user to Cairn's receiving address.
 *
 * Cairn never custodies funds and holds no balances: the send goes straight from
 * the user's wallet to the app address, and buys a bundle of generations. Nothing
 * is refundable because nothing is held. `fee` is deliberately omitted — Nimiq
 * Pay picks one, and uses 0 where it can.
 *
 * The returned string is opaque. Whether the SDK hands back a transaction hash or
 * a serialized transaction (its own type definitions disagree with the docs site —
 * see the header), the server never reads it: verification matches sender and
 * amount against the receiving address's incoming transactions. The receipt is
 * passed along only as an idempotency hint.
 *
 * @param valueLuna amount in LUNA (see lib/units.ts — 1 NIM = 100,000 Luna)
 * @param note      attached to the transaction, visible in the user's history
 */
export async function sendPayment(
  provider: NimiqProvider,
  recipient: string,
  valueLuna: number,
  note?: string,
): Promise<string> {
  const tx = { recipient, value: valueLuna }
  return note
    ? unwrap(await provider.sendBasicTransactionWithData({ ...tx, data: note }))
    : unwrap(await provider.sendBasicTransaction(tx))
}
