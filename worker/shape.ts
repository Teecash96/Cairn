/**
 * Validating what comes in, and clamping what goes out.
 *
 * Two jobs, and they are the same job:
 *
 *  - **Inbound.** The request body is untrusted. Idea text is capped so that
 *    nobody can use Cairn as an unmetered pipe to a language model, and every
 *    field is length-limited before it reaches a prompt or KV.
 *  - **Outbound.** A generation is also untrusted. A model that returns eleven
 *    features, a 4,000-word summary, or three decision points would break the
 *    diagram's layout, so the shape is repaired here rather than defended against
 *    in nine components.
 *
 * Nothing here throws for bad *content* — it trims, drops and demotes, so a
 * mediocre generation still renders. Only a bad *request* is rejected.
 */
import type {
  BuildMilestoneDraft,
  BuildTaskDraft,
  BuildPlanDraft,
  FlowBranch,
  FlowStep,
  FlowStepKind,
  PlanInput,
  Plan,
  PublicBuildPlan,
  PublicMilestone,
  PublicTask,
  PublicPlan,
  Prd,
  PlanChanges,
  RealityCheckItem,
  RealityPriority,
} from './types'

/** Matches `FLOW_MIN_STEPS`/`FLOW_MAX_STEPS`/`PRD_LIST_MAX` in src/lib/plan.ts. */
export const FLOW_MIN_STEPS = 5
export const FLOW_MAX_STEPS = 8
export const PRD_LIST_MAX = 5
export const BUILD_SCOPE_MAX = 5
export const BUILD_MILESTONE_COUNT = 3
export const BUILD_TASK_MIN = 8
export const BUILD_TASK_MAX = 12
export const BUILD_LIST_MAX = 5
export const REALITY_CHECK_COUNT = 3

/** Enough for a real description; short enough not to be a free LLM endpoint. */
export const IDEA_MIN = 24
export const IDEA_MAX = 1500
const HINT_MAX = 240
const NAME_MAX = 80

const PROSE_MAX = 900
const ITEM_MAX = 260
const TITLE_MAX = 90
const BUILD_TITLE_MAX = 100
const TRACKER_LABEL_MAX = 3
const TRACKER_LABEL_LENGTH = 24
const TRACKER_DATE = /^\d{4}-\d{2}-\d{2}$/
const TRACKER_MILESTONE_MAX = 12
const TRACKER_TASK_MAX = 12
const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/

// -- primitives -------------------------------------------------------------

function str(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  // Collapse whitespace: a model sometimes returns wrapped text, and these are
  // single-line fields in the UI.
  return value.replace(/\s+/g, ' ').trim().slice(0, max)
}

function list(value: unknown, maxItems: number, maxLen = ITEM_MAX): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    const text = str(item, maxLen)
    if (text) out.push(text)
    if (out.length >= maxItems) break
  }
  return out
}

// -- inbound ----------------------------------------------------------------

export interface Invalid {
  message: string
}

export function isInvalid(value: unknown): value is Invalid {
  return typeof value === 'object' && value !== null && 'message' in value
}

/**
 * The form from screen one. Only `idea` is required, and the minimum length is
 * enforced here as well as in the client — two or three words produce a plan
 * about nothing, and it would still cost a generation.
 */
export function readPlanInput(value: unknown): PlanInput | Invalid {
  if (typeof value !== 'object' || value === null) return { message: 'No idea was sent.' }
  const raw = value as Record<string, unknown>

  // Idea text keeps its line breaks — paragraphs are meaningful to the model.
  const idea = typeof raw.idea === 'string' ? raw.idea.trim().slice(0, IDEA_MAX) : ''
  if (idea.length < IDEA_MIN) {
    return { message: 'Describe the idea in a sentence or two and try again.' }
  }

  return {
    name: str(raw.name, NAME_MAX),
    idea,
    targetUser: str(raw.targetUser, HINT_MAX) || undefined,
    problem: str(raw.problem, HINT_MAX) || undefined,
    goal: str(raw.goal, HINT_MAX) || undefined,
  }
}

// -- outbound ---------------------------------------------------------------

export function clampPrd(value: unknown): Prd {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>

  return {
    summary: str(raw.summary, PROSE_MAX),
    problem: str(raw.problem, PROSE_MAX),
    targetUser: str(raw.targetUser, ITEM_MAX),
    userGoal: str(raw.userGoal, ITEM_MAX),
    coreFeatures: list(raw.coreFeatures, PRD_LIST_MAX),
    userStories: list(raw.userStories, PRD_LIST_MAX),
    successCriteria: list(raw.successCriteria, PRD_LIST_MAX),
    assumptions: list(raw.assumptions, PRD_LIST_MAX),
    outOfScope: list(raw.outOfScope, PRD_LIST_MAX),
  }
}

const KINDS: FlowStepKind[] = ['entry', 'action', 'decision', 'success', 'exit']

function readKind(value: unknown): FlowStepKind {
  return typeof value === 'string' && (KINDS as string[]).includes(value)
    ? (value as FlowStepKind)
    : 'action'
}

function readBranches(value: unknown): [FlowBranch, FlowBranch] | null {
  if (!Array.isArray(value) || value.length < 2) return null

  const pair: FlowBranch[] = []
  for (const item of value.slice(0, 2)) {
    const raw = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>
    const label = str(raw.label, TITLE_MAX)
    const result = str(raw.result, ITEM_MAX)
    if (!label) return null
    pair.push({ label, result })
  }

  const [first, second] = pair
  return first && second ? [first, second] : null
}

/**
 * Repair the flow into something the diagram can render.
 *
 * The one structural invariant `FlowDiagram.vue` relies on is **at most one
 * decision, and a decision always has exactly two outcomes** — it renders the
 * fork off `kind`, not off the text. A schema cannot express "exactly one of
 * these", so extra decisions are demoted to plain actions here, and a decision
 * that arrived without a usable pair of branches is demoted too rather than
 * rendering a fork with one arm.
 */
export function clampFlow(value: unknown): FlowStep[] {
  if (!Array.isArray(value)) return []

  const steps: FlowStep[] = []
  let decided = false

  for (const item of value) {
    if (steps.length >= FLOW_MAX_STEPS) break
    if (typeof item !== 'object' || item === null) continue

    const raw = item as Record<string, unknown>
    const title = str(raw.title, TITLE_MAX)
    const action = str(raw.action, ITEM_MAX)
    if (!title && !action) continue

    let kind = readKind(raw.kind)
    const branches = kind === 'decision' ? readBranches(raw.branches) : null

    if (kind === 'decision' && (decided || !branches)) kind = 'action'
    if (kind === 'decision') decided = true

    const step: FlowStep = { kind, title, action, result: str(raw.result, ITEM_MAX) }
    if (kind === 'decision' && branches) step.branches = branches
    steps.push(step)
  }

  return steps
}

export function requireFlow(value: unknown): FlowStep[] {
  const flow = clampFlow(value)
  const decisions = flow.filter((step) => step.kind === 'decision')
  if (flow.length < FLOW_MIN_STEPS || flow.length > FLOW_MAX_STEPS || decisions.length !== 1) {
    throw new Error('The model returned an incomplete user flow.')
  }
  return flow
}

// -- builder pack ----------------------------------------------------------

function readTaskText(value: unknown): string {
  if (typeof value === 'string') return str(value, ITEM_MAX)
  if (typeof value !== 'object' || value === null) return ''
  return str((value as { text?: unknown }).text, ITEM_MAX)
}

function readTaskDraft(value: unknown): string | BuildTaskDraft {
  const text = readTaskText(value)
  if (!text) return ''
  if (typeof value !== 'object' || value === null) return text
  const rawId = (value as { id?: unknown }).id
  return typeof rawId === 'string' && TASK_ID.test(rawId)
    ? { id: rawId, text }
    : text
}

/** Loose clamp used for stored share snapshots and client edits. */
export function clampBuild(value: unknown): BuildPlanDraft {
  if (typeof value !== 'object' || value === null) {
    return { mvpScope: [], milestones: [], risks: [], acceptanceTests: [], nextAction: '' }
  }
  const raw = value as Record<string, unknown>
  const rawMilestones = Array.isArray(raw.milestones) ? raw.milestones : []
  let taskCount = 0
  const milestones: BuildMilestoneDraft[] = []

  for (const item of rawMilestones.slice(0, BUILD_MILESTONE_COUNT)) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    const rawTasks = Array.isArray(record.tasks) ? record.tasks : []
    const tasks: Array<string | BuildTaskDraft> = []
    for (const task of rawTasks) {
      if (taskCount >= BUILD_TASK_MAX) break
      const draft = readTaskDraft(task)
      if (!draft) continue
      tasks.push(draft)
      taskCount += 1
    }
    milestones.push({
      title: str(record.title, BUILD_TITLE_MAX),
      outcome: str(record.outcome, ITEM_MAX),
      tasks,
    })
  }

  return {
    mvpScope: list(raw.mvpScope, BUILD_SCOPE_MAX),
    milestones,
    risks: list(raw.risks, BUILD_LIST_MAX),
    acceptanceTests: list(raw.acceptanceTests, BUILD_LIST_MAX),
    nextAction: str(raw.nextAction, ITEM_MAX),
  }
}

function validBuild(value: unknown): value is BuildPlanDraft {
  const build = clampBuild(value)
  const taskCount = build.milestones.reduce((sum, milestone) => sum + milestone.tasks.length, 0)
  return (
    build.mvpScope.length >= 3 &&
    build.mvpScope.length <= BUILD_SCOPE_MAX &&
    build.milestones.length === BUILD_MILESTONE_COUNT &&
    build.milestones.every((milestone) => Boolean(milestone.title && milestone.outcome)) &&
    taskCount >= BUILD_TASK_MIN &&
    taskCount <= BUILD_TASK_MAX &&
    build.risks.length <= BUILD_LIST_MAX &&
    build.acceptanceTests.length <= BUILD_LIST_MAX &&
    Boolean(build.nextAction)
  )
}

export function requireBuild(value: unknown): BuildPlanDraft {
  const build = clampBuild(value)
  if (!validBuild(build)) throw new Error('The model returned an incomplete builder pack.')
  return build
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !TRACKER_DATE.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return false
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function sharedLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const result: string[] = []
  for (const item of value) {
    const label = str(item, TRACKER_LABEL_LENGTH)
    if (!label || result.includes(label)) continue
    result.push(label)
    if (result.length >= TRACKER_LABEL_MAX) break
  }
  return result
}

/** Public tracker fields only. Private notes, priorities, and dependencies stay local. */
/** Clamp the public Track projection and rebuild ids under the server prefix. */
export function clampSharedBuild(value: unknown, id: string, preserveTaskIds = false): PublicBuildPlan {
  const raw = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
  const rawMilestones = Array.isArray(raw.milestones) ? raw.milestones : []
  const milestones: PublicMilestone[] = []
  let taskCount = 0

  for (const item of rawMilestones.slice(0, TRACKER_MILESTONE_MAX)) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    const startDate = validDate(record.startDate) ? record.startDate : undefined
    const dueDate = validDate(record.dueDate) ? record.dueDate : undefined
    const safeStart = startDate && dueDate && startDate > dueDate ? undefined : startDate
    const safeDue = startDate && dueDate && startDate > dueDate ? undefined : dueDate
    const rawTasks = Array.isArray(record.tasks) ? record.tasks : []
    const tasks: PublicTask[] = []
    for (const rawTask of rawTasks) {
      if (taskCount >= TRACKER_TASK_MAX) break
      if (typeof rawTask !== 'object' || rawTask === null) continue
      const task = rawTask as Record<string, unknown>
      const text = readTaskText(task)
      if (!text) continue
      const status = task.status === 'done' || task.status === 'in_progress'
        ? task.status
        : task.done === true
          ? 'done'
          : 'todo'
      const dueDate = validDate(task.dueDate) ? task.dueDate : undefined
      const incomingId = preserveTaskIds && typeof task.id === 'string' && TASK_ID.test(task.id)
        ? task.id
        : `${id}-m${milestones.length + 1}-t${tasks.length + 1}`
      const rewardRaw = typeof task.reward === 'object' && task.reward !== null
        ? task.reward as Record<string, unknown>
        : null
      const recipient = rewardRaw && typeof rewardRaw.recipient === 'string'
        ? rewardRaw.recipient.replace(/\s+/g, '').toUpperCase()
        : ''
      const transactionHash = rewardRaw && typeof rewardRaw.transactionHash === 'string'
        ? rewardRaw.transactionHash.toLowerCase()
        : ''
      const reward = rewardRaw && /^NQ[0-9A-Z]{34}$/.test(recipient) && /^[0-9a-f]{64}$/.test(transactionHash)
        && typeof rewardRaw.amountLuna === 'number' && Number.isSafeInteger(rewardRaw.amountLuna) && rewardRaw.amountLuna >= 1
        && typeof rewardRaw.createdAt === 'number' && Number.isFinite(rewardRaw.createdAt)
        ? { recipient, amountLuna: rewardRaw.amountLuna, transactionHash, createdAt: rewardRaw.createdAt }
        : null
      const assignee = typeof task.assignee === 'string' ? task.assignee.replace(/\s+/g, '').toUpperCase() : ''
      const approvalStatus = task.approvalStatus === 'pending' || task.approvalStatus === 'approved' || task.approvalStatus === 'changes_requested'
        ? task.approvalStatus
        : 'none'
      const completionNote = str(task.completionNote, 500)
      const reviewNote = str(task.reviewNote, 500)
      tasks.push({
        id: incomingId,
        text,
        status,
        labels: sharedLabels(task.labels),
        ...(dueDate ? { dueDate } : {}),
        ...(/^NQ[0-9A-Z]{34}$/.test(assignee) ? { assignee } : {}),
        ...(approvalStatus !== 'none' ? { approvalStatus } : {}),
        ...(completionNote ? { completionNote } : {}),
        ...(reviewNote ? { reviewNote } : {}),
        ...(reward ? { reward } : {}),
      })
      taskCount += 1
    }
    milestones.push({
      id: `${id}-m${milestones.length + 1}`,
      title: str(record.title, BUILD_TITLE_MAX),
      outcome: str(record.outcome, ITEM_MAX),
      blocked: record.blocked === true,
      ...(safeStart ? { startDate: safeStart } : {}),
      ...(safeDue ? { dueDate: safeDue } : {}),
      tasks,
    })
  }

  return {
    mvpScope: list(raw.mvpScope, BUILD_SCOPE_MAX),
    milestones,
    risks: list(raw.risks, BUILD_LIST_MAX),
    acceptanceTests: list(raw.acceptanceTests, BUILD_LIST_MAX),
    nextAction: str(raw.nextAction, ITEM_MAX),
  }
}

/**
 * Clamp the Track-only projection used by protected teams.
 *
 * Keep this separate from public shares. Public shares intentionally include
 * the builder pack summary. A team link is a narrower permission boundary and
 * must never expose that summary by accident.
 */
export function clampTeamBuild(value: unknown, id: string): PublicBuildPlan {
  const projection = clampSharedBuild(value, id)
  return {
    ...projection,
    mvpScope: [],
    risks: [],
    acceptanceTests: [],
    nextAction: '',
  }
}

function clampRealityItem(value: unknown): RealityCheckItem | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  const priorities: RealityPriority[] = ['high', 'medium', 'low']
  const priority = priorities.includes(raw.priority as RealityPriority)
    ? (raw.priority as RealityPriority)
    : 'medium'
  const concern = str(raw.concern, ITEM_MAX)
  const why = str(raw.why, ITEM_MAX)
  const fix = str(raw.fix, ITEM_MAX)
  return concern && why && fix ? { priority, concern, why, fix } : null
}

export function clampRealityCheck(value: unknown): RealityCheckItem[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, REALITY_CHECK_COUNT).flatMap((item) => {
    const checked = clampRealityItem(item)
    return checked ? [checked] : []
  })
}

export function requireRealityCheck(value: unknown): RealityCheckItem[] {
  const realityCheck = clampRealityCheck(value)
  if (realityCheck.length !== REALITY_CHECK_COUNT) {
    throw new Error('The model returned an incomplete reality check.')
  }
  return realityCheck
}

function partialPrd(value: unknown): Partial<Prd> | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const raw = value as Record<string, unknown>
  const patch: Partial<Prd> = {}
  for (const field of ['summary', 'problem', 'targetUser', 'userGoal'] as const) {
    if (field in raw) patch[field] = str(raw[field], PROSE_MAX)
  }
  for (const field of ['coreFeatures', 'userStories', 'successCriteria', 'assumptions', 'outOfScope'] as const) {
    if (field in raw) patch[field] = list(raw[field], PRD_LIST_MAX)
  }
  return Object.keys(patch).length ? patch : undefined
}

function partialBuild(value: unknown): Partial<BuildPlanDraft> | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const raw = value as Record<string, unknown>
  const patch: Partial<BuildPlanDraft> = {}
  if ('mvpScope' in raw) patch.mvpScope = list(raw.mvpScope, BUILD_SCOPE_MAX)
  if ('milestones' in raw) {
    const clamped = clampBuild({ milestones: raw.milestones }).milestones
    if (clamped.length) patch.milestones = clamped
  }
  if ('risks' in raw) patch.risks = list(raw.risks, BUILD_LIST_MAX)
  if ('acceptanceTests' in raw) patch.acceptanceTests = list(raw.acceptanceTests, BUILD_LIST_MAX)
  if ('nextAction' in raw) patch.nextAction = str(raw.nextAction, ITEM_MAX)
  return Object.keys(patch).length ? patch : undefined
}

/** Clamp targeted changes without allowing arbitrary data into a response. */
export function clampChanges(value: unknown): PlanChanges {
  if (typeof value !== 'object' || value === null) return {}
  const raw = value as Record<string, unknown>
  const changes: PlanChanges = {}
  const prd = partialPrd(raw.prd)
  if (prd) changes.prd = prd
  if ('flow' in raw) {
    // A targeted edit must still satisfy the same diagram contract as a new
    // plan. Otherwise one malformed refinement can make the workspace
    // impossible to render or share.
    try {
      changes.flow = requireFlow(raw.flow)
    } catch {
      // Ignore an invalid flow patch and keep the other safe changes.
    }
  }
  const build = partialBuild(raw.build)
  if (build) changes.build = build
  if ('realityCheck' in raw) {
    const realityCheck = clampRealityCheck(raw.realityCheck)
    if (realityCheck.length) changes.realityCheck = realityCheck
  }
  return changes
}

/** Reject model references that do not belong to the current plan. */
export function validateRefinementTaskReferences(plan: Plan | PublicPlan, changes: PlanChanges): void {
  const milestones = changes.build?.milestones
  if (!milestones) return
  const existing = new Set(plan.build.milestones.flatMap((milestone) => milestone.tasks.map((task) => task.id)))
  const seen = new Set<string>()
  for (const milestone of milestones) {
    for (const entry of milestone.tasks) {
      if (typeof entry !== 'object' || entry === null || !('id' in entry)) continue
      const id = (entry as { id?: unknown }).id
      if (typeof id !== 'string' || !TASK_ID.test(id) || !existing.has(id)) {
        throw new Error('The model returned an unknown task reference.')
      }
      if (seen.has(id)) throw new Error('The model returned a duplicate task reference.')
      seen.add(id)
    }
  }
}

// -- a whole plan, on its way into KV ---------------------------------------

/**
 * Clamp a plan the client is asking us to store, and strip everything we have no
 * business keeping.
 *
 * A shared plan has been *hand-edited* since it was generated, so it gets the same
 * treatment as a generation. `id` and timestamps are replaced rather than trusted:
 * the stored copy is a new object with no link to the sharer's library.
 */
export function clampPlan(
  value: unknown,
  id: string,
  now: number,
  options: { preserveTaskIds?: boolean } = {},
): PublicPlan | Invalid {
  if (typeof value !== 'object' || value === null) return { message: 'No plan was sent.' }
  const raw = value as Record<string, unknown>

  const input = readPlanInput(raw.input)
  if (isInvalid(input)) return input

  const flow = clampFlow(raw.flow)
  const prd = clampPrd(raw.prd)
  const build = clampSharedBuild(raw.build, id, options.preserveTaskIds === true)
  const realityCheck = clampRealityCheck(raw.realityCheck)
  if (!prd.summary && flow.length === 0 && !build.nextAction) {
    return { message: 'That plan is empty.' }
  }

  return {
    id,
    name: str(raw.name, NAME_MAX),
    createdAt: now,
    updatedAt: now,
    input,
    prd,
    flow,
    build,
    realityCheck,
    shareId: id,
  }
}
