<script setup lang="ts">
/**
 * A textarea that grows to fit its content instead of scrolling.
 *
 * Every editable field in a plan is prose of unpredictable length, and a phone
 * has no room for a nested scroll region — a field that scrolls internally hides
 * the user's own words and fights the page scroll. So the element is sized to its
 * content on mount, on input, and whenever the value changes from outside (a
 * regeneration replaces every field at once).
 */
import { nextTick, onMounted, ref, watch } from 'vue'

const model = defineModel<string>({ required: true })

const {
  rows = 2,
  placeholder = '',
  ariaLabel = '',
} = defineProps<{
  /** Starting height, before the first measure. */
  rows?: number
  placeholder?: string
  /** Give this when no visible <label> points at the field. */
  ariaLabel?: string
}>()

const el = ref<HTMLTextAreaElement | null>(null)

function fit(): void {
  const node = el.value
  if (!node) return
  // Collapse first, or the height only ever ratchets upwards as text is deleted.
  node.style.height = 'auto'
  node.style.height = `${node.scrollHeight}px`
}

onMounted(() => {
  void nextTick(fit)
})

// The DOM value lands one tick after the model changes.
watch(model, () => {
  void nextTick(fit)
})
</script>

<template>
  <textarea
    ref="el"
    v-model="model"
    class="input grow"
    :rows="rows"
    :placeholder="placeholder"
    :aria-label="ariaLabel || undefined"
    @input="fit"
  />
</template>

<style scoped>
.grow {
  display: block;
  resize: none;
  /* Hidden rather than auto: the element is always exactly as tall as its text. */
  overflow: hidden;
  line-height: var(--leading-loose);
}
</style>
