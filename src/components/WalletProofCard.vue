<script setup lang="ts">
import { computed } from 'vue'
import { shortAddress } from '../lib/units'
import type { WalletProof } from '../lib/plan'

const {
  proof,
  currentHash,
  walletAddress,
  readOnly = false,
  busy = false,
} = defineProps<{
  proof?: WalletProof
  currentHash: string
  walletAddress?: string | null
  readOnly?: boolean
  busy?: boolean
}>()

const emit = defineEmits<{
  prove: []
}>()

function canonical(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase()
}

const hasProof = computed(() => Boolean(proof))
const isCurrent = computed(() => Boolean(proof && proof.hash === currentHash))
const belongsToWallet = computed(() => {
  if (!proof || !walletAddress) return true
  return canonical(proof.address) === canonical(walletAddress)
})
const verified = computed(() => isCurrent.value && belongsToWallet.value)
const stateLabel = computed(() => {
  if (verified.value) return 'Verified plan state'
  if (hasProof.value) return 'Plan changed'
  return 'Claim this plan'
})
const stateCopy = computed(() => {
  if (verified.value) return `Cairn checked a wallet signature for this exact plan. Signed by ${shortAddress(proof?.address ?? '')}.`
  if (hasProof.value) return 'This plan changed after the last signature. Sign the current version so the proof matches the work you will build.'
  return 'Sign a short plan summary with your Nimiq wallet. This costs nothing and does not move NIM.'
})

function sign(): void {
  if (!busy && !readOnly && !verified.value) emit('prove')
}
</script>

<template>
  <section class="wallet-proof" :class="{ 'wallet-proof--verified': verified, 'wallet-proof--stale': hasProof && !verified }" aria-labelledby="wallet-proof-heading">
    <div class="wallet-proof__mark" aria-hidden="true">
      <svg v-if="verified" viewBox="0 0 24 24" width="22" height="22" fill="none">
        <path d="m6 12.5 4 4 8-9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <svg v-else viewBox="0 0 24 24" width="22" height="22" fill="none">
        <path d="M12 4v16M4 12h16" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      </svg>
    </div>
    <div class="wallet-proof__body">
      <div class="wallet-proof__top">
        <div>
          <p class="eyebrow">Wallet proof</p>
          <h3 id="wallet-proof-heading">{{ stateLabel }}</h3>
        </div>
        <span v-if="verified" class="badge badge--verified">Nimiq signature</span>
        <span v-else-if="hasProof" class="badge">Needs update</span>
        <span v-else class="badge badge--accent">Free</span>
      </div>
      <p>{{ stateCopy }}</p>
      <p v-if="verified && proof" class="wallet-proof__hash"><span>Plan hash</span><code>{{ proof.hash }}</code></p>
      <details v-if="verified && proof" class="wallet-proof__details">
        <summary>Show proof details</summary>
        <dl>
          <div><dt>Wallet</dt><dd>{{ proof.address }}</dd></div>
          <div><dt>Public key</dt><dd>{{ proof.publicKey }}</dd></div>
          <div><dt>Signature</dt><dd>{{ proof.signature }}</dd></div>
        </dl>
      </details>
      <button v-if="!readOnly && !verified" type="button" class="btn btn--primary btn--sm wallet-proof__button" :disabled="busy" @click="sign">
        {{ busy ? 'Waiting for wallet…' : hasProof ? 'Sign updated plan' : 'Sign this plan' }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.wallet-proof { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: var(--s4); margin: 0 var(--workspace-pad) var(--s5); padding: var(--s4); border: 1px solid var(--accent-line); border-radius: var(--r-md); background: var(--accent-subtle); }
.wallet-proof--verified { border-color: var(--sage-line); background: var(--sage-subtle); }
.wallet-proof--stale { border-color: var(--line-strong); background: var(--surface-sunken); }
.wallet-proof__mark { display: grid; flex: 0 0 42px; place-items: center; width: 42px; height: 42px; border-radius: 13px; color: var(--accent); background: var(--surface); }
.wallet-proof--verified .wallet-proof__mark { color: var(--success); }
.wallet-proof__body { display: flex; min-width: 0; flex-direction: column; gap: var(--s2); }
.wallet-proof__top { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--s3); }
.wallet-proof h3 { font-family: var(--font-display); font-size: var(--text-md); line-height: var(--leading-tight); }
.wallet-proof p { color: var(--text-muted); font-size: var(--text-sm); line-height: var(--leading); }
.wallet-proof__hash { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--s2); }
.wallet-proof__hash span { color: var(--text-faint); font-size: var(--text-xs); font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
.wallet-proof code { max-width: 100%; overflow-wrap: anywhere; color: var(--text); font-family: var(--font-mono); font-size: .68rem; }
.wallet-proof__details { border-top: 1px solid var(--accent-line); padding-top: var(--s2); color: var(--text-muted); font-size: var(--text-xs); }
.wallet-proof--verified .wallet-proof__details { border-color: var(--sage-line); }
.wallet-proof__details summary { cursor: pointer; font-weight: 700; }
.wallet-proof__details dl { display: grid; gap: var(--s2); margin: var(--s2) 0 0; }
.wallet-proof__details dl > div { display: grid; gap: 2px; min-width: 0; }
.wallet-proof__details dt { color: var(--text-faint); font-size: .68rem; }
.wallet-proof__details dd { margin: 0; overflow-wrap: anywhere; color: var(--text); font-family: var(--font-mono); font-size: .68rem; }
.wallet-proof__button { align-self: flex-start; margin-top: var(--s1); }
@media (max-width: 650px) {
  .wallet-proof { margin-right: 1rem; margin-left: 1rem; }
  .wallet-proof__top { flex-direction: column; gap: var(--s2); }
}
</style>
