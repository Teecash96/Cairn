<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import BuildView from './BuildView.vue'
import CairnMark from './CairnMark.vue'
import FlowDiagram from './FlowDiagram.vue'
import MilestoneTracker from './MilestoneTracker.vue'
import PrdView from './PrdView.vue'
import TeamPanel from './TeamPanel.vue'
import VisualPrd from './VisualPrd.vue'
import { copyText, canDownload, downloadText } from '../lib/clipboard'
import { buildToText, flowToText, planToMarkdown, prdToText, trackToText } from '../lib/markdown'
import type { RefineAction, TeamMember, TeamRole } from '../lib/api'
import { relativeTime, slugOf, titleOf, type BuildPlan, type Plan } from '../lib/plan'
import { projectStats } from '../lib/tracker'

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
  teamSyncing = false,
} = defineProps<{
  plan: Plan
  readOnly?: boolean
  sharing?: boolean
  regenerating?: boolean
  refining?: boolean
  teamOnly?: boolean
  teamPanel?: TeamPanelState
  teamSyncing?: boolean
}>()

const emit = defineEmits<{
  back: []
  regenerate: []
  share: []
  refine: [action: RefineAction]
  remove: []
  notify: [message: string, tone?: 'info' | 'success' | 'error']
  'team-open': []
  'team-create': []
  'team-add': [address: string, title: string, role: TeamRole]
  'team-update': [address: string, role: TeamRole]
  'team-remove': [address: string]
  'team-copy': [url: string]
  'track-change': [build: BuildPlan]
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
const stats = computed(() => projectStats(plan.build))
const activeTabIndex = computed(() => Math.max(0, routeTabs.findIndex((item) => item.id === tab.value)))
const metaLabel = computed(() => {
  if (teamOnly) return `Track only · ${readOnly ? 'viewer' : 'editor'}`
  return readOnly ? 'shared with you' : `edited ${edited.value}`
})
const availableTabs = computed<Tab[]>(() => teamOnly ? ['track'] : ['plan', 'flow', 'build', 'track'])

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

function teamAdd(address: string, title: string, role: TeamRole): void {
  emit('team-add', address, title, role)
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
      <div class="bar__brand" aria-label="Cairn project workspace">
        <CairnMark :size="25" />
        <span>Cairn</span>
      </div>
      <div v-if="!teamOnly" class="bar__actions">
        <button v-if="!readOnly" type="button" class="bar__change" :disabled="refining" @click="emit('refine', 'change_plan')">
          {{ refining ? 'Working…' : 'Update plan' }}
        </button>
        <button type="button" class="bar__more" :aria-expanded="actionsOpen" aria-controls="plan-actions" aria-label="More project actions" @click="actionsOpen = !actionsOpen">
          <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
            <circle cx="4" cy="9" r="1.5" /><circle cx="9" cy="9" r="1.5" /><circle cx="14" cy="9" r="1.5" />
          </svg>
        </button>
      </div>
    </header>

    <Transition name="menu-pop">
      <div v-if="actionsOpen && !teamOnly" id="plan-actions" class="action-sheet" role="dialog" aria-label="Plan actions">
        <div class="action-sheet__head">
          <div><p class="eyebrow">Project menu</p><strong>More ways to use this plan</strong></div>
          <button type="button" class="btn btn--ghost btn--sm" @click="actionsOpen = false">Close</button>
        </div>
        <div class="action-sheet__grid">
          <button v-if="!readOnly" type="button" class="action-item action-item--accent" :disabled="refining" @click="emit('refine', 'change_plan'); actionsOpen = false">
            <strong>{{ refining ? 'Preparing plan update…' : 'Change the plan, update the build' }}</strong>
            <span>Preview every affected flow, task, and test before you save.</span>
          </button>
          <button v-if="!readOnly" type="button" class="action-item" :disabled="sharing" @click="emit('share'); actionsOpen = false">
            <strong>{{ sharing ? 'Sharing…' : plan.shareId ? 'Copy share link' : 'Share read only link' }}</strong>
            <span>Send a clean snapshot of this project.</span>
          </button>
          <button type="button" class="action-item" @click="copy('markdown'); actionsOpen = false">
            <strong>Copy full plan</strong>
            <span>Take the complete plan to any tool.</span>
          </button>
          <button v-if="downloadable" type="button" class="action-item" @click="save(); actionsOpen = false">
            <strong>Save Markdown</strong>
            <span>Download a portable builder file.</span>
          </button>
          <button v-if="!readOnly && teamPanel" type="button" class="action-item" @click="openTeam">
            <strong>Team workspace</strong>
            <span>Invite people and share tracker access.</span>
          </button>
        </div>
      </div>
    </Transition>

    <slot name="banner" />

    <div class="titling">
      <div class="titling__main">
        <p class="eyebrow">Project workspace</p>
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
      <div class="project-pulse" aria-label="Project progress">
        <span><strong>{{ stats.progress }}%</strong><small>complete</small></span>
        <span class="project-pulse__track"><i :style="{ width: `${stats.progress}%` }" /></span>
        <small>{{ stats.completedTasks }} of {{ stats.totalTasks }} tasks done</small>
      </div>
    </div>

    <div v-if="!teamOnly && tab !== 'team'" class="route-tabs" :style="{ '--active-tab': activeTabIndex }" role="tablist" aria-label="Project views" @keydown="onTabKey">
      <span class="route-tabs__indicator" aria-hidden="true" />
      <button v-for="(item, index) in routeTabs" :id="`tab-${item.id}`" :key="item.id" type="button" role="tab" class="route-tab" :class="{ 'route-tab--on': tab === item.id }" :aria-selected="tab === item.id" :aria-controls="`panel-${item.id}`" :tabindex="tab === item.id ? 0 : -1" @click="select(item.id)">
        <span class="route-tab__number" aria-hidden="true">0{{ index + 1 }}</span>
        <span>{{ item.label }}</span>
      </button>
    </div>

    <div class="body">
      <Transition name="route-page" mode="out-in">
        <section v-if="tab === 'plan' && !teamOnly" id="panel-plan" key="plan" role="tabpanel" aria-labelledby="tab-plan" tabindex="0">
          <div class="plan-tools">
            <div class="plan-switch" aria-label="Plan view">
              <button type="button" :class="{ on: planView === 'map' }" :aria-pressed="planView === 'map'" @click="planView = 'map'">Overview</button>
              <button type="button" :class="{ on: planView === 'details' }" :aria-pressed="planView === 'details'" @click="planView = 'details'">Details</button>
            </div>
            <button v-if="!readOnly" type="button" class="btn btn--ghost btn--sm" :aria-pressed="editing" @click="editing = !editing">
              {{ editing ? 'Finish editing' : 'Edit plan' }}
            </button>
          </div>
          <VisualPrd v-if="planView === 'map'" :prd="plan.prd" :editing="editing" />
          <PrdView v-else :prd="plan.prd" :editing="editing" />
        </section>

        <section v-else-if="tab === 'flow' && !teamOnly" id="panel-flow" key="flow" role="tabpanel" aria-labelledby="tab-flow" tabindex="0">
          <FlowDiagram v-model="plan.flow" :editing="editing" />
        </section>

        <section v-else-if="tab === 'build' && !teamOnly" id="panel-build" key="build" role="tabpanel" aria-labelledby="tab-build" tabindex="0">
          <BuildView :build="plan.build" :reality-check="plan.realityCheck" />
          <div v-if="!readOnly" class="followups">
            <div class="section-heading">
              <div>
                <p class="eyebrow">Improve the plan</p>
                <h3>Sharpen the build</h3>
              </div>
              <span v-if="refining" class="badge badge--accent">Working…</span>
            </div>
            <button type="button" class="change-plan-card" :disabled="refining" @click="emit('refine', 'change_plan')">
              <span class="change-plan-card__eyebrow">Connected update</span>
              <strong>Change the plan, update the build</strong>
              <span>Review affected requirements, flow steps, tasks, and tests before anything is saved.</span>
            </button>
            <div class="quick-actions">
              <button type="button" class="btn btn--secondary btn--sm" :disabled="refining" @click="emit('refine', 'cut_mvp_scope')">Cut MVP scope</button>
              <button type="button" class="btn btn--secondary btn--sm" :disabled="refining" @click="emit('refine', 'break_into_tasks')">Break into tasks</button>
              <button type="button" class="btn btn--secondary btn--sm" :disabled="refining" @click="emit('refine', 'find_missing_risks')">Find missing risks</button>
              <button type="button" class="btn btn--secondary btn--sm" :disabled="refining" @click="emit('refine', 'improve_acceptance_tests')">Improve tests</button>
            </div>
            <button type="button" class="btn btn--ghost btn--block" :disabled="refining" @click="emit('refine', 'custom')">Ask a custom question</button>
          </div>
        </section>

        <section v-else-if="tab === 'track'" id="panel-track" key="track" role="tabpanel" aria-labelledby="tab-track" tabindex="0">
          <MilestoneTracker v-model="plan.build" :read-only="readOnly" :editing="editing" :team-mode="teamOnly" @update:model-value="emit('track-change', $event)" />
        </section>

        <section v-else-if="tab === 'team' && teamPanel" id="panel-team" key="team" tabindex="0">
          <div class="team-route-head">
            <p class="eyebrow">Team workspace</p>
            <h3>Team access</h3>
          </div>
          <TeamPanel :team-id="teamPanel.teamId" :owner="teamPanel.owner" :role="teamPanel.role" :members="teamPanel.members" :invite-url="teamPanel.inviteUrl" :loading="teamPanel.loading" :error="teamPanel.error" :syncing="teamSyncing" @create="emit('team-create')" @add="teamAdd" @update="teamUpdate" @remove="emit('team-remove', $event)" @copy="emit('team-copy', $event)" />
        </section>
      </Transition>

      <div v-if="tab !== 'team'" class="context-action">
        <span>Take this view with you</span>
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
.atlas-workspace { --workspace-pad: clamp(1rem, 4vw, 2.25rem); width: min(100%, 1180px); }
.bar { position: sticky; top: 0; z-index: 30; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; min-height: calc(var(--safe-top) + 64px); padding: var(--safe-top) var(--workspace-pad) 0; background: color-mix(in srgb, var(--surface) 94%, transparent); border-bottom: 1px solid var(--line); box-shadow: 0 4px 18px rgb(35 40 32 / 4%); }
.bar__back, .bar__more { display: grid; place-items: center; width: 42px; min-height: 42px; color: var(--text-muted); background: var(--surface); border: 1px solid var(--line); border-radius: 13px; }
.bar__back { justify-self: start; }
.bar__back:hover, .bar__more:hover { color: var(--accent); background: var(--surface-hover); }
.bar__brand { display: flex; align-items: center; gap: .45rem; font-family: var(--font-display); font-weight: 750; }
.bar__actions { display: flex; align-items: center; justify-self: end; gap: var(--s2); }
.bar__change { min-height: 42px; padding: 0 var(--s4); color: var(--accent-on); background: var(--accent); border-radius: 13px; font-size: var(--text-xs); font-weight: 800; transition: transform var(--duration-fast) var(--ease-smooth-out), background-color var(--duration-quick) var(--ease-in-out); }
.bar__change:hover { background: var(--accent-hover); transform: translateY(-1px); }
.bar__change:disabled { cursor: wait; opacity: .65; }
.action-sheet { position: fixed; z-index: 60; top: calc(var(--safe-top) + 72px); right: max(var(--workspace-pad), calc((100vw - 1080px) / 2)); width: min(27rem, calc(100vw - 2rem)); padding: var(--s4); background: var(--surface); border: 1px solid var(--line-strong); border-radius: var(--r-lg); box-shadow: var(--shadow-float); transform-origin: top right; }
.action-sheet__head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--s3); margin-bottom: var(--s3); }
.action-sheet__head > div { display: grid; gap: 2px; }
.action-sheet__head > div > strong { font-size: var(--text-sm); }
.action-sheet__grid { display: grid; gap: var(--s2); }
.action-item { display: grid; gap: .25rem; padding: var(--s4); text-align: left; background: var(--surface-sunken); border: 1px solid transparent; border-radius: 13px; transition: transform var(--duration-fast) var(--ease-smooth-out), background-color var(--duration-quick) var(--ease-in-out), border-color var(--duration-quick) var(--ease-in-out); }
.action-item:hover { background: var(--surface-hover); border-color: var(--line); transform: translateX(2px); }
.action-item--accent { background: var(--accent-subtle); border-color: var(--accent-line); }
.action-item strong { color: var(--text); font-size: var(--text-sm); }
.action-item span { color: var(--text-muted); font-size: var(--text-xs); line-height: 1.45; }
.titling { display: grid; grid-template-columns: minmax(0, 1fr) minmax(12rem, 15rem); align-items: end; gap: var(--s8); padding: clamp(2rem, 5vw, 3.5rem) var(--workspace-pad) var(--s5); }
.titling .screen__title { max-width: 20ch; font-family: var(--font-display); font-size: clamp(2rem, 5.5vw, 3.75rem); line-height: 1; letter-spacing: -.05em; }
.titling__main { min-width: 0; }
.name { font-family: var(--font-display); font-size: clamp(1.7rem, 5vw, 3.2rem); font-weight: 700; }
.meta { display: flex; align-items: center; flex-wrap: wrap; gap: var(--s2); margin-top: var(--s3); font-size: var(--text-xs); }
.eyebrow { margin: 0 0 var(--s2); color: var(--accent); font-size: .7rem; font-weight: 800; letter-spacing: .065em; text-transform: uppercase; }
.project-pulse { display: grid; gap: var(--s2); padding: var(--s4); background: var(--sage-subtle); border: 1px solid var(--sage-line); border-radius: var(--r-md); }
.project-pulse > span:first-child { display: flex; align-items: baseline; justify-content: space-between; gap: var(--s3); }
.project-pulse strong { font-family: var(--font-display); font-size: 1.55rem; letter-spacing: -.04em; }
.project-pulse small { color: var(--text-muted); font-size: var(--text-xs); }
.project-pulse__track { height: 5px; overflow: hidden; background: color-mix(in srgb, var(--moss) 12%, var(--surface)); border-radius: var(--r-full); }
.project-pulse__track i { display: block; height: 100%; background: var(--moss); border-radius: inherit; transition: width var(--duration-slow) var(--ease-smooth-out); }
.route-tabs { position: sticky; top: calc(var(--safe-top) + 72px); z-index: 20; display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; margin: 0 var(--workspace-pad); padding: 4px; background: var(--surface-sunken); border: 1px solid var(--line); border-radius: 16px; box-shadow: 0 8px 22px rgb(35 40 32 / 6%); isolation: isolate; }
.route-tabs__indicator { position: absolute; z-index: -1; top: 4px; bottom: 4px; left: 4px; width: calc((100% - 8px) / 4); background: var(--surface); border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 2px 7px rgb(35 40 32 / 8%); transform: translateX(calc(var(--active-tab) * 100%)); transition: transform var(--tabs-dur) var(--tabs-ease); }
.route-tab { position: relative; display: flex; align-items: center; justify-content: center; gap: .45rem; min-width: 0; min-height: 44px; padding: 0 var(--s2); color: var(--text-faint); font-size: var(--text-sm); font-weight: 750; }
.route-tab--on { color: var(--text); }
.route-tab__number { color: var(--accent); font-size: .64rem; font-variant-numeric: tabular-nums; }
.body { display: flex; flex-direction: column; gap: var(--s6); width: min(100%, 920px); margin: 0 auto; padding: var(--s8) var(--workspace-pad) 0; }
.body [role='tabpanel']:focus { outline: none; }
.body [role='tabpanel']:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; }
.plan-tools { display: flex; align-items: center; justify-content: space-between; gap: var(--s3); margin-bottom: var(--s5); }
.plan-switch { display: inline-flex; gap: 3px; padding: 3px; background: var(--surface-sunken); border: 1px solid var(--line); border-radius: 13px; }
.plan-switch button { min-height: 36px; padding: 0 .85rem; color: var(--text-muted); font-size: var(--text-xs); font-weight: 750; border-radius: 10px; transition: background-color var(--duration-quick) var(--ease-in-out), color var(--duration-quick) var(--ease-in-out); }
.plan-switch button.on { color: var(--text); background: var(--surface); box-shadow: 0 1px 4px rgb(35 40 32 / 8%); }
.context-action { display: flex; align-items: center; justify-content: space-between; gap: var(--s3); padding: var(--s4); color: var(--text-muted); background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-md); font-size: var(--text-xs); }
.footer { display: flex; flex-direction: column; gap: var(--s3); padding-bottom: var(--s6); }
.hint { font-size: var(--text-xs); text-align: center; }
.remove { align-self: center; color: var(--text-faint); }
.confirm { display: flex; flex-direction: column; gap: var(--s3); padding: var(--s4); background: var(--danger-subtle); border: 1px solid color-mix(in srgb, var(--danger) 25%, var(--line)); border-radius: var(--r-md); }
.confirm__q { font-size: var(--text-sm); }
.confirm__row { display: flex; gap: var(--s2); }
.followups { display: flex; flex-direction: column; gap: var(--s3); margin-top: var(--s6); padding: var(--s5); background: var(--accent-subtle); border: 1px solid var(--accent-line); border-radius: var(--r-lg); }
.followups h3 { font-family: var(--font-display); font-size: var(--text-lg); }
.change-plan-card { display: grid; gap: .3rem; padding: var(--s4); text-align: left; border: 1px solid var(--accent-line); border-radius: var(--r-md); background: var(--surface); transition: transform var(--duration-fast) var(--ease-smooth-out), box-shadow var(--duration-fast) var(--ease-smooth-out); }
.change-plan-card:hover { transform: translateY(-2px); box-shadow: var(--shadow-card); }
.change-plan-card:disabled { cursor: wait; opacity: .65; }
.change-plan-card strong { font-family: var(--font-display); font-size: var(--text-md); }
.change-plan-card > span:last-child { color: var(--text-muted); font-size: var(--text-sm); line-height: var(--leading); }
.change-plan-card__eyebrow { color: var(--accent); font-size: .65rem; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; }
.quick-actions { display: flex; flex-wrap: wrap; gap: var(--s2); }
.quick-actions .btn { flex: 1 1 9rem; }
.team-route-head { padding-bottom: var(--s4); border-bottom: 1px solid var(--line); }
.team-route-head h3 { font-family: var(--font-display); font-size: var(--text-xl); }

/* transitions.dev menu-dropdown and page-side-by-side patterns. */
.menu-pop-enter-active { transition: opacity var(--dropdown-open-dur) var(--dropdown-ease), transform var(--dropdown-open-dur) var(--dropdown-ease), filter var(--dropdown-open-dur) var(--dropdown-ease); }
.menu-pop-leave-active { transition: opacity var(--dropdown-close-dur) var(--dropdown-ease), transform var(--dropdown-close-dur) var(--dropdown-ease), filter var(--dropdown-close-dur) var(--dropdown-ease); }
.menu-pop-enter-from, .menu-pop-leave-to { opacity: 0; transform: translateY(calc(var(--distance-micro) * -1)) scale(.97); filter: blur(var(--blur-small)); }
.route-page-enter-active, .route-page-leave-active { transition: opacity var(--page-slide-dur) var(--page-slide-ease), transform var(--page-slide-dur) var(--page-slide-ease), filter var(--page-slide-dur) var(--page-slide-ease); }
.route-page-enter-from { opacity: 0; transform: translateX(var(--page-slide-distance)); filter: blur(var(--page-blur)); }
.route-page-leave-to { opacity: 0; transform: translateX(calc(var(--page-slide-distance) * -1)); filter: blur(var(--page-blur)); }

@media (max-width: 520px) {
  .bar { grid-template-columns: auto 1fr auto; }
  .bar__brand { justify-self: center; }
  .bar__brand span { display: none; }
  .bar__change { padding: 0 var(--s3); }
  .titling { grid-template-columns: 1fr; gap: var(--s4); padding-top: var(--s6); }
  .titling .screen__title { font-size: 2.15rem; }
  .project-pulse { grid-template-columns: auto 1fr; align-items: center; }
  .project-pulse__track { min-width: 0; }
  .project-pulse > small { grid-column: 1 / -1; }
  .route-tabs { top: calc(var(--safe-top) + 70px); margin: 0 var(--s3); }
  .route-tab { flex-direction: column; gap: 0; min-height: 48px; padding: .35rem .2rem; font-size: .76rem; }
  .plan-tools { align-items: flex-start; }
  .action-sheet { right: 1rem; }
  .context-action > span { display: none; }
  .context-action .btn { width: 100%; }
  .body { padding-top: var(--s6); }
}
</style>
