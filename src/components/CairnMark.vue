<script setup lang="ts">
/**
 * The Cairn mark: three stacked stones, widest at the base.
 *
 * Two deliberate choices keep it from reading as a hamburger menu — the stones
 * decrease in width and are centre-aligned, where menu bars are equal width and
 * flush. It is drawn on a 24-unit grid with 3.5 units of padding so it stays
 * legible down to 16px, and inherits `currentColor` so one component covers
 * every context.
 *
 * The same geometry, scaled, is the app icon in `public/icon.svg`.
 */
const { size = 24, label = '' } = defineProps<{
  size?: number | string
  /** Give this only when the mark is the sole label; otherwise it stays hidden. */
  label?: string
}>()
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="currentColor"
    :role="label ? 'img' : undefined"
    :aria-label="label || undefined"
    :aria-hidden="label ? undefined : 'true'"
    focusable="false"
  >
    <rect x="8.5" y="3.5" width="7" height="4.5" rx="2.25" />
    <rect x="5.5" y="9.75" width="13" height="4.5" rx="2.25" />
    <rect x="3" y="16" width="18" height="4.5" rx="2.25" />
  </svg>
</template>
