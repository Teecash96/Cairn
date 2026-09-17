<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import BuildView from './BuildView.vue'
import CairnMark from './CairnMark.vue'
import FlowDiagram from './FlowDiagram.vue'
import MilestoneTracker from './MilestoneTracker.vue'
import PrdView from './PrdView.vue'
import TeamPanel from './TeamPanel.vue'
import VisualPrd from './VisualPrd.vue'
import { copyText, canDownload, downloadFile, downloadText } from '../lib/clipboard'
import { buildToText, flowToText, planToMarkdown, prdToText, trackToText } from '../lib/markdown'
import type { RefineAction, TeamActivity, TeamMember, TeamRole } from '../lib/api'
import { exportPlanBackup, relativeTime, slugOf, titleOf, type BuildPlan, type Plan } from '../lib/plan'

export interface TeamContext {
  address: string
  role: 'owner' | TeamRole
  members: TeamMember[]
  activity: TeamActivity[]
  busy: boolean
}

export interface TeamPanelState {
  teamId: string | null
  owner: string
  role: 'owner' | TeamRole
  members: TeamMember[]
  inviteUrl: string
  loading: boolean
  error: string | null
}

const {
  plan,
  readOnly = false,
  sharing = false,
  regenerating = false,
  refining = false,
  teamOnly = false,
  teamPanel,
  teamContext,
  teamSyncing = false,
  teamSaveState = 'idle',
} = defineProps<{
  plan: Plan
  readOnly?: boolean
  sharing?: boolean
  regenerating?: boolean
  refining?: boolean
  teamOnly?: boolean
  teamPanel?: TeamPanelState
  teamContext?: TeamContext
  teamSyncing?: boolean
  teamSaveState?: 'idle' | 'saving' | 'saved' | 'error'
}>()

const emit = defineEmits<{
  back: []
  regenerate: []
  share: []
  'share-revoke': []
  refine: [action: RefineAction]
  remove: []
  notify: [message: string, tone?: 'info' | 'success' | 'error']
  'team-open': []
  'team-create': []
  'team-add': [address: string, role: TeamRole]
  'team-update': [address: string, role: TeamRole]
  'team-remove': [address: string]
  'team-copy': [url: string]
  'team-reward': [address: string]
  'team-delete': []
  'track-change': [build: BuildPlan]
  'team-retry': []
  'team-task': [taskId: string, operation: 'assign' | 'submit' | 'approve' | 'return', value?: string]
}>()

type Tab = 'plan' | 'flow' | 'build' | 'track' | 'team'
type PlanView = 'map' | 'details'

const tab = ref<Tab>(teamOnly ? 'track' : 'plan')
const planView = ref<PlanView>('map')
const editing = ref(false)
const confirmingRemove = ref(false)
const actionsOpen = ref(false)
const downloadable = canDownload()
const routeTabs: Array<{ id: Exclude<Tab, 'team'>; label: string }> = [
  { id: 'plan', label: 'Plan' },
  { id: 'flow', label: 'Flow' },
  { id: 'build', label: 'Build' },
  { id: 'track', label: 'Track' },
]

const heading = computed(() => titleOf(plan))
const edited = computed(() => relativeTime(plan.updatedAt))
const metaLabel = computed(() => {
  if (teamOnly) return `Track only · ${readOnly ? 'viewer' : 'editor'}`
  return readOnly ? 'shared with you' : `edited ${edited.value}`
})
const availableTabs = computed<Tab[]>(() => teamOnly ? ['track'] : ['plan', 'flow', 'build', 'track'])
function compactAddress(address: string): string {
  return address.length > 15 ? `${address.slice(0, 8)}…${address.slice(-5)}` : address
}

function relayTeamTask(taskId: string, operation: 'assign' | 'submit' | 'approve' | 'return', value?: string): void {
  emit('team-task', taskId, operation, value)
}

const completedTasks = computed(() => plan.build.milestones.flatMap((milestone) => milestone.tasks)
  .filter((task) => task.status === 'done')
  .map((task) => ({ id: task.id, text: task.text, rewarded: Boolean(task.reward) })))

watch(
  () => plan.id,
  () => {
    tab.value = teamOnly ? 'track' : 'plan'
    planView.value = 'map'
    editing.value = false
    confirmingRemove.value = false
    actionsOpen.value = false
  },
)

async function copy(what: 'prd' | 'flow' | 'build' | 'track' | 'markdown'): Promise<void> {
  const text = what === 'prd'
    ? prdToText(plan)
    : what === 'flow'
      ? flowToText(plan.flow)
      : what === 'track'
        ? trackToText(plan.build)
        : what === 'build'
          ? buildToText(plan)
          : planToMarkdown(plan)

  const label = what === 'markdown'
    ? 'Full plan'
    : what === 'prd'
      ? 'Plan'
      : what === 'flow'
        ? 'Flow'
        : what === 'track'
          ? 'Tracker'
          : 'Builder pack'

  if (await copyText(text)) emit('notify', `${label} copied`, 'success')
  else emit('notify', "This browser would not let us copy", 'error')
}

function save(): void {
  if (downloadText(`${slugOf(plan)}-plan.md`, planToMarkdown(plan))) {
    emit('notify', 'Saved as Markdown', 'success')
  } else {
    emit('notify', "This browser cannot save files. Copy the plan instead.", 'error')
  }
}

function saveBackup(): void {
  const json = JSON.stringify(exportPlanBackup(plan), null, 2)
  if (downloadFile(`${slugOf(plan)}-cairn-backup.json`, json, 'application/json;charset=utf-8')) {
    emit('notify', 'JSON backup saved', 'success')
  } else {
    emit('notify', 'This browser cannot save a backup file.', 'error')
  }
}

function select(next: Tab): void {
  if (!availableTabs.value.includes(next)) return
  tab.value = next
  actionsOpen.value = false
}

function openTeam(): void {
  if (!teamPanel) return
  tab.value = 'team'
  actionsOpen.value = false
  emit('team-open')
}

function goBack(): void {
  if (tab.value === 'team') {
    tab.value = 'plan'
    return
  }
  emit('back')
}

function teamAdd(address: string, role: TeamRole): void {
  emit('team-add', address, role)
}

function teamUpdate(address: string, role: TeamRole): void {
  emit('team-update', address, role)
}

function onTabKey(event: KeyboardEvent): void {
  if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
  event.preventDefault()
  const tabs = availableTabs.value
  const currentIndex = tabs.indexOf(tab.value)
  const offset = event.key === 'ArrowRight' ? 1 : -1
  tab.value = tabs[(currentIndex + offset + tabs.length) % tabs.length] ?? tabs[0] ?? 'plan'
}
</script>

<template>
  <div class="screen screen--flush atlas-workspace" @keydown.esc="actionsOpen = false">
    <header class="bar">
      <button type="button" class="bar__back" :aria-label="tab === 'team' ? 'Back to plan' : 'Back to library'" @click="goBack">
        <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" focusable="false">
          <path d="M9.5 3.5L5 8l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <div class="bar__brand" aria-label="Cairn product atlas">
        <CairnMark :size="25" />
        <span>Cairn</span>
      </div>
      <button v-if="!teamOnly" type="button" class="bar__more" :aria-expanded="actionsOpen" aria-controls="plan-actions" @click="actionsOpen = !actionsOpen">
        Actions
      </button>
    </header>

    <div v-if="actionsOpen && !teamOnly" id="plan-actions" class="action-sheet" role="dialog" aria-label="Plan actions">
      <div class="action-sheet__head">
        <p class="eyebrow">Plan actions</p>
        <button type="button" class="btn btn--ghost btn--sm" @click="actionsOpen = false">Close</button>
      </div>
      <div class="action-sheet__grid">
        <button v-if="!readOnly" type="button" class="action-item" :disabled="sharing" @click="emit('share'); actionsOpen = false">
          <strong>{{ sharing ? 'Sharing…' : plan.shareId ? 'Copy share link' : 'Share read only link' }}</strong>
          <span>Send a clean snapshot of this route.</span>
        </button>
        <button v-if="!readOnly && plan.shareId" type="button" class="action-item" :disabled="sharing" @click="emit('share-revoke'); actionsOpen = false">
          <strong>Revoke public link</strong>
          <span>Make the current read-only link stop working.</span>
        </button>
        <button type="button" class="action-item" @click="copy('markdown'); actionsOpen = false">
          <strong>Copy full plan</strong>
          <span>Take the complete route to any tool.</span>
        </button>
        <button v-if="downloadable" type="button" class="action-item" @click="save(); actionsOpen = false">
          <strong>Save Markdown</strong>
          <span>Download a portable builder file.</span>
        </button>
        <button v-if="!readOnly && downloadable" type="button" class="action-item" @click="saveBackup(); actionsOpen = false">
          <strong>Save JSON backup</strong>
          <span>Keep a restorable copy of this route.</span>
        </button>
        <button v-if="!readOnly && teamPanel" type="button" class="action-item" @click="openTeam">
          <strong>Team workspace</strong>
          <span>Invite people and share tracker access.</span>
        </button>
      </div>
    </div>

    <slot name="banner" />

    <div class="titling">
      <p class="eyebrow">Your route to release</p>
      <input v-if="editing" v-model="plan.name" class="input name" aria-label="Plan name" :placeholder="heading" autocapitalize="sentences" />
      <h2 v-else class="screen__title">{{ heading }}</h2>
      <p class="meta faint">
        <template v-if="!teamOnly">
          <span>{{ plan.flow.length }} mapped steps</span>
          <span aria-hidden="true">·</span>
        </template>
        <span>{{ metaLabel }}</span>
        <span v-if="plan.shareId && !readOnly" class="badge">Shared</span>
      </p>
    </div>

    <div v-if="!teamOnly && tab !== 'team'" class="route-tabs" role="tablist" aria-label="Product route" @keydown="onTabKey">
      <button v-for="(item, index) in routeTabs" :id="`tab-${item.id}`" :key="item.id" type="button" role="tab" class="route-tab" :class="{ 'route-tab--on': tab === item.id }" :aria-selected="tab === item.id" :aria-controls="`panel-${item.id}`" :tabindex="tab === item.id ? 0 : -1" @click="select(item.id)">
        <span class="route-tab__number">0{{ index + 1 }}</span>
        <span>{{ item.label }}</span>
      </button>
    </div>

    <div class="body">
      <section v-if="tab === 'plan' && !teamOnly" id="panel-plan" role="tabpanel" aria-labelledby="tab-plan" tabindex="0">
        <div class="plan-tools">
          <div class="plan-switch" aria-label="Plan view">
            <button type="button" :class="{ on: planView === 'map' }" :aria-pressed="planView === 'map'" @click="planView = 'map'">Map</button>
            <button type="button" :class="{ on: planView === 'details' }" :aria-pressed="planView === 'details'" @click="planView = 'details'">Details</button>
          </div>
          <button v-if="!readOnly" type="button" class="btn btn--ghost btn--sm" :aria-pressed="editing" @click="editing = !editing">
            {{ editing ? 'Finish editing' : 'Edit plan' }}
          </button>
        </div>
        <VisualPrd v-if="planView === 'map'" :prd="plan.prd" :editing="editing" />
        <PrdView v-else :prd="plan.prd" :editing="editing" />
      </section>

      <section v-else-if="tab === 'flow' && !teamOnly" id="panel-flow" role="tabpanel" aria-labelledby="tab-flow" tabindex="0">
        <FlowDiagram v-model="plan.flow" :editing="editing" />
      </section>

      <section v-else-if="tab === 'build' && !teamOnly" id="panel-build" role="tabpanel" aria-labelledby="tab-build" tabindex="0">
        <BuildView :build="plan.build" :reality-check="plan.realityCheck" />
        <div v-if="!readOnly" class="followups">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Route check</p>
              <h3>Sharpen the build</h3>
            </div>
            <span v-if="refining" class="badge badge--accent">Working…</span>
          </div>
          <div class="quick-actions">
            <button type="button" class="btn btn--secondary btn--sm" :disabled="refining" @click="emit('refine', 'cut_mvp_scope')">Cut MVP scope</button>
            <button type="button" class="btn btn--secondary btn--sm" :disabled="refining" @click="emit('refine', 'break_into_tasks')">Break into tasks</button>
            <button type="button" class="btn btn--secondary btn--sm" :disabled="refining" @click="emit('refine', 'find_missing_risks')">Find missing risks</button>
            <button type="button" class="btn btn--secondary btn--sm" :disabled="refining" @click="emit('refine', 'improve_acceptance_tests')">Improve tests</button>
          </div>
          <button type="button" class="btn btn--ghost btn--block" :disabled="refining" @click="emit('refine', 'custom')">Ask a custom question</button>
        </div>
      </section>

      <section v-else-if="tab === 'track'" id="panel-track" role="tabpanel" aria-labelledby="tab-track" tabindex="0">
        <div v-if="teamOnly && teamSaveState !== 'idle'" class="team-save" role="status" aria-live="polite">
          <span>{{ teamSaveState === 'saving' ? 'Saving team changes…' : teamSaveState === 'saved' ? 'All team changes saved' : 'Team changes were not saved.' }}</span>
          <button v-if="teamSaveState === 'error'" type="button" class="btn btn--secondary btn--sm" @click="emit('team-retry')">Retry save</button>
        </div>
        <MilestoneTracker
          v-model="plan.build"
          :read-only="readOnly"
          :editing="editing"
          :team-mode="teamOnly"
          :team-address="teamContext?.address"
          :team-role="teamContext?.role"
          :team-members="teamContext?.members"
          :team-busy="teamContext?.busy"
          @update:model-value="emit('track-change', $event)"
          @team-task="relayTeamTask"
        />
        <section v-if="teamOnly && teamContext?.activity.length" class="activity-log" aria-labelledby="activity-title">
          <div class="activity-log__head">
            <p class="eyebrow">Signed history</p>
            <h3 id="activity-title">Team activity</h3>
          </div>
          <ol class="activity-log__list">
            <li v-for="entry in teamContext.activity.slice(0, 12)" :key="entry.id" class="activity-log__item">
              <span class="activity-log__action">{{ entry.action.replace('_', ' ') }}</span>
              <span class="activity-log__task">{{ entry.taskText || entry.detail || 'Tracker' }}</span>
              <span class="activity-log__meta mono">{{ compactAddress(entry.address) }} · {{ relativeTime(entry.createdAt) }}</span>
            </li>
          </ol>
        </section>
      </section>

      <section v-else-if="tab === 'team' && teamPanel" id="panel-team" tabindex="0">
        <div class="team-route-head">
          <p class="eyebrow">Secondary workspace</p>
          <h3>Team access</h3>
        </div>
        <TeamPanel :team-id="teamPanel.teamId" :owner="teamPanel.owner" :role="teamPanel.role" :members="teamPanel.members" :invite-url="teamPanel.inviteUrl" :loading="teamPanel.loading" :error="teamPanel.error" :syncing="teamSyncing" :completed-tasks="completedTasks" @create="emit('team-create')" @add="teamAdd" @update="teamUpdate" @remove="emit('team-remove', $event)" @copy="emit('team-copy', $event)" @reward="emit('team-reward', $event)" @delete="emit('team-delete')" />
      </section>

      <div v-if="tab !== 'team'" class="context-action">
        <span class="mono">EXPORT CURRENT STOP</span>
        <button type="button" class="btn btn--secondary btn--sm" @click="copy(teamOnly || tab === 'track' ? 'track' : tab === 'plan' ? 'prd' : tab === 'flow' ? 'flow' : 'build')">
          {{ teamOnly || tab === 'track' ? 'Copy tracker' : tab === 'plan' ? 'Copy plan' : tab === 'flow' ? 'Copy flow' : 'Copy builder pack' }}
        </button>
      </div>

      <template v-if="!readOnly && !teamOnly && tab !== 'team'">
        <div class="footer">
          <button type="button" class="btn btn--secondary btn--block" :disabled="regenerating" @click="emit('regenerate')">
            {{ regenerating ? 'Generating…' : 'Remap from my description' }}
          </button>
          <p class="faint hint">Your original description stays in place.</p>
          <div v-if="confirmingRemove" class="confirm">
            <p class="confirm__q">Delete this plan from this device?</p>
            <div class="confirm__row">
              <button type="button" class="btn btn--danger btn--sm" @click="emit('remove')">Delete</button>
              <button type="button" class="btn btn--secondary btn--sm" @click="confirmingRemove = false">Keep it</button>
            </div>
          </div>
          <button v-else type="button" class="btn btn--ghost btn--sm remove" @click="confirmingRemove = true">Delete plan</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.atlas-workspace { --workspace-pad: clamp(1rem, 4vw, 2rem); }
.bar { position: sticky; top: 0; z-index: 30; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; padding: var(--safe-top) var(--workspace-pad) 0; min-height: calc(var(--safe-top) + 58px); background: color-mix(in srgb, var(--bg) 96%, transparent); border-bottom: 1px solid var(--line); }
.bar__back, .bar__more { min-height: 44px; color: var(--text-muted); font-size: var(--text-sm); font-weight: 750; }
.bar__back { display: grid; place-items: center; justify-self: start; width: 44px; border: 1px solid var(--line); border-radius: 50%; }
.bar__more { justify-self: end; color: var(--accent); }
.bar__brand { display: flex; align-items: center; gap: .45rem; font-family: var(--font-display); font-weight: 750; }
.action-sheet { position: fixed; z-index: 60; top: calc(var(--safe-top) + 64px); right: max(var(--workspace-pad), calc((100vw - 820px) / 2)); width: min(26rem, calc(100vw - 2rem)); padding: var(--s4); background: var(--surface); border: 1px solid var(--line-strong); border-radius: var(--r-lg); box-shadow: 0 20px 60px rgb(20 24 19 / .18); }
.action-sheet__head { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--s3); }
.action-sheet__grid { display: grid; gap: 1px; background: var(--line); border: 1px solid var(--line); }
.action-item { display: grid; gap: .25rem; padding: var(--s4); text-align: left; background: var(--surface); }
.action-item:hover { background: var(--surface-hover); }
.action-item strong { color: var(--text); font-size: var(--text-sm); }
.action-item span { color: var(--text-muted); font-size: var(--text-xs); line-height: 1.45; }
.titling { padding: clamp(2rem, 7vw, 4rem) var(--workspace-pad) var(--s5); }
.titling .screen__title { max-width: 17ch; font-family: var(--font-display); font-size: clamp(2rem, 7vw, 4.4rem); line-height: .98; letter-spacing: -.045em; }
.name { font-family: var(--font-display); font-size: clamp(1.7rem, 6vw, 3.5rem); font-weight: 700; }
.meta { display: flex; align-items: center; flex-wrap: wrap; gap: var(--s2); margin-top: var(--s3); font-size: var(--text-xs); }
.eyebrow { margin: 0 0 var(--s2); color: var(--accent); font-family: var(--font-mono); font-size: .7rem; font-weight: 750; letter-spacing: .12em; text-transform: uppercase; }
.route-tabs { position: sticky; top: calc(var(--safe-top) + 58px); z-index: 20; display: grid; grid-template-columns: repeat(4, 1fr); padding: 0 var(--workspace-pad); background: var(--bg); border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.route-tab { position: relative; display: flex; align-items: baseline; gap: .45rem; min-width: 0; padding: var(--s3) var(--s2); color: var(--text-faint); font-size: var(--text-sm); font-weight: 750; text-align: left; border-right: 1px solid var(--line); }
.route-tab:first-child { border-left: 1px solid var(--line); }
.route-tab::after { content: ''; position: absolute; right: 0; bottom: -1px; left: 0; height: 3px; background: transparent; }
.route-tab--on { color: var(--text); background: var(--surface); }
.route-tab--on::after { background: var(--accent); }
.route-tab__number { color: var(--accent); font-family: var(--font-mono); font-size: .65rem; }
.body { display: flex; flex-direction: column; gap: var(--s6); padding: var(--s6) var(--workspace-pad) 0; }
.body [role='tabpanel']:focus { outline: none; }
.body [role='tabpanel']:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; }
.plan-tools { display: flex; align-items: center; justify-content: space-between; gap: var(--s3); margin-bottom: var(--s5); padding-bottom: var(--s3); border-bottom: 1px solid var(--line); }
.plan-switch { display: inline-flex; gap: 2px; padding: 3px; background: var(--surface-sunken); border: 1px solid var(--line); border-radius: var(--r-sm); }
.plan-switch button { min-height: 34px; padding: 0 .8rem; color: var(--text-muted); font-size: var(--text-xs); font-weight: 750; border-radius: 2px; }
.plan-switch button.on { color: var(--text); background: var(--surface); box-shadow: 0 1px 3px rgb(20 24 19 / .08); }
.context-action { display: flex; align-items: center; justify-content: space-between; gap: var(--s3); padding: var(--s3) 0; border-top: 1px solid var(--line-strong); border-bottom: 1px solid var(--line-strong); }
.context-action .mono { color: var(--text-faint); font-size: .62rem; letter-spacing: .09em; }
.footer { display: flex; flex-direction: column; gap: var(--s3); padding-bottom: var(--s6); }
.hint { font-size: var(--text-xs); text-align: center; }
.remove { align-self: center; color: var(--text-faint); }
.confirm { display: flex; flex-direction: column; gap: var(--s3); padding: var(--s4); border-left: 3px solid var(--danger); background: var(--danger-subtle); }
.confirm__q { font-size: var(--text-sm); }
.confirm__row { display: flex; gap: var(--s2); }
.followups { display: flex; flex-direction: column; gap: var(--s3); margin-top: var(--s6); padding: var(--s4); border-left: 3px solid var(--accent); background: var(--accent-subtle); }
.followups h3 { font-family: var(--font-display); font-size: var(--text-lg); }
.quick-actions { display: flex; flex-wrap: wrap; gap: var(--s2); }
.quick-actions .btn { flex: 1 1 9rem; }
.team-route-head { padding-bottom: var(--s4); border-bottom: 1px solid var(--line); }
.team-route-head h3 { font-family: var(--font-display); font-size: var(--text-xl); }
@media (max-width: 520px) {
  .route-tab { flex-direction: column; gap: .1rem; padding: .65rem .4rem; font-size: .76rem; }
  .titling { padding-top: var(--s6); }
  .plan-tools { align-items: flex-start; }
  .action-sheet { right: 1rem; }
  .context-action .mono { display: none; }
  .context-action .btn { width: 100%; }
}
.team-save { display: flex; align-items: center; justify-content: space-between; gap: var(--s3); min-width: 0; margin-bottom: var(--s3); padding: var(--s3) var(--s4); border: 1px solid var(--line); border-radius: var(--r-md); background: var(--surface-sunken); color: var(--text-muted); font-size: var(--text-sm); }
.team-save span { min-width: 0; overflow-wrap: anywhere; }
</style>

<style scoped>
.activity-log { margin-top: 1.25rem; padding: 1rem; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); overflow: hidden; }
.activity-log__head h3 { margin: .15rem 0 .75rem; }
.activity-log__list { display: grid; gap: .65rem; margin: 0; padding: 0; list-style: none; }
.activity-log__item { display: grid; grid-template-columns: minmax(5.5rem, auto) minmax(0, 1fr); gap: .2rem .7rem; padding-top: .65rem; border-top: 1px solid var(--line); }
.activity-log__action { color: var(--accent); font-weight: 800; text-transform: capitalize; }
.activity-log__task { min-width: 0; overflow-wrap: anywhere; }
.activity-log__meta { grid-column: 1 / -1; color: var(--muted); font-size: .78rem; overflow-wrap: anywhere; }
</style>
