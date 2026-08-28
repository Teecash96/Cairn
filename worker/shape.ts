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
import type { FlowBranch, FlowStep, FlowStepKind, Plan, PlanInput, Prd } from './types'

/** Matches `FLOW_MIN_STEPS`/`FLOW_MAX_STEPS`/`PRD_LIST_MAX` in src/lib/plan.ts. */
export const FLOW_MIN_STEPS = 5
export const FLOW_MAX_STEPS = 8
export const PRD_LIST_MAX = 5

/** Enough for a real description; short enough not to be a free LLM endpoint. */
export const IDEA_MIN = 24
export const IDEA_MAX = 1500
const HINT_MAX = 240
const NAME_MAX = 80

const PROSE_MAX = 900
const ITEM_MAX = 260
const TITLE_MAX = 90

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

// -- a whole plan, on its way into KV ---------------------------------------

/**
 * Clamp a plan the client is asking us to store, and strip everything we have no
 * business keeping.
 *
 * A shared plan has been *hand-edited* since it was generated, so it gets the same
 * treatment as a generation. `id` and timestamps are replaced rather than trusted:
 * the stored copy is a new object with no link to the sharer's library.
 */
export function clampPlan(value: unknown, id: string, now: number): Plan | Invalid {
  if (typeof value !== 'object' || value === null) return { message: 'No plan was sent.' }
  const raw = value as Record<string, unknown>

  const input = readPlanInput(raw.input)
  if (isInvalid(input)) return input

  const flow = clampFlow(raw.flow)
  const prd = clampPrd(raw.prd)
  if (!prd.summary && flow.length === 0) {
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
    shareId: id,
  }
}
