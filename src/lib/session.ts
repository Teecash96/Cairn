/**
 * Session state: are we inside Nimiq Pay, and whose wallet is this?
 *
 * Two runtime modes:
 *  - `nimiq`   — running in the Nimiq Pay WebView. Real provider, real payments.
 *  - `preview` — a normal browser. The grid is fully explorable and payments are
 *                simulated, so the game can be developed and reviewed on desktop.
 *
 * Wallet connect happens on the FIRST tap rather than behind a splash screen:
 * the competition's only quantitative criterion counts distinct Nimiq wallets,
 * so the prompt has to land inside the first minute, attached to an action the
 * player already wanted to take.
 */
import { computed, readonly, ref } from 'vue'
import {
  ProviderError,
  connectWallet,
  detectLanguage,
  getChainStatus,
  getDeviceId,
  getProvider,
  payForTile,
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
let booted = false

/** Synthetic address used in preview mode so the grid behaves normally. */
const PREVIEW_ADDRESS = 'NQ07 0000 0000 0000 0000 0000 0000 0000 PRVW'

export function useSession() {
  async function boot(): Promise<void> {
    if (booted) return
    booted = true
    language.value = detectLanguage()

    try {
      provider = await getProvider()
      mode.value = 'nimiq'
      void refreshChain()
      // Fire-and-forget: only used to remember this device between visits.
      void getDeviceId()
    } catch {
      // `init()` times out outside Nimiq Pay. Expected on desktop.
      mode.value = 'preview'
    }
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
    if (address.value) return address.value
    lastError.value = null

    if (mode.value === 'preview') {
      address.value = PREVIEW_ADDRESS
      return address.value
    }
    if (!provider) return null

    connecting.value = true
    try {
      address.value = await connectWallet(provider)
      return address.value
    } catch (error) {
      lastError.value =
        error instanceof ProviderError && error.isDenied
          ? 'Connect your Nimiq wallet to claim a tile.'
          : error instanceof Error
            ? error.message
            : 'Could not reach your wallet.'
      return null
    } finally {
      connecting.value = false
    }
  }

  /**
   * Pay another player, or the network, for a tile.
   * Resolves with an opaque receipt, or null if the user declined the prompt.
   * In preview mode this returns a marker string and moves no funds.
   */
  async function pay(recipient: string, valueLuna: number, note: string): Promise<string | null> {
    lastError.value = null

    if (mode.value === 'preview' || !provider) {
      return 'preview'
    }
    try {
      return await payForTile(provider, recipient, valueLuna, note)
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
    pay,
    refreshChain,
  }
}
