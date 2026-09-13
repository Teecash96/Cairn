<script setup lang="ts">
/**
 * Cairn's shell: the new plan screen, library, workspace, and protected team
 * route, plus the free generate, refine, and share loop.
 *
 * State lives here rather than in a store. There are three screens and one open
 * plan; a store would be indirection for its own sake, and keeping the sequence
 * in one file is what makes the ordering rules below checkable at a glance.
 *
 * The wallet prompt fires on the first generate tap, never at boot. It proves
 * identity for free planning and protected team actions. NIM payment remains an
 * optional support path, never a prerequisite for using Cairn.
 *
 * Editing autosaves. There is no save button, and the deep watcher that does it
 * is guarded so that stamping `updatedAt` cannot retrigger itself.
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import CairnMark from './components/CairnMark.vue'
import Library from './components/Library.vue'
import NewPlan from './components/NewPlan.vue'
import PaySheet from './components/PaySheet.vue'
import RefineSheet from './components/RefineSheet.vue'
import Toast from './components/Toast.vue'
import Workspace from './components/Workspace.vue'
import {
  addTeamMember,
  ApiError,
  createTeam,
  generatePlan,
  getCredits,
  getSharedPlan,
  getTeam,
  redeemPayment,
  refinePlan,
  removeTeamMember,
  sharePlan,
  updateTeamMember,
  updateTeamTracker,
} from './lib/api'
import type { PriceQuote, RefineAction, TeamResult, TeamRole } from './lib/api'
import { copyText } from './lib/clipboard'
import {
  createPlan,
  deletePlan,
  getPlan,
  libraryIsPersistent,
  listPlans,
  materializeBuildPlan,
  hydratePublicBuild,
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
import { bindPayment, samePaymentAddress } from './lib/payment-session'
import { mergeRefinement } from './lib/refinement'
import { createExamplePlan } from './lib/example'
import { stubGenerate, stubRefinement } from './lib/stub'

type View = 'new' | 'workspace' | 'library'
type Tone = 'info' | 'success' | 'error'

const session = useSession()

const view = ref<View>('new')
const plans = ref<Plan[]>([])
const current = ref<Plan | null>(null)
const persistent = ref(true)

/** Bumped to remount the form, which is how it gets cleared. */
const formKey = ref(0)
const formInitial = ref<PlanInput | undefined>(undefined)

const generating = ref(false)
const sharing = ref(false)
const supportLoading = ref(false)
const payOpen = ref(false)
const payState = ref<'idle' | 'paying' | 'verifying'>('idle')
const payError = ref<string | null>(null)
const price = ref<PriceQuote | null>(null)
const pendingGeneration = ref<{ input: PlanInput; replaceId?: string } | null>(null)
const pendingRefinement = ref<{ action: RefineAction; question?: string } | null>(null)

const PAYMENT_POLL_DELAYS_MS = [3_000, 5_000, 8_000, 10_000, 15_000]
const PAYMENT_WAITING_MESSAGE = 'Payment sent. Cairn is checking for one network confirmation. Do not pay again.'
const paymentPendingMessage = ref<string | null>(null)
const paymentPollAttempt = ref(0)
let paymentPollTimer: ReturnType<typeof setTimeout> | undefined
let paymentPollRun = 0

const PENDING_PAYMENT_KEY = 'cairn:pending-payment'
function readPendingReceipt(): { address: string; receipt: string } | null {
  try {
    const raw = sessionStorage.getItem(PENDING_PAYMENT_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as { address?: unknown; receipt?: unknown }
    return typeof value.address === 'string' && typeof value.receipt === 'string'
      ? { address: value.address, receipt: value.receipt }
      : null
  } catch {
    return null
  }
}

function rememberPendingReceipt(value: { address: string; receipt: string }): void {
  pendingReceipt.value = value
  paymentPendingMessage.value = PAYMENT_WAITING_MESSAGE
  try { sessionStorage.setItem(PENDING_PAYMENT_KEY, JSON.stringify(value)) } catch { /* best effort */ }
}

function forgetPendingReceipt(): void {
  pendingReceipt.value = null
  paymentPendingMessage.value = null
  try { sessionStorage.removeItem(PENDING_PAYMENT_KEY) } catch { /* best effort */ }
}

const pendingReceipt = ref<{ address: string; receipt: string } | null>(readPendingReceipt())

function stopPaymentPolling(): void {
  paymentPollRun += 1
  paymentPollAttempt.value = 0
  if (paymentPollTimer !== undefined) {
    clearTimeout(paymentPollTimer)
    paymentPollTimer = undefined
  }
}

const toast = ref('')
const toastTone = ref<Tone>('info')

const refineOpen = ref(false)
const refineAction = ref<RefineAction>('custom')
const refineBusy = ref(false)
const refineExplanation = ref('')
const refineAnswer = ref('')
const refineChanges = ref<PlanChanges | null>(null)

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
const teamLoading = ref(false)
const teamError = ref<string | null>(null)
const teamSyncing = ref(false)
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.'
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
    void loadTeamLink(teamId)
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
  stopPaymentPolling()
})

// -- navigation -------------------------------------------------------------

function goNew(input?: PlanInput): void {
  showingExample.value = false
  flush()
  formInitial.value = input
  formKey.value += 1
  shared.value = null
  teamPlan.value = null
  teamResult.value = null
  view.value = 'new'
}

function goLibrary(): void {
  showingExample.value = false
  flush()
  shared.value = null
  teamPlan.value = null
  teamResult.value = null
  plans.value = listPlans()
  view.value = 'library'
}

function open(id: string): void {
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

function leaveTeam(): void {
  teamPlan.value = null
  teamResult.value = null
  teamError.value = null
  goNew()
}

function onTrackChange(build: Plan['build']): void {
  if (teamSyncing.value || !teamResult.value) return
  const teamId = teamPlan.value?.teamId ?? current.value?.teamId
  if (!teamId || teamResult.value.teamId !== teamId) return
  if (teamSyncTimer !== undefined) clearTimeout(teamSyncTimer)
  teamSyncTimer = setTimeout(() => {
    teamSyncTimer = undefined
    void pushTeamBuild(teamId, build)
  }, 700)
}

async function pushTeamBuild(teamId: string, build: Plan['build']): Promise<void> {
  const state = teamResult.value
  if (!state || state.teamId !== teamId || teamSyncing.value) return
  teamSyncing.value = true
  try {
    const result = await updateTeamTracker(teamId, publicTrackOf(build), state.revision)
    teamResult.value = result
    if (teamPlan.value?.teamId === teamId) {
      teamPlan.value.build = hydratePublicBuild(result.build)
      teamPlan.value.updatedAt = Date.now()
    }
  } catch (error) {
    teamError.value = error instanceof ApiError && error.code === 'conflict'
      ? 'Someone changed the tracker. Open the team link again to refresh it.'
      : messageOf(error)
    notify(teamError.value, 'error')
  } finally {
    teamSyncing.value = false
  }
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

async function completePayment(): Promise<void> {
  stopPaymentPolling()
  forgetPendingReceipt()
  payOpen.value = false
  const generation = pendingGeneration.value
  const refinement = pendingRefinement.value
  pendingGeneration.value = null
  pendingRefinement.value = null
  notify('Thank you. Your optional NIM support payment was verified.', 'success')
  if (generation) await generate(generation.input, generation.replaceId)
  else if (refinement) await runRefinement(refinement.action, refinement.question)
}

/** Open the voluntary NIM support path without gating any planner action. */
async function openSupport(): Promise<void> {
  if (supportLoading.value || payOpen.value) return
  if (localPreview) {
    notify('NIM support is available in the deployed Cairn app.', 'info')
    return
  }

  supportLoading.value = true
  try {
    const address = await requireAuth()
    if (!address) return
    const result = await getCredits()
    price.value = result.price
    if (!result.price) {
      notify('NIM support is temporarily unavailable.', 'error')
      return
    }
    payError.value = null
    paymentPendingMessage.value = pendingReceipt.value ? PAYMENT_WAITING_MESSAGE : null
    payOpen.value = true
  } catch (error) {
    notify(messageOf(error), 'error')
  } finally {
    supportLoading.value = false
  }
}

function startPaymentPolling(address: string, receipt: string): void {
  stopPaymentPolling()
  const run = paymentPollRun
  paymentPollAttempt.value = 0
  paymentPendingMessage.value = PAYMENT_WAITING_MESSAGE

  const poll = async (): Promise<void> => {
    const pending = pendingReceipt.value
    if (
      run !== paymentPollRun ||
      !pending ||
      pending.address !== address ||
      pending.receipt !== receipt
    ) return

    payState.value = 'verifying'
    try {
      await redeemPayment(address, receipt)
      if (run !== paymentPollRun) return
      await completePayment()
      return
    } catch (error) {
      if (run !== paymentPollRun) return
      const transient = error instanceof ApiError && (
        error.code === 'payment_not_found' ||
        error.code === 'rate_limited' ||
        error.code === 'network'
      )
      if (!transient) {
        stopPaymentPolling()
        payState.value = 'idle'
        paymentPendingMessage.value = null
        payError.value = messageOf(error)
        if (error instanceof ApiError && error.code === 'payment_wrong_wallet') session.disconnect()
        return
      }

      const delay = PAYMENT_POLL_DELAYS_MS[paymentPollAttempt.value] ?? 15_000
      paymentPollAttempt.value += 1
      // Stay busy between requests: no repeated taps or second payment required.
      payState.value = 'verifying'
      paymentPendingMessage.value = paymentPollAttempt.value >= 5
        ? 'Confirmation is taking longer than usual. We are still checking automatically. Do not pay again.'
        : PAYMENT_WAITING_MESSAGE
      paymentPollTimer = setTimeout(() => {
        paymentPollTimer = undefined
        void poll()
      }, delay)
    }
  }

  void poll()
}

async function pay(): Promise<void> {
  const quote = price.value
  if (!quote || payState.value !== 'idle') return
  const pending = pendingReceipt.value
  // A saved receipt is a recovery flow, not a new checkout. Mark it busy
  // before authentication so a second tap cannot start another attempt.
  payState.value = pending?.receipt ? 'verifying' : 'paying'
  // A wallet that already paid may now hold less than the purchase amount.
  // Let it authenticate so its saved receipt can still be recovered.
  const address = await requireAuth(pending?.receipt ? undefined : quote.priceLuna)
  if (!address) {
    payState.value = 'idle'
    payError.value = session.lastError.value ?? 'Select your funded Nimiq wallet, then try again.'
    return
  }

  payError.value = null
  const storedReceipt = pending && samePaymentAddress(pending.address, address)
    ? pending.receipt
    : null
  if (storedReceipt) {
    startPaymentPolling(address, storedReceipt)
    return
  }

  if (pending?.receipt) {
    try {
      // Keep the saved receipt when reconnecting a different wallet. A canonical
      // receipt lets the Worker check one transaction directly and explain a
      // wallet mismatch without scanning the whole recipient history.
      const recovered = await redeemPayment(address, pending.receipt)
      if (recovered.credits.total > 0) {
        await completePayment()
        return
      }
      payState.value = 'idle'
      payError.value = 'That payment is already claimed. Do not pay again.'
      return
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== 'payment_not_found') {
        payState.value = 'idle'
        payError.value = messageOf(error)
        if (error instanceof ApiError && error.code === 'payment_wrong_wallet') session.disconnect()
        return
      }
      // The receipt is still pending or not visible for this wallet. Keep it
      // saved for a later retry, but never fall through to a new payment.
      payState.value = 'idle'
      paymentPendingMessage.value = PAYMENT_WAITING_MESSAGE
      payError.value = 'Payment is still confirming. Resume checking in a moment. Do not pay again.'
      return
    }
  }

  const payment = await session.pay(quote.payTo, quote.priceLuna, 'Optional support for Cairn')
  if (!payment) {
    payState.value = 'idle'
    payError.value = session.lastError.value ?? 'Payment was not completed.'
    return
  }
  const boundPayment = bindPayment(address, payment)
  if (boundPayment.requiresPayerAuth) {
    rememberPendingReceipt(boundPayment.pending)
    session.disconnect()
    payState.value = 'idle'
    paymentPendingMessage.value = null
    payError.value = 'Payment was sent from another wallet. Sign in with that paying wallet to claim the credits. Do not pay again.'
    return
  }

  rememberPendingReceipt(boundPayment.pending)
  startPaymentPolling(address, payment.receipt)
}

function resumePendingPayment(): void {
  const connected = session.address.value
  const pending = pendingReceipt.value
  if (
    payOpen.value &&
    price.value &&
    pending &&
    connected &&
    samePaymentAddress(connected, pending.address) &&
    payState.value === 'idle'
  ) void pay()
}

// Resume without another tap only while the authenticated payer is still in
// memory. A reload must wait for a user tap so Hub can open its auth popup.
watch([payOpen, price, pendingReceipt, session.address], resumePendingPayment)

function closePay(): void {
  if (payState.value === 'paying' || (payState.value === 'verifying' && !pendingReceipt.value)) return
  stopPaymentPolling()
  payState.value = 'idle'
  payOpen.value = false
  pendingGeneration.value = null
  pendingRefinement.value = null
  if (pendingReceipt.value) paymentPendingMessage.value = PAYMENT_WAITING_MESSAGE
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

  let updated: Plan
  try {
    updated = mergeRefinement(plan, changes)
  } catch (error) {
    notify(`Could not apply the changes: ${messageOf(error)}`, 'error')
    return
  }
  current.value = updated
  flush()
  refineOpen.value = false
  clearRefineResult()
  notify('Plan updated', 'success')
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

    if (await copyText(result.url)) {
      notify('Read-only link copied', 'success')
    } else {
      notify("Shared, but this browser wouldn't let us copy the link", 'error')
    }
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
    :read-only="teamResult?.role === 'viewer'"
    @back="leaveTeam"
    @track-change="onTrackChange"
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
      :support-busy="supportLoading"
      :initial="formInitial"
      @submit="generate"
      @example="openExample"
      @support="openSupport"
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
      @regenerate="current && generate(current.input, current.id)"
      @refine="openRefine"
      @remove="current && remove(current.id)"
      @team-open="openTeamPanel"
      @team-create="createOwnerTeam"
      @team-add="addOwnerMember"
      @team-update="updateOwnerMember"
      @team-remove="removeOwnerMember"
      @team-copy="copyTeamInvite"
      @track-change="onTrackChange"
      @notify="notify"
    />

    <Library
      v-else
      :plans="plans"
      :persistent="persistent"
      @open="open"
      @create="goNew()"
      @remove="remove"
      @rename="rename"
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
      <span v-if="plans.length" class="nav__count mono">{{ plans.length }}</span>
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

  <PaySheet
    v-if="payOpen"
    :price="price"
    :state="payState"
    :error="payError"
    :pending="Boolean(pendingReceipt)"
    :pending-message="paymentPendingMessage"
    :retrying="Boolean(pendingReceipt)"
    @pay="pay"
    @close="closePay"
  />

  <Toast :message="toast" :tone="toastTone" />
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
