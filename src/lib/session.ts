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
 * needs identity. Cairn never requests a payment or device identifier.
 */
import { computed, readonly, ref } from 'vue'
import { clearAuthToken, getAuthChallenge, hasAuthToken, setAuthToken, verifyAuth } from './api'
import {
  ProviderError,
  connectWallet,
  detectLanguage,
  getChainStatus,
  getProvider,
  isInsideNimiqPay,
  sendPayment,
  sendPaymentInBrowser,
  signMessage,
  signMessageInBrowser,
  type NimiqProvider,
} from './nimiq'

export type SessionMode = 'booting' | 'nimiq' | 'preview'

const mode = ref<SessionMode>('booting')
const address = ref<string | null>(null)
const connecting = ref(false)
const language = ref('en')
const blockHeight = ref<number | null>(null)
const consensus = ref(false)
const lastError = ref<string | null>(null)

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
  async function authenticate(): Promise<string | null> {
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
        // Nimiq Hub is the standalone Chrome path. The signer address is
        // returned by Hub before the server verifies the signature.
        lastError.value = null
        const challengePromise = getAuthChallenge()
        const signed = await signMessageInBrowser(
          challengePromise.then((challenge) => challenge.message),
        )
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

  async function pay(recipient: string, valueLuna: number, note: string): Promise<string | null> {
    if (mode.value === 'booting') await boot()
    lastError.value = null
    try {
      if (mode.value === 'nimiq' && provider) {
        return await sendPayment(provider, recipient, valueLuna, note)
      }
      if (mode.value === 'preview' && !localPreview) {
        return await sendPaymentInBrowser(recipient, valueLuna, note)
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
    pay,
    refreshChain,
  }
}
