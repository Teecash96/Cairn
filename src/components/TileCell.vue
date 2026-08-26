<script setup lang="ts">
/**
 * One tile on the grid. Shows the plant, a growth ring, and a marker when the
 * tile belongs to the player looking at it.
 */
import { computed } from 'vue'
import PlantGlyph from './PlantGlyph.vue'
import {
  MAX_STAGE,
  STAGE_NAMES,
  isProtected,
  priceOf,
  stageOf,
  stageProgress,
  type Tile,
} from '../lib/game'
import { formatNim } from '../lib/units'

const props = defineProps<{
  tile: Tile
  flow: number
  now: number
  /** Address of the viewer, if connected. */
  me: string | null
}>()

const stage = computed(() => stageOf(props.tile, props.flow, props.now))
const progress = computed(() => stageProgress(props.tile, props.flow, props.now))
const isMine = computed(() => props.me !== null && props.tile.holder === props.me)
const isEmpty = computed(() => props.tile.holder === null)
const guarded = computed(() => isProtected(props.tile, props.now))

const label = computed(() => {
  if (isEmpty.value) return 'Bare soil — seed it for free'
  const price = formatNim(priceOf(props.tile, props.flow, props.now))
  const mine = isMine.value ? ', yours' : ''
  const safe = guarded.value ? ', protected' : ''
  return `${STAGE_NAMES[stage.value]}${mine}${safe}, worth ${price} NIM`
})

// Circumference of the r=47 ring below, for the growth arc.
const RING = 2 * Math.PI * 47
const dash = computed(() => `${progress.value * RING} ${RING}`)
</script>

<template>
  <button
    class="tile"
    :class="{ 'tile--mine': isMine, 'tile--empty': isEmpty, 'tile--guarded': guarded }"
    :aria-label="label"
    type="button"
  >
    <svg class="tile__ring" viewBox="0 0 100 100" aria-hidden="true">
      <circle class="tile__ring-track" cx="50" cy="50" r="47" />
      <circle
        v-if="!isEmpty && stage < MAX_STAGE"
        class="tile__ring-fill"
        cx="50"
        cy="50"
        r="47"
        :stroke-dasharray="dash"
      />
    </svg>

    <span class="tile__plant">
      <PlantGlyph :stage="stage" />
    </span>

    <span v-if="tile.generation > 1" class="tile__gen mono">{{ tile.generation }}</span>
  </button>
</template>

<style scoped>
.tile {
  position: relative;
  aspect-ratio: 1;
  min-height: 0;
  width: 100%;
  padding: 0;
  border-radius: var(--radius);
  background: var(--surface);
  border: 1px solid var(--line);
  display: grid;
  place-items: center;
  transition:
    transform 0.12s ease,
    border-color 0.2s ease,
    background 0.3s ease;
}

.tile:active {
  transform: scale(0.94);
}

.tile--empty {
  background: #0f1424;
  border-style: dashed;
  border-color: #232c47;
}

.tile--mine {
  border-color: var(--gold);
  box-shadow: inset 0 0 0 1px rgba(246, 194, 68, 0.35);
}

/* Freshly claimed — briefly untakeable. */
.tile--guarded {
  animation: settle 1.4s ease-in-out infinite alternate;
}

@keyframes settle {
  from {
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
  }
  to {
    box-shadow: inset 0 0 0 1px rgba(142, 232, 155, 0.3);
  }
}

.tile__ring {
  position: absolute;
  inset: 3px;
  width: auto;
  height: auto;
  transform: rotate(-90deg);
}

.tile__ring-track {
  fill: none;
  stroke: rgba(255, 255, 255, 0.04);
  stroke-width: 3;
}

.tile__ring-fill {
  fill: none;
  stroke: var(--flow);
  stroke-width: 3;
  stroke-linecap: round;
  opacity: 0.55;
  transition: stroke-dasharray 0.9s linear;
}

.tile__plant {
  position: relative;
  width: 62%;
  height: 62%;
}

.tile__gen {
  position: absolute;
  right: 5px;
  bottom: 3px;
  font-size: 9px;
  font-weight: 700;
  color: var(--muted-dim);
}
</style>
