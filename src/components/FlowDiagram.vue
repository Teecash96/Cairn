<script setup lang="ts">
/**
 * The user flow, as a diagram.
 *
 * This is the artifact people will screenshot, so it is built from real text in
 * real boxes rather than an image: it stays selectable, it reflows in portrait, it
 * survives a font-size bump, and a screen reader walks it as an ordered list.
 *
 * Three things are deliberate:
 *
 *  - `kind` drives the layout structurally. The decision step renders a genuine
 *    two-column split because the data says it is a decision, not because
 *    something guessed from the wording.
 *  - Every step carries its role in *words* ("Decision", "Success"), so the tint
 *    on a card is decoration. Nothing here is legible only in colour.
 *  - Structure changes replace the array (via the model) while text edits write
 *    into the step objects in place. One write path each, no draft copy.
 */
import AutoTextarea from './AutoTextarea.vue'
import { FLOW_MAX_STEPS, type FlowStep, type FlowStepKind } from '../lib/plan'

const model = defineModel<FlowStep[]>({ required: true })

const { editing = false } = defineProps<{
  editing?: boolean
}>()

const KIND_LABEL: Record<FlowStepKind, string> = {
  entry: 'Entry point',
  action: 'Action',
  decision: 'Decision',
  success: 'Success',
  exit: 'Next step',
}

function labelFor(kind: FlowStepKind): string {
  return KIND_LABEL[kind] ?? 'Step'
}

function addStep(): void {
  if (model.value.length >= FLOW_MAX_STEPS) return
  const step: FlowStep = { kind: 'action', title: '', action: '', result: '' }
  // Before the closing steps, where a new action almost always belongs.
  const tail = model.value.findIndex((s) => s.kind === 'success' || s.kind === 'exit')
  const at = tail === -1 ? model.value.length : tail
  model.value = [...model.value.slice(0, at), step, ...model.value.slice(at)]
}

function removeStep(index: number): void {
  model.value = model.value.filter((_, i) => i !== index)
}
</script>

<template>
  <div class="flow">
    <ol class="steps">
      <li v-for="(step, index) in model" :key="index" class="node">
        <article class="card" :class="`card--${step.kind}`">
          <header class="card__head">
            <span class="num mono" aria-hidden="true">{{ index + 1 }}</span>
            <span class="badge" :class="{ 'badge--accent': step.kind === 'decision' }">
              {{ labelFor(step.kind) }}
            </span>
            <button
              v-if="editing"
              type="button"
              class="drop"
              :aria-label="`Remove step ${index + 1}`"
              @click="removeStep(index)"
            >
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
                <path
                  d="M4 4l8 8M12 4l-8 8"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.75"
                  stroke-linecap="round"
                />
              </svg>
            </button>
          </header>

          <AutoTextarea
            v-if="editing"
            v-model="step.title"
            :rows="1"
            class="title-edit"
            :aria-label="`Step ${index + 1} title`"
            placeholder="What happens here"
          />
          <h4 v-else class="title">{{ step.title }}</h4>

          <dl class="detail">
            <dt>Does</dt>
            <dd>
              <AutoTextarea
                v-if="editing"
                v-model="step.action"
                :rows="2"
                :aria-label="`Step ${index + 1}: what the user does`"
                placeholder="What the user does"
              />
              <template v-else>{{ step.action }}</template>
            </dd>

            <dt>Sees</dt>
            <dd>
              <AutoTextarea
                v-if="editing"
                v-model="step.result"
                :rows="2"
                :aria-label="`Step ${index + 1}: what the user sees`"
                placeholder="What they see happen"
              />
              <template v-else>{{ step.result }}</template>
            </dd>
          </dl>

          <!-- Outcomes of a decision, inside the card that asks the question, so
               the two paths are unmistakably that step's own branches. -->
          <div v-if="(step.branches?.length ?? 0) > 0" class="branch">
            <div class="fork" aria-hidden="true"><span class="fork__arms"></span></div>

            <ul class="branch__row">
              <li v-for="(outcome, b) in step.branches ?? []" :key="b" class="branch__cell">
                <p class="branch__label">
                  <span class="faint" aria-hidden="true">If</span>
                  <template v-if="editing">
                    <input
                      v-model="outcome.label"
                      class="input branch__input"
                      :aria-label="`Step ${index + 1}, outcome ${b + 1} condition`"
                      placeholder="Yes"
                    />
                  </template>
                  <template v-else>{{ outcome.label }}</template>
                </p>
                <AutoTextarea
                  v-if="editing"
                  v-model="outcome.result"
                  :rows="2"
                  :aria-label="`Step ${index + 1}, outcome ${b + 1} result`"
                  placeholder="Then what?"
                />
                <p v-else class="branch__result">{{ outcome.result }}</p>
              </li>
            </ul>
          </div>
        </article>

        <div v-if="index < model.length - 1" class="link" aria-hidden="true"></div>
      </li>
    </ol>

    <div v-if="editing" class="add">
      <button
        type="button"
        class="btn btn--secondary btn--sm"
        :disabled="model.length >= FLOW_MAX_STEPS"
        @click="addStep"
      >
        Add step
      </button>
      <span class="faint count mono">{{ model.length }} of {{ FLOW_MAX_STEPS }}</span>
    </div>
  </div>
</template>

<style scoped>
.steps {
  list-style: none;
  margin: 0;
  padding: 0 0 0 var(--s5);
  border-left: 1px solid var(--accent-line);
}

.node {
  display: flex;
  flex-direction: column;
  align-items: stretch;
}

/* -- the card ------------------------------------------------------------ */

.card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--s2);
  padding: var(--s4);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
}

.card::before {
  content: '';
  position: absolute;
  top: var(--s4);
  left: -26px;
  width: 9px;
  height: 9px;
  border: 2px solid var(--bg);
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
}

/* Entry and success are the two ends of the story; a single accent edge marks
   them without adding another colour to the page. */
.card--entry,
.card--success {
  border-left: 2px solid var(--accent);
}

.card--decision {
  background: var(--accent-subtle);
  border-color: var(--accent-line);
}

.card--exit {
  background: var(--surface-sunken);
}

.card__head {
  display: flex;
  align-items: center;
  gap: var(--s2);
}

.num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: var(--r-full);
  background: var(--surface-sunken);
  border: 1px solid var(--line);
  font-size: var(--text-xs);
  font-weight: 700;
  color: var(--text-muted);
}

.card--decision .num {
  background: var(--surface);
}

.drop {
  margin-left: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: var(--r-sm);
  color: var(--text-faint);
}

.drop:hover {
  background: var(--surface-hover);
  color: var(--danger);
}

.title {
  font-family: var(--font-display);
  font-size: var(--text-lg);
  letter-spacing: -0.012em;
  overflow-wrap: break-word;
}

.title-edit {
  font-size: var(--text-md);
  font-weight: 650;
}

/* -- does / sees --------------------------------------------------------- */

.detail {
  display: grid;
  grid-template-columns: 42px 1fr;
  gap: var(--s1) var(--s3);
  margin: var(--s1) 0 0;
  font-size: var(--text-sm);
}

.detail dt {
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--text-faint);
  padding-top: 2px;
}

.detail dd {
  margin: 0;
  color: var(--text-muted);
  line-height: var(--leading);
  min-width: 0;
  overflow-wrap: break-word;
}

/* -- the branch ---------------------------------------------------------- */

.branch {
  margin-top: var(--s2);
}

/* A bar with a leg down into each column: the split, in two elements and no
   images. Legs land at 25% and 75% — the centre of each half. */
.fork {
  position: relative;
  height: 14px;
}

.fork__arms {
  position: absolute;
  inset: 0 25%;
  border: 1px solid var(--accent-line);
  border-bottom: 0;
  border-top-left-radius: 8px;
  border-top-right-radius: 8px;
}

.branch__row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--s3);
  list-style: none;
  margin: 0;
  padding: 0;
}

.branch__cell {
  display: flex;
  flex-direction: column;
  gap: var(--s1);
  min-width: 0;
  padding: var(--s3);
  background: var(--surface);
  border: 1px solid var(--accent-line);
  border-radius: var(--r-md);
}

.branch__label {
  display: flex;
  align-items: center;
  gap: var(--s1);
  font-size: var(--text-sm);
  font-weight: 650;
  overflow-wrap: break-word;
}

.branch__input {
  padding: var(--s1) var(--s2);
  font-size: var(--text-sm);
  font-weight: 650;
  min-width: 0;
}

.branch__result {
  font-size: var(--text-sm);
  line-height: var(--leading);
  color: var(--text-muted);
  overflow-wrap: break-word;
}

/* -- the spine ----------------------------------------------------------- */

.link {
  position: relative;
  align-self: center;
  width: 1px;
  height: 22px;
  background: var(--accent-line);
}

/* Chevron, so the spine reads as direction rather than decoration. */
.link::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: 1px;
  width: 5px;
  height: 5px;
  border-right: 1px solid var(--line-strong);
  border-bottom: 1px solid var(--line-strong);
  transform: translateX(-50%) rotate(45deg);
}

.add {
  display: flex;
  align-items: center;
  gap: var(--s3);
  margin-top: var(--s4);
}

.count {
  font-size: var(--text-xs);
}

/* Below this the two outcome cells are narrower than a readable line, so they
   stack. The fork would then point at nothing, so it is hidden. */
@media (max-width: 21rem) {
  .branch__row {
    grid-template-columns: 1fr;
  }

  .fork {
    height: var(--s2);
  }

  .fork__arms {
    display: none;
  }
}
</style>
