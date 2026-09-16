<script setup lang="ts">
import { computed, ref } from 'vue'
import TrackerEditorSheet from './TrackerEditorSheet.vue'
import { newId, type BuildPlan, type Milestone, type Task, type TaskStatus } from '../lib/plan'
import {
  allTasks,
  dateRange,
  dependencyError,
  displayDate,
  isOverdue,
  milestoneStatus,
  MILESTONE_STATUS_LABEL,
  nextStatus,
  projectStats,
  recommendedTask,
  taskIsBlocked,
  taskMap,
  TASK_STATUS_LABEL,
  type MilestoneStatus,
} from '../lib/tracker'
import { formatNim } from '../lib/units'

const build = defineModel<BuildPlan>({ required: true })
const { readOnly = false, editing = false, teamMode = false } = defineProps<{
  readOnly?: boolean
  editing?: boolean
  /** Team workspaces expose only the public tracker fields. */
  teamMode?: boolean
}>()

type View = 'board' | 'timeline'
type Filter = 'all' | TaskStatus | 'blocked'
type EditorState =
  | { mode: 'task'; milestoneId: string; task?: Task }
  | { mode: 'milestone'; milestone?: Milestone }
  | null

const view = ref<View>('board')
const filter = ref<Filter>('all')
const editor = ref<EditorState>(null)

const stats = computed(() => projectStats(build.value))
const recommendation = computed(() => recommendedTask(build.value))
const projectTasks = computed(() => allTasks(build.value))
const projectTaskMap = computed(() => taskMap(build.value))
const datedMilestones = computed(() => build.value.milestones.filter((milestone) => milestone.startDate || milestone.dueDate))
const undatedMilestones = computed(() => build.value.milestones.filter((milestone) => !milestone.startDate && !milestone.dueDate))
const editorMilestoneTitle = computed(() => {
  const state = editor.value
  if (!state || state.mode !== 'task') return undefined
  return build.value.milestones.find((item) => item.id === state.milestoneId)?.title
})

function cloneTask(task: Task): Task {
  return {
    id: task.id,
    text: task.text,
    status: task.status,
    priority: task.priority,
    labels: [...task.labels],
    notes: task.notes,
    ...(task.dueDate ? { dueDate: task.dueDate } : {}),
    dependsOn: [...task.dependsOn],
  }
}

function cloneMilestone(milestone: Milestone): Milestone {
  return {
    id: milestone.id,
    title: milestone.title,
    outcome: milestone.outcome,
    tasks: milestone.tasks.map(cloneTask),
    ...(milestone.startDate ? { startDate: milestone.startDate } : {}),
    ...(milestone.dueDate ? { dueDate: milestone.dueDate } : {}),
    blocked: milestone.blocked,
  }
}

function cloneBuild(value: BuildPlan): BuildPlan {
  return {
    mvpScope: [...value.mvpScope],
    milestones: value.milestones.map(cloneMilestone),
    risks: [...value.risks],
    acceptanceTests: [...value.acceptanceTests],
    nextAction: value.nextAction,
  }
}

function replaceBuild(mutator: (next: BuildPlan) => void): void {
  const next = cloneBuild(build.value)
  mutator(next)
  build.value = next
}

function taskBlocked(task: Task): boolean {
  return taskIsBlocked(task, projectTaskMap.value)
}

function matches(task: Task, milestone: Milestone): boolean {
  if (filter.value === 'all') return true
  if (filter.value === 'blocked') return taskBlocked(task) || milestone.blocked
  return task.status === filter.value
}

function filteredTasks(milestone: Milestone): Task[] {
  return milestone.tasks.filter((task) => matches(task, milestone))
}

function milestoneVisible(milestone: Milestone): boolean {
  if (filter.value === 'all') return true
  return milestone.tasks.some((task) => matches(task, milestone)) || (filter.value === 'blocked' && milestone.blocked)
}

const visibleDatedMilestones = computed(() => datedMilestones.value.filter(milestoneVisible))
const visibleUndatedMilestones = computed(() => undatedMilestones.value.filter(milestoneVisible))

function statusFor(milestone: Milestone): MilestoneStatus {
  return milestoneStatus(milestone)
}

function cycleStatus(task: Task): void {
  if (readOnly) return
  replaceBuild((next) => {
    for (const milestone of next.milestones) {
      const found = milestone.tasks.find((candidate) => candidate.id === task.id)
      if (found) found.status = nextStatus(found.status)
    }
  })
}

function openTask(milestoneId: string, task?: Task): void {
  if (readOnly || !editing) return
  editor.value = { mode: 'task', milestoneId, ...(task ? { task: cloneTask(task) } : {}) }
}

function openMilestone(milestone?: Milestone): void {
  if (readOnly || !editing) return
  editor.value = { mode: 'milestone', ...(milestone ? { milestone: cloneMilestone(milestone) } : {}) }
}

function closeEditor(): void {
  editor.value = null
}

function saveTask(task: Task): void {
  const state = editor.value
  if (!state || state.mode !== 'task') return
  const problem = dependencyError(task.id, task.dependsOn, build.value)
  if (problem) return
  replaceBuild((next) => {
    const milestone = next.milestones.find((candidate) => candidate.id === state.milestoneId)
    if (!milestone) return
    const index = milestone.tasks.findIndex((candidate) => candidate.id === task.id)
    if (index === -1) milestone.tasks.push(cloneTask(task))
    else milestone.tasks[index] = cloneTask(task)
  })
  closeEditor()
}

function saveMilestone(milestone: Milestone): void {
  const state = editor.value
  if (!state || state.mode !== 'milestone') return
  replaceBuild((next) => {
    const index = state.milestone ? next.milestones.findIndex((candidate) => candidate.id === milestone.id) : -1
    if (index === -1) next.milestones.push(cloneMilestone(milestone))
    else next.milestones[index] = { ...cloneMilestone(milestone), tasks: next.milestones[index]?.tasks ?? [] }
  })
  closeEditor()
}

function removeTask(id: string): void {
  if (!window.confirm('Remove this task?')) return
  replaceBuild((next) => {
    for (const milestone of next.milestones) milestone.tasks = milestone.tasks.filter((task) => task.id !== id)
    for (const milestone of next.milestones) {
      for (const task of milestone.tasks) task.dependsOn = task.dependsOn.filter((dependency) => dependency !== id)
    }
  })
  closeEditor()
}

function removeMilestone(id: string): void {
  if (!window.confirm('Remove this milestone and its tasks?')) return
  const removed = build.value.milestones.find((milestone) => milestone.id === id)
  const removedIds = new Set(removed?.tasks.map((task) => task.id) ?? [])
  replaceBuild((next) => {
    next.milestones = next.milestones.filter((milestone) => milestone.id !== id)
    for (const milestone of next.milestones) {
      for (const task of milestone.tasks) task.dependsOn = task.dependsOn.filter((dependency) => !removedIds.has(dependency))
    }
  })
  closeEditor()
}

function moveMilestone(index: number, direction: -1 | 1): void {
  const target = index + direction
  if (!editing || readOnly || target < 0 || target >= build.value.milestones.length) return
  replaceBuild((next) => {
    const [item] = next.milestones.splice(index, 1)
    if (item) next.milestones.splice(target, 0, item)
  })
}

function taskPosition(milestone: Milestone, taskId: string): number {
  return milestone.tasks.findIndex((task) => task.id === taskId)
}

function moveTask(milestoneId: string, taskId: string, direction: -1 | 1): void {
  if (!editing || readOnly) return
  replaceBuild((next) => {
    const milestone = next.milestones.find((candidate) => candidate.id === milestoneId)
    if (!milestone) return
    const index = taskPosition(milestone, taskId)
    const target = index + direction
    if (index < 0 || target < 0 || target >= milestone.tasks.length) return
    const [item] = milestone.tasks.splice(index, 1)
    if (item) milestone.tasks.splice(target, 0, item)
  })
}

function newTask(milestoneId: string): void {
  openTask(milestoneId, {
    id: newId(),
    text: '',
    status: 'todo',
    priority: 'medium',
    labels: [],
    notes: '',
    dependsOn: [],
  })
}

function newMilestone(): void {
  openMilestone({ id: newId(), title: '', outcome: '', tasks: [], blocked: false })
}
</script>

<template>
  <div class="tracker" aria-labelledby="tracker-heading">
    <section class="tracker-summary" aria-labelledby="tracker-heading">
      <div>
        <p class="eyebrow">Project tracker</p>
        <h3 id="tracker-heading">Move the work forward</h3>
        <p class="muted tracker-summary__copy">Cairn seeded the structure. You own the dates and the next move.</p>
      </div>
      <div class="tracker-progress" :aria-label="`${stats.progress}% of tasks complete`">
        <strong>{{ stats.progress }}%</strong>
        <span>{{ stats.completedTasks }}/{{ stats.totalTasks }} done</span>
      </div>
    </section>

    <div class="stat-grid" aria-label="Project status">
      <div class="stat"><strong>{{ stats.totalTasks }}</strong><span>Tasks</span></div>
      <div class="stat"><strong>{{ stats.blockedTasks + stats.blockedMilestones }}</strong><span>Blocked</span></div>
      <div class="stat"><strong>{{ stats.overdueTasks }}</strong><span>Overdue</span></div>
    </div>
    <div class="progress-track" role="progressbar" :aria-valuenow="stats.progress" aria-valuemin="0" aria-valuemax="100" aria-label="Project progress">
      <span class="progress-track__fill" :style="{ width: `${stats.progress}%` }" />
    </div>

    <section v-if="!teamMode" class="next-work" aria-labelledby="next-work-heading">
      <h3 id="next-work-heading">{{ recommendation ? 'Next recommended task' : stats.totalTasks === 0 ? 'Add your first task' : stats.completedTasks === stats.totalTasks ? 'All tasks complete' : 'Resolve a blocker to continue' }}</h3>
      <template v-if="recommendation">
        <p>{{ recommendation.task.text }}</p>
        <p class="muted">{{ recommendation.milestone.title }} · {{ recommendation.reason }}</p>
        <button v-if="!readOnly && editing" type="button" class="btn btn--secondary" @click="openTask(recommendation.milestone.id, recommendation.task)">Open task</button>
      </template>
      <p v-else class="muted">{{ stats.totalTasks === 0 ? 'Create a milestone and add the work needed for your first release.' : stats.completedTasks === stats.totalTasks ? 'Review your acceptance tests before releasing.' : 'Remaining tasks have unfinished dependencies or belong to a blocked milestone.' }}</p>
    </section>

    <div class="view-toggle" role="group" aria-label="Tracker view">
      <button type="button" class="toggle" :class="{ 'toggle--on': view === 'board' }" :aria-pressed="view === 'board'" @click="view = 'board'">Board</button>
      <button type="button" class="toggle" :class="{ 'toggle--on': view === 'timeline' }" :aria-pressed="view === 'timeline'" @click="view = 'timeline'">Timeline</button>
    </div>

    <div class="filters" role="group" aria-label="Filter tasks">
      <button v-for="option in (['all', 'todo', 'in_progress', 'done', 'blocked'] as Filter[])" :key="option" type="button" class="filter" :class="{ 'filter--on': filter === option }" :aria-pressed="filter === option" @click="filter = option">
        {{ option === 'all' ? 'All' : option === 'in_progress' ? 'In progress' : option === 'todo' ? 'To do' : option === 'done' ? 'Done' : 'Blocked' }}
      </button>
    </div>

    <section v-if="view === 'board'" class="board" aria-labelledby="board-heading">
      <div class="section-heading">
        <h4 id="board-heading">Milestone lanes</h4>
        <button v-if="editing && !readOnly" type="button" class="btn btn--secondary btn--sm" @click="newMilestone">Add milestone</button>
      </div>
      <div v-if="!build.milestones.length" class="empty-track muted">No milestones yet. Add one to give the project a first lane.</div>
      <article v-for="(milestone, milestoneIndex) in build.milestones" v-show="milestoneVisible(milestone)" :key="milestone.id" class="lane" :class="{ 'lane--blocked': milestone.blocked }">
        <header class="lane__head">
          <div class="lane__title">
            <span class="step-number" aria-hidden="true">{{ milestoneIndex + 1 }}</span>
            <div>
              <h5>{{ milestone.title || `Milestone ${milestoneIndex + 1}` }}</h5>
              <p class="muted">{{ milestone.outcome || 'Add the outcome this lane should deliver.' }}</p>
              <span class="lane__meta">{{ dateRange(milestone) }} · {{ MILESTONE_STATUS_LABEL[statusFor(milestone)] }}</span>
            </div>
          </div>
          <div v-if="editing && !readOnly" class="lane__controls">
            <button type="button" class="icon-btn icon-btn--small" aria-label="Edit milestone" @click="openMilestone(milestone)">✎</button>
            <button type="button" class="icon-btn icon-btn--small" :disabled="milestoneIndex === 0" aria-label="Move milestone up" @click="moveMilestone(milestoneIndex, -1)">↑</button>
            <button type="button" class="icon-btn icon-btn--small" :disabled="milestoneIndex === build.milestones.length - 1" aria-label="Move milestone down" @click="moveMilestone(milestoneIndex, 1)">↓</button>
          </div>
        </header>

        <div class="lane__tasks">
          <article v-for="task in filteredTasks(milestone)" :key="task.id" class="track-task" :class="{ 'track-task--blocked': taskBlocked(task), 'track-task--done': task.status === 'done' }">
            <button type="button" class="task-open" :aria-label="`${editing && !readOnly ? 'Edit' : 'View'} task: ${task.text}`" @click="openTask(milestone.id, task)">
              <span class="status-dot" :class="`status-dot--${task.status}`" aria-hidden="true" />
              <span class="task-open__text">{{ task.text }}</span>
              <span v-if="taskBlocked(task) && !readOnly" class="badge badge--blocked">Blocked</span>
            </button>
            <div class="task-meta">
              <span v-for="label in task.labels" :key="label" class="badge badge--label">{{ label }}</span>
              <span v-if="task.dueDate" class="due" :class="{ 'due--late': isOverdue(task) }">{{ isOverdue(task) ? 'Overdue' : 'Due' }} {{ displayDate(task.dueDate) }}</span>
              <a v-if="task.reward" class="badge badge--reward" :href="`https://nimiq.watch/#${task.reward.transactionHash}`" target="_blank" rel="noopener noreferrer" @click.stop>Rewarded {{ formatNim(task.reward.amountLuna) }} NIM ↗</a>
            </div>
            <div class="task-actions">
              <button type="button" class="status-button" :disabled="readOnly" :aria-label="`Change status, currently ${TASK_STATUS_LABEL[task.status]}`" @click.stop="cycleStatus(task)">{{ TASK_STATUS_LABEL[task.status] }}</button>
              <template v-if="editing && !readOnly">
                <button type="button" class="icon-btn icon-btn--small" :disabled="taskPosition(milestone, task.id) === 0" aria-label="Move task up" @click="moveTask(milestone.id, task.id, -1)">↑</button>
                <button type="button" class="icon-btn icon-btn--small" :disabled="taskPosition(milestone, task.id) === milestone.tasks.length - 1" aria-label="Move task down" @click="moveTask(milestone.id, task.id, 1)">↓</button>
              </template>
            </div>
          </article>
          <p v-if="!filteredTasks(milestone).length" class="empty-lane muted">No tasks match this filter.</p>
        </div>
        <button v-if="editing && !readOnly" type="button" class="btn btn--ghost btn--block add-task" @click="newTask(milestone.id)">Add task</button>
      </article>
    </section>

    <section v-else class="timeline" aria-labelledby="timeline-heading">
      <div class="section-heading">
        <div>
          <h4 id="timeline-heading">Timeline</h4>
          <p class="muted">Dates stay empty until you choose them.</p>
        </div>
        <button v-if="editing && !readOnly" type="button" class="btn btn--secondary btn--sm" @click="newMilestone">Add milestone</button>
      </div>

        <div v-if="visibleDatedMilestones.length" class="timeline-group">
          <p class="eyebrow">Scheduled</p>
        <article v-for="milestone in visibleDatedMilestones" :key="milestone.id" class="timeline-lane">
          <div class="timeline-lane__bar" :class="`timeline-lane__bar--${statusFor(milestone)}`" />
          <div class="timeline-lane__body">
            <div class="timeline-lane__head">
              <div><h5>{{ milestone.title }}</h5><p class="muted">{{ dateRange(milestone) }}</p></div>
              <button v-if="editing && !readOnly" type="button" class="icon-btn icon-btn--small" aria-label="Edit milestone" @click="openMilestone(milestone)">✎</button>
            </div>
            <ul class="timeline-tasks">
              <li v-for="task in filteredTasks(milestone)" :key="task.id" :class="{ 'timeline-task--late': isOverdue(task) }">
                <span class="status-dot" :class="`status-dot--${task.status}`" aria-hidden="true" />
                <span>{{ task.text }}</span>
                <span v-for="label in task.labels" :key="label" class="badge badge--label">{{ label }}</span>
                <span v-if="task.dueDate" class="due">{{ isOverdue(task) ? 'Overdue' : 'Due' }} {{ displayDate(task.dueDate) }}</span>
                <span v-if="task.reward" class="badge badge--reward">{{ formatNim(task.reward.amountLuna) }} NIM reward</span>
              </li>
            </ul>
          </div>
        </article>
      </div>

      <div v-if="visibleUndatedMilestones.length" class="timeline-group">
        <p class="eyebrow">Undated</p>
        <article v-for="milestone in visibleUndatedMilestones" :key="milestone.id" class="timeline-lane timeline-lane--undated">
          <div class="timeline-lane__bar timeline-lane__bar--todo" />
          <div class="timeline-lane__body">
            <div class="timeline-lane__head">
              <div><h5>{{ milestone.title || 'Untitled milestone' }}</h5><p class="muted">No milestone dates yet</p></div>
              <button v-if="editing && !readOnly" type="button" class="icon-btn icon-btn--small" aria-label="Edit milestone" @click="openMilestone(milestone)">✎</button>
            </div>
            <ul class="timeline-tasks">
              <li v-for="task in filteredTasks(milestone)" :key="task.id">
                <span class="status-dot" :class="`status-dot--${task.status}`" aria-hidden="true" />
                <span>{{ task.text }}</span>
                <span v-for="label in task.labels" :key="label" class="badge badge--label">{{ label }}</span>
                <span v-if="task.dueDate" class="due">Due {{ displayDate(task.dueDate) }}</span>
                <span v-if="task.reward" class="badge badge--reward">{{ formatNim(task.reward.amountLuna) }} NIM reward</span>
              </li>
            </ul>
          </div>
        </article>
      </div>
      <p v-if="!datedMilestones.length && !undatedMilestones.length" class="empty-track muted">No milestones yet.</p>
      <p v-else-if="!visibleDatedMilestones.length && !visibleUndatedMilestones.length" class="empty-track muted">No items match this filter.</p>
    </section>

    <p v-if="readOnly" class="shared-note faint">Shared view shows progress, dates, and labels. Notes, priorities, and dependency details stay private.</p>

    <TrackerEditorSheet
      v-if="editor"
      :key="editor.mode === 'task' ? `task-${editor.task?.id ?? 'new'}` : `milestone-${editor.milestone?.id ?? 'new'}`"
      :mode="editor.mode"
      :task="editor.mode === 'task' ? editor.task : undefined"
      :milestone="editor.mode === 'milestone' ? editor.milestone : undefined"
      :milestone-title="editorMilestoneTitle"
      :all-tasks="projectTasks"
      :public-only="teamMode"
      @close="closeEditor"
      @save-task="saveTask"
      @save-milestone="saveMilestone"
      @remove-task="removeTask"
      @remove-milestone="removeMilestone"
    />
  </div>
</template>

<style scoped>
.next-work { display: grid; gap: var(--s3); padding: var(--s4); background: var(--accent-subtle); border: 1px solid var(--accent-line); border-radius: var(--r-md); overflow-wrap: anywhere; }
.next-work h3 { font-size: 1rem; }
.next-work p { font-size: 1rem; line-height: var(--leading); }
.next-work .muted { font-size: .875rem; }
.next-work button { justify-self: start; }
.tracker { display: flex; flex-direction: column; gap: var(--s4); }
.eyebrow { margin: 0 0 var(--s1); color: var(--accent); font-size: var(--text-xs); font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
.tracker-summary { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--s4); }
.tracker-summary h3 { font-size: var(--text-lg); }
.tracker-summary__copy { margin-top: var(--s2); max-width: 34rem; font-size: var(--text-sm); line-height: var(--leading); }
.tracker-progress { display: flex; flex: 0 0 auto; flex-direction: column; align-items: flex-end; color: var(--text-muted); font-size: var(--text-xs); }
.tracker-progress strong { color: var(--text); font-size: var(--text-xl); letter-spacing: -.03em; }
.stat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--s2); }
.stat { display: flex; flex-direction: column; gap: 2px; padding: var(--s3); border: 1px solid var(--line); border-radius: var(--r-md); background: var(--surface-sunken); }
.stat strong { font-size: var(--text-lg); }
.stat span { color: var(--text-muted); font-size: var(--text-xs); }
.progress-track { height: 6px; overflow: hidden; border-radius: var(--r-full); background: var(--surface-sunken); }
.progress-track__fill { display: block; height: 100%; border-radius: inherit; background: var(--accent); transition: width 220ms ease; }
.view-toggle { display: flex; gap: var(--s1); padding: 3px; border: 1px solid var(--line); border-radius: var(--r-md); background: var(--surface-sunken); }
.toggle { flex: 1; min-height: 38px; border-radius: var(--r-sm); color: var(--text-muted); font-size: var(--text-sm); font-weight: 650; }
.toggle--on { background: var(--surface); color: var(--text); box-shadow: 0 1px 2px rgb(16 18 27 / 7%); }
.filters { display: flex; gap: var(--s2); overflow-x: auto; padding-bottom: 2px; }
.filter { flex: 0 0 auto; min-height: 36px; padding: 0 var(--s3); border: 1px solid var(--line); border-radius: var(--r-full); color: var(--text-muted); font-size: var(--text-xs); font-weight: 650; white-space: nowrap; }
.filter--on { border-color: var(--accent-line); background: var(--accent-subtle); color: var(--accent); }
.board, .timeline { display: flex; flex-direction: column; gap: var(--s3); }
.section-heading { display: flex; align-items: center; justify-content: space-between; gap: var(--s3); }
.section-heading h4 { font-size: var(--text-md); }
.empty-track { padding: var(--s6) var(--s4); border: 1px dashed var(--line-strong); border-radius: var(--r-md); text-align: center; font-size: var(--text-sm); }
.lane { display: flex; flex-direction: column; gap: var(--s3); padding: var(--s4); border: 1px solid var(--line); border-radius: var(--r-md); background: var(--surface); }
.lane--blocked { border-color: color-mix(in srgb, var(--danger) 35%, var(--line)); }
.lane__head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--s3); }
.lane__title { display: flex; align-items: flex-start; gap: var(--s3); min-width: 0; }
.step-number { display: grid; flex: 0 0 26px; place-items: center; width: 26px; height: 26px; border-radius: 50%; background: var(--accent-subtle); color: var(--accent); font-size: var(--text-xs); font-weight: 750; }
.lane h5, .timeline-lane h5 { font-size: var(--text-md); }
.lane p { margin-top: var(--s1); font-size: var(--text-sm); line-height: var(--leading); }
.lane__meta { display: block; margin-top: var(--s2); color: var(--text-faint); font-size: var(--text-xs); }
.lane__controls, .task-actions { display: flex; align-items: center; gap: var(--s1); }
.icon-btn { display: grid; flex: 0 0 40px; place-items: center; width: 40px; height: 40px; border-radius: 50%; color: var(--text-muted); font-size: 20px; line-height: 1; }
.icon-btn:hover:not(:disabled) { background: var(--surface-sunken); color: var(--text); }
.icon-btn--small { flex-basis: 32px; width: 32px; height: 32px; font-size: var(--text-md); }
.lane__tasks { display: flex; flex-direction: column; gap: var(--s2); }
.track-task { display: grid; grid-template-columns: 1fr auto; gap: var(--s1) var(--s2); padding: var(--s3); border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--surface-sunken); }
.track-task--blocked { border-color: color-mix(in srgb, var(--danger) 35%, var(--line)); }
.track-task--done { opacity: .76; }
.task-open { display: flex; align-items: flex-start; gap: var(--s2); min-width: 0; padding: 0; text-align: left; }
.task-open__text { min-width: 0; color: var(--text); font-size: var(--text-sm); line-height: var(--leading); }
.track-task--done .task-open__text { color: var(--text-muted); text-decoration: line-through; }
.status-dot { display: block; flex: 0 0 9px; width: 9px; height: 9px; margin-top: .42em; border-radius: 50%; background: var(--line-strong); }
.status-dot--in_progress { background: var(--accent); }
.status-dot--done { background: var(--success); }
.badge--blocked { color: var(--danger); background: var(--danger-subtle); border-color: color-mix(in srgb, var(--danger) 35%, var(--line)); }
.task-meta { display: flex; flex-wrap: wrap; grid-column: 1 / -1; gap: var(--s1); padding-left: calc(9px + var(--s2)); }
.badge--label { text-transform: none; letter-spacing: 0; }
.due { color: var(--text-muted); font-size: var(--text-xs); }
.due--late, .timeline-task--late .due { color: var(--danger); font-weight: 650; }
.status-button { min-height: 32px; padding: 0 var(--s2); border: 1px solid var(--line); border-radius: var(--r-sm); color: var(--text-muted); font-size: var(--text-xs); font-weight: 650; white-space: nowrap; }
.status-button:not(:disabled):hover { border-color: var(--accent-line); color: var(--accent); }
.empty-lane { padding: var(--s2) 0; font-size: var(--text-xs); }
.add-task { align-self: stretch; }
.timeline { gap: var(--s5); }
.timeline-group { display: flex; flex-direction: column; gap: var(--s3); }
.timeline-lane { display: grid; grid-template-columns: 4px 1fr; gap: var(--s3); }
.timeline-lane__bar { border-radius: var(--r-full); background: var(--accent); }
.timeline-lane__bar--done { background: var(--success); }
.timeline-lane__bar--blocked { background: var(--danger); }
.timeline-lane__bar--todo { background: var(--line-strong); }
.timeline-lane__body { display: flex; flex-direction: column; gap: var(--s3); padding: var(--s3); border: 1px solid var(--line); border-radius: var(--r-md); background: var(--surface); }
.timeline-lane__head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--s3); }
.timeline-lane p { margin-top: var(--s1); font-size: var(--text-sm); }
.timeline-tasks { display: flex; flex-direction: column; gap: var(--s2); margin: 0; padding: 0; list-style: none; }
.timeline-tasks li { display: flex; align-items: flex-start; gap: var(--s2); color: var(--text-muted); font-size: var(--text-sm); line-height: var(--leading); }
.timeline-tasks li > span:nth-child(2) { flex: 1; }
.timeline-lane--undated .timeline-lane__body { background: var(--surface-sunken); }
.shared-note { padding-top: var(--s2); border-top: 1px solid var(--line); font-size: var(--text-xs); line-height: var(--leading); }

@media (max-width: 25rem) {
  .lane__head { flex-direction: column; }
  .lane__controls { align-self: flex-end; }
  .track-task { grid-template-columns: 1fr; }
  .task-actions { justify-content: space-between; }
}
@media (prefers-reduced-motion: reduce) { .progress-track__fill { transition: none; } }
</style>
