<script setup lang="ts">
/**
 * Cairn's shell: the new plan screen, library, workspace, and protected team
 * route, plus the free generate, refine, and share loop.
 *
 * State lives here rather than in a store. There are three screens and one open
 * plan; a store would be indirection for its own sake, and keeping the sequence
 * in one file is what makes the ordering rules below checkable at a glance.
 *
 * Wallet selection starts only from a user action, never at boot. A separate
 * signature proves identity for generation and protected team actions.
 *
 * Editing autosaves. There is no save button, and the deep watcher that does it
 * is guarded so that stamping `updatedAt` cannot retrigger itself.
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import CairnMark from './components/CairnMark.vue'
import Library from './components/Library.vue'
import NewPlan from './components/NewPlan.vue'
import RefineSheet from './components/RefineSheet.vue'
import RewardSheet from './components/RewardSheet.vue'
import Toast from './components/Toast.vue'
import Workspace from './components/Workspace.vue'
import {
  addTeamMember,
  ApiError,
  createTeam,
  generatePlan,
  getSharedPlan,
  getTeam,
  listTeams as discoverTeams,
  refinePlan,
  removeTeamMember,
  recordTeamReward,
  deleteTeamWorkspace,
  revokeSharedPlan,
  sharePlan,
  updateTeamMember,
  updateTeamTracker,
} from './lib/api'
import type { RefineAction, TeamResult, TeamRole } from './lib/api'
import { copyText, shareLink } from './lib/clipboard'
import {
  createPlan,
  deletePlan,
  getPlan,
  libraryIsPersistent,
  listPlans,
  materializeBuildPlan,
  hydratePublicBuild,
  importPlanBackup,
  normalizeSharedPlan,
  renamePlan,
  savePlan,
  publicTrackOf,
  titleOf,
  type BuildPlanDraft,
  type PlanChanges,
  type RealityCheckItem,
  type Plan,
  type PlanInput,
} from './lib/plan'
import type { TeamPanelState } from './components/Workspace.vue'
import { useSession } from './lib/session'
import { clearPendingReward, loadPendingReward, savePendingReward } from './lib/payment-session'
import { mergeRefinement, snapshotPlan } from './lib/refinement'
import { createExamplePlan } from './lib/example'
import { stubGenerate, stubRefinement } from './lib/stub'
import { forgetTeamRoute, listTeamRoutes, rememberTeamRoute, type TeamRoute } from './lib/team-library'

type View = 'new' | 'workspace' | 'library'
type Tone = 'info' | 'success' | 'error'

const session = useSession()

const view = ref<View>('new')
const plans = ref<Plan[]>([])
const teamRoutes = ref<TeamRoute[]>([])
const current = ref<Plan | null>(null)
const persistent = ref(true)

/** Bumped to remount the form, which is how it gets cleared. */
const formKey = ref(0)
const formInitial = ref<PlanInput | undefined>(undefined)

const generating = ref(false)
const sharing = ref(false)

const toast = ref('')
const toastTone = ref<Tone>('info')

const refineOpen = ref(false)
const refineAction = ref<RefineAction>('custom')
const refineBusy = ref(false)
const refineExplanation = ref('')
const refineAnswer = ref('')
const refineChanges = ref<PlanChanges | null>(null)
const refinementUndo = ref<{ before: Plan; after: Plan } | null>(null)
let refinementUndoTimer: ReturnType<typeof setTimeout> | undefined

/** A plan opened from someone else's share link. Read-only, never saved here. */
const shared = ref<Plan | null>(null)
const showingExample = ref(false)

function openExample(): void {
  flush()
  showingExample.value = true
  shared.value = createExamplePlan()
  window.scrollTo(0, 0)
}
/** Protected team state. Unlike a public share, this requires wallet auth. */
const teamResult = ref<TeamResult | null>(null)
const teamPlan = ref<Plan | null>(null)
const pendingTeamId = ref<string | null>(null)
const teamLoading = ref(false)
const teamError = ref<string | null>(null)
const teamSyncing = ref(false)
const teamSaveState = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')
let pendingTeamBuild: Plan['build'] | null = null
const rewardRecipient = ref<string | null>(null)
const rewardBusy = ref(false)
const rewardStatus = ref('')
const rewardError = ref<string | null>(null)
const rewardPending = ref(loadPendingReward())
let teamSyncTimer: ReturnType<typeof setTimeout> | undefined

/** `vite dev` without `VITE_API_BASE` has no Worker behind its `/api` paths. */
const localPreview = import.meta.env.DEV && !import.meta.env.VITE_API_BASE

// -- messages ---------------------------------------------------------------

let toastTimer: ReturnType<typeof setTimeout> | undefined

function notify(message: string, tone: Tone = 'info'): void {
  toast.value = message
  toastTone.value = tone
  if (toastTimer !== undefined) clearTimeout(toastTimer)
  // Errors need reading; confirmations need only registering.
  toastTimer = setTimeout(() => (toast.value = ''), tone === 'error' ? 5200 : 2800)
}

function clearRefinementUndo(): void {
  refinementUndo.value = null
  if (refinementUndoTimer !== undefined) {
    clearTimeout(refinementUndoTimer)
    refinementUndoTimer = undefined
  }
}

function armRefinementUndo(before: Plan, after: Plan): void {
  clearRefinementUndo()
  refinementUndo.value = { before, after }
  refinementUndoTimer = setTimeout(clearRefinementUndo, 10_000)
}

function undoRefinement(): void {
  const pending = refinementUndo.value
  const plan = current.value
  if (!pending || !plan) return

  // Do not overwrite edits made after the refinement was applied.
  if (JSON.stringify(plan) !== JSON.stringify(pending.after)) {
    clearRefinementUndo()
    notify('Undo is no longer available because the plan changed.', 'info')
    return
  }

  current.value = snapshotPlan(pending.before)
  flush()
  clearRefinementUndo()
  notify('Refinement undone', 'success')
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.'
}

async function connectIdentity(): Promise<void> {
  const address = await session.connect()
  if (address) {
    teamRoutes.value = listTeamRoutes(address)
    notify('Wallet connected. Your address is your Cairn identity.', 'success')
  } else {
    notify(session.lastError.value ?? 'Choose a Nimiq wallet to continue.', 'error')
  }
}

function disconnectIdentity(): void {
  session.disconnect()
  teamRoutes.value = []
  notify('Wallet disconnected', 'info')
}

async function openPendingTeam(): Promise<void> {
  const teamId = pendingTeamId.value
  if (teamId) await loadTeamLink(teamId)
}

async function requireAuth(minBalance?: number): Promise<string | null> {
  const address = await session.authenticate(minBalance)
  if (!address) notify(session.lastError.value ?? 'Sign in with your Nimiq wallet to continue.', 'error')
  return address
}

// -- boot -------------------------------------------------------------------

onMounted(() => {
  persistent.value = libraryIsPersistent()
  plans.value = listPlans()
  teamRoutes.value = listTeamRoutes(session.address.value)
  readLink()
  // Deliberately not awaited: the first paint must not wait on the SDK's poll.
  void session.boot()
})

/**
 * Share links are query parameters — `?s=<id>` — not paths, so no
 * server-side rewrite rule stands between a shared link and the app rendering.
 */
function readLink(): void {
  let params: URLSearchParams
  try {
    params = new URLSearchParams(window.location.search)
  } catch {
    return
  }

  const teamId = params.get('t')
  if (teamId) {
    pendingTeamId.value = teamId
    return
  }

  const id = params.get('s')
  if (id) void loadShared(id)
}

async function loadShared(shareId: string): Promise<void> {
  try {
    const result = await getSharedPlan(shareId)
    const normalized = normalizeSharedPlan(result.plan)
    if (!normalized) throw new Error('That shared plan is incomplete.')
    shared.value = normalized
  } catch (error) {
    notify(
      error instanceof ApiError && error.code === 'not_found'
        ? 'That share link has expired.'
        : "Couldn't open that shared plan.",
      'error',
    )
  }
}

function teamPlanFrom(result: TeamResult): Plan {
  const now = Date.now()
  return {
    id: `team-${result.teamId}`,
    name: result.name,
    createdAt: now,
    updatedAt: now,
    input: { name: result.name, idea: 'Protected team tracker' },
    prd: {
      summary: '',
      problem: '',
      targetUser: '',
      userGoal: '',
      coreFeatures: [],
      userStories: [],
      successCriteria: [],
      assumptions: [],
      outOfScope: [],
    },
    flow: [],
    build: hydratePublicBuild(result.build),
    realityCheck: [],
    teamId: result.teamId,
  }
}

async function loadTeamLink(teamId: string): Promise<void> {
  if (localPreview) {
    notify('Protected teams start when the Cairn Worker is connected.', 'info')
    return
  }
  teamLoading.value = true
  teamError.value = null
  try {
    await session.boot()
    const address = await requireAuth()
    if (!address) {
      teamError.value = session.lastError.value ?? 'Connect your Nimiq wallet to open this team.'
      return
    }
    const result = await getTeam(teamId)
    teamResult.value = result
    teamPlan.value = teamPlanFrom(result)
    rememberTeamRoute(result, address)
    teamRoutes.value = listTeamRoutes(address)
    pendingTeamId.value = null
    window.scrollTo(0, 0)
  } catch (error) {
    teamError.value = error instanceof ApiError && error.code === 'forbidden'
      ? 'This wallet is not a member of that team.'
      : messageOf(error)
    notify(teamError.value, 'error')
  } finally {
    teamLoading.value = false
  }
}

// -- autosave ---------------------------------------------------------------

let saveTimer: ReturnType<typeof setTimeout> | undefined
let saving = false

function flush(): void {
  if (saveTimer !== undefined) clearTimeout(saveTimer)
  saveTimer = undefined

  const plan = current.value
  if (!plan) return

  // Guarded: the watcher below would otherwise see this stamp as a fresh edit.
  saving = true
  plan.updatedAt = Date.now()
  if (!savePlan(plan)) persistent.value = false
  plans.value = listPlans()
  void nextTick(() => (saving = false))
}

watch(
  current,
  () => {
    if (saving || !current.value) return
    if (saveTimer !== undefined) clearTimeout(saveTimer)
    saveTimer = setTimeout(flush, 700)
  },
  { deep: true },
)

onUnmounted(() => {
  if (saveTimer !== undefined) clearTimeout(saveTimer)
  if (toastTimer !== undefined) clearTimeout(toastTimer)
  if (teamSyncTimer !== undefined) clearTimeout(teamSyncTimer)
  clearRefinementUndo()
})

// -- navigation -------------------------------------------------------------

async function refreshTeamRoutes(): Promise<void> {
  const wallet = session.address.value
  const local = listTeamRoutes(wallet)
  if (!wallet) {
    teamRoutes.value = []
    return
  }
  try {
    const remote = (await discoverTeams())
      .filter((team) => team.role !== 'owner')
      .map((team): TeamRoute => ({
        teamId: team.teamId,
        name: team.name,
        role: team.role as 'viewer' | 'editor',
        wallet: wallet.replace(/\s+/g, '').toUpperCase(),
        updatedAt: team.updatedAt,
      }))
    const merged = new Map(local.map((route) => [route.teamId, route]))
    for (const route of remote) merged.set(route.teamId, route)
    teamRoutes.value = [...merged.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  } catch (error) {
    teamRoutes.value = local
    if (!(error instanceof ApiError) || error.code !== 'auth_required') {
      notify('Could not refresh teammate work. Showing saved routes.', 'error')
    }
  }
}

function goNew(input?: PlanInput): void {
  clearRefinementUndo()
  showingExample.value = false
  flush()
  formInitial.value = input
  formKey.value += 1
  shared.value = null
  teamPlan.value = null
  teamResult.value = null
  pendingTeamId.value = null
  view.value = 'new'
}

async function goLibrary(): Promise<void> {
  clearRefinementUndo()
  showingExample.value = false
  flush()
  shared.value = null
  teamPlan.value = null
  teamResult.value = null
  plans.value = listPlans()
  teamRoutes.value = listTeamRoutes(session.address.value)
  view.value = 'library'
  if (session.address.value) {
    const authenticated = await session.authenticate()
    if (authenticated) await refreshTeamRoutes()
  }
}

function openTeamRoute(teamId: string): void {
  goNew()
  pendingTeamId.value = teamId
  window.scrollTo(0, 0)
}

function forgetRememberedTeam(teamId: string): void {
  const wallet = session.address.value
  if (!wallet) return
  forgetTeamRoute(teamId, wallet)
  teamRoutes.value = listTeamRoutes(wallet)
  notify('Teammate route removed from this device', 'info')
}

function open(id: string): void {
  clearRefinementUndo()
  flush()
  const plan = getPlan(id)
  if (!plan) {
    notify('That plan is no longer on this device.', 'error')
    plans.value = listPlans()
    return
  }
  current.value = plan
  shared.value = null
  teamPlan.value = null
  teamResult.value = null
  view.value = 'workspace'
  window.scrollTo(0, 0)
}

function back(): void {
  clearRefinementUndo()
  flush()
  // The plan you were just in is saved, so the library is never empty here.
  view.value = plans.value.length ? 'library' : 'new'
}

const ownerTeamPanel = computed<TeamPanelState | undefined>(() => {
  const plan = current.value
  if (!plan) return undefined
  const loaded = teamResult.value && teamResult.value.teamId === plan.teamId ? teamResult.value : null
  return {
    teamId: plan.teamId ?? null,
    owner: loaded?.owner ?? session.address.value ?? '',
    role: 'owner',
    members: loaded?.members ?? [],
    inviteUrl: loaded?.inviteUrl ?? '',
    loading: teamLoading.value,
    error: teamError.value,
  }
})

async function openTeamPanel(): Promise<void> {
  const plan = current.value
  if (!plan?.teamId || teamLoading.value) return
  if (localPreview) {
    notify('Protected teams start when the Cairn Worker is connected.', 'info')
    return
  }
  if (teamResult.value?.teamId === plan.teamId) return

  teamLoading.value = true
  teamError.value = null
  try {
    if (!(await requireAuth())) {
      teamError.value = session.lastError.value ?? 'Connect your wallet to manage the team.'
      return
    }
    teamResult.value = await getTeam(plan.teamId)
  } catch (error) {
    teamError.value = messageOf(error)
    notify(teamError.value, 'error')
  } finally {
    teamLoading.value = false
  }
}

async function createOwnerTeam(): Promise<void> {
  const plan = current.value
  if (!plan || plan.teamId || teamLoading.value) return
  if (localPreview) {
    notify('Protected teams start when the Cairn Worker is connected.', 'info')
    return
  }
  teamLoading.value = true
  teamError.value = null
  try {
    if (!(await requireAuth())) {
      teamError.value = session.lastError.value ?? 'Connect your wallet to create a team.'
      return
    }
    const result = await createTeam({
      planId: plan.id,
      name: titleOf(plan),
      build: publicTrackOf(plan.build),
    })
    plan.teamId = result.teamId
    teamResult.value = result
    flush()
    notify('Team workspace created', 'success')
  } catch (error) {
    teamError.value = messageOf(error)
    notify(teamError.value, 'error')
  } finally {
    teamLoading.value = false
  }
}

function activeOwnerTeamId(): string | null {
  const id = current.value?.teamId
  return id && teamResult.value?.teamId === id ? id : null
}

async function addOwnerMember(address: string, role: TeamRole): Promise<void> {
  const teamId = activeOwnerTeamId()
  if (!teamId || teamLoading.value) return
  teamLoading.value = true
  teamError.value = null
  try {
    teamResult.value = await addTeamMember(teamId, address, role)
    notify('Member added', 'success')
  } catch (error) {
    teamError.value = messageOf(error)
    notify(teamError.value, 'error')
  } finally {
    teamLoading.value = false
  }
}

async function updateOwnerMember(address: string, role: TeamRole): Promise<void> {
  const teamId = activeOwnerTeamId()
  if (!teamId || teamLoading.value) return
  teamLoading.value = true
  teamError.value = null
  try {
    teamResult.value = await updateTeamMember(teamId, address, role)
    notify('Permission updated', 'success')
  } catch (error) {
    teamError.value = messageOf(error)
    notify(teamError.value, 'error')
  } finally {
    teamLoading.value = false
  }
}

async function removeOwnerMember(address: string): Promise<void> {
  const teamId = activeOwnerTeamId()
  if (!teamId || teamLoading.value) return
  teamLoading.value = true
  teamError.value = null
  try {
    teamResult.value = await removeTeamMember(teamId, address)
    notify('Member removed', 'success')
  } catch (error) {
    teamError.value = messageOf(error)
    notify(teamError.value, 'error')
  } finally {
    teamLoading.value = false
  }
}

async function copyTeamInvite(url: string): Promise<void> {
  if (await copyText(url)) notify('Invite link copied', 'success')
  else notify("This browser would not let us copy the invite link", 'error')
}

function openTeamReward(address: string): void {
  const plan = current.value
  if (!plan) return
  const available = plan.build.milestones.flatMap((milestone) => milestone.tasks)
    .some((task) => task.status === 'done' && !task.reward)
  if (!available) {
    notify('Complete an unrewarded task first.', 'info')
    return
  }
  if (rewardPending.value && rewardPending.value.recipient !== address) {
    notify('Finish checking the pending teammate reward first.', 'info')
    return
  }
  rewardRecipient.value = address
  rewardError.value = null
  rewardStatus.value = ''
}

function closeTeamReward(): void {
  if (rewardBusy.value) return
  rewardRecipient.value = null
  rewardError.value = null
  rewardStatus.value = ''
}

async function sendTeamReward(value: { taskId: string; amountLuna: number }): Promise<void> {
  const teamId = activeOwnerTeamId()
  const recipient = rewardRecipient.value
  const plan = current.value
  const state = teamResult.value
  if (!teamId || !recipient || !plan || !state || rewardBusy.value) return
  const task = plan.build.milestones.flatMap((milestone) => milestone.tasks).find((item) => item.id === value.taskId)
  if (!task || task.status !== 'done' || task.reward) return

  rewardBusy.value = true
  rewardError.value = null
  rewardStatus.value = 'Confirm the direct payment in your Nimiq wallet.'
  try {
    if (!(await requireAuth())) throw new Error(session.lastError.value ?? 'Connect your wallet to send the reward.')
    const existing = rewardPending.value
    let receipt: string
    let revision: number
    if (existing) {
      if (existing.teamId !== teamId || existing.taskId !== task.id || existing.recipient !== recipient || existing.amountLuna !== value.amountLuna) {
        throw new Error('Finish checking the pending teammate reward before sending another one.')
      }
      receipt = existing.receipt
      revision = existing.revision
    } else {
      const payment = await session.pay(recipient, value.amountLuna, `Cairn reward: ${task.text.slice(0, 48)}`)
      if (!payment) throw new Error(session.lastError.value ?? 'The reward was not sent.')
      receipt = payment.receipt
      revision = state.revision
      rewardPending.value = { teamId, taskId: task.id, recipient, amountLuna: value.amountLuna, receipt, revision }
      savePendingReward(rewardPending.value)
    }

    rewardStatus.value = 'Payment sent. Waiting for one network confirmation…'
    const delays = [0, 3_000, 5_000, 8_000, 12_000, 15_000, 20_000, 25_000]
    let result: TeamResult | null = null
    for (const delay of delays) {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
      try {
        result = await recordTeamReward(teamId, {
          taskId: task.id,
          recipient,
          amountLuna: value.amountLuna,
          receipt,
          revision,
        })
        break
      } catch (error) {
        if (error instanceof ApiError && error.code === 'payment_not_found') continue
        if (error instanceof ApiError && error.code === 'conflict') {
          const refreshed = await getTeam(teamId)
          teamResult.value = refreshed
          const recorded = refreshed.build.milestones.flatMap((milestone) => milestone.tasks)
            .find((candidate) => candidate.id === task.id)?.reward
          if (recorded?.transactionHash) {
            result = refreshed
            break
          }
          revision = refreshed.revision
          rewardPending.value = { teamId, taskId: task.id, recipient, amountLuna: value.amountLuna, receipt, revision }
          savePendingReward(rewardPending.value)
          continue
        }
        throw error
      }
    }
    if (!result) throw new Error('The payment is still pending. Use Resume confirmation later. Cairn will not ask you to pay again.')

    rewardPending.value = null
    clearPendingReward()
    teamResult.value = result
    const verified = result.build.milestones.flatMap((milestone) => milestone.tasks).find((item) => item.id === task.id)?.reward
    if (verified) task.reward = { ...verified }
    flush()
    rewardStatus.value = 'Reward confirmed and attached to the completed task.'
    notify('Teammate reward confirmed', 'success')
    await new Promise((resolve) => setTimeout(resolve, 900))
    rewardRecipient.value = null
  } catch (error) {
    rewardError.value = messageOf(error)
  } finally {
    rewardBusy.value = false
  }
}

async function deleteOwnerTeam(): Promise<void> {
  const teamId = activeOwnerTeamId()
  const plan = current.value
  if (!teamId || !plan || teamLoading.value) return
  teamLoading.value = true
  try {
    await deleteTeamWorkspace(teamId)
    if (rewardPending.value?.teamId === teamId) {
      rewardPending.value = null
      clearPendingReward()
    }
    delete plan.teamId
    teamResult.value = null
    flush()
    notify('Team workspace deleted and link revoked', 'success')
  } catch (error) {
    teamError.value = messageOf(error)
    notify(teamError.value, 'error')
  } finally {
    teamLoading.value = false
  }
}

function leaveTeam(): void {
  teamPlan.value = null
  teamResult.value = null
  teamError.value = null
  void goLibrary()
}

function onTrackChange(build: Plan['build']): void {
  if (!teamResult.value) return
  const teamId = teamPlan.value?.teamId ?? current.value?.teamId
  if (!teamId || teamResult.value.teamId !== teamId) return
  pendingTeamBuild = build
  teamSaveState.value = 'saving'
  if (teamSyncTimer !== undefined) clearTimeout(teamSyncTimer)
  teamSyncTimer = setTimeout(() => {
    teamSyncTimer = undefined
    void pushPendingTeamBuild(teamId)
  }, 700)
}

async function pushPendingTeamBuild(teamId: string): Promise<void> {
  if (teamSyncing.value || !pendingTeamBuild) return
  const state = teamResult.value
  if (!state || state.teamId !== teamId) return
  const build = pendingTeamBuild
  pendingTeamBuild = null
  teamSyncing.value = true
  teamSaveState.value = 'saving'
  try {
    const result = await updateTeamTracker(teamId, publicTrackOf(build), state.revision)
    teamResult.value = result
    teamSaveState.value = 'saved'
    if (teamPlan.value?.teamId === teamId) {
      teamPlan.value.build = hydratePublicBuild(result.build)
      teamPlan.value.updatedAt = Date.now()
    }
  } catch (error) {
    pendingTeamBuild = build
    teamSaveState.value = 'error'
    teamError.value = error instanceof ApiError && error.code === 'conflict'
      ? 'Someone changed the tracker. Open the team link again to refresh it.'
      : messageOf(error)
    notify(teamError.value, 'error')
  } finally {
    teamSyncing.value = false
    if (pendingTeamBuild && teamSaveState.value !== 'error') void pushPendingTeamBuild(teamId)
  }
}

function retryTeamSave(): void {
  const teamId = teamPlan.value?.teamId ?? current.value?.teamId
  if (!teamId || !pendingTeamBuild) return
  teamSaveState.value = 'saving'
  void pushPendingTeamBuild(teamId)
}

// -- generation -------------------------------------------------------------

/**
 * `replaceId` regenerates an existing plan in place. "Try again" keeps the plan's
 * identity and its name — a second near-identical entry in the library is clutter,
 * not history.
 */
async function generate(input: PlanInput, replaceId?: string): Promise<void> {
  if (generating.value) return
  generating.value = true

  try {
    const address = await requireAuth()
    if (!address) {
      return
    }

    if (localPreview) {
      const stub = stubGenerate(input)
      apply(input, stub.prd, stub.flow, stub.build, stub.realityCheck, replaceId)
      notify('Local preview plan — connect the Worker for real AI', 'info')
      return
    }
    const result = await generatePlan({ address, input })

    apply(input, result.prd, result.flow, result.build, result.realityCheck, replaceId)
  } catch (error) {
    onGenerateFailed(error, input, replaceId)
  } finally {
    generating.value = false
  }
}

function apply(
  input: PlanInput,
  prd: Plan['prd'],
  flow: Plan['flow'],
  build: BuildPlanDraft,
  realityCheck: RealityCheckItem[],
  replaceId?: string,
): void {
  const existing = replaceId && current.value?.id === replaceId ? current.value : null

  if (existing) {
    existing.input = input
    existing.prd = prd
    existing.flow = flow
    existing.build = materializeBuildPlan(build, existing.build)
    existing.realityCheck = realityCheck
    flush()
    notify('Regenerated', 'success')
    return
  }

  const plan = createPlan(input, prd, flow, build, realityCheck)
  if (!savePlan(plan)) persistent.value = false
  plans.value = listPlans()
  // Read back the stored copy so the open plan and the saved one are the same.
  current.value = getPlan(plan.id) ?? plan
  view.value = 'workspace'
  window.scrollTo(0, 0)
}

function onGenerateFailed(error: unknown, input: PlanInput, replaceId?: string): void {
  if (error instanceof ApiError) {
    if (error.needsPayment) {
      notify('This Cairn deployment still has the old payment gate. Refresh after the free version is deployed.', 'error')
      return
    }
    /**
     * Development only. `vite dev` has no Worker and therefore no AI key, so
     * rather than leave every screen unreachable, an obviously-placeholder plan
     * is produced locally. A deployed build never takes this path.
     */
    if (error.isOffline && import.meta.env.DEV) {
      const stub = stubGenerate(input)
      apply(input, stub.prd, stub.flow, stub.build, stub.realityCheck, replaceId)
      notify('No backend yet — placeholder plan', 'info')
      return
    }
  }

  notify(messageOf(error), 'error')
}

// -- planner follow ups ----------------------------------------------------

function clearRefineResult(): void {
  refineExplanation.value = ''
  refineAnswer.value = ''
  refineChanges.value = null
}

function openRefine(action: RefineAction): void {
  if (!current.value || refineBusy.value) return
  clearRefineResult()
  refineAction.value = action
  refineOpen.value = true
  if (action !== 'custom') void runRefinement(action)
}

async function runRefinement(action: RefineAction, question?: string): Promise<void> {
  const plan = current.value
  if (!plan || refineBusy.value) return
  refineBusy.value = true

  try {
    const address = await requireAuth()
    if (!address) {
      refineOpen.value = false
      return
    }

    if (localPreview) {
      const stub = stubRefinement(plan, action, question)
      refineExplanation.value = stub.explanation
      refineAnswer.value = stub.answer ?? ''
      refineChanges.value = stub.changes
      return
    }
    const result = await refinePlan({ address, plan, action, question })
    refineExplanation.value = result.explanation
    refineAnswer.value = result.answer ?? ''
    refineChanges.value = result.changes
  } catch (error) {
    if (error instanceof ApiError && error.needsPayment) {
      notify('This Cairn deployment still has the old payment gate. Refresh after the free version is deployed.', 'error')
      return
    }
    refineOpen.value = false
    notify(messageOf(error), 'error')
  } finally {
    refineBusy.value = false
  }
}

function submitRefinement(question: string): void {
  void runRefinement('custom', question)
}

function applyRefinement(): void {
  const plan = current.value
  const changes = refineChanges.value
  if (!plan || !changes) return

  const before = snapshotPlan(plan)
  let updated: Plan
  try {
    updated = mergeRefinement(plan, changes)
  } catch (error) {
    notify(`Could not apply the changes: ${messageOf(error)}`, 'error')
    return
  }
  current.value = updated
  flush()
  armRefinementUndo(before, snapshotPlan(updated))
  refineOpen.value = false
  clearRefineResult()
}

function closeRefinement(apply = false): void {
  if (apply) {
    applyRefinement()
    return
  }
  refineOpen.value = false
}

// -- sharing ----------------------------------------------------------------

async function share(): Promise<void> {
  const plan = current.value
  if (!plan || sharing.value) return
  if (localPreview) {
    notify('Sharing starts when the Cairn Worker is connected.', 'info')
    return
  }
  sharing.value = true

  try {
    const address = await requireAuth()
    if (!address) {
      return
    }

    const result = await sharePlan(address, plan)
    plan.shareId = result.shareId
    flush()

    const outcome = await shareLink(titleOf(plan), 'A product route mapped with Cairn.', result.url)
    if (outcome === 'shared') notify('Read-only link shared', 'success')
    else if (outcome === 'copied') notify('Read-only link copied', 'success')
    else if (outcome === 'failed') notify("Shared, but this browser wouldn't let us send the link", 'error')
  } catch (error) {
    notify(messageOf(error), 'error')
  } finally {
    sharing.value = false
  }
}

async function revokeShare(): Promise<void> {
  const plan = current.value
  if (!plan?.shareId || sharing.value) return
  sharing.value = true
  try {
    await revokeSharedPlan(plan.shareId)
    delete plan.shareId
    flush()
    notify('Public link revoked', 'success')
  } catch (error) {
    notify(messageOf(error), 'error')
  } finally {
    sharing.value = false
  }
}

// -- library actions --------------------------------------------------------

function remove(id: string): void {
  deletePlan(id)
  plans.value = listPlans()
  if (current.value?.id === id) {
    current.value = null
    view.value = plans.value.length ? 'library' : 'new'
  }
}

function rename(id: string, name: string): void {
  renamePlan(id, name)
  plans.value = listPlans()
  const open = current.value
  if (open && open.id === id) open.name = name
}

function restoreBackup(text: string): void {
  const restored = importPlanBackup(text)
  if (!restored) {
    notify('This is not a valid Cairn backup.', 'error')
    return
  }
  if (!savePlan(restored)) persistent.value = false
  plans.value = listPlans()
  current.value = restored
  view.value = 'workspace'
  notify('Backup restored as a new route', 'success')
}

/** Leave a shared plan and start your own. Their idea is theirs — the form is blank. */
function ownIt(): void {
  goNew()
}
</script>

<template>
  <!-- A plan someone shared with you. Same workspace, nothing mutable. -->
  <Workspace
    v-if="shared"
    :plan="shared"
    read-only
    @back="ownIt"
    @notify="notify"
  >
    <template #banner>
      <div class="gifted">
        <p class="gifted__title">
          <CairnMark :size="18" class="gifted__mark" />
          {{ showingExample ? 'Sample plan · Meetup tickets' : 'Someone left this for you' }}
        </p>
        <p class="gifted__body">
          {{ showingExample ? 'A curated illustration, not a customer project or a live AI result. Explore Plan, Flow, Build, and Track without connecting a wallet.' : 'Cairn turns an idea into a product map and a route to release. Explore this plan, then create your own. Planning is free and Nimiq wallet support is built in.' }}
        </p>
        <button type="button" class="btn btn--primary btn--sm" @click="ownIt">
          Map my own idea
        </button>
      </div>
    </template>
  </Workspace>

  <Workspace
    v-else-if="teamPlan"
    :plan="teamPlan"
    :team-only="true"
    :team-syncing="teamSyncing"
    :team-save-state="teamSaveState"
    :read-only="teamResult?.role === 'viewer'"
    @back="leaveTeam"
    @track-change="onTrackChange"
    @team-retry="retryTeamSave"
    @notify="notify"
  >
    <template #banner>
      <div class="team-banner">
        <p class="team-banner__title">
          <CairnMark :size="18" />
          Protected team tracker
        </p>
        <p class="team-banner__body">
          You are a {{ teamResult?.role === 'editor' ? 'Track editor' : 'Track viewer' }}. The private brief belongs to the owner.
        </p>
      </div>
    </template>
  </Workspace>

  <template v-else>
    <NewPlan
      v-if="view === 'new'"
      :key="formKey"
      :busy="generating"
      :wallet-busy="session.connecting.value"
      :team-busy="teamLoading"
      :wallet-address="session.address.value"
      :team-invite="Boolean(pendingTeamId)"
      :initial="formInitial"
      @submit="generate"
      @example="openExample"
      @connect="connectIdentity"
      @disconnect="disconnectIdentity"
      @open-team="openPendingTeam"
    />

    <Workspace
      v-else-if="view === 'workspace' && current"
      :plan="current"
      :sharing="sharing"
      :regenerating="generating"
      :refining="refineBusy"
      :team-panel="ownerTeamPanel"
      :team-syncing="teamSyncing"
      @back="back"
      @share="share"
      @share-revoke="revokeShare"
      @regenerate="current && generate(current.input, current.id)"
      @refine="openRefine"
      @remove="current && remove(current.id)"
      @team-open="openTeamPanel"
      @team-create="createOwnerTeam"
      @team-add="addOwnerMember"
      @team-update="updateOwnerMember"
      @team-remove="removeOwnerMember"
      @team-copy="copyTeamInvite"
      @team-reward="openTeamReward"
      @team-delete="deleteOwnerTeam"
      @track-change="onTrackChange"
      @notify="notify"
    />

    <Library
      v-else
      :plans="plans"
      :team-routes="teamRoutes"
      :wallet-connected="Boolean(session.address.value)"
      :persistent="persistent"
      @open="open"
      @open-team="openTeamRoute"
      @forget-team="forgetRememberedTeam"
      @create="goNew()"
      @remove="remove"
      @rename="rename"
      @import="restoreBackup"
    />
  </template>

  <nav class="nav" aria-label="Main">
    <button
      type="button"
      class="nav__item"
      :class="{ 'nav__item--on': view === 'new' && !shared }"
      :aria-current="view === 'new' && !shared ? 'page' : undefined"
      @click="goNew()"
    >
      <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false">
        <path
          d="M10 4.5v11M4.5 10h11"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
        />
      </svg>
      Map
    </button>

    <button
      type="button"
      class="nav__item"
      :class="{ 'nav__item--on': view === 'library' && !shared }"
      :aria-current="view === 'library' && !shared ? 'page' : undefined"
      @click="goLibrary"
    >
      <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false">
        <g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
          <path d="M4 6h12M4 10h12M4 14h8" />
        </g>
      </svg>
      Routes
      <span v-if="plans.length + teamRoutes.length" class="nav__count mono">{{ plans.length + teamRoutes.length }}</span>
    </button>
  </nav>

  <RefineSheet
    v-if="refineOpen && current"
    :plan="current"
    :action="refineAction"
    :explanation="refineExplanation"
    :answer="refineAnswer"
    :changes="refineChanges"
    :busy="refineBusy"
    @submit="submitRefinement"
    @cancel="closeRefinement"
  />

  <RewardSheet
    v-if="rewardRecipient && current"
    :recipient="rewardRecipient"
    :tasks="current.build.milestones.flatMap((milestone) => milestone.tasks).filter((task) => task.status === 'done' && !task.reward).map((task) => ({ id: task.id, text: task.text }))"
    :busy="rewardBusy"
    :status="rewardStatus"
    :error="rewardError"
    :pending="Boolean(rewardPending)"
    :initial-task-id="rewardPending?.taskId"
    :initial-amount-luna="rewardPending?.amountLuna"
    @send="sendTeamReward"
    @close="closeTeamReward"
  />

  <Toast :message="toast" :tone="toastTone" />

  <Transition name="rise">
    <div v-if="refinementUndo" class="undo-banner" role="status" aria-live="polite">
      <span>Plan updated.</span>
      <button type="button" class="undo-banner__button" @click="undoRefinement">Undo</button>
    </div>
  </Transition>
</template>

<style scoped>
/* -- bottom nav ---------------------------------------------------------- */

.nav {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 40;
  display: flex;
  /* The bar is --nav-h tall; the inset is extra, below it. */
  height: calc(var(--nav-h) + var(--safe-bottom));
  padding-bottom: var(--safe-bottom);
  background: var(--ink);
  border-top: 3px solid var(--nim);
}

.nav__item {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--s2);
  font-size: var(--text-sm);
  font-weight: 700;
  color: #b9beb5;
}

.nav__item--on {
  color: #fffdf7;
  background: #2457d6;
}

.nav__count {
  padding: 1px var(--s2);
  border-radius: var(--r-full);
  background: rgb(255 255 255 / .12);
  border: 1px solid rgb(255 255 255 / .18);
  font-size: var(--text-xs);
  font-weight: 650;
  color: inherit;
}

.undo-banner {
  position: fixed;
  left: 50%;
  bottom: calc(var(--nav-h) + var(--safe-bottom) + var(--s3));
  z-index: 61;
  display: flex;
  align-items: center;
  gap: var(--s3);
  max-width: calc(100% - (2 * var(--s4)));
  padding: var(--s2) var(--s2) var(--s2) var(--s4);
  border-radius: var(--r-full);
  background: var(--text);
  color: var(--bg);
  box-shadow: 0 6px 20px rgb(16 18 27 / 18%);
  transform: translateX(-50%);
  font-size: var(--text-sm);
  font-weight: 550;
}

.undo-banner__button {
  min-height: 32px;
  padding: 0 var(--s3);
  border-radius: var(--r-full);
  background: var(--accent);
  color: #fff;
  font-weight: 700;
}

.undo-banner__button:hover { background: var(--accent-strong, var(--accent)); }

/* -- shared-plan banner -------------------------------------------------- */

.gifted {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--s2);
  margin: var(--s4) var(--s4) 0;
  padding: var(--s4);
  background: var(--accent-subtle);
  border: 1px solid var(--accent-line);
  border-radius: var(--r-md);
}

.gifted__title {
  display: flex;
  align-items: center;
  gap: var(--s2);
  font-size: var(--text-sm);
  font-weight: 700;
  color: var(--accent);
}

.gifted__mark {
  color: var(--accent);
}

.gifted__body {
  font-size: var(--text-sm);
  line-height: var(--leading);
  color: var(--text-muted);
}

.team-banner {
  display: flex;
  flex-direction: column;
  gap: var(--s2);
  margin: var(--s4) var(--s4) 0;
  padding: var(--s4);
  background: var(--accent-subtle);
  border: 1px solid var(--accent-line);
  border-radius: var(--r-md);
}

.team-banner__title {
  display: flex;
  align-items: center;
  gap: var(--s2);
  color: var(--accent);
  font-size: var(--text-sm);
  font-weight: 700;
}

.team-banner__body {
  color: var(--text-muted);
  font-size: var(--text-sm);
  line-height: var(--leading);
}
</style>
