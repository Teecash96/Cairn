<script setup lang="ts">
/**
 * Screen one: describe the idea.
 *
 * One required field. The optional three are folded away, because the fastest
 * path to a result is the one that gets judged — and a phone keyboard covering
 * half the screen makes every extra field feel like a form.
 *
 * The generating state is a written sequence rather than a spinner. It takes the
 * better part of twenty seconds, and a bare spinner for twenty seconds reads as
 * broken; saying what is happening reads as work.
 *
 * `initial` prefills the form. The parent forces a remount with `:key` when it
 * wants a blank one, so there is no reset logic to get wrong.
 */
import { computed, onUnmounted, ref, watch } from 'vue'
import CairnMark from './CairnMark.vue'
import type { PlanInput } from '../lib/plan'

const {
  busy = false,
  initial,
  freeLeft = null,
  showDisclosure = true,
} = defineProps<{
  busy?: boolean
  initial?: PlanInput
  /** Free generations remaining, once the server has told us. */
  freeLeft?: number | null
  showDisclosure?: boolean
}>()

const emit = defineEmits<{
  submit: [input: PlanInput]
}>()

const name = ref(initial?.name ?? '')
const idea = ref(initial?.idea ?? '')
const targetUser = ref(initial?.targetUser ?? '')
const problem = ref(initial?.problem ?? '')
const goal = ref(initial?.goal ?? '')

const expanded = ref(Boolean(initial?.targetUser || initial?.problem || initial?.goal))

/** Enough to work from. Two or three words produces a plan about nothing. */
const MIN_IDEA = 24
const ready = computed(() => idea.value.trim().length >= MIN_IDEA)

const EXAMPLES = [
  'A tool that turns a voice note into a shopping list, grouped by aisle, for people who shop straight after work.',
  'An app where cyclists report potholes and the council sees a ranked heat map of the worst streets.',
]

function useExample(text: string): void {
  idea.value = text
}

// -- the generating sequence ------------------------------------------------

const PHASES = [
  'Reading your description',
  'Working out the requirements',
  'Mapping the user flow',
  'Tidying it up',
]
const phase = ref(0)
let timer: ReturnType<typeof setInterval> | undefined

function stopTimer(): void {
  if (timer !== undefined) clearInterval(timer)
  timer = undefined
}

watch(
  () => busy,
  (on) => {
    stopTimer()
    phase.value = 0
    if (!on) return
    timer = setInterval(() => {
      // Stops on the last phase rather than looping: a loop implies a retry.
      phase.value = Math.min(phase.value + 1, PHASES.length - 1)
    }, 2600)
  },
)

onUnmounted(stopTimer)

function submit(): void {
  if (!ready.value || busy) return
  emit('submit', {
    name: name.value.trim(),
    idea: idea.value.trim(),
    targetUser: targetUser.value.trim() || undefined,
    problem: problem.value.trim() || undefined,
    goal: goal.value.trim() || undefined,
  })
}
</script>

<template>
  <div class="screen">
    <header>
      <CairnMark :size="26" class="mark" />
      <h1 class="hero">Turn an idea into a plan.</h1>
      <p class="screen__sub">
        Describe it in your own words. Get a product requirements doc and a user-flow diagram, both
        yours to edit.
      </p>
    </header>

    <form class="form" @submit.prevent="submit">
      <div class="field">
        <label class="field__label" for="idea">
          Your idea
          <span class="field__optional">— a few sentences is plenty</span>
        </label>
        <textarea
          id="idea"
          v-model="idea"
          class="textarea"
          :disabled="busy"
          placeholder="What is it, who is it for, and what should it let them do?"
          autocapitalize="sentences"
          autocorrect="on"
          spellcheck="true"
        />

        <div v-if="!idea.trim()" class="examples">
          <span class="faint examples__label">Or start from one of these:</span>
          <button
            v-for="(example, i) in EXAMPLES"
            :key="i"
            type="button"
            class="example"
            :disabled="busy"
            @click="useExample(example)"
          >
            {{ example }}
          </button>
        </div>
      </div>

      <div class="field">
        <label class="field__label" for="name">
          Project name
          <span class="field__optional">— optional</span>
        </label>
        <input
          id="name"
          v-model="name"
          class="input"
          :disabled="busy"
          placeholder="Untitled"
          autocapitalize="words"
        />
      </div>

      <button
        v-if="!expanded"
        type="button"
        class="btn btn--ghost more"
        :disabled="busy"
        @click="expanded = true"
      >
        Add more detail
        <span class="field__optional">— optional, but it sharpens the result</span>
      </button>

      <template v-else>
        <div class="field">
          <label class="field__label" for="target">Who is it for?</label>
          <input
            id="target"
            v-model="targetUser"
            class="input"
            :disabled="busy"
            placeholder="Freelance designers billing by the hour"
          />
        </div>

        <div class="field">
          <label class="field__label" for="problem">What problem does it solve?</label>
          <input
            id="problem"
            v-model="problem"
            class="input"
            :disabled="busy"
            placeholder="They lose an hour a week to invoicing"
          />
        </div>

        <div class="field">
          <label class="field__label" for="goal">What should a user achieve?</label>
          <input
            id="goal"
            v-model="goal"
            class="input"
            :disabled="busy"
            placeholder="Send a correct invoice in under a minute"
          />
        </div>
      </template>

      <div class="submit">
        <button type="submit" class="btn btn--primary btn--block" :disabled="!ready || busy">
          <span v-if="busy" class="dot" aria-hidden="true"></span>
          {{ busy ? PHASES[phase] + '…' : 'Generate plan' }}
        </button>

        <p v-if="busy" class="foot faint" aria-live="polite">
          Usually about twenty seconds.
        </p>
        <p v-else-if="!ready && idea.trim()" class="foot faint">
          A little more detail and it will have something to work with.
        </p>
        <p v-else-if="freeLeft !== null && freeLeft > 0" class="foot muted">
          {{ freeLeft }} free {{ freeLeft === 1 ? 'plan' : 'plans' }} left — no card, no account.
        </p>
      </div>
    </form>

    <p v-if="showDisclosure" class="disclosure faint">
      What leaves your phone: the description above, sent to Anthropic's Claude to write the plan.
      The finished plan is stored on this device only — nothing is uploaded unless you tap Share.
    </p>
  </div>
</template>

<style scoped>
.mark {
  color: var(--accent);
  display: block;
  margin-bottom: var(--s3);
}

.hero {
  font-size: var(--text-2xl);
  letter-spacing: -0.024em;
}

.form {
  display: flex;
  flex-direction: column;
  gap: var(--s5);
}

.more {
  align-self: flex-start;
  padding-left: 0;
  padding-right: 0;
  min-height: 34px;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--accent);
  gap: var(--s1);
  flex-wrap: wrap;
  justify-content: flex-start;
  text-align: left;
  white-space: normal;
}

.more:hover:not(:disabled) {
  background: none;
  color: var(--accent-hover);
}

/* -- examples ------------------------------------------------------------ */

.examples {
  display: flex;
  flex-direction: column;
  gap: var(--s2);
  margin-top: var(--s1);
}

.examples__label {
  font-size: var(--text-xs);
}

.example {
  padding: var(--s3);
  text-align: left;
  font-size: var(--text-sm);
  line-height: var(--leading);
  color: var(--text-muted);
  background: var(--surface-sunken);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
}

.example:hover:not(:disabled) {
  border-color: var(--accent-line);
  color: var(--text);
}

/* -- submit -------------------------------------------------------------- */

.submit {
  display: flex;
  flex-direction: column;
  gap: var(--s3);
  margin-top: var(--s1);
}

.foot {
  font-size: var(--text-xs);
  line-height: var(--leading);
  text-align: center;
}

/* A single pulsing dot beside the phase text — motion enough to show life,
   quiet enough not to compete with the words. Stilled by reduced-motion. */
.dot {
  width: 6px;
  height: 6px;
  border-radius: var(--r-full);
  background: currentColor;
  animation: pulse 1400ms var(--ease) infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 0.35;
  }
  50% {
    opacity: 1;
  }
}

.disclosure {
  font-size: var(--text-xs);
  line-height: var(--leading);
  padding-top: var(--s4);
  border-top: 1px solid var(--line);
}
</style>
