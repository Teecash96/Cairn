/**
 * Cairn's data model and on-device library.
 *
 * A "plan" is one idea turned into a builder pack: a PRD, a user flow, a
 * milestone plan, and a reality check. The server writes the draft. The client
 * owns task identity and completion state, so the AI can never claim work is
 * complete.
 *
 * Plans live in localStorage. There is no account and no sync: the library is
 * per-device by design, and `shareId` is the only thing that ever leaves it.
 */

/** Exactly the form on screen 1. Only `idea` is required. */
export interface PlanInput {
  name: string
  idea: string
  targetUser?: string
  problem?: string
  goal?: string
}

/**
 * Product requirements. The three capped arrays are capped by the *server*
 * (a generation is clamped before it is returned), but the UI must not assume
 * the cap held — a hand-edited or older plan can carry more.
 */
export interface Prd {
  summary: string
  problem: string
  targetUser: string
  userGoal: string
  /** Max 5. */
  coreFeatures: string[]
  /** Max 5. */
  userStories: string[]
  /** Max 5. */
  successCriteria: string[]
  assumptions: string[]
  outOfScope: string[]
}

/**
 * One node of the user flow.
 *
 * `kind` is structural, not decorative: `FlowDiagram.vue` renders the branching
 * card off `kind === 'decision'` rather than guessing from the text, and the
 * generator is required to emit exactly one of those. It also means meaning is
 * never carried by colour alone, which is a scored accessibility requirement.
 */
export type FlowStepKind = 'entry' | 'action' | 'decision' | 'success' | 'exit'

export interface FlowBranch {
  label: string
  result: string
}

export interface FlowStep {
  kind: FlowStepKind
  title: string
  /** What the user does. */
  action: string
  /** What they should see happen. */
  result: string
  /** Present only when `kind === 'decision'`; exactly two outcomes. */
  branches?: [FlowBranch, FlowBranch]
}

export interface Task {
  /** Client-authored stable identity. Never supplied by the model. */
  id: string
  text: string
  /** Local progress. Never supplied or changed by the model. */
  done: boolean
}

export interface Milestone {
  /** Client-authored stable identity. */
  id: string
  title: string
  outcome: string
  tasks: Task[]
}

export interface BuildPlan {
  mvpScope: string[]
  milestones: Milestone[]
  risks: string[]
  acceptanceTests: string[]
  nextAction: string
}

/** Server-authored build shape. It deliberately has no ids or progress. */
export interface BuildMilestoneDraft {
  title: string
  outcome: string
  tasks: string[]
}

export interface BuildPlanDraft {
  mvpScope: string[]
  milestones: BuildMilestoneDraft[]
  risks: string[]
  acceptanceTests: string[]
  nextAction: string
}

export type RealityPriority = 'high' | 'medium' | 'low'

export interface RealityCheckItem {
  priority: RealityPriority
  concern: string
  why: string
  fix: string
}

export interface BuildPlanChanges {
  mvpScope?: string[]
  milestones?: BuildMilestoneDraft[]
  risks?: string[]
  acceptanceTests?: string[]
  nextAction?: string
}

/** A targeted refinement. Missing fields must remain untouched. */
export interface PlanChanges {
  prd?: Partial<Prd>
  flow?: FlowStep[]
  build?: BuildPlanChanges
  realityCheck?: RealityCheckItem[]
}

export interface Plan {
  id: string
  /** Display name. May be empty — use `titleOf()` rather than reading this raw. */
  name: string
  createdAt: number
  updatedAt: number
  /**
   * The form as submitted, kept verbatim. Two reasons: "Try again" after a
   * failed generation must never lose the user's typing, and regenerating a
   * saved plan should start from what they actually wrote.
   */
  input: PlanInput
  prd: Prd
  flow: FlowStep[]
  build: BuildPlan
  realityCheck: RealityCheckItem[]
  /** Set once the plan has been shared. Absent means it has never left the device. */
  shareId?: string
}

/** Steps outside this range are a generator bug; the UI still renders them. */
export const FLOW_MIN_STEPS = 5
export const FLOW_MAX_STEPS = 8
/** Applies to coreFeatures, userStories and successCriteria. */
export const PRD_LIST_MAX = 5
export const BUILD_SCOPE_MIN = 3
export const BUILD_SCOPE_MAX = 5
export const BUILD_MILESTONE_COUNT = 3
export const BUILD_TASK_MIN = 8
export const BUILD_TASK_MAX = 12
export const BUILD_LIST_MAX = 5
export const REALITY_CHECK_COUNT = 3

// -- identity ---------------------------------------------------------------

/**
 * `crypto.randomUUID()` requires a secure context, and LAN HTTP — how this app
 * is tested on a real handset — is not one. Feature-detect, then fall back to
 * `getRandomValues`, then to `Math.random`. Collisions only matter within one
 * device's library, so the weakest tier is still fine.
 */
export function newId(): string {
  const c: Crypto | undefined = typeof crypto !== 'undefined' ? crypto : undefined

  if (typeof c?.randomUUID === 'function') {
    try {
      return c.randomUUID()
    } catch {
      /* fall through */
    }
  }

  if (typeof c?.getRandomValues === 'function') {
    const bytes = c.getRandomValues(new Uint8Array(16))
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  }

  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

export function emptyBuildPlan(): BuildPlan {
  return {
    mvpScope: [],
    milestones: [],
    risks: [],
    acceptanceTests: [],
    nextAction: '',
  }
}

function normalizeMatch(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

/**
 * Turn a server draft into client-owned work state.
 *
 * Matching happens across the whole prior plan, not only inside the same
 * milestone. A useful refinement may move a task without erasing its progress.
 */
export function materializeBuildPlan(
  draft: BuildPlanDraft,
  previous?: BuildPlan,
): BuildPlan {
  const oldTasks = new Map<string, Task[]>()
  for (const milestone of previous?.milestones ?? []) {
    for (const task of milestone.tasks) {
      const key = normalizeMatch(task.text)
      const bucket = oldTasks.get(key) ?? []
      bucket.push(task)
      oldTasks.set(key, bucket)
    }
  }

  const oldMilestones = new Map<string, Milestone[]>()
  for (const milestone of previous?.milestones ?? []) {
    const key = normalizeMatch(milestone.title)
    const bucket = oldMilestones.get(key) ?? []
    bucket.push(milestone)
    oldMilestones.set(key, bucket)
  }

  const usedTasks = new Set<string>()
  const usedMilestones = new Set<string>()

  return {
    mvpScope: draft.mvpScope.map((item) => item.trim()).filter(Boolean),
    milestones: draft.milestones.map((item) => {
      const milestoneMatch = (oldMilestones.get(normalizeMatch(item.title)) ?? []).find(
        (candidate) => !usedMilestones.has(candidate.id),
      )
      const id = milestoneMatch?.id ?? newId()
      usedMilestones.add(id)

      return {
        id,
        title: item.title.trim(),
        outcome: item.outcome.trim(),
        tasks: item.tasks
          .map((text) => text.trim())
          .filter(Boolean)
          .map((text) => {
            const match = (oldTasks.get(normalizeMatch(text)) ?? []).find(
              (candidate) => !usedTasks.has(candidate.id),
            )
            if (match) {
              usedTasks.add(match.id)
              return { id: match.id, text, done: match.done }
            }
            return { id: newId(), text, done: false }
          }),
      }
    }),
    risks: draft.risks.map((item) => item.trim()).filter(Boolean),
    acceptanceTests: draft.acceptanceTests.map((item) => item.trim()).filter(Boolean),
    nextAction: draft.nextAction.trim(),
  }
}

// -- derived display values -------------------------------------------------

/** The name if there is one, otherwise the opening of the idea. Never empty. */
export function titleOf(plan: Pick<Plan, 'name' | 'input'>): string {
  const name = plan.name.trim()
  if (name) return name

  const idea = plan.input.idea.trim().replace(/\s+/g, ' ')
  if (!idea) return 'Untitled plan'
  return idea.length > 48 ? `${idea.slice(0, 47)}…` : idea
}

/** `{project-name}-plan.md` — the filename the spec asks for. */
export function slugOf(plan: Pick<Plan, 'name' | 'input'>): string {
  const slug = titleOf(plan)
    .toLowerCase()
    .normalize('NFKD')
    // Drop the combining marks NFKD just split off, so "café" slugs as "cafe".
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return slug || 'untitled'
}

/**
 * "just now" / "4 minutes ago" for the library list.
 *
 * `Intl.RelativeTimeFormat` is missing in some older WebViews, so it is
 * feature-detected with an English fallback rather than assumed.
 */
export function relativeTime(timestamp: number, now = Date.now()): string {
  const seconds = Math.round((timestamp - now) / 1000)
  const magnitude = Math.abs(seconds)

  if (magnitude < 45) return 'just now'

  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3600],
    ['minute', 60],
  ]

  for (const [unit, size] of units) {
    if (magnitude < size) continue
    const amount = Math.round(seconds / size)

    if (typeof Intl !== 'undefined' && typeof Intl.RelativeTimeFormat === 'function') {
      try {
        return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(amount, unit)
      } catch {
        /* fall through to English */
      }
    }

    const n = Math.abs(amount)
    const plural = n === 1 ? unit : `${unit}s`
    return amount < 0 ? `${n} ${plural} ago` : `in ${n} ${plural}`
  }

  return 'just now'
}

// -- the library ------------------------------------------------------------

const STORAGE_KEY = 'cairn.library.v2'
const LEGACY_STORAGE_KEY = 'cairn.library.v1'

interface StoredLibrary {
  version: 2
  plans: Plan[]
}

/** `structuredClone` is missing in older WebViews; JSON covers this shape. */
function clone<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value)
    } catch {
      // Vue reactive proxies and older embedded WebViews can reject cloning.
      // Plans are JSON-shaped, so the fallback is safe for this storage layer.
    }
  }
  return JSON.parse(JSON.stringify(value)) as T
}

function normalizeRealityCheck(value: unknown): RealityCheckItem[] {
  if (!Array.isArray(value)) return []
  const priorities: RealityPriority[] = ['high', 'medium', 'low']

  return value.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return []
    const raw = item as Partial<RealityCheckItem>
    if (
      typeof raw.concern !== 'string' ||
      typeof raw.why !== 'string' ||
      typeof raw.fix !== 'string'
    ) return []
    const priority = priorities.includes(raw.priority as RealityPriority)
      ? (raw.priority as RealityPriority)
      : 'medium'
    return [{ priority, concern: raw.concern, why: raw.why, fix: raw.fix }]
  })
}

function normalizeBuild(value: unknown): BuildPlan {
  if (typeof value !== 'object' || value === null) return emptyBuildPlan()
  const raw = value as Partial<BuildPlan>
  if (!Array.isArray(raw.milestones)) return emptyBuildPlan()

  const milestones = raw.milestones.flatMap((item) => {
    if (typeof item !== 'object' || item === null || !Array.isArray(item.tasks)) return []
    const tasks = item.tasks.flatMap((task) => {
      if (typeof task !== 'object' || task === null || typeof task.text !== 'string') return []
      return [{
        id: typeof task.id === 'string' && task.id ? task.id : newId(),
        text: task.text,
        done: task.done === true,
      }]
    })
    return [{
      id: typeof item.id === 'string' && item.id ? item.id : newId(),
      title: typeof item.title === 'string' ? item.title : '',
      outcome: typeof item.outcome === 'string' ? item.outcome : '',
      tasks,
    }]
  })

  return {
    mvpScope: Array.isArray(raw.mvpScope)
      ? raw.mvpScope.filter((item): item is string => typeof item === 'string')
      : [],
    milestones,
    risks: Array.isArray(raw.risks)
      ? raw.risks.filter((item): item is string => typeof item === 'string')
      : [],
    acceptanceTests: Array.isArray(raw.acceptanceTests)
      ? raw.acceptanceTests.filter((item): item is string => typeof item === 'string')
      : [],
    nextAction: typeof raw.nextAction === 'string' ? raw.nextAction : '',
  }
}

function normalizePlan(value: unknown): Plan | null {
  if (typeof value !== 'object' || value === null) return null
  const plan = value as Partial<Plan>
  if (!(
    typeof plan.id === 'string' &&
    typeof plan.createdAt === 'number' &&
    typeof plan.updatedAt === 'number' &&
    typeof plan.input === 'object' &&
    plan.input !== null &&
    typeof plan.prd === 'object' &&
    plan.prd !== null &&
    Array.isArray(plan.flow)
  )) return null

  return {
    ...(clone(value) as Omit<Plan, 'build' | 'realityCheck'>),
    build: normalizeBuild(plan.build),
    realityCheck: normalizeRealityCheck(plan.realityCheck),
  }
}

/**
 * Read the whole library. Anything unparseable is dropped rather than thrown —
 * a corrupted entry must not take out the app, and a private-mode WebView can
 * throw on localStorage access at all.
 */
function read(): Plan[] {
  try {
    const current = localStorage.getItem(STORAGE_KEY)
    const raw = current ?? localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    const plans = (parsed as { plans?: unknown })?.plans
    if (!Array.isArray(plans)) return []
    const normalized = plans.flatMap((plan) => {
      const valid = normalizePlan(plan)
      return valid ? [valid] : []
    })

    // Migration is additive. Keep v1 until this v2 write succeeds, so a storage
    // failure cannot destroy the only copy of the user's work.
    if (!current && normalized.length) write(normalized)
    return normalized
  } catch {
    return []
  }
}

/** Returns false when the write failed, so callers can warn instead of lying. */
function write(plans: Plan[]): boolean {
  try {
    const payload: StoredLibrary = { version: 2, plans }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    return true
  } catch {
    return false
  }
}

/** Most recently edited first — the order the library screen shows them in. */
export function listPlans(): Plan[] {
  return read().sort((a, b) => b.updatedAt - a.updatedAt)
}

export function getPlan(id: string): Plan | null {
  return read().find((plan) => plan.id === id) ?? null
}

export function createPlan(
  input: PlanInput,
  prd: Prd,
  flow: FlowStep[],
  buildDraft: BuildPlanDraft = {
    mvpScope: [],
    milestones: [],
    risks: [],
    acceptanceTests: [],
    nextAction: '',
  },
  realityCheck: RealityCheckItem[] = [],
): Plan {
  const now = Date.now()
  return {
    id: newId(),
    name: input.name.trim(),
    createdAt: now,
    updatedAt: now,
    input: clone(input),
    prd: clone(prd),
    flow: clone(flow),
    build: materializeBuildPlan(buildDraft),
    realityCheck: clone(realityCheck),
  }
}

/**
 * Insert or replace, stamping `updatedAt`. Returns false if persistence failed
 * — the caller keeps the plan in memory either way, so the session continues.
 */
export function savePlan(plan: Plan): boolean {
  const stamped: Plan = { ...clone(plan), updatedAt: Date.now() }
  const plans = read()
  const index = plans.findIndex((existing) => existing.id === stamped.id)

  if (index === -1) plans.push(stamped)
  else plans[index] = stamped

  return write(plans)
}

export function renamePlan(id: string, name: string): Plan | null {
  const plans = read()
  const plan = plans.find((existing) => existing.id === id)
  if (!plan) return null

  plan.name = name.trim()
  plan.updatedAt = Date.now()
  write(plans)
  return clone(plan)
}

export function deletePlan(id: string): boolean {
  const plans = read()
  const remaining = plans.filter((plan) => plan.id !== id)
  if (remaining.length === plans.length) return false
  return write(remaining)
}

/**
 * True when the device will actually keep a library. Private-mode WebViews
 * refuse writes, and the library screen should say so rather than silently
 * losing the user's plans.
 */
export function libraryIsPersistent(): boolean {
  try {
    const probe = `${STORAGE_KEY}.probe`
    localStorage.setItem(probe, '1')
    localStorage.removeItem(probe)
    return true
  } catch {
    return false
  }
}
