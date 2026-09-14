<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import type { Milestone, Task, TaskPriority, TaskStatus } from '../lib/plan'
import { isValidDate, TRACKER_DEPENDENCY_MAX, TRACKER_LABEL_LENGTH, TRACKER_LABEL_MAX, TRACKER_NOTES_MAX } from '../lib/plan'
import { dependencyError } from '../lib/tracker'

const { mode, task, milestone, allTasks, milestoneTitle = '', publicOnly = false } = defineProps<{
  mode: 'task' | 'milestone'
  task?: Task
  milestone?: Milestone
  allTasks?: Task[]
  milestoneTitle?: string
  /** Team editors can change only fields in the public Track projection. */
  publicOnly?: boolean
}>()

const emit = defineEmits<{
  close: []
  'save-task': [task: Task]
  'save-milestone': [milestone: Milestone]
  'remove-task': [id: string]
  'remove-milestone': [id: string]
}>()

const taskDraft = reactive<Task>(copyTask(task ?? {
  id: '',
  text: '',
  status: 'todo',
  priority: 'medium',
  labels: [],
  notes: '',
  dependsOn: [],
}))
const milestoneDraft = reactive<Milestone>(copyMilestone(milestone ?? {
  id: '',
  title: '',
  outcome: '',
  tasks: [],
  blocked: false,
}))

const labelsText = ref(taskDraft.labels.join(', '))
const bountyRecipient = ref(milestoneDraft.bounty?.recipient ?? '')
const bountyAmountNim = ref(milestoneDraft.bounty ? String(milestoneDraft.bounty.amountLuna / 100_000) : '')
const error = ref('')

const statusOptions: TaskStatus[] = ['todo', 'in_progress', 'done']
const priorityOptions: TaskPriority[] = ['low', 'medium', 'high']
const dependencyOptions = computed(() => (allTasks ?? []).filter((candidate) => candidate.id !== taskDraft.id))

function copyTask(value: Task): Task {
  return {
    id: value.id,
    text: value.text,
    status: value.status,
    priority: value.priority,
    labels: [...value.labels],
    notes: value.notes,
    ...(value.dueDate ? { dueDate: value.dueDate } : {}),
    dependsOn: [...value.dependsOn],
  }
}

function copyMilestone(value: Milestone): Milestone {
  return {
    id: value.id,
    title: value.title,
    outcome: value.outcome,
    tasks: value.tasks.map(copyTask),
    ...(value.startDate ? { startDate: value.startDate } : {}),
    ...(value.dueDate ? { dueDate: value.dueDate } : {}),
    blocked: value.blocked,
    ...(value.bounty ? { bounty: { ...value.bounty } } : {}),
  }
}

function parseLabels(): string[] | null {
  const labels = labelsText.value
    .split(',')
    .map((value) => value.replace(/\s+/g, ' ').trim().slice(0, TRACKER_LABEL_LENGTH))
    .filter((value, index, values) => value && values.indexOf(value) === index)
  if (labels.length > TRACKER_LABEL_MAX) {
    error.value = `Use up to ${TRACKER_LABEL_MAX} labels.`
    return null
  }
  return labels
}

function saveTask(): void {
  const text = taskDraft.text.replace(/\s+/g, ' ').trim()
  if (!text) {
    error.value = 'Give the task a name.'
    return
  }
  const labels = parseLabels()
  if (!labels) return
  const dueDate = taskDraft.dueDate?.trim() || undefined
  if (dueDate && !isValidDate(dueDate)) {
    error.value = 'Use a real date in YYYY-MM-DD format.'
    return
  }
  const next: Task = {
    ...copyTask(taskDraft),
    text,
    labels,
    priority: publicOnly ? 'medium' : taskDraft.priority,
    notes: publicOnly ? '' : taskDraft.notes.slice(0, TRACKER_NOTES_MAX),
    ...(dueDate ? { dueDate } : {}),
    dependsOn: publicOnly ? [] : [...taskDraft.dependsOn],
  }
  const build = {
    mvpScope: [],
    milestones: [{ id: 'editor', title: milestoneTitle, outcome: '', tasks: allTasks ?? [], blocked: false }],
    risks: [],
    acceptanceTests: [],
    nextAction: '',
  }
  const dependencyProblem = publicOnly ? null : dependencyError(next.id, next.dependsOn, build)
  if (dependencyProblem) {
    error.value = dependencyProblem
    return
  }
  emit('save-task', next)
}

function saveMilestone(): void {
  const title = milestoneDraft.title.replace(/\s+/g, ' ').trim()
  if (!title) {
    error.value = 'Give the milestone a name.'
    return
  }
  const startDate = milestoneDraft.startDate?.trim() || undefined
  const dueDate = milestoneDraft.dueDate?.trim() || undefined
  if ((startDate && !isValidDate(startDate)) || (dueDate && !isValidDate(dueDate))) {
    error.value = 'Use real dates in YYYY-MM-DD format.'
    return
  }
  if (startDate && dueDate && startDate > dueDate) {
    error.value = 'The start date must be before the due date.'
    return
  }
  const recipient = bountyRecipient.value.replace(/\s+/g, '').toUpperCase()
  const amountNim = Number(bountyAmountNim.value)
  if (!publicOnly && (recipient || bountyAmountNim.value)) {
    if (!/^NQ[0-9A-HJ-NP-VXY]{34}$/.test(recipient)) {
      error.value = 'Enter a complete Nimiq bounty address.'
      return
    }
    if (!Number.isFinite(amountNim) || amountNim <= 0 || amountNim > 1_000_000 || Math.round(amountNim * 100_000) !== amountNim * 100_000) {
      error.value = 'Enter a bounty with no more than 5 decimal places.'
      return
    }
  }
  const next: Milestone = {
    ...copyMilestone(milestoneDraft),
    title,
    outcome: milestoneDraft.outcome.replace(/\s+/g, ' ').trim().slice(0, 260),
    ...(startDate ? { startDate } : {}),
    ...(dueDate ? { dueDate } : {}),
    ...(!publicOnly && recipient && amountNim ? { bounty: { recipient, amountLuna: Math.round(amountNim * 100_000) } } : {}),
  }
  if (!recipient || !amountNim || publicOnly) delete next.bounty
  emit('save-milestone', next)
}

function save(): void {
  error.value = ''
  if (mode === 'task') saveTask()
  else saveMilestone()
}

function toggleDependency(id: string): void {
  if (taskDraft.dependsOn.includes(id)) {
    taskDraft.dependsOn = taskDraft.dependsOn.filter((value) => value !== id)
  } else if (taskDraft.dependsOn.length < TRACKER_DEPENDENCY_MAX) {
    taskDraft.dependsOn = [...taskDraft.dependsOn, id]
  }
}

onMounted(() => {
  document.getElementById(mode === 'task' ? 'tracker-task-text' : 'tracker-milestone-title')?.focus()
})
</script>

<template>
  <div class="sheet-backdrop" role="presentation" @click.self="emit('close')">
    <section
      class="sheet tracker-sheet"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="mode === 'task' ? 'tracker-task-heading' : 'tracker-milestone-heading'"
      :aria-describedby="error ? 'tracker-editor-error' : undefined"
      @keydown.esc="emit('close')"
    >
      <div class="sheet__grab" aria-hidden="true" />
      <header class="sheet__head">
        <div>
          <p class="eyebrow">{{ mode === 'task' ? 'Task' : 'Milestone' }}</p>
          <h2 :id="mode === 'task' ? 'tracker-task-heading' : 'tracker-milestone-heading'">
            {{ mode === 'task' ? (task ? 'Edit task' : 'Add task') : (milestone ? 'Edit milestone' : 'Add milestone') }}
          </h2>
        </div>
        <button type="button" class="icon-btn" aria-label="Close editor" @click="emit('close')">×</button>
      </header>

      <form v-if="mode === 'task'" class="tracker-form" @submit.prevent="save">
        <label class="field">
          <span class="field__label">Task</span>
          <input id="tracker-task-text" v-model="taskDraft.text" class="input" maxlength="260" required />
        </label>

        <div class="form-grid">
          <label class="field">
            <span class="field__label">Status</span>
            <select v-model="taskDraft.status" class="input">
              <option v-for="value in statusOptions" :key="value" :value="value">{{ value === 'in_progress' ? 'In progress' : value === 'todo' ? 'To do' : 'Done' }}</option>
            </select>
          </label>
          <label v-if="!publicOnly" class="field">
            <span class="field__label">Priority</span>
            <select v-model="taskDraft.priority" class="input">
              <option v-for="value in priorityOptions" :key="value" :value="value">{{ value }}</option>
            </select>
          </label>
        </div>

        <label class="field">
          <span class="field__label">Due date <span class="faint">Optional</span></span>
          <input
            class="input"
            type="date"
            :value="taskDraft.dueDate ?? ''"
            @input="taskDraft.dueDate = ($event.target as HTMLInputElement).value || undefined"
          />
        </label>

        <label class="field">
          <span class="field__label">Labels <span class="faint">Up to 3, separated by commas</span></span>
          <input v-model="labelsText" class="input" maxlength="80" placeholder="design, test" />
        </label>

        <label v-if="!publicOnly" class="field">
          <span class="field__label">Private note <span class="faint">Never shared</span></span>
          <textarea v-model="taskDraft.notes" class="textarea" rows="3" :maxlength="TRACKER_NOTES_MAX" placeholder="What should you remember?" />
        </label>

        <fieldset v-if="!publicOnly && dependencyOptions.length" class="dependency-fieldset">
          <legend class="field__label">Blocked by <span class="faint">Optional</span></legend>
          <label v-for="candidate in dependencyOptions" :key="candidate.id" class="check-row">
            <input type="checkbox" :checked="taskDraft.dependsOn.includes(candidate.id)" @change="toggleDependency(candidate.id)" />
            <span>{{ candidate.text }}</span>
          </label>
          <p class="faint field-help">A task is blocked until every selected task is done.</p>
        </fieldset>

        <p v-if="publicOnly" class="faint field-help">Team editors can change status, labels, and dates. Private fields belong to the owner.</p>

        <p v-if="error" id="tracker-editor-error" class="form-error" role="alert">{{ error }}</p>
        <div class="sheet__actions tracker-actions">
          <button v-if="task" type="button" class="btn btn--danger btn--sm" @click="emit('remove-task', task.id)">Remove</button>
          <span v-else />
          <button type="submit" class="btn btn--primary btn--block">Save task</button>
        </div>
      </form>

      <form v-else class="tracker-form" @submit.prevent="save">
        <label class="field">
          <span class="field__label">Milestone</span>
          <input id="tracker-milestone-title" v-model="milestoneDraft.title" class="input" maxlength="100" required />
        </label>
        <label class="field">
          <span class="field__label">Outcome</span>
          <textarea v-model="milestoneDraft.outcome" class="textarea" rows="2" maxlength="260" placeholder="What will be true when this is complete?" />
        </label>
        <div class="form-grid">
          <label class="field">
            <span class="field__label">Starts <span class="faint">Optional</span></span>
            <input class="input" type="date" :value="milestoneDraft.startDate ?? ''" @input="milestoneDraft.startDate = ($event.target as HTMLInputElement).value || undefined" />
          </label>
          <label class="field">
            <span class="field__label">Due <span class="faint">Optional</span></span>
            <input class="input" type="date" :value="milestoneDraft.dueDate ?? ''" @input="milestoneDraft.dueDate = ($event.target as HTMLInputElement).value || undefined" />
          </label>
        </div>
        <label class="check-row check-row--flag">
          <input v-model="milestoneDraft.blocked" type="checkbox" />
          <span>Mark this milestone blocked</span>
        </label>
        <p class="faint field-help">This is your manual flag. Task blockers are calculated separately.</p>
        <fieldset v-if="!publicOnly" class="dependency-fieldset">
          <legend class="field__label">NIM milestone bounty <span class="faint">Optional</span></legend>
          <label class="field">
            <span class="field__label">Recipient wallet</span>
            <input v-model="bountyRecipient" class="input" maxlength="44" placeholder="NQ…" autocomplete="off" />
          </label>
          <label class="field">
            <span class="field__label">Amount in NIM</span>
            <input v-model="bountyAmountNim" class="input" type="number" min="0.00001" max="1000000" step="0.00001" inputmode="decimal" placeholder="1" />
          </label>
          <p class="faint field-help">Cairn never holds this money. When the milestone is complete, your wallet creates a direct payment to this address.</p>
        </fieldset>
        <p v-if="error" id="tracker-editor-error" class="form-error" role="alert">{{ error }}</p>
        <div class="sheet__actions tracker-actions">
          <button v-if="milestone" type="button" class="btn btn--danger btn--sm" @click="emit('remove-milestone', milestone.id)">Remove</button>
          <span v-else />
          <button type="submit" class="btn btn--primary btn--block">Save milestone</button>
        </div>
      </form>
    </section>
  </div>
</template>

<style scoped>
.sheet-backdrop { position: fixed; inset: 0; z-index: 50; display: flex; align-items: flex-end; justify-content: center; padding: var(--s3); background: rgb(15 16 24 / 48%); }
.sheet { width: min(100%, 35rem); max-height: min(90vh, 48rem); overflow-y: auto; border: 1px solid var(--line); border-radius: var(--r-lg) var(--r-lg) var(--r-md) var(--r-md); background: var(--surface); box-shadow: var(--shadow-sheet); }
.tracker-sheet { padding: var(--s3) var(--s4) calc(var(--safe-bottom) + var(--s5)); }
.sheet__grab { width: 36px; height: 4px; margin: 0 auto var(--s4); border-radius: var(--r-full); background: var(--line-strong); }
.sheet__head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--s3); margin-bottom: var(--s5); }
.sheet__head h2 { font-size: var(--text-xl); letter-spacing: -.02em; }
.icon-btn { display: grid; flex: 0 0 40px; place-items: center; width: 40px; height: 40px; border-radius: 50%; color: var(--text-muted); font-size: 28px; line-height: 1; }
.icon-btn:hover { background: var(--surface-sunken); color: var(--text); }
.tracker-form { display: flex; flex-direction: column; gap: var(--s4); }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s3); }
.input, .textarea { width: 100%; }
.dependency-fieldset { display: flex; flex-direction: column; gap: var(--s2); margin: 0; padding: var(--s3); border: 1px solid var(--line); border-radius: var(--r-md); }
.dependency-fieldset legend { padding: 0 var(--s1); }
.check-row { display: flex; align-items: flex-start; gap: var(--s2); color: var(--text-muted); font-size: var(--text-sm); line-height: var(--leading); }
.check-row input { flex: 0 0 auto; width: 18px; height: 18px; margin: 2px 0 0; accent-color: var(--accent); }
.check-row--flag { color: var(--text); }
.field-help { font-size: var(--text-xs); line-height: var(--leading); }
.form-error { color: var(--danger); font-size: var(--text-sm); line-height: var(--leading); }
.tracker-actions { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: var(--s3); }
.tracker-actions > span { min-width: 1px; }
@media (max-width: 24rem) { .form-grid { grid-template-columns: 1fr; } }
</style>
