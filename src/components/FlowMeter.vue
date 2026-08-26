<script setup lang="ts">
/**
 * The shared resource meter. This is the whole thesis of the game in one strip:
 * one number, owned by nobody, that every player's behaviour moves.
 */
import { computed } from 'vue'
import { FLOW_COPY, flowBand, stageDurationMs } from '../lib/game'

const props = defineProps<{ flow: number }>()

const band = computed(() => flowBand(props.flow))
const copy = computed(() => FLOW_COPY[band.value])

const color = computed(() => {
  switch (band.value) {
    case 'thriving':
    case 'steady':
      return 'var(--flow)'
    case 'strained':
      return 'var(--flow-warn)'
    default:
      return 'var(--flow-bad)'
  }
})

/** Growth speed relative to the neutral baseline, e.g. "1.3x". */
const speed = computed(() => (60_000 / stageDurationMs(props.flow)).toFixed(1))
</script>

<template>
  <section class="flow" :class="`flow--${band}`" aria-live="polite">
    <header class="flow__head">
      <h2 class="flow__title">Flow</h2>
      <span class="flow__speed mono">{{ speed }}× growth</span>
    </header>

    <div
      class="flow__track"
      role="meter"
      :aria-valuenow="Math.round(flow)"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-label="copy"
    >
      <div class="flow__fill" :style="{ width: `${flow}%`, background: color }" />
    </div>

    <p class="flow__copy">{{ copy }}</p>
  </section>
</template>

<style scoped>
.flow {
  padding: 12px 14px 13px;
  border-radius: var(--radius);
  background: var(--surface);
  border: 1px solid var(--line);
}

.flow__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.flow__title {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--muted);
}

.flow__speed {
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
}

.flow__track {
  height: 7px;
  border-radius: 99px;
  background: rgba(255, 255, 255, 0.06);
  overflow: hidden;
}

.flow__fill {
  height: 100%;
  border-radius: 99px;
  transition:
    width 0.6s ease,
    background 0.6s ease;
}

.flow__copy {
  margin-top: 8px;
  font-size: 12.5px;
  color: var(--muted);
}

.flow--collapsing .flow__copy {
  color: var(--flow-bad);
}
</style>
