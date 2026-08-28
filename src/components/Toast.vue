<script setup lang="ts">
/**
 * Transient confirmations: "Copied", "Saved", "Couldn't reach Cairn".
 *
 * The live region is always in the DOM and only its contents change, because a
 * region that is inserted at the same moment as its text is unreliably announced
 * by screen readers. The parent owns the timeout — this component only renders.
 */
const { message = '', tone = 'info' } = defineProps<{
  message?: string
  tone?: 'info' | 'success' | 'error'
}>()
</script>

<template>
  <div class="layer" role="status" aria-live="polite">
    <Transition name="rise">
      <p v-if="message" class="toast" :class="`toast--${tone}`">{{ message }}</p>
    </Transition>
  </div>
</template>

<style scoped>
.layer {
  position: fixed;
  left: 0;
  right: 0;
  /* Clear of the bottom nav and the home indicator. */
  bottom: calc(var(--nav-h) + var(--safe-bottom) + var(--s3));
  display: flex;
  justify-content: center;
  padding: 0 var(--s4);
  pointer-events: none;
  z-index: 60;
}

.toast {
  max-width: 100%;
  padding: var(--s3) var(--s4);
  border-radius: var(--r-full);
  background: var(--text);
  color: var(--bg);
  font-size: var(--text-sm);
  font-weight: 550;
  text-align: center;
  box-shadow: 0 6px 20px rgb(16 18 27 / 18%);
}

/* Tone is a supplement to the wording, never the only signal. */
.toast--success {
  background: var(--success);
  color: #fff;
}

.toast--error {
  background: var(--danger);
  color: #fff;
}

.rise-enter-active,
.rise-leave-active {
  transition:
    opacity var(--dur) var(--ease),
    transform var(--dur) var(--ease);
}

.rise-enter-from,
.rise-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
