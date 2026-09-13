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
import { NIMIQ_TEMPLATE } from '../lib/example'

const {
  busy = false,
  supportBusy = false,
  initial,
  showDisclosure = true,
} = defineProps<{
  busy?: boolean
  supportBusy?: boolean
  initial?: PlanInput
  showDisclosure?: boolean
}>()

const emit = defineEmits<{
  submit: [input: PlanInput]
  example: []
  support: []
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

function useNimiqTemplate(): void {
  name.value = NIMIQ_TEMPLATE.name
  idea.value = NIMIQ_TEMPLATE.idea
  targetUser.value = NIMIQ_TEMPLATE.targetUser ?? ''
  problem.value = NIMIQ_TEMPLATE.problem ?? ''
  goal.value = NIMIQ_TEMPLATE.goal ?? ''
  expanded.value = true
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
  <div class="screen home-screen">
    <header class="home-topbar">
      <div class="home-brand">
        <span class="home-brand__symbol">
          <CairnMark :size="21" class="mark" label="Cairn" />
        </span>
        <span>
          <strong>Cairn</strong>
          <small>Personal product planner</small>
        </span>
      </div>
      <span class="home-status"><i aria-hidden="true" />Free planning</span>
    </header>

    <main class="home-grid">
      <section class="welcome" aria-labelledby="welcome-heading">
        <p class="welcome__eyebrow">Clarity for what you are building</p>
        <h1 id="welcome-heading">Turn an idea into your next clear move.</h1>
        <p class="welcome__copy">
          Cairn connects your product plan, build steps, and daily progress so the work stays useful when the idea changes.
        </p>

        <div class="promise-list" aria-label="How Cairn helps">
          <div class="promise">
            <span>01</span>
            <p><strong>Understand</strong><small>Shape the problem and user journey.</small></p>
          </div>
          <div class="promise">
            <span>02</span>
            <p><strong>Build</strong><small>Get ordered tasks and clear proof.</small></p>
          </div>
          <div class="promise">
            <span>03</span>
            <p><strong>Continue</strong><small>Return to one recommended next move.</small></p>
          </div>
        </div>

        <button type="button" class="sample-action sample-action--desktop" :disabled="busy" @click="emit('example')">
          <span>
            <small>See it before you start</small>
            <strong>Explore a complete sample plan</strong>
          </span>
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
            <path d="M4 10h11m-4-4 4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
      </section>

      <form id="new-plan-form" class="composer" aria-label="Create a product plan" @submit.prevent="submit">
        <div class="composer__head">
          <div>
            <p class="composer__eyebrow">New project</p>
            <h2>What do you want to make real?</h2>
          </div>
          <span class="local-chip">Saved here</span>
        </div>

        <button type="button" class="sample-action sample-action--mobile" :disabled="busy" @click="emit('example')">
          <span>
            <small>Want to look around first?</small>
            <strong>Open the sample project</strong>
          </span>
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
            <path d="M4 10h11m-4-4 4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>

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
            placeholder="Give it a working title"
            autocapitalize="words"
          />
        </div>

        <div class="idea-field">
          <div class="idea-field__heading">
            <label class="field__label" for="idea">Describe the idea</label>
            <span class="idea-field__count">{{ idea.length }}/1500</span>
          </div>
          <textarea
            id="idea"
            v-model="idea"
            class="textarea"
            :disabled="busy"
            placeholder="What is it, who needs it, and what should become easier?"
            autocapitalize="sentences"
            autocorrect="on"
            spellcheck="true"
            required
            aria-required="true"
            maxlength="1500"
          />

          <Transition name="examples-reveal">
            <div v-if="!idea.trim()" class="examples">
              <span class="examples__label">Need a spark?</span>
              <div class="example-chips">
                <button
                  v-for="example in EXAMPLES"
                  :key="example.label"
                  type="button"
                  class="example-chip"
                  :disabled="busy"
                  :title="example.text"
                  @click="useExample(example.text)"
                >
                  {{ example.label }} idea
                </button>
              </div>
            </div>
          </Transition>
        </div>

        <div class="composer-tools">
          <button type="button" class="template-action" :disabled="busy" @click="useNimiqTemplate">
            <span class="template-action__mark" aria-hidden="true">N</span>
            <span><strong>Planning a Nimiq Mini App?</strong><small>Start with the guided template</small></span>
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
              <path d="M7.5 4.5 13 10l-5.5 5.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>

          <button
            type="button"
            class="context-toggle"
            :class="{ 'context-toggle--open': expanded }"
            :aria-expanded="expanded"
            :disabled="busy"
            @click="expanded = !expanded"
          >
            <span><strong>{{ expanded ? 'Hide extra context' : 'Add more context' }}</strong><small>Audience, problem, and goal</small></span>
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
              <path d="m5 8 5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
        </div>

        <Transition name="accordion-reveal">
          <div v-if="expanded" class="context-fields">
            <div class="field">
              <label class="field__label" for="target">Who is it for?</label>
              <input id="target" v-model="targetUser" class="input" :disabled="busy" placeholder="Freelance designers billing by the hour" />
            </div>
            <div class="field">
              <label class="field__label" for="problem">What problem does it solve?</label>
              <input id="problem" v-model="problem" class="input" :disabled="busy" placeholder="They lose an hour a week to invoicing" />
            </div>
            <div class="field">
              <label class="field__label" for="goal">What should a user achieve?</label>
              <input id="goal" v-model="goal" class="input" :disabled="busy" placeholder="Send a correct invoice in under a minute" />
            </div>
          </div>
        </Transition>

        <div class="submit">
          <button type="submit" class="btn btn--primary btn--block generate-button" :disabled="!ready || busy">
            <span class="generate-button__icon" aria-hidden="true">
              <span v-if="busy" class="dot" />
              <svg v-else viewBox="0 0 20 20" width="18" height="18">
                <path d="M10 3.5v13M4.5 10H15.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
              </svg>
            </span>
            <span class="generate-button__label">
              <Transition name="text-swap" mode="out-in">
                <span :key="busy ? phase : -1">{{ busy ? PHASES[phase] + '…' : 'Create my plan' }}</span>
              </Transition>
            </span>
          </button>

          <p v-if="busy" class="foot faint" aria-live="polite">Most plans are ready in under 30 seconds.</p>
          <p v-else-if="!ready && idea.trim()" class="foot faint">Add a little more detail so Cairn has something useful to work with.</p>
          <p v-else class="foot muted">Your first wallet sign in protects the plan. Planning and updates stay free.</p>
        </div>

        <div class="wallet-row">
          <span><i aria-hidden="true" />Nimiq wallet identity</span>
          <button type="button" :disabled="busy || supportBusy" @click="emit('support')">
            {{ supportBusy ? 'Opening Nimiq Pay…' : 'Support with 1 NIM' }}
          </button>
        </div>
      </form>
    </main>

    <div class="home-foot">
      <p v-if="showDisclosure" class="disclosure faint">
        Your description goes to Google Gemini to create the plan. The finished plan stays on this device until you choose to share it.
      </p>
      <footer class="site-footer" aria-label="Cairn information">
        <a href="/case-studies">Examples</a>
        <a href="/faq">FAQ</a>
        <a href="/privacy">Privacy</a>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.home-screen { width: min(100%, 1180px); gap: clamp(2rem, 5vw, 4.5rem); }
.home-topbar { display: flex; align-items: center; justify-content: space-between; gap: var(--s4); }
.home-brand { display: flex; align-items: center; gap: var(--s3); }
.home-brand__symbol { display: grid; place-items: center; width: 42px; height: 42px; color: var(--ink); background: var(--nim); border-radius: 14px; box-shadow: 0 8px 24px rgb(56 47 23 / 10%); }
.home-brand > span:last-child { display: grid; gap: 1px; }
.home-brand strong { font-family: var(--font-display); font-size: var(--text-lg); letter-spacing: -.025em; }
.home-brand small { color: var(--text-muted); font-size: var(--text-xs); }
.home-status { display: inline-flex; align-items: center; gap: var(--s2); padding: .5rem .75rem; color: var(--moss); background: var(--sage-subtle); border: 1px solid var(--sage-line); border-radius: var(--r-full); font-size: var(--text-xs); font-weight: 750; }
.home-status i, .wallet-row i { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }

.home-grid { display: grid; grid-template-columns: minmax(0, .88fr) minmax(30rem, 1.12fr); align-items: start; gap: clamp(2rem, 6vw, 5.5rem); }
.welcome { position: sticky; top: var(--s8); display: flex; flex-direction: column; gap: var(--s5); padding-top: var(--s4); }
.welcome__eyebrow, .composer__eyebrow { margin: 0; color: var(--accent); font-size: var(--text-xs); font-weight: 800; letter-spacing: .065em; text-transform: uppercase; }
.welcome h1 { max-width: 12ch; font-family: var(--font-display); font-size: clamp(2.75rem, 5vw, 4.65rem); font-weight: 720; line-height: .98; letter-spacing: -.055em; }
.welcome__copy { max-width: 35rem; color: var(--text-muted); font-size: clamp(1rem, 1.3vw, 1.12rem); line-height: 1.65; }
.promise-list { display: grid; gap: var(--s2); margin-top: var(--s2); }
.promise { display: grid; grid-template-columns: 2rem 1fr; gap: var(--s3); align-items: start; padding: var(--s3) 0; border-top: 1px solid var(--line); }
.promise > span { padding-top: 2px; color: var(--accent); font-size: .68rem; font-weight: 800; font-variant-numeric: tabular-nums; }
.promise p { display: grid; gap: 2px; }
.promise strong { font-size: var(--text-sm); }
.promise small { color: var(--text-muted); font-size: var(--text-sm); line-height: var(--leading); }
.sample-action { display: flex; align-items: center; justify-content: space-between; gap: var(--s4); width: 100%; padding: var(--s4); color: var(--text); text-align: left; background: var(--sage-subtle); border: 1px solid var(--sage-line); border-radius: var(--r-md); transition: transform var(--duration-fast) var(--ease-smooth-out), background-color var(--duration-fast) var(--ease-smooth-out); }
.sample-action:hover { transform: translateY(-2px); background: var(--sage-hover); }
.sample-action > span { display: grid; gap: 2px; }
.sample-action small { color: var(--text-muted); font-size: var(--text-xs); }
.sample-action strong { font-size: var(--text-sm); }
.sample-action svg { flex: 0 0 auto; color: var(--moss); transition: transform var(--duration-fast) var(--ease-smooth-out); }
.sample-action:hover svg { transform: translateX(3px); }
.sample-action--mobile { display: none; }

.composer { display: flex; flex-direction: column; gap: var(--s5); padding: clamp(1.1rem, 3vw, 2rem); background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-xl); box-shadow: var(--shadow-card); }
.composer__head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--s4); padding-bottom: var(--s4); border-bottom: 1px solid var(--line); }
.composer__head > div { display: grid; gap: var(--s2); }
.composer__head h2 { max-width: 18ch; font-family: var(--font-display); font-size: clamp(1.5rem, 3vw, 2.1rem); letter-spacing: -.035em; }
.local-chip { flex: 0 0 auto; padding: .38rem .65rem; color: var(--text-muted); background: var(--surface-sunken); border-radius: var(--r-full); font-size: .68rem; font-weight: 750; }
.project-field { max-width: 100%; }
.idea-field { padding: var(--s4); background: var(--surface-raised); border: 1px solid var(--line-strong); border-radius: var(--r-md); transition: border-color var(--duration-quick) var(--ease-smooth-out), box-shadow var(--duration-fast) var(--ease-smooth-out), transform var(--duration-fast) var(--ease-smooth-out); }
.idea-field:focus-within { border-color: var(--accent); box-shadow: 0 0 0 4px var(--accent-subtle); transform: translateY(-1px); }
.idea-field .textarea { min-height: 176px; padding: var(--s3) 0 0; border: 0; border-radius: 0; background: transparent; }
.idea-field .textarea:focus { border: 0; box-shadow: none; }
.idea-field__heading { display: flex; align-items: center; justify-content: space-between; gap: var(--s3); }
.idea-field__count { color: var(--text-faint); font-size: var(--text-xs); font-variant-numeric: tabular-nums; }
.examples { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s2); padding-top: var(--s3); border-top: 1px solid var(--line); }
.examples__label { color: var(--text-faint); font-size: var(--text-xs); font-weight: 700; }
.example-chips { display: flex; flex-wrap: wrap; gap: var(--s2); }
.example-chip { min-height: 34px; padding: 0 .7rem; color: var(--text-muted); background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-full); font-size: var(--text-xs); font-weight: 700; transition: transform var(--duration-quick) var(--ease-smooth-out), border-color var(--duration-quick) var(--ease-smooth-out), color var(--duration-quick) var(--ease-smooth-out); }
.example-chip:hover { color: var(--accent); border-color: var(--accent-line); transform: translateY(-1px); }

.composer-tools { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s3); }
.template-action, .context-toggle { display: flex; align-items: center; gap: var(--s3); min-height: 64px; padding: var(--s3); text-align: left; background: var(--surface-sunken); border: 1px solid var(--line); border-radius: var(--r-md); transition: background-color var(--duration-fast) var(--ease-smooth-out), transform var(--duration-fast) var(--ease-smooth-out); }
.template-action:hover, .context-toggle:hover { background: var(--surface-hover); transform: translateY(-1px); }
.template-action > span:nth-child(2), .context-toggle > span { display: grid; flex: 1; gap: 2px; }
.template-action strong, .context-toggle strong { font-size: var(--text-xs); }
.template-action small, .context-toggle small { color: var(--text-muted); font-size: .69rem; line-height: 1.35; }
.template-action__mark { display: grid; flex: 0 0 30px; place-items: center; width: 30px; height: 30px; color: #17130b; background: var(--nim); border-radius: 10px; font-size: .72rem; font-weight: 900; }
.template-action svg, .context-toggle svg { flex: 0 0 auto; color: var(--text-faint); }
.context-toggle svg { transition: transform var(--acc-chevron) var(--acc-ease); }
.context-toggle--open svg { transform: rotate(180deg); }
.context-fields { display: grid; gap: var(--s4); padding: var(--s4); background: var(--surface-sunken); border-radius: var(--r-md); overflow: hidden; }

.submit { display: flex; flex-direction: column; gap: var(--s3); }
.generate-button { position: relative; min-height: 54px; overflow: hidden; }
.generate-button__icon { display: grid; flex: 0 0 24px; place-items: center; width: 24px; height: 24px; }
.generate-button__label { display: grid; place-items: center; min-width: 12rem; }
.generate-button__label > span { grid-area: 1 / 1; }
.foot { min-height: 1.2em; font-size: var(--text-xs); line-height: var(--leading); text-align: center; }
.dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; animation: pulse 1200ms var(--ease-in-out) infinite; }
@keyframes pulse { 0%, 100% { opacity: .35; transform: scale(.8); } 50% { opacity: 1; transform: scale(1); } }
.wallet-row { display: flex; align-items: center; justify-content: space-between; gap: var(--s3); padding-top: var(--s4); border-top: 1px solid var(--line); color: var(--text-muted); font-size: var(--text-xs); }
.wallet-row > span { display: inline-flex; align-items: center; gap: var(--s2); }
.wallet-row i { color: var(--nim); }
.wallet-row button { min-height: 36px; color: var(--accent); font-size: var(--text-xs); font-weight: 750; }
.wallet-row button:hover { color: var(--accent-hover); }

.home-foot { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--s6); padding-top: var(--s5); border-top: 1px solid var(--line); }
.disclosure { max-width: 46rem; font-size: var(--text-xs); line-height: var(--leading); }
.site-footer { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--s4); font-size: var(--text-xs); }
.site-footer a { color: var(--text-muted); }
.site-footer a:hover { color: var(--accent); }

/* transitions.dev: text-state swap, accordion and content reveal. */
.text-swap-enter-active, .text-swap-leave-active { transition: opacity var(--text-swap-dur) var(--text-swap-ease), transform var(--text-swap-dur) var(--text-swap-ease), filter var(--text-swap-dur) var(--text-swap-ease); }
.text-swap-enter-from { opacity: 0; transform: translateY(var(--text-swap-translate-y)); filter: blur(var(--text-swap-blur)); }
.text-swap-leave-to { opacity: 0; transform: translateY(calc(var(--text-swap-translate-y) * -1)); filter: blur(var(--text-swap-blur)); }
.accordion-reveal-enter-active, .accordion-reveal-leave-active { transition: opacity var(--acc-expand) var(--acc-ease), transform var(--acc-expand) var(--acc-ease), filter var(--acc-expand) var(--acc-ease); transform-origin: top; }
.accordion-reveal-enter-from, .accordion-reveal-leave-to { opacity: 0; transform: translateY(calc(var(--distance-base) * -1)) scaleY(.97); filter: blur(var(--blur-small)); }
.examples-reveal-enter-active, .examples-reveal-leave-active { transition: opacity var(--duration-slow) var(--ease-in-out), filter var(--duration-slow) var(--ease-in-out); }
.examples-reveal-enter-from, .examples-reveal-leave-to { opacity: 0; filter: blur(var(--blur-small)); }

@media (max-width: 860px) {
  .home-grid { grid-template-columns: 1fr; gap: var(--s8); }
  .welcome { position: static; padding-top: 0; }
  .welcome h1 { max-width: 13ch; font-size: clamp(2.5rem, 9vw, 4.1rem); }
  .promise-list { grid-template-columns: repeat(3, 1fr); }
  .promise { grid-template-columns: 1fr; }
  .sample-action { max-width: 34rem; }
}

@media (max-width: 600px) {
  .home-screen { gap: var(--s8); }
  .home-brand small { display: none; }
  .home-status { padding: .4rem .6rem; }
  .welcome { display: none; }
  .composer { margin: 0 calc(var(--s4) * -1); padding: var(--s5) var(--s4); border-right: 0; border-left: 0; border-radius: 0; box-shadow: none; }
  .composer__head { align-items: center; }
  .composer__head h2 { font-size: 1.65rem; }
  .local-chip { display: none; }
  .sample-action--mobile { display: flex; padding: var(--s3); }
  .composer-tools { grid-template-columns: 1fr; }
  .idea-field .textarea { min-height: 160px; }
  .home-foot { flex-direction: column; }
  .site-footer { justify-content: flex-start; }
}
</style>
