<script setup lang="ts">
/**
 * Cairn's shell: three screens, one bottom nav, and the whole generate → pay →
 * share loop.
 *
 * State lives here rather than in a store. There are three screens and one open
 * plan; a store would be indirection for its own sake, and keeping the sequence
 * in one file is what makes the ordering rules below checkable at a glance.
 *
 * Two orderings matter and are easy to get wrong:
 *
 *  1. The wallet prompt fires on the first "Generate plan" tap — never at boot.
 *     Distinct wallets are the competition's only quantitative measure, so the
 *     prompt has to arrive attached to something the user already chose to do.
 *  2. `connect()` comes before `ensureDeviceId()`. Both open native dialogs, and
 *     the wallet must not be queued behind a permission the user cares less
 *     about and may well decline.
 *
 * Editing autosaves. There is no save button, and the deep watcher that does it
 * is guarded so that stamping `updatedAt` cannot retrigger itself.
 */
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import CairnMark from './components/CairnMark.vue'
import Library from './components/Library.vue'
import NewPlan from './components/NewPlan.vue'
import PaySheet from './components/PaySheet.vue'
import RefineSheet from './components/RefineSheet.vue'
import Toast from './components/Toast.vue'
import Workspace from './components/Workspace.vue'
import { ApiError, generatePlan, getSharedPlan, redeemPayment, refinePlan, sharePlan } from './lib/api'
import type { CreditState, PriceQuote, RefineAction } from './lib/api'
import { copyText } from './lib/clipboard'
import {
  createPlan,
  deletePlan,
  getPlan,
  libraryIsPersistent,
  listPlans,
  materializeBuildPlan,
  renamePlan,
  savePlan,
  type BuildPlanDraft,
  type PlanChanges,
  type RealityCheckItem,
  type Plan,
  type PlanInput,
} from './lib/plan'
import { useSession } from './lib/session'
import { mergeRefinement } from './lib/refinement'
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

const toast = ref('')
const toastTone = ref<Tone>('info')

const credits = ref<CreditState | null>(null)
const price = ref<PriceQuote | null>(null)
const payOpen = ref(false)
const payState = ref<'idle' | 'paying' | 'verifying'>('idle')
const payError = ref<string | null>(null)

/** The request that was refused for want of credits, replayed after payment. */
const pending = ref<{ input: PlanInput; replaceId?: string } | null>(null)
const pendingRefinement = ref<{ action: RefineAction; question?: string } | null>(null)

const refineOpen = ref(false)
const refineAction = ref<RefineAction>('custom')
const refineBusy = ref(false)
const refineExplanation = ref('')
const refineAnswer = ref('')
const refineChanges = ref<PlanChanges | null>(null)

/** A plan opened from someone else's share link. Read-only, never saved here. */
const shared = ref<Plan | null>(null)
/** Single-use token from a share link: a free plan, courtesy of whoever shared it. */
const gift = ref<string | null>(null)

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

// -- boot -------------------------------------------------------------------

onMounted(() => {
  persistent.value = libraryIsPersistent()
  plans.value = listPlans()
  readLink()
  // Deliberately not awaited: the first paint must not wait on the SDK's poll.
  void session.boot()
})

/**
 * Share links are query parameters — `?s=<id>&g=<token>` — not paths, so no
 * server-side rewrite rule stands between a shared link and the app rendering.
 */
function readLink(): void {
  let params: URLSearchParams
  try {
    params = new URLSearchParams(window.location.search)
  } catch {
    return
  }

  const token = params.get('g')
  if (token) gift.value = token

  const id = params.get('s')
  if (id) void loadShared(id)
}

async function loadShared(shareId: string): Promise<void> {
  try {
    const result = await getSharedPlan(shareId)
    shared.value = result.plan
    if (result.gift) gift.value = result.gift
  } catch (error) {
    notify(
      error instanceof ApiError && error.code === 'not_found'
        ? 'That share link has expired.'
        : "Couldn't open that shared plan.",
      'error',
    )
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
})

// -- navigation -------------------------------------------------------------

function goNew(input?: PlanInput): void {
  flush()
  formInitial.value = input
  formKey.value += 1
  shared.value = null
  view.value = 'new'
}

function goLibrary(): void {
  flush()
  shared.value = null
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
  view.value = 'workspace'
  window.scrollTo(0, 0)
}

function back(): void {
  flush()
  // The plan you were just in is saved, so the library is never empty here.
  view.value = plans.value.length ? 'library' : 'new'
}

// -- generation -------------------------------------------------------------

/**
 * `replaceId` regenerates an existing plan in place. "Try again" keeps the plan's
 * identity and its name — a second near-identical entry in the library is clutter,
 * not history.
 */
async function generate(input: PlanInput, replaceId?: string): Promise<void> {
  if (generating.value) return
  // A new generation supersedes any unpaid refinement. Keeping both pending
  // actions would let a later payment replay the wrong request.
  pendingRefinement.value = null
  generating.value = true
  pending.value = { input, replaceId }

  try {
    const address = await session.connect()
    if (!address) {
      notify(session.lastError.value ?? 'Connect your Nimiq wallet to generate a plan.', 'error')
      return
    }

    const deviceId = await session.ensureDeviceId()
    if (localPreview) {
      const stub = stubGenerate(input)
      pending.value = null
      apply(input, stub.prd, stub.flow, stub.build, stub.realityCheck, replaceId)
      notify('Local preview plan — connect the Worker for real AI', 'info')
      return
    }
    const result = await generatePlan({ address, input, deviceId, gift: gift.value })

    credits.value = result.credits
    // Spent, whether or not it was honoured. The server is the authority.
    gift.value = null
    pending.value = null

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
      if (error.price) price.value = error.price
      if (error.credits) credits.value = error.credits
      payError.value = null
      payOpen.value = true
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
  // Refinements and generations are mutually exclusive pending actions. A
  // refinement starts here, so an older unpaid generation must not be replayed.
  pending.value = null
  refineBusy.value = true

  try {
    const address = await session.connect()
    if (!address) {
      refineOpen.value = false
      notify(session.lastError.value ?? 'Connect your wallet to refine this plan.', 'error')
      return
    }

    const deviceId = await session.ensureDeviceId()
    if (localPreview) {
      const stub = stubRefinement(plan, action, question)
      refineExplanation.value = stub.explanation
      refineAnswer.value = stub.answer ?? ''
      refineChanges.value = stub.changes
      return
    }
    const result = await refinePlan({ address, plan, action, question, deviceId })
    credits.value = result.credits
    refineExplanation.value = result.explanation
    refineAnswer.value = result.answer ?? ''
    refineChanges.value = result.changes
  } catch (error) {
    if (error instanceof ApiError && error.needsPayment) {
      pendingRefinement.value = { action, question }
      if (error.price) price.value = error.price
      if (error.credits) credits.value = error.credits
      refineOpen.value = false
      payError.value = null
      payOpen.value = true
    } else {
      refineOpen.value = false
      notify(messageOf(error), 'error')
    }
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
  sharing.value = true

  try {
    const address = await session.connect()
    if (!address) {
      notify(session.lastError.value ?? 'Connect your wallet to share.', 'error')
      return
    }

    const result = await sharePlan(address, plan)
    plan.shareId = result.shareId
    flush()

    if (await copyText(result.url)) {
      notify('Link copied — it carries a free plan for whoever opens it', 'success')
    } else {
      notify("Shared, but this browser wouldn't let us copy the link", 'error')
    }
  } catch (error) {
    notify(messageOf(error), 'error')
  } finally {
    sharing.value = false
  }
}

// -- payment ----------------------------------------------------------------

async function pay(): Promise<void> {
  const quote = price.value
  if (!quote || payState.value !== 'idle') return

  payError.value = null
  payState.value = 'paying'

  try {
    const address = await session.connect()
    if (!address) {
      payError.value = session.lastError.value ?? 'Connect your wallet first.'
      return
    }

    const receipt = await session.pay(quote.payTo, quote.priceLuna, 'Cairn plans')
    if (!receipt) {
      payError.value = session.lastError.value ?? 'Payment cancelled.'
      return
    }

    // The send is on the network; the server still has to see it settle.
    payState.value = 'verifying'
    const result = await redeemPayment(address, receipt, await session.ensureDeviceId())

    credits.value = result.credits
    payOpen.value = false
    notify(`${result.granted} plans added`, 'success')

    const replayRefinement = pendingRefinement.value
    pendingRefinement.value = null
    if (replayRefinement) {
      refineOpen.value = true
      refineAction.value = replayRefinement.action
      clearRefineResult()
      void runRefinement(replayRefinement.action, replayRefinement.question)
    } else {
      const replay = pending.value
      if (replay) void generate(replay.input, replay.replaceId)
    }
  } catch (error) {
    payError.value =
      error instanceof ApiError && error.code === 'payment_not_found'
        ? "We can't see that payment on the network yet. Give it a few seconds and try again."
        : messageOf(error)
  } finally {
    payState.value = 'idle'
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
          Someone left this for you
        </p>
        <p class="gifted__body">
          <template v-if="gift">
            Their link carries a free plan. Make your own and it's yours — no card, no account.
          </template>
          <template v-else>
            Cairn turns an idea into a product plan and a user flow. Read this one, then write yours.
          </template>
        </p>
        <button type="button" class="btn btn--primary btn--sm" @click="ownIt">
          {{ gift ? 'Claim my free plan' : 'Make my own' }}
        </button>
      </div>
    </template>
  </Workspace>

  <template v-else>
    <NewPlan
      v-if="view === 'new'"
      :key="formKey"
      :busy="generating"
      :initial="formInitial"
      :free-left="credits ? credits.free : null"
      @submit="generate"
    />

    <Workspace
      v-else-if="view === 'workspace' && current"
      :plan="current"
      :sharing="sharing"
      :regenerating="generating"
      :refining="refineBusy"
      @back="back"
      @share="share"
      @regenerate="current && generate(current.input, current.id)"
      @refine="openRefine"
      @remove="current && remove(current.id)"
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
      New plan
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
      Library
      <span v-if="plans.length" class="nav__count mono">{{ plans.length }}</span>
    </button>
  </nav>

  <PaySheet
    v-if="payOpen"
    :price="price"
    :state="payState"
    :error="payError"
    :credits="credits"
    @pay="pay"
    @close="payOpen = false"
  />

  <RefineSheet
    v-if="refineOpen"
    :action="refineAction"
    :explanation="refineExplanation"
    :answer="refineAnswer"
    :changes="refineChanges"
    :busy="refineBusy"
    @submit="submitRefinement"
    @cancel="closeRefinement"
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
  background: var(--surface);
  border-top: 1px solid var(--line);
}

.nav__item {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--s2);
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-muted);
}

.nav__item--on {
  color: var(--accent);
}

.nav__count {
  padding: 1px var(--s2);
  border-radius: var(--r-full);
  background: var(--surface-sunken);
  border: 1px solid var(--line);
  font-size: var(--text-xs);
  font-weight: 650;
  color: var(--text-muted);
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
</style>
