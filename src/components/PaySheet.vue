<script setup lang="ts">
/**
 * The pay sheet. Appears only when a generation was actually refused for want of
 * credits, so it is never the first thing anyone sees.
 *
 * One payment buys a bundle, not a single plan, because every wallet call opens a
 * native confirmation dialog that an app cannot suppress — charging per plan would
 * mean a system prompt between every idea and its result.
 *
 * The price comes from the server. Nothing here hardcodes an amount: NIM moves,
 * and the pitch is that a bundle costs about what the inference costs.
 */
import { computed, onMounted, ref } from 'vue'
import { formatNim, shortAddress } from '../lib/units'
import type { PriceQuote } from '../lib/api'

const {
  price,
  state = 'idle',
  error = null,
  pending = false,
  pendingMessage = null,
  retrying = false,
} = defineProps<{
  price: PriceQuote | null
  /** `paying` — waiting on Nimiq Pay. `verifying` — waiting on the network. */
  state?: 'idle' | 'paying' | 'verifying'
  error?: string | null
  pending?: boolean
  pendingMessage?: string | null
  retrying?: boolean
}>()

const emit = defineEmits<{
  pay: []
  close: []
}>()

const confirmButton = ref<HTMLButtonElement | null>(null)

// Move focus into the sheet, or a keyboard user is stranded behind it.
onMounted(() => confirmButton.value?.focus())

const busy = computed(() => state !== 'idle')
const canDismiss = computed(() => state !== 'paying' && !(state === 'verifying' && !pending))

/** A payment already in flight must not be dismissed out from under itself. */
function dismiss(): void {
  if (canDismiss.value) emit('close')
}

function perPlan(quote: PriceQuote): string {
  return formatNim(Math.round(quote.priceLuna / Math.max(quote.plans, 1)))
}
</script>

<template>
  <div class="wrap" @keydown.esc="dismiss">
    <!-- Tapping away cancels; it is a dismissable sheet, not a trap. -->
    <div class="scrim" @click="dismiss"></div>

    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="pay-title">
      <div class="grabber" aria-hidden="true"></div>

      <h2 id="pay-title" class="title">
        Unlock Cairn
      </h2>

      <p class="body muted">
        Payment is required for AI planning. One NIM payment buys a bundle of planner actions. No subscription.
      </p>

      <template v-if="price">
        <div class="quote">
          <div class="quote__amount">
            <span class="amount mono">{{ formatNim(price.priceLuna) }}</span>
            <span class="unit">NIM</span>
          </div>
          <p class="quote__for">
            buys <strong>{{ price.plans }} AI actions</strong>
            <span class="faint"> · about {{ perPlan(price) }} NIM per action</span>
          </p>
        </div>

        <dl class="rows">
          <div class="rows__row">
            <dt>Goes to</dt>
            <dd class="mono">{{ shortAddress(price.payTo) }}</dd>
          </div>
          <div class="rows__row">
            <dt>Payment</dt>
            <dd>Through your Nimiq wallet</dd>
          </div>
        </dl>
      </template>

      <p v-else class="body faint">Fetching the current price…</p>

      <p v-if="pendingMessage" class="pending" role="status">{{ pendingMessage }}</p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>

      <div class="actions">
        <button
          ref="confirmButton"
          type="button"
          class="btn btn--primary btn--block"
          :disabled="!price || busy"
          @click="emit('pay')"
        >
          <template v-if="state === 'paying'">Confirm in Nimiq Pay…</template>
          <template v-else-if="state === 'verifying'">Checking the network…</template>
          <template v-else-if="price && retrying">Check payment</template>
          <template v-else-if="price">Pay {{ formatNim(price.priceLuna) }} NIM</template>
          <template v-else>Pay</template>
        </button>

        <button
          type="button"
          class="btn btn--ghost btn--block"
          :disabled="state === 'paying' || (state === 'verifying' && !pending)"
          @click="emit('close')"
        >
          Not now
        </button>
      </div>

      <p class="fine faint">
        Credits are held against your wallet address. Payment goes straight from your wallet to Cairn’s receiving address.
      </p>
    </div>
  </div>
</template>

<style scoped>
.wrap {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: flex-end;
}

.scrim {
  position: absolute;
  inset: 0;
  background: rgb(10 11 16 / 45%);
  animation: fade var(--dur) var(--ease);
}

.sheet {
  position: relative;
  width: 100%;
  max-height: 92vh;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  display: flex;
  flex-direction: column;
  gap: var(--s4);
  padding: var(--s2) var(--s5) calc(var(--safe-bottom) + var(--s6));
  background: var(--surface);
  border-top-left-radius: var(--r-lg);
  border-top-right-radius: var(--r-lg);
  box-shadow: var(--shadow-sheet);
  animation: slide 260ms var(--ease);
}

.grabber {
  align-self: center;
  width: 36px;
  height: 4px;
  margin: var(--s2) 0;
  border-radius: var(--r-full);
  background: var(--line-strong);
}

.title {
  font-size: var(--text-xl);
  letter-spacing: -0.018em;
}

.body {
  font-size: var(--text-sm);
  line-height: var(--leading-loose);
}

/* -- the quote ----------------------------------------------------------- */

.quote {
  display: flex;
  flex-direction: column;
  gap: var(--s1);
  padding: var(--s4);
  background: var(--accent-subtle);
  border: 1px solid var(--accent-line);
  border-radius: var(--r-md);
}

.quote__amount {
  display: flex;
  align-items: baseline;
  gap: var(--s2);
}

.amount {
  font-size: var(--text-2xl);
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1;
}

.unit {
  font-size: var(--text-sm);
  font-weight: 650;
  color: var(--accent);
  letter-spacing: 0.04em;
}

.quote__for {
  font-size: var(--text-sm);
  line-height: var(--leading);
  color: var(--text-muted);
}

/* -- detail rows --------------------------------------------------------- */

.rows {
  display: flex;
  flex-direction: column;
  gap: var(--s2);
  margin: 0;
  font-size: var(--text-sm);
}

.rows__row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--s4);
}

.rows__row dt {
  color: var(--text-muted);
  white-space: nowrap;
}

.rows__row dd {
  margin: 0;
  text-align: right;
  min-width: 0;
  overflow-wrap: break-word;
}

.error {
  padding: var(--s3);
  border-radius: var(--r-sm);
  background: var(--danger-subtle);
  color: var(--danger);
  font-size: var(--text-sm);
  line-height: var(--leading);
}

.pending {
  padding: var(--s3);
  border-radius: var(--r-sm);
  background: var(--accent-subtle);
  color: var(--text);
  font-size: var(--text-sm);
  line-height: var(--leading);
}

.actions {
  display: flex;
  flex-direction: column;
  gap: var(--s2);
}

.fine {
  font-size: var(--text-xs);
  line-height: var(--leading);
}

@keyframes fade {
  from {
    opacity: 0;
  }
}

@keyframes slide {
  from {
    transform: translateY(16px);
    opacity: 0;
  }
}
</style>
