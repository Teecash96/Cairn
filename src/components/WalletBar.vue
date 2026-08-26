<script setup lang="ts">
/**
 * Top bar: identity and chain state.
 *
 * Kept deliberately quiet. Connecting is not a gate here — the player can look
 * at the grid before the wallet prompt appears, which is what makes the prompt
 * land on a tap they already meant to make.
 */
import { computed } from 'vue'
import { shortAddress } from '../lib/units'

const props = defineProps<{
  address: string | null
  connecting: boolean
  isPreview: boolean
  blockHeight: number | null
  consensus: boolean
}>()

defineEmits<{ connect: [] }>()

const chain = computed(() => {
  if (props.isPreview) return 'Browser preview'
  if (!props.consensus) return 'Syncing…'
  return props.blockHeight ? `#${props.blockHeight.toLocaleString('en-US')}` : 'Connected'
})
</script>

<template>
  <header class="bar">
    <div class="bar__brand">
      <span class="bar__mark" aria-hidden="true" />
      <div>
        <h1 class="bar__name">Ecoflow</h1>
        <p class="bar__chain mono">{{ chain }}</p>
      </div>
    </div>

    <button
      v-if="!address"
      class="bar__connect"
      type="button"
      :disabled="connecting"
      @click="$emit('connect')"
    >
      {{ connecting ? 'Connecting…' : 'Connect' }}
    </button>
    <span v-else class="bar__addr mono">{{ shortAddress(address) }}</span>
  </header>
</template>

<style scoped>
.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.bar__brand {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.bar__mark {
  flex: none;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  background: linear-gradient(140deg, var(--stage-4) 0%, var(--flow) 55%, var(--gold) 100%);
}

.bar__name {
  font-size: 17px;
  font-weight: 800;
  letter-spacing: -0.01em;
  line-height: 1.1;
}

.bar__chain {
  font-size: 11px;
  color: var(--muted-dim);
}

.bar__connect {
  flex: none;
  min-height: 38px;
  padding: 0 16px;
  border-radius: 99px;
  font-size: 14px;
  font-weight: 700;
  color: #1a1405;
  background: linear-gradient(180deg, var(--gold) 0%, var(--gold-dim) 100%);
}

.bar__connect:disabled {
  opacity: 0.6;
}

.bar__addr {
  flex: none;
  padding: 7px 12px;
  border-radius: 99px;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
  background: var(--surface-2);
  border: 1px solid var(--line);
}
</style>
