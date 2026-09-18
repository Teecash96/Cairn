<script setup lang="ts">
import { computed, ref } from 'vue'
import { copyText } from '../lib/clipboard'
import { buildProjectReport, REPORT_KIND_LABELS } from '../lib/report'
import {
  EXECUTION_EXPERIMENT_MAX,
  newId,
  relativeTime,
  titleOf,
  type BuildJournalEntry,
  type Plan,
  type ReportKind,
  type Task,
  type ValidationExperiment,
} from '../lib/plan'

const { plan, readOnly = false, refining = false } = defineProps<{
  plan: Plan
  readOnly?: boolean
  refining?: boolean
}>()

const emit = defineEmits<{
  replan: []
  'open-track': []
  notify: [message: string, tone?: 'info' | 'success' | 'error']
}>()

const checkInOpen = ref(false)
const experimentOpen = ref(false)
const completed = ref('')
const blocker = ref('')
const changed = ref('')
const nextStep = ref('')
const hypothesis = ref('')
const method = ref('')
const successMetric = ref('')

const tasks = computed(() => plan.build.milestones.flatMap((milestone) => milestone.tasks))
const taskById = computed(() => new Map(tasks.value.map((task) => [task.id, task])))
const doneCount = computed(() => tasks.value.filter((task) => task.status === 'done').length)
const progress = computed(() => tasks.value.length ? Math.round((doneCount.value / tasks.value.length) * 100) : 0)
const pendingApprovals = computed(() => tasks.value.filter((task) => task.approvalStatus === 'pending').length)
const blockedTasks = computed(() => {
  const done = new Set(tasks.value.filter((task) => task.status === 'done').map((task) => task.id))
  return tasks.value.filter((task) => task.status !== 'done' && task.dependsOn.some((id) => !done.has(id)))
})
const activeExperimentCount = computed(() => plan.execution.experiments.filter((item) => item.decision === 'open').length)
const latestCheckIn = computed(() => plan.execution.checkIns.at(-1))
const journal = computed(() => [...plan.execution.journal].reverse().slice(0, 20))

const focusTask = computed<Task | undefined>(() => {
  const selected = plan.execution.focusTaskId ? taskById.value.get(plan.execution.focusTaskId) : undefined
  if (selected && selected.status !== 'done') return selected
  const done = new Set(tasks.value.filter((task) => task.status === 'done').map((task) => task.id))
  const available = tasks.value.filter((task) => task.status !== 'done' && task.dependsOn.every((id) => done.has(id)))
  return available.find((task) => task.status === 'in_progress')
    ?? available.find((task) => task.priority === 'high')
    ?? available[0]
})

const releaseReady = computed(() => progress.value === 100 && blockedTasks.value.length === 0 && pendingApprovals.value === 0)
const releaseChecklist = computed(() => [
  { label: 'All mapped tasks complete', done: progress.value === 100 },
  { label: 'No blocked work', done: blockedTasks.value.length === 0 },
  { label: 'No approvals waiting', done: pendingApprovals.value === 0 },
  { label: 'At least one validation result', done: plan.execution.experiments.some((item) => Boolean(item.result.trim())) },
  { label: 'Audience and known issues recorded', done: Boolean(plan.execution.release.audience.trim() && plan.execution.release.knownIssues.trim()) },
])
const checkInReady = computed(() => [completed.value, blocker.value, changed.value, nextStep.value].some((value) => value.trim().length >= 2))
const experimentReady = computed(() => hypothesis.value.trim().length >= 8 && method.value.trim().length >= 8 && successMetric.value.trim().length >= 4)
const reportKinds = Object.entries(REPORT_KIND_LABELS) as Array<[ReportKind, string]>

function addJournal(entry: Omit<BuildJournalEntry, 'id' | 'createdAt'>): void {
  plan.execution.journal.push({ id: newId(), createdAt: Date.now(), ...entry })
  plan.execution.journal = plan.execution.journal.slice(-100)
}

function focus(task: Task): void {
  plan.execution.focusTaskId = task.id
  if (task.status === 'todo') {
    task.status = 'in_progress'
    addJournal({ kind: 'task_started', title: task.text, taskId: task.id })
    plan.execution.taskStates[task.id] = task.status
  }
  emit('notify', 'Today’s focus updated', 'success')
}

function submitCheckIn(): void {
  if (!checkInReady.value || readOnly) return
  const entry = {
    id: newId(),
    createdAt: Date.now(),
    completed: completed.value.trim(),
    blocker: blocker.value.trim(),
    changed: changed.value.trim(),
    nextStep: nextStep.value.trim(),
  }
  plan.execution.checkIns.push(entry)
  plan.execution.checkIns = plan.execution.checkIns.slice(-100)
  addJournal({
    kind: 'check_in',
    title: entry.completed || 'Daily check-in',
    detail: [entry.blocker && `Blocker: ${entry.blocker}`, entry.changed && `Changed: ${entry.changed}`, entry.nextStep && `Next: ${entry.nextStep}`].filter(Boolean).join(' · '),
  })
  if (entry.nextStep) plan.build.nextAction = entry.nextStep
  completed.value = ''
  blocker.value = ''
  changed.value = ''
  nextStep.value = ''
  checkInOpen.value = false
  emit('notify', 'Check-in added to the build journal', 'success')
}

function addExperiment(): void {
  if (!experimentReady.value || readOnly || plan.execution.experiments.length >= EXECUTION_EXPERIMENT_MAX) return
  const now = Date.now()
  plan.execution.experiments.push({
    id: newId(), createdAt: now, updatedAt: now,
    hypothesis: hypothesis.value.trim(), method: method.value.trim(), successMetric: successMetric.value.trim(),
    result: '', decision: 'open',
  })
  addJournal({ kind: 'experiment', title: hypothesis.value.trim(), detail: `Test: ${method.value.trim()}` })
  hypothesis.value = ''
  method.value = ''
  successMetric.value = ''
  experimentOpen.value = false
  emit('notify', 'Validation experiment added', 'success')
}

function updateExperiment(experiment: ValidationExperiment): void {
  experiment.updatedAt = Date.now()
}

function recordExperimentDecision(experiment: ValidationExperiment): void {
  updateExperiment(experiment)
  if (experiment.decision !== 'open') addJournal({ kind: 'experiment', title: `Decision: ${experiment.decision}`, detail: `${experiment.hypothesis}${experiment.result ? ` · ${experiment.result}` : ''}` })
}

function draftReport(): void {
  if (readOnly) return
  const report = plan.execution.report
  const now = Date.now()
  report.title = `${REPORT_KIND_LABELS[report.kind]} · ${titleOf(plan)}`
  report.body = buildProjectReport(plan, report.kind)
  report.updatedAt = now
  emit('notify', 'Editable report drafted from current progress', 'success')
}

function updateReport(): void {
  if (!readOnly) plan.execution.report.updatedAt = Date.now()
}

async function copyReport(): Promise<void> {
  const report = plan.execution.report
  const heading = report.title.trim() ? `# ${report.title.trim()}` : `# ${REPORT_KIND_LABELS[report.kind]}`
  const context = [report.period.trim() && `**Period:** ${report.period.trim()}`, report.audience.trim() && `**For:** ${report.audience.trim()}`].filter(Boolean).join('\n')
  const output = [heading, context, report.body.trim()].filter(Boolean).join('\n\n')
  if (!report.body.trim()) {
    emit('notify', 'Draft or write the report before copying it.', 'error')
    return
  }
  if (await copyText(output)) emit('notify', 'Report copied as Markdown', 'success')
  else emit('notify', 'This browser would not let Cairn copy the report.', 'error')
}

function releaseMarkdown(): string {
  const done = tasks.value.filter((task) => task.status === 'done').map((task) => `- ${task.text}`).join('\n') || '- No completed tasks yet'
  const outstanding = tasks.value.filter((task) => task.status !== 'done').map((task) => `- ${task.text}`).join('\n') || '- None'
  const experiments = plan.execution.experiments.filter((item) => item.result).map((item) => `- ${item.hypothesis}: ${item.result} (${item.decision})`).join('\n') || '- No recorded results'
  const product = `${titleOf(plan)} helps ${plan.prd.targetUser || 'its target user'} ${plan.prd.userGoal || plan.prd.summary}.`
  const social = `We just shipped ${titleOf(plan)} ${plan.execution.release.version}. ${plan.prd.summary} Built from a tested route, not a blank page.`
  const demo = `Start with the problem: ${plan.prd.problem}. Show the core promise: ${plan.prd.userGoal}. Walk through the smallest shipped path, then close with the validation evidence and next release.`
  const metrics = plan.prd.successCriteria.map((item) => `- ${item}`).join('\n') || '- Completion of the core user path'
  const checklist = releaseChecklist.value.map((item) => `- [${item.done ? 'x' : ' '}] ${item.label}`).join('\n')
  return `# ${titleOf(plan)} ${plan.execution.release.version}\n\n${plan.prd.summary}\n\n## Launch checklist\n${checklist}\n\n## Product description\n${product}\n\n## Audience\n${plan.execution.release.audience || plan.prd.targetUser}\n\n## Shipped\n${done}\n\n## Validation\n${experiments}\n\n## Outstanding\n${outstanding}\n\n## Known issues\n${plan.execution.release.knownIssues || 'None recorded'}\n\n## Release notes\n${plan.execution.release.notes || 'No additional notes.'}\n\n## Social launch post\n${social}\n\n## Demo outline\n${demo}\n\n## Metrics to watch\n${metrics}`
}

async function copyRelease(): Promise<void> {
  if (await copyText(releaseMarkdown())) emit('notify', 'Release pack copied', 'success')
  else emit('notify', 'This browser would not let Cairn copy the release pack.', 'error')
}

function markShipped(): void {
  if (readOnly) return
  plan.execution.release.shippedAt = Date.now()
  addJournal({ kind: 'release', title: `Shipped ${plan.execution.release.version}` })
  emit('notify', 'Release recorded in the build journal', 'success')
}
</script>

<template>
  <div class="execute">
    <section class="today-hero">
      <div class="today-hero__top">
        <div><p class="eyebrow">Today</p><h3>Keep the route moving</h3></div>
        <strong class="progress-number">{{ progress }}%</strong>
      </div>
      <div class="progress-track" role="progressbar" :aria-valuenow="progress" aria-valuemin="0" aria-valuemax="100"><span :style="{ width: `${progress}%` }" /></div>
      <div class="today-stats">
        <span><strong>{{ doneCount }}/{{ tasks.length }}</strong> tasks</span>
        <span><strong>{{ blockedTasks.length }}</strong> blocked</span>
        <span><strong>{{ pendingApprovals }}</strong> reviews</span>
        <span><strong>{{ activeExperimentCount }}</strong> tests</span>
      </div>
    </section>

    <section class="focus-card card">
      <p class="eyebrow">Next useful move</p>
      <template v-if="focusTask">
        <h3>{{ focusTask.text }}</h3>
        <p class="muted">{{ focusTask.status === 'in_progress' ? 'In progress' : 'Ready to start' }}<template v-if="focusTask.dueDate"> · due {{ focusTask.dueDate }}</template></p>
        <div class="button-row">
          <button v-if="!readOnly && focusTask.status === 'todo'" type="button" class="btn btn--primary btn--sm" @click="focus(focusTask)">Start this task</button>
          <button type="button" class="btn btn--secondary btn--sm" @click="emit('open-track')">Open Track</button>
        </div>
      </template>
      <template v-else>
        <h3>All mapped tasks are complete</h3>
        <p class="muted">Review your evidence and prepare the release.</p>
      </template>
    </section>

    <div v-if="!readOnly" class="today-actions">
      <button type="button" class="btn btn--primary" @click="checkInOpen = !checkInOpen">Daily check-in</button>
      <button type="button" class="btn btn--secondary" :disabled="refining" @click="emit('replan')">{{ refining ? 'Replanning…' : 'Replan from progress' }}</button>
    </div>

    <form v-if="checkInOpen && !readOnly" class="execution-form card" @submit.prevent="submitCheckIn">
      <div><p class="eyebrow">Two-minute check-in</p><h3>What changed since last time?</h3></div>
      <label><span>What did you finish?</span><textarea v-model="completed" class="textarea" maxlength="600" rows="2" placeholder="The smallest useful result" /></label>
      <label><span>What is blocking you?</span><textarea v-model="blocker" class="textarea" maxlength="600" rows="2" placeholder="Leave empty if nothing is blocked" /></label>
      <label><span>What changed?</span><textarea v-model="changed" class="textarea" maxlength="600" rows="2" placeholder="New information, scope, or constraint" /></label>
      <label><span>What will you do next?</span><textarea v-model="nextStep" class="textarea" maxlength="600" rows="2" :placeholder="plan.build.nextAction" /></label>
      <button type="submit" class="btn btn--primary btn--block" :disabled="!checkInReady">Save check-in</button>
    </form>

    <section class="execution-section">
      <div class="section-heading"><div><p class="eyebrow">Prove the idea</p><h3>Validation experiments</h3></div><button v-if="!readOnly" type="button" class="btn btn--ghost btn--sm" @click="experimentOpen = !experimentOpen">{{ experimentOpen ? 'Close' : 'Add test' }}</button></div>
      <form v-if="experimentOpen && !readOnly" class="execution-form card" @submit.prevent="addExperiment">
        <label><span>Hypothesis</span><textarea v-model="hypothesis" class="textarea" maxlength="600" rows="2" placeholder="We believe that…" /></label>
        <label><span>Smallest test</span><textarea v-model="method" class="textarea" maxlength="600" rows="2" placeholder="Interview five users, publish a waitlist, run a prototype…" /></label>
        <label><span>Success target</span><input v-model="successMetric" class="input" maxlength="600" placeholder="For example: 3 of 5 users try it" /></label>
        <button type="submit" class="btn btn--primary btn--block" :disabled="!experimentReady">Add experiment</button>
      </form>
      <div v-if="plan.execution.experiments.length" class="experiment-list">
        <article v-for="experiment in plan.execution.experiments" :key="experiment.id" class="experiment card">
          <div class="experiment__head"><strong>{{ experiment.hypothesis }}</strong><span class="badge" :class="{ 'badge--accent': experiment.decision === 'open' }">{{ experiment.decision }}</span></div>
          <p class="muted"><strong>Test:</strong> {{ experiment.method }}</p><p class="muted"><strong>Target:</strong> {{ experiment.successMetric }}</p>
          <template v-if="!readOnly">
            <label><span>Result</span><textarea v-model="experiment.result" class="textarea" maxlength="600" rows="2" placeholder="What did the evidence show?" @change="updateExperiment(experiment)" /></label>
            <label><span>Decision</span><select v-model="experiment.decision" class="input" @change="recordExperimentDecision(experiment)"><option value="open">Still testing</option><option value="continue">Continue</option><option value="change">Change direction</option><option value="stop">Stop this route</option></select></label>
          </template>
          <p v-else-if="experiment.result">{{ experiment.result }}</p>
        </article>
      </div>
      <p v-else class="empty muted">No experiments yet. Turn the riskiest assumption into a small test.</p>
    </section>

    <section class="execution-section release-card card">
      <div class="section-heading"><div><p class="eyebrow">Release mode</p><h3>Prepare what you will ship</h3></div><span class="badge" :class="{ 'badge--accent': releaseReady }">{{ releaseReady ? 'Ready' : 'In progress' }}</span></div>
      <div class="release-grid">
        <label><span>Version</span><input v-model="plan.execution.release.version" class="input" :readonly="readOnly" maxlength="30" /></label>
        <label><span>Audience</span><input v-model="plan.execution.release.audience" class="input" :readonly="readOnly" maxlength="300" :placeholder="plan.prd.targetUser" /></label>
        <label class="release-wide"><span>Known issues</span><textarea v-model="plan.execution.release.knownIssues" class="textarea" :readonly="readOnly" maxlength="1200" rows="3" placeholder="What should users know?" /></label>
        <label class="release-wide"><span>Release notes</span><textarea v-model="plan.execution.release.notes" class="textarea" :readonly="readOnly" maxlength="2000" rows="3" placeholder="What changed and why does it matter?" /></label>
      </div>
      <ul class="release-checklist">
        <li v-for="item in releaseChecklist" :key="item.label" :class="{ done: item.done }"><span aria-hidden="true">{{ item.done ? '✓' : '○' }}</span>{{ item.label }}</li>
      </ul>
      <div class="button-row"><button type="button" class="btn btn--secondary btn--sm" @click="copyRelease">Copy release pack</button><button v-if="!readOnly" type="button" class="btn btn--primary btn--sm" @click="markShipped">Mark shipped</button></div>
      <p v-if="plan.execution.release.shippedAt" class="muted">Last shipped {{ relativeTime(plan.execution.release.shippedAt) }}.</p>
    </section>

    <section class="execution-section report-card card" aria-labelledby="report-heading">
      <div class="section-heading">
        <div><p class="eyebrow">Reports</p><h3 id="report-heading">Write an update from real progress</h3></div>
        <span v-if="plan.execution.report.updatedAt" class="faint">Updated {{ relativeTime(plan.execution.report.updatedAt) }}</span>
      </div>
      <p class="muted">Cairn drafts from tasks, check-ins, evidence, blockers, decisions, and teammate activity. Edit every word before you share it.</p>
      <div class="report-grid">
        <label><span>Report type</span><select v-model="plan.execution.report.kind" class="input" :disabled="readOnly" @change="updateReport"><option v-for="[value, label] in reportKinds" :key="value" :value="value">{{ label }}</option></select></label>
        <label><span>Reporting period</span><input v-model="plan.execution.report.period" class="input" :readonly="readOnly" maxlength="120" placeholder="For example: 12–18 September" @input="updateReport" /></label>
        <label><span>Title</span><input v-model="plan.execution.report.title" class="input" :readonly="readOnly" maxlength="180" placeholder="Progress update" @input="updateReport" /></label>
        <label><span>Audience</span><input v-model="plan.execution.report.audience" class="input" :readonly="readOnly" maxlength="300" placeholder="Team, client, judges, or community" @input="updateReport" /></label>
        <label class="report-wide"><span>Report</span><textarea v-model="plan.execution.report.body" class="textarea report-body" :readonly="readOnly" maxlength="12000" rows="14" placeholder="Draft from current progress or write the report here." @input="updateReport" /></label>
      </div>
      <div class="button-row"><button v-if="!readOnly" type="button" class="btn btn--primary btn--sm" @click="draftReport">Draft from progress</button><button type="button" class="btn btn--secondary btn--sm" :disabled="!plan.execution.report.body.trim()" @click="copyReport">Copy report</button></div>
      <p class="faint">The report stays in this local route and its JSON backup until you copy it.</p>
    </section>

    <section class="execution-section">
      <div class="section-heading"><div><p class="eyebrow">Build journal</p><h3>What actually happened</h3></div><span v-if="latestCheckIn" class="faint">Last check-in {{ relativeTime(latestCheckIn.createdAt) }}</span></div>
      <ol v-if="journal.length" class="journal">
        <li v-for="entry in journal" :key="entry.id"><span class="journal__mark" aria-hidden="true" /><div><strong>{{ entry.title }}</strong><p v-if="entry.detail" class="muted">{{ entry.detail }}</p><span class="faint">{{ entry.kind.replaceAll('_', ' ') }} · {{ relativeTime(entry.createdAt) }}</span></div></li>
      </ol>
      <p v-else class="empty muted">Your check-ins, task progress, experiments, and releases will appear here.</p>
    </section>
  </div>
</template>

<style scoped>
.execute { display: grid; gap: var(--s5); }
.today-hero { padding: var(--s5); border-radius: var(--r-lg); color: #fff; background: linear-gradient(145deg, #173b99, #2457d6 60%, #3974ef); }
.today-hero__top, .section-heading, .experiment__head, .button-row { display: flex; align-items: center; justify-content: space-between; gap: var(--s3); }
.today-hero h3, .today-hero .eyebrow { color: inherit; }
.progress-number { font-family: var(--font-display); font-size: clamp(2rem, 10vw, 3.5rem); }
.progress-track { height: 8px; margin: var(--s4) 0; overflow: hidden; border-radius: var(--r-full); background: rgb(255 255 255 / 22%); }
.progress-track span { display: block; height: 100%; border-radius: inherit; background: var(--nim); transition: width .25s ease; }
.today-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--s2); font-size: var(--text-xs); }
.today-stats span { min-width: 0; overflow-wrap: anywhere; }
.today-stats strong { display: block; font-size: var(--text-lg); }
.focus-card, .release-card, .report-card, .execution-form, .experiment { display: grid; gap: var(--s3); padding: var(--s4); }
.focus-card h3, .execution-form h3 { overflow-wrap: anywhere; }
.today-actions { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s3); }
.execution-form label, .experiment label, .release-grid label, .report-grid label { display: grid; gap: var(--s1); min-width: 0; font-size: var(--text-sm); font-weight: 700; }
.execution-section { display: grid; gap: var(--s3); padding-top: var(--s3); }
.experiment-list { display: grid; gap: var(--s3); }
.experiment__head strong { min-width: 0; overflow-wrap: anywhere; }
.release-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s3); }
.release-wide { grid-column: 1 / -1; }
.report-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s3); }
.report-wide { grid-column: 1 / -1; }
.report-body { min-height: 19rem; font-family: var(--font-mono); font-size: var(--text-sm); white-space: pre-wrap; overflow-wrap: anywhere; }
.release-checklist { display: grid; gap: var(--s2); margin: 0; padding: 0; list-style: none; }
.release-checklist li { display: flex; gap: var(--s2); color: var(--text-muted); }
.release-checklist li.done { color: var(--success, #19724a); }
.journal { display: grid; gap: 0; margin: 0; padding: 0; list-style: none; }
.journal li { display: grid; grid-template-columns: 12px minmax(0, 1fr); gap: var(--s3); padding: 0 0 var(--s4); overflow-wrap: anywhere; }
.journal__mark { width: 10px; height: 10px; margin-top: .35rem; border: 2px solid var(--accent); border-radius: 50%; box-shadow: 0 1.5rem 0 -4px var(--line); }
.journal p { margin: var(--s1) 0; }
.empty { padding: var(--s4); border: 1px dashed var(--line); border-radius: var(--r-md); }
@media (max-width: 520px) { .today-stats { grid-template-columns: 1fr 1fr; } .today-actions, .release-grid, .report-grid { grid-template-columns: 1fr; } .release-wide, .report-wide { grid-column: auto; } .button-row { align-items: stretch; flex-direction: column; } .button-row .btn { width: 100%; } }
</style>
