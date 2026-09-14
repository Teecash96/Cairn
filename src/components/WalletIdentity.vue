<script setup lang="ts">
import { ref, watch } from 'vue'
import Identicons from '@nimiq/identicons'
import { shortAddress } from '../lib/units'

const { address } = defineProps<{ address?: string | null }>()
const icon = ref('')

watch(
  () => address,
  async (value) => {
    icon.value = ''
    if (!value) return
    try {
      icon.value = await Identicons.toDataUrl(value.replace(/\s+/g, '').toUpperCase())
    } catch {
      icon.value = ''
    }
  },
  { immediate: true },
)
</script>

<template>
  <div v-if="address" class="wallet-identity" :title="address" aria-label="Connected Nimiq wallet">
    <img v-if="icon" :src="icon" alt="" />
    <span v-else class="wallet-identity__placeholder" aria-hidden="true">N</span>
    <span class="wallet-identity__copy">
      <small>Nimiq wallet</small>
      <strong>{{ shortAddress(address) }}</strong>
    </span>
  </div>
</template>

<style scoped>
.wallet-identity { display: inline-flex; align-items: center; gap: .55rem; min-height: 42px; padding: .35rem .7rem .35rem .4rem; color: var(--text); background: var(--surface); border: 1px solid var(--line); border-radius: 13px; }
.wallet-identity img, .wallet-identity__placeholder { width: 30px; height: 30px; border-radius: 50%; }
.wallet-identity__placeholder { display: grid; place-items: center; color: #17130b; background: var(--nim); font-size: .72rem; font-weight: 900; }
.wallet-identity__copy { display: grid; gap: 1px; }
.wallet-identity small { color: var(--text-faint); font-size: .62rem; }
.wallet-identity strong { font-family: var(--font-mono); font-size: .67rem; font-weight: 700; white-space: nowrap; }
@media (max-width: 650px) { .wallet-identity__copy { display: none; } .wallet-identity { padding-right: .4rem; } }
</style>
