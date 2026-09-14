/**
 * Session state: are we inside Nimiq Pay, and whose wallet is this?
 *
 * Two runtime modes:
 *  - `nimiq`   — running in the Nimiq Pay WebView with native wallet identity.
 *  - `preview` — a normal browser. Production uses Nimiq Hub for wallet
 *                authentication. Only the local Vite preview uses
 *                the synthetic wallet and offline generator.
 *
 * Nothing here prompts at boot. Wallet sign in starts on the first action that
 * needs identity. Planning never requires a payment. NIM transfers are used
 * for an explicit fee free plan proof and product actions such as anchors,
 * bounties, and builder tips.
 */
import { computed, readonly, ref } from 'vue'
import {
  clearAuthToken,
  getAuthChallenge,
  getPlanProofChallenge,
  hasAuthToken,
  setAuthToken,
  verifyAuth,
  verifyPlanProof,
} from './api'
import type { WalletProofChallenge } from './api'
import type { WalletProof } from './plan'
import {
  ProviderError,
  chooseAddressInBrowser,
  connectWallet,
  detectLanguage,
  getChainStatus,
  getProvider,
  isInsideNimiqPay,
  sendPayment,
  sendPaymentInBrowser,
  signMessage,
  signMessageInBrowser,
  type BrowserSignedMessage,
  type NimiqProvider,
  type SignedMessage,
} from './nimiq'

export type SessionMode = 'booting' | 'nimiq' | 'preview'

export interface SessionPayment {
  receipt: string
  sender: string
}

const mode = ref<SessionMode>('booting')
const address = ref<string | null>(null)
const connecting = ref(false)
const language = ref('en')
const blockHeight = ref<number | null>(null)
const consensus = ref(false)
const lastError = ref<string | null>(null)

/**
 * Browser Hub needs two user gestures: choose the address, then sign for it.
 * Keep the selected address in memory between those gestures so the challenge
 * cannot silently fall back to another Hub account.
 */
const browserSigner = ref<string | null>(null)

let provider: NimiqProvider | null = null
let bootPromise: Promise<void> | null = null

/** Synthetic address used in preview mode so the whole flow stays walkable. */
const PREVIEW_ADDRESS = 'NQ07 0000 0000 0000 0000 0000 0000 0000 PRVW'
const localPreview = import.meta.env.DEV && !import.meta.env.VITE_API_BASE

export function useSession() {
  async function boot(): Promise<void> {
    if (bootPromise) return bootPromise
    bootPromise = (async () => {
      language.value = detectLanguage()

      // A normal browser must never wait for the Mini App provider. Some
      // wallet extensions expose similarly named globals, so the synchronous
      // host check is the source of truth for choosing Nimiq Pay or Hub.
      if (!isInsideNimiqPay()) {
        mode.value = 'preview'
        return
      }

      try {
        provider = await getProvider()
        mode.value = 'nimiq'
        void refreshChain()
      } catch {
        // `init()` times out outside Nimiq Pay. Expected on desktop.
        mode.value = 'preview'
      }
    })()
    return bootPromise
  }

  async function refreshChain(): Promise<void> {
    if (!provider) return
    try {
      const status = await getChainStatus(provider)
      consensus.value = status.consensus
      blockHeight.value = status.blockHeight
    } catch {
      /* read-only, non-fatal */
    }
  }

  /** Returns the connected address, or null if the user declined. */
  async function connect(): Promise<string | null> {
    if (mode.value === 'booting') await boot()
    if (address.value) return address.value
    lastError.value = null

    if (mode.value === 'preview' && localPreview) {
      address.value = PREVIEW_ADDRESS
      return address.value
    }
    if (mode.value === 'preview') return null
    if (!provider) return null

    connecting.value = true
    try {
      address.value = await connectWallet(provider)
      return address.value
    } catch (error) {
      lastError.value =
        error instanceof ProviderError && error.isDenied
          ? 'Connect your Nimiq wallet to generate a plan.'
          : error instanceof Error
            ? error.message
            : 'Could not reach your wallet.'
      return null
    } finally {
      connecting.value = false
    }
  }

  /** Establish a short lived server session by signing a one time challenge. */
  async function authenticate(minBalance?: number): Promise<string | null> {
    if (mode.value === 'booting') {
      // Preserve the click's user activation for Hub. The browser path does
      // not need the provider poll, and waiting for it would block the popup.
      if (isInsideNimiqPay()) await boot()
      else {
        mode.value = 'preview'
        void boot()
      }
    }
    if (localPreview) return connect()

    // A few mobile WebViews inject their host bridge after the first paint.
    // If boot classified that first paint as a browser, re-check on the user's
    // tap and switch to the native provider before opening a Hub popup.
    if (mode.value === 'preview' && isInsideNimiqPay()) {
      bootPromise = null
      mode.value = 'booting'
      await boot()
    }

    // A previous successful auth is enough. In browser mode the address is
    // already known from the Hub signer; in Pay mode it came from listAccounts.
    if (address.value && hasAuthToken(address.value)) return address.value

    try {
      const compact = (value: string): string => value.replace(/\s+/g, '').toUpperCase()

      if (mode.value === 'preview') {
        // Nimiq Hub is the standalone Chrome path. Choose the account in one
        // request, then sign the challenge for that exact address on the next
        // tap. Opening a second popup after an awaited Hub request is blocked
        // by modern browsers, so this explicit two-step flow is intentional.
        lastError.value = null
        const signer = browserSigner.value ?? address.value
        if (!signer) {
          const selected = await chooseAddressInBrowser(minBalance)
          browserSigner.value = selected
          address.value = selected
          lastError.value = 'Wallet selected. Tap the action again to verify it with Cairn.'
          return null
        }
        const challengePromise = getAuthChallenge(signer)
        const signed = await signMessageInBrowser(
          challengePromise.then((challenge) => challenge.message),
          signer,
        )
        if (compact(signed.address) !== compact(signer)) {
          throw new Error('The wallet returned a different address. Choose the funded account again.')
        }
        const challenge = await challengePromise
        if (hasAuthToken(signed.address)) {
          address.value = signed.address
          return signed.address
        }
        const result = await verifyAuth({
          address: signed.address,
          challenge: challenge.challenge,
          publicKey: signed.publicKey,
          signature: signed.signature,
        })
        if (compact(result.address) !== compact(signed.address)) {
          throw new Error('The wallet session did not match the connected wallet.')
        }
        address.value = result.address
        setAuthToken(result.token, result.address)
        return result.address
      }

      const wallet = await connect()
      if (!wallet || !provider) return null
      if (hasAuthToken(wallet)) return wallet

      lastError.value = null
      const challenge = await getAuthChallenge(wallet)
      const signed = await signMessage(provider, challenge.message)
      const result = await verifyAuth({
        address: wallet,
        challenge: challenge.challenge,
        publicKey: signed.publicKey,
        signature: signed.signature,
      })
      if (compact(result.address) !== compact(wallet)) {
        throw new Error('The wallet session did not match the connected wallet.')
      }
      address.value = result.address
      setAuthToken(result.token, result.address)
      return result.address
    } catch (error) {
      clearAuthToken()
      lastError.value =
        error instanceof ProviderError && error.isDenied
          ? 'Sign the Cairn message to continue.'
          : error instanceof Error
            ? error.message
            : 'Could not verify your wallet.'
      return null
    }
  }

  async function pay(recipient: string, valueLuna: number, note: string): Promise<SessionPayment | null> {
    if (mode.value === 'booting') await boot()
    lastError.value = null
    try {
      if (mode.value === 'nimiq' && provider) {
        const connected = await connectWallet(provider)
        const canonical = (value: string): string => value.replace(/\s+/g, '').toUpperCase()
        if (address.value && canonical(connected) !== canonical(address.value)) {
          throw new ProviderError('The connected wallet changed. Sign in again before paying.', 'WalletChanged')
        }
        return {
          receipt: await sendPayment(provider, recipient, valueLuna, note),
          sender: connected,
        }
      }
      if (mode.value === 'preview' && !localPreview) {
        return await sendPaymentInBrowser(recipient, valueLuna, note, address.value ?? undefined)
      }
      return null
    } catch (error) {
      lastError.value =
        error instanceof ProviderError && error.isDenied
          ? 'Payment cancelled.'
          : error instanceof Error
            ? error.message
            : 'Payment failed.'
      return null
    }
  }

  /** Submit a self transfer whose data field is the 32 byte PRD hash in hex. */
  async function anchor(hash: string): Promise<SessionPayment | null> {
    if (!/^[a-f0-9]{64}$/i.test(hash)) {
      lastError.value = 'The plan hash is invalid.'
      return null
    }
    if (mode.value === 'booting') await boot()
    lastError.value = null
    try {
      const wallet = address.value ?? await authenticate()
      if (!wallet) return null
      if (mode.value === 'nimiq' && provider) {
        return {
          receipt: await sendPayment(provider, wallet, 1, hash.toLowerCase()),
          sender: wallet,
        }
      }
      if (mode.value === 'preview' && !localPreview) {
        return await sendPaymentInBrowser(wallet, 1, hash.toLowerCase(), wallet)
      }
      return null
    } catch (error) {
      lastError.value =
        error instanceof ProviderError && error.isDenied
          ? 'Anchor transaction cancelled.'
          : error instanceof Error
            ? error.message
            : 'Anchor transaction failed.'
      return null
    }
  }

  /** Sign and server verify the current plan snapshot without spending NIM. */
  async function signPlanProof(hash: string): Promise<WalletProof | null> {
    if (!/^[a-f0-9]{64}$/i.test(hash)) {
      lastError.value = 'The plan proof hash is invalid.'
      return null
    }
    if (mode.value === 'booting') await boot()
    const wallet = address.value ?? await authenticate()
    if (!wallet) return null
    if (localPreview) {
      lastError.value = 'Plan proofs need the Cairn Worker and a Nimiq wallet.'
      return null
    }

    try {
      const challengePromise = getPlanProofChallenge(hash)
      let signed: SignedMessage | BrowserSignedMessage
      let challenge: WalletProofChallenge

      if (mode.value === 'nimiq' && provider) {
        challenge = await challengePromise
        signed = await signMessage(provider, challenge.message)
      } else if (mode.value === 'preview') {
        // Open Hub before awaiting the Worker response so Chrome keeps the
        // original tap's popup activation, just like wallet authentication.
        signed = await signMessageInBrowser(
          challengePromise.then((value) => value.message),
          wallet,
        )
        challenge = await challengePromise
      } else {
        lastError.value = 'Could not reach your Nimiq wallet.'
        return null
      }

      const result = await verifyPlanProof({
        challenge: challenge.challenge,
        hash: challenge.hash,
        publicKey: signed.publicKey,
        signature: signed.signature,
      })
      const canonical = (value: string): string => value.replace(/\s+/g, '').toUpperCase()
      if (canonical(result.proof.address) !== canonical(wallet)) {
        throw new Error('The wallet proof did not match the connected wallet.')
      }
      return result.proof
    } catch (error) {
      lastError.value =
        error instanceof ProviderError && error.isDenied
          ? 'Plan signing cancelled.'
          : error instanceof Error
            ? error.message
            : 'Could not verify the plan signature.'
      return null
    }
  }

  /** Clear the in memory wallet session so a different wallet can reconnect. */
  function disconnect(): void {
    clearAuthToken()
    address.value = null
    browserSigner.value = null
    lastError.value = null
  }

  return {
    mode: readonly(mode),
    address: readonly(address),
    connecting: readonly(connecting),
    language: readonly(language),
    blockHeight: readonly(blockHeight),
    consensus: readonly(consensus),
    lastError,
    isConnected: computed(() => address.value !== null),
    isPreview: computed(() => mode.value === 'preview'),
    boot,
    connect,
    authenticate,
    anchor,
    signPlanProof,
    pay,
    disconnect,
    refreshChain,
  }
}
