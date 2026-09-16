<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { shortAddress } from '../lib/units'

const props = defineProps<{
  recipient: string
  tasks: Array<{ id: string; text: string }>
  busy?: boolean
  status?: string
  error?: string | null
  pending?: boolean
  initialTaskId?: string
  initialAmountLuna?: number
}>()

const emit = defineEmits<{
  send: [value: { taskId: string; amountLuna: number }]
  close: []
}>()

const taskId = ref(props.initialTaskId ?? props.tasks[0]?.id ?? '')
const amount = ref(props.initialAmountLuna ? String(props.initialAmountLuna / 100_000) : '1')
const select = ref<HTMLSelectElement | null>(null)
const amountLuna = computed(() => Math.round(Number(amount.value) * 100_000))
const valid = computed(() => Boolean(taskId.value) && Number.isSafeInteger(amountLuna.value) && amountLuna.value >= 1 && amountLuna.value <= 100_000_000_000)

onMounted(() => select.value?.focus())
</script>

<template>
  <div class="reward-wrap" @keydown.esc="!busy && emit('close')">
    <div class="reward-scrim" @click="!busy && emit('close')" />
    <section class="reward-sheet" role="dialog" aria-modal="true" aria-labelledby="reward-title">
      <div class="reward-grab" aria-hidden="true" />
      <p class="eyebrow">Nimiq teammate reward</p>
      <h2 id="reward-title">Reward completed work</h2>
      <p class="muted">NIM goes directly from your wallet to {{ shortAddress(recipient) }}. Cairn never holds the funds.</p>

      <label class="field">
        <span class="field__label">Completed task</span>
        <select ref="select" v-model="taskId" class="input" :disabled="busy || pending">
          <option v-for="task in tasks" :key="task.id" :value="task.id">{{ task.text }}</option>
        </select>
      </label>
      <label class="field">
        <span class="field__label">Reward amount</span>
        <div class="amount-row">
          <input v-model="amount" class="input" type="number" inputmode="decimal" min="0.00001" max="1000000" step="0.1" :disabled="busy || pending" />
          <strong>NIM</strong>
        </div>
      </label>

      <p v-if="status" class="reward-status" role="status"><span class="payment-spinner" aria-hidden="true" />{{ status }}</p>
      <p v-if="error" class="reward-error" role="alert">{{ error }}</p>

      <button type="button" class="btn btn--primary btn--block" :disabled="busy || !valid" :aria-busy="busy" @click="emit('send', { taskId, amountLuna })">
        {{ busy ? 'Checking the Nimiq network…' : pending ? 'Resume confirmation' : `Send ${amount || '0'} NIM reward` }}
      </button>
      <button type="button" class="btn btn--ghost btn--block" :disabled="busy" @click="emit('close')">Not now</button>
    </section>
  </div>
</template>

<style scoped>
.reward-wrap { position: fixed; inset: 0; z-index: 100; display: grid; align-items: end; }
.reward-scrim { position: absolute; inset: 0; background: rgb(20 24 19 / .55); backdrop-filter: blur(3px); }
.reward-sheet { position: relative; width: min(38rem, 100%); max-height: 92dvh; margin: 0 auto; padding: var(--s5); overflow: auto; border: 1px solid var(--line-strong); border-radius: var(--r-xl) var(--r-xl) 0 0; background: var(--surface); box-shadow: 0 -20px 70px rgb(20 24 19 / .22); }
.reward-grab { width: 3.2rem; height: .3rem; margin: calc(var(--s2) * -1) auto var(--s4); border-radius: 99px; background: var(--line-strong); }
.reward-sheet h2 { margin-bottom: var(--s2); font-size: var(--text-xl); }
.reward-sheet > .muted { margin-bottom: var(--s5); font-size: var(--text-sm); line-height: var(--leading); }
.field { display: grid; gap: var(--s2); margin-bottom: var(--s4); }
.amount-row { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: var(--s3); }
.reward-status, .reward-error { margin-bottom: var(--s3); padding: var(--s3); border-radius: var(--r-md); font-size: var(--text-sm); }
.reward-status { display: flex; align-items: center; gap: var(--s2); background: var(--accent-subtle); color: var(--text); }
.reward-error { background: var(--danger-subtle); color: var(--danger); }
.payment-spinner { width: 1rem; height: 1rem; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: spin .75s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (min-width: 40rem) { .reward-wrap { align-items: center; padding: var(--s4); } .reward-sheet { border-radius: var(--r-xl); } }
</style>
