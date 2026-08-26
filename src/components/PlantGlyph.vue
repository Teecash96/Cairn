<script setup lang="ts">
/**
 * The plant itself, drawn as inline SVG so it scales crisply on any handset and
 * inherits theme colours. Five stages, from bare soil to ancient growth.
 */
import { computed } from 'vue'
import { MAX_STAGE, type Stage } from '../lib/game'

const props = defineProps<{
  stage: Stage
}>()

const leaf = computed(
  () =>
    ['transparent', 'var(--stage-1)', 'var(--stage-2)', 'var(--stage-3)', 'var(--stage-4)'][
      props.stage
    ],
)

const isAncient = computed(() => props.stage >= MAX_STAGE)
</script>

<template>
  <svg
    class="plant"
    viewBox="0 0 40 40"
    aria-hidden="true"
    :class="{ 'plant--ancient': isAncient }"
  >
    <!-- Bare soil: a dry, cracked plot. -->
    <template v-if="stage === 0">
      <circle cx="20" cy="24" r="9" fill="var(--soil)" />
      <path
        d="M14 24h12M20 20v8"
        stroke="var(--soil-edge)"
        stroke-width="1.4"
        stroke-linecap="round"
      />
    </template>

    <template v-else>
      <!-- Stem grows taller with each stage. -->
      <path
        :d="`M20 32 V ${32 - stage * 5.5}`"
        :stroke="leaf"
        stroke-width="2.2"
        stroke-linecap="round"
        fill="none"
      />

      <!-- Stage 1: a single sprout leaf. -->
      <path
        v-if="stage >= 1"
        d="M20 27 C15 26 13.5 22 15 20 C18 20.5 20 23.5 20 27 Z"
        :fill="leaf"
      />

      <!-- Stage 2 adds the mirrored leaf. -->
      <path
        v-if="stage >= 2"
        d="M20 24 C25 23 26.5 19 25 17 C22 17.5 20 20.5 20 24 Z"
        :fill="leaf"
      />

      <!-- Stage 3 broadens the canopy. -->
      <path
        v-if="stage >= 3"
        d="M20 18 C13 17.5 10 13 12 10 C16.5 10.5 20 14 20 18 Z"
        :fill="leaf"
        opacity="0.9"
      />
      <path
        v-if="stage >= 3"
        d="M20 16 C27 15.5 30 11 28 8 C23.5 8.5 20 12 20 16 Z"
        :fill="leaf"
        opacity="0.9"
      />

      <!-- Stage 4: it flowers. This is the tile you don't want to lose. -->
      <circle v-if="isAncient" cx="20" cy="7" r="3.4" fill="var(--gold)" />
      <circle v-if="isAncient" cx="20" cy="7" r="1.4" fill="#1a1405" opacity="0.55" />
    </template>
  </svg>
</template>

<style scoped>
.plant {
  width: 100%;
  height: 100%;
  display: block;
}

.plant--ancient {
  filter: drop-shadow(0 0 6px rgba(246, 194, 68, 0.45));
}
</style>
