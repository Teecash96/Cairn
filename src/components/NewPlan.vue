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
  showDisclosure = true,
} = defineProps<{
  busy?: boolean
  initial?: PlanInput
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
  {
    label: 'Daily',
    text: 'A tool that turns a voice note into a shopping list, grouped by aisle, for people who shop straight after work.',
  },
  {
    label: 'Civic',
    text: 'An app where cyclists report potholes and the council sees a ranked heat map of the worst streets.',
  },
  {
    label: 'Habit',
    text: 'A habit tracker for remote workers that turns small routines into a simple weekly check-in.',
  },
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
  <div class="screen screen--atlas-new">
    <header class="atlas-hero">
      <div class="brandline">
        <span class="brandline__symbol">
          <CairnMark :size="22" class="mark" label="Cairn" />
        </span>
        <span class="brandline__name">Cairn</span>
        <span class="brandline__tag">Product atlas</span>
      </div>
      <div class="atlas-meta mono">
        <span>Route 01</span>
        <span class="atlas-meta__free">Free to use</span>
      </div>
      <h1 class="hero">Map the idea before you build it.</h1>
      <p class="hero-copy">
        Describe the rough version. Cairn turns it into a clear product map, a route to release,
        and the next useful move.
      </p>

      <ol class="route-preview" aria-label="Cairn maps an idea into a plan, flow, build path, and tracker">
        <li class="route-preview__stop route-preview__stop--active"><span>01</span>Idea</li>
        <li class="route-preview__stop"><span>02</span>Plan</li>
        <li class="route-preview__stop"><span>03</span>Build</li>
        <li class="route-preview__stop"><span>04</span>Track</li>
      </ol>
    </header>

    <form id="new-plan-form" class="form atlas-form" aria-label="Create a product plan" @submit.prevent="submit">
      <div class="field project-field">
        <label class="field__label" for="name">
          Project name
          <span class="field__optional">Optional</span>
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

      <div class="idea-field">
        <div class="idea-field__heading">
          <label class="field__label" for="idea">The rough idea</label>
          <span class="idea-field__count">{{ idea.length }}/1500</span>
        </div>
        <textarea
          id="idea"
          v-model="idea"
          class="textarea"
          :disabled="busy"
          placeholder="What are you trying to make real? Tell us what it is, who needs it, and what should change for them."
          autocapitalize="sentences"
          autocorrect="on"
          spellcheck="true"
          required
          aria-required="true"
        />

        <div v-if="!idea.trim()" class="examples">
          <span class="examples__label mono">Example routes</span>
          <button
            v-for="example in EXAMPLES"
            :key="example.label"
            type="button"
            class="example"
            :disabled="busy"
            @click="useExample(example.text)"
          >
            <span class="example__label mono">{{ example.label }}</span>
            <span class="example__text">{{ example.text }}</span>
          </button>
        </div>
      </div>

      <div class="submit">
        <button type="submit" class="btn btn--primary btn--block" :disabled="!ready || busy">
          <span v-if="busy" class="dot" aria-hidden="true"></span>
          {{ busy ? PHASES[phase] + '…' : 'Generate my plan' }}
        </button>

        <p v-if="busy" class="foot faint" aria-live="polite">
          Most plans are ready in under 30 seconds.
        </p>
        <p v-else-if="!ready && idea.trim()" class="foot faint">
          A little more detail and it will have something to work with.
        </p>
        <p v-else class="foot muted">
          Free to use. Your finished plan stays on this device.
        </p>
      </div>

      <button
        v-if="!expanded"
        type="button"
        class="btn btn--ghost more"
        :disabled="busy"
        @click="expanded = true"
      >
        <span>Add route context</span>
        <span class="field__optional">Optional, but it sharpens the map</span>
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
    </form>

    <p v-if="showDisclosure" class="disclosure faint">
      What leaves your phone: the description above, sent to Google's Gemini to write the plan.
      The finished plan is stored on this device only — nothing is uploaded unless you tap Share.
    </p>

    <footer class="site-footer" aria-label="Cairn information">
      <a href="/case-studies">Examples</a>
      <a href="/faq">FAQ</a>
      <a href="/privacy">Privacy</a>
    </footer>
  </div>
</template>

<style scoped>
.screen--atlas-new { gap: var(--s8); }
.atlas-hero { position: relative; display: flex; flex-direction: column; gap: var(--s4); padding-bottom: var(--s2); }
.brandline { margin-bottom: var(--s4); }
.brandline__symbol { display: grid; place-items: center; width: 38px; height: 38px; color: var(--ink); background: var(--nim); border-radius: 50%; }
.mark { display: block; }
.atlas-meta { display: flex; align-items: center; gap: var(--s3); color: var(--text-faint); font-size: var(--text-xs); font-weight: 700; letter-spacing: .09em; text-transform: uppercase; }
.atlas-meta__free { display: inline-flex; align-items: center; gap: var(--s2); color: var(--moss); }
.atlas-meta__free::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.hero { max-width: 13ch; font-family: var(--font-display); font-size: clamp(2.5rem, 12vw, 4.7rem); font-weight: 600; line-height: .97; letter-spacing: -.055em; }
.hero-copy { max-width: 38rem; color: var(--text-muted); font-size: var(--text-md); line-height: var(--leading-loose); }
.route-preview { position: relative; display: grid; grid-template-columns: repeat(4, 1fr); margin: var(--s4) 0 0; padding: 0; list-style: none; }
.route-preview::before { content: ''; position: absolute; top: 13px; left: 8%; right: 8%; height: 1px; background: var(--line-strong); }
.route-preview__stop { position: relative; display: flex; flex-direction: column; align-items: center; gap: var(--s2); color: var(--text-faint); font-size: var(--text-xs); font-weight: 650; }
.route-preview__stop span { position: relative; z-index: 1; display: grid; place-items: center; width: 27px; height: 27px; color: var(--text-muted); background: var(--bg); border: 1px solid var(--line-strong); border-radius: 50%; font-size: .62rem; }
.route-preview__stop--active { color: var(--text); }
.route-preview__stop--active span { color: var(--accent-on); background: var(--accent); border-color: var(--accent); box-shadow: 0 0 0 5px var(--accent-subtle); }

.form {
  display: flex;
  flex-direction: column;
  gap: var(--s5);
}

.atlas-form { padding-top: var(--s5); border-top: 1px solid var(--line); }
.project-field { max-width: 28rem; }
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
  gap: 0;
  margin-top: var(--s3);
  border-top: 1px solid var(--line);
}

.examples__label {
  padding: var(--s3) 0 var(--s2);
  color: var(--text-faint);
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.example {
  display: grid;
  grid-template-columns: 4.25rem 1fr;
  gap: var(--s3);
  padding: var(--s3) 0;
  text-align: left;
  font-size: var(--text-sm);
  line-height: var(--leading);
  color: var(--text-muted);
  border-bottom: 1px solid var(--line);
}

.example:hover:not(:disabled) {
  color: var(--text);
}
.example__label { color: var(--accent); font-size: var(--text-xs); font-weight: 750; letter-spacing: .07em; text-transform: uppercase; }
.example__text { max-width: 52ch; }

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

.site-footer {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s4);
  padding-top: var(--s2);
  font-size: var(--text-xs);
}

.site-footer a {
  color: var(--text-muted);
}

.site-footer a:hover {
  color: var(--accent);
}

@media (max-width: 720px) {
  .submit {
    position: sticky;
    bottom: calc(var(--nav-h) + var(--safe-bottom) + var(--s2));
    z-index: 5;
    padding: var(--s3) 0;
    background: var(--bg);
    border-top: 1px solid var(--line);
  }
}

@media (max-width: 380px) {
  .hero { font-size: 2.3rem; }
  .route-preview__stop { font-size: .68rem; }
  .example { grid-template-columns: 3.5rem 1fr; }
}
</style>
