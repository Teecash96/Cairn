<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { RefineAction } from '../lib/api'
import type { Plan, PlanChanges } from '../lib/plan'
import { refinementDifferences, removedRefinementTasks } from '../lib/refinement'

const {
  action,
  plan,
  explanation = '',
  answer = '',
  changes,
  busy = false,
} = defineProps<{
  action: RefineAction
  plan: Plan
  explanation?: string
  answer?: string
  changes?: PlanChanges | null
  busy?: boolean
}>()

const emit = defineEmits<{
  cancel: [apply?: boolean]
  submit: [question: string]
}>()

const question = ref('')
const acknowledgeRemoval = ref(false)
watch(() => changes, () => { acknowledgeRemoval.value = false })
const differences = computed(() => changes ? refinementDifferences(plan, changes) : [])
const removedTasks = computed(() => changes ? removedRefinementTasks(plan, changes) : [])
const canApply = computed(() => !busy && (!removedTasks.value.length || acknowledgeRemoval.value))
const labels: Record<RefineAction, string> = {
  cut_mvp_scope: 'Cut MVP scope',
  break_into_tasks: 'Break work into smaller tasks',
  find_missing_risks: 'Find missing risks',
  improve_acceptance_tests: 'Improve acceptance tests',
  custom: 'Ask Cairn a question',
}

const title = computed(() => labels[action])
const hasChanges = computed(() => {
  if (!changes) return false
  return Boolean(
    changes.prd ||
      changes.flow ||
      changes.build ||
      changes.realityCheck,
  )
})

const changeLabels = computed(() => {
  if (!changes) return []
  const labels: string[] = []
  if (changes.prd) labels.push('PRD sections')
  if (changes.flow) labels.push('User flow')
  if (changes.build?.mvpScope) labels.push('MVP scope')
  if (changes.build?.milestones) labels.push('Milestones and tasks')
  if (changes.build?.risks) labels.push('Risks')
  if (changes.build?.acceptanceTests) labels.push('Acceptance tests')
  if (changes.build?.nextAction) labels.push('Next action')
  if (changes.realityCheck) labels.push('Reality check')
  return labels
})

const questionReady = computed(() => question.value.trim().length >= 8)

function submitQuestion(): void {
  if (!questionReady.value || busy) return
  emit('submit', question.value.trim())
}

function applyChanges(): void {
  if (canApply.value) emit('cancel', true)
}

function dismiss(): void {
  if (!busy) emit('cancel')
}

onMounted(() => {
  if (action === 'custom') document.getElementById('refine-question')?.focus()
  else document.getElementById('refine-cancel')?.focus()
})
</script>

<template>
  <div class="sheet-backdrop" role="presentation" @click.self="dismiss">
    <section class="sheet refine-sheet" role="dialog" aria-modal="true" aria-labelledby="refine-title">
      <div class="sheet__grab" aria-hidden="true" />
      <header class="sheet__head">
        <div>
          <p class="eyebrow">Planner follow up</p>
          <h2 id="refine-title">{{ title }}</h2>
        </div>
        <button id="refine-cancel" type="button" class="icon-btn" aria-label="Close" :disabled="busy" @click="dismiss">×</button>
      </header>

      <div v-if="busy" class="refine-loading" role="status" aria-live="polite">
        <span class="dot" aria-hidden="true" />
        <p>Reading the current plan and finding the smallest useful change…</p>
      </div>

      <form v-else-if="action === 'custom' && !answer && !explanation" class="refine-question" @submit.prevent="submitQuestion">
        <label class="field">
          <span class="field__label">What should Cairn look at?</span>
          <textarea
            id="refine-question"
            v-model="question"
            class="textarea"
            rows="4"
            minlength="8"
            maxlength="500"
            placeholder="For example: what is the smallest way to test whether people will pay for this?"
          />
        </label>
        <button type="submit" class="btn btn--primary btn--block" :disabled="!questionReady || busy">
          {{ busy ? 'Thinking…' : 'Ask Cairn' }}
        </button>
      </form>

      <div v-else class="refine-result">
        <p v-if="answer" class="answer">{{ answer }}</p>
        <p v-if="explanation" class="muted refine-result__intro">{{ explanation }}</p>

        <div v-if="hasChanges" class="proposed">
          <div class="section-heading">
            <h3>Proposed changes</h3>
            <span class="badge badge--accent">Preview</span>
          </div>
          <ul class="clean-list">
            <li v-for="label in changeLabels" :key="label">{{ label }}</li>
          </ul>
          <details v-for="difference in differences" :key="difference.label" class="change-detail">
            <summary>{{ difference.label }}</summary>
            <p class="eyebrow">Current</p>
            <p class="change-copy">{{ difference.before || 'Empty' }}</p>
            <p class="eyebrow">Proposed</p>
            <p class="change-copy">{{ difference.after || 'Empty' }}</p>
          </details>
          <div v-if="removedTasks.length" class="removal-warning">
            <h4>{{ removedTasks.length }} existing task(s) will be removed or replaced</h4>
            <ul><li v-for="task in removedTasks" :key="task.id">{{ task.text }} — {{ task.status === 'done' ? 'completed' : task.status === 'in_progress' ? 'in progress' : 'to do' }}</li></ul>
            <label><input v-model="acknowledgeRemoval" type="checkbox" /> I understand that these tasks and their saved progress, notes, and dependencies will be removed.</label>
          </div>
          <p class="faint refine-result__note">Unchanged task text keeps its progress and notes, even when moved to another milestone. Renamed tasks are treated as replacements.</p>
        </div>
        <p v-else class="empty-result muted">No plan changes were proposed. Your plan stays as it is.</p>

        <div class="sheet__actions">
          <button type="button" class="btn btn--secondary btn--block" :disabled="busy" @click="emit('cancel')">Cancel</button>
          <button v-if="hasChanges" type="button" class="btn btn--primary btn--block" :disabled="!canApply" @click="applyChanges">Apply changes</button>
          <button v-else type="button" class="btn btn--primary btn--block" :disabled="busy" @click="emit('cancel')">Done</button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.change-detail { padding: var(--s3) 0; border-top: 1px solid var(--line); }
.change-detail summary { cursor: pointer; font-size: 1rem; font-weight: 650; }
.change-detail .eyebrow { margin-top: var(--s3); }
.change-copy { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 1rem; line-height: var(--leading); }
.removal-warning { display: grid; gap: var(--s3); padding: var(--s3); border: 1px solid var(--line-strong); border-radius: var(--r-md); font-size: .875rem; line-height: var(--leading); }
.removal-warning ul { padding-left: var(--s4); }
.removal-warning input { margin-right: var(--s2); }
.sheet-backdrop { position: fixed; inset: 0; z-index: 50; display: flex; align-items: flex-end; justify-content: center; padding: var(--s3); background: rgb(15 16 24 / 48%); }
.sheet { width: min(100%, 35rem); max-height: min(88vh, 44rem); overflow-y: auto; border: 1px solid var(--line); border-radius: var(--r-lg) var(--r-lg) var(--r-md) var(--r-md); background: var(--surface); box-shadow: var(--shadow-sheet); }
.refine-sheet { padding: var(--s3) var(--s4) calc(var(--safe-bottom) + var(--s5)); }
.sheet__grab { width: 36px; height: 4px; margin: 0 auto var(--s4); border-radius: var(--r-full); background: var(--line-strong); }
.sheet__head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--s3); margin-bottom: var(--s5); }
.sheet__head h2 { font-size: var(--text-xl); letter-spacing: -.02em; }
.icon-btn { display: grid; flex: 0 0 40px; place-items: center; width: 40px; height: 40px; border-radius: 50%; color: var(--text-muted); font-size: 28px; line-height: 1; }
.icon-btn:hover { background: var(--surface-sunken); color: var(--text); }
.refine-question, .refine-result { display: flex; flex-direction: column; gap: var(--s4); }
.refine-loading { display: flex; align-items: center; gap: var(--s3); min-height: 100px; color: var(--text-muted); font-size: var(--text-md); line-height: var(--leading); }
.dot { flex: 0 0 10px; width: 10px; height: 10px; border-radius: 50%; background: var(--accent); animation: pulse 1.2s ease-in-out infinite; }
@keyframes pulse { 0%, 100% { opacity: .35; transform: scale(.8); } 50% { opacity: 1; transform: scale(1); } }
.refine-question .textarea { min-height: 112px; }
.answer { padding: var(--s4); border: 1px solid var(--accent-line); border-radius: var(--r-md); background: var(--accent-subtle); font-size: var(--text-md); line-height: var(--leading); }
.refine-result__intro { font-size: var(--text-md); line-height: var(--leading); }
.proposed { display: flex; flex-direction: column; gap: var(--s3); padding: var(--s4); border: 1px solid var(--line); border-radius: var(--r-md); background: var(--surface-sunken); }
.proposed h3 { font-size: var(--text-md); }
.refine-result__note { font-size: var(--text-xs); line-height: var(--leading); }
.empty-result { padding: var(--s4); border: 1px dashed var(--line-strong); border-radius: var(--r-md); font-size: var(--text-sm); line-height: var(--leading); }
.sheet__actions { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s2); }
@media (max-width: 24rem) { .sheet__actions { grid-template-columns: 1fr; } }
@media (prefers-reduced-motion: reduce) { .dot { animation: none; } }
</style>
