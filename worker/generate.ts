import type { Config } from './config'
import type {
  BuildPlanDraft,
  FlowStep,
  Plan,
  PlanChanges,
  PlanInput,
  PublicPlan,
  Prd,
  RefineAction,
  RealityCheckItem,
} from './types'
import { clampChanges, clampPrd, requireBuild, requireFlow, requireRealityCheck } from './shape'

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> }
  }>
  error?: { message?: string }
}

type JsonSchema = Record<string, unknown>

const GEMINI_TIMEOUT_MS = 45_000
const GEMINI_MAX_RESPONSE_BYTES = 512 * 1024

const TEXT_SCHEMA: JsonSchema = { type: 'string' }

function listSchema(maxItems?: number): JsonSchema {
  const schema: JsonSchema = { type: 'array', items: TEXT_SCHEMA }
  if (maxItems !== undefined) schema.maxItems = maxItems
  return schema
}

const PRD_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    summary: TEXT_SCHEMA,
    problem: TEXT_SCHEMA,
    targetUser: TEXT_SCHEMA,
    userGoal: TEXT_SCHEMA,
    coreFeatures: listSchema(5),
    userStories: listSchema(5),
    successCriteria: listSchema(5),
    assumptions: listSchema(5),
    outOfScope: listSchema(5),
  },
  required: ['summary', 'problem', 'targetUser', 'userGoal', 'coreFeatures', 'userStories', 'successCriteria', 'assumptions', 'outOfScope'],
  additionalProperties: false,
}

const FLOW_BRANCH_SCHEMA: JsonSchema = {
  type: 'object',
  properties: { label: TEXT_SCHEMA, result: TEXT_SCHEMA },
  required: ['label', 'result'],
  additionalProperties: false,
}

const FLOW_STEP_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['entry', 'action', 'decision', 'success', 'exit'] },
    title: TEXT_SCHEMA,
    action: TEXT_SCHEMA,
    result: TEXT_SCHEMA,
    branches: { type: 'array', items: FLOW_BRANCH_SCHEMA, minItems: 2, maxItems: 2 },
  },
  required: ['kind', 'title', 'action', 'result'],
  additionalProperties: false,
}

const BUILD_MILESTONE_SCHEMA: JsonSchema = {
  type: 'object',
  properties: { title: TEXT_SCHEMA, outcome: TEXT_SCHEMA, tasks: listSchema(6) },
  required: ['title', 'outcome', 'tasks'],
  additionalProperties: false,
}

const BUILD_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    mvpScope: listSchema(5),
    milestones: { type: 'array', items: BUILD_MILESTONE_SCHEMA, minItems: 3, maxItems: 3 },
    risks: listSchema(5),
    acceptanceTests: listSchema(5),
    nextAction: TEXT_SCHEMA,
  },
  required: ['mvpScope', 'milestones', 'risks', 'acceptanceTests', 'nextAction'],
  additionalProperties: false,
}

const REALITY_ITEM_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    priority: { type: 'string', enum: ['high', 'medium', 'low'] },
    concern: TEXT_SCHEMA,
    why: TEXT_SCHEMA,
    fix: TEXT_SCHEMA,
  },
  required: ['priority', 'concern', 'why', 'fix'],
  additionalProperties: false,
}

const PLAN_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    prd: PRD_SCHEMA,
    flow: { type: 'array', items: FLOW_STEP_SCHEMA, minItems: 5, maxItems: 8 },
    build: BUILD_SCHEMA,
    realityCheck: { type: 'array', items: REALITY_ITEM_SCHEMA, minItems: 3, maxItems: 3 },
  },
  required: ['prd', 'flow', 'build', 'realityCheck'],
  additionalProperties: false,
}

const REFINEMENT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    answer: TEXT_SCHEMA,
    explanation: TEXT_SCHEMA,
    changes: {
      type: 'object',
      properties: {
        prd: {
          type: 'object',
          properties: {
            summary: TEXT_SCHEMA,
            problem: TEXT_SCHEMA,
            targetUser: TEXT_SCHEMA,
            userGoal: TEXT_SCHEMA,
            coreFeatures: listSchema(5),
            userStories: listSchema(5),
            successCriteria: listSchema(5),
            assumptions: listSchema(5),
            outOfScope: listSchema(5),
          },
          additionalProperties: false,
        },
        flow: { type: 'array', items: FLOW_STEP_SCHEMA, minItems: 5, maxItems: 8 },
        build: {
          type: 'object',
          properties: {
            mvpScope: listSchema(5),
            milestones: { type: 'array', items: BUILD_MILESTONE_SCHEMA, minItems: 3, maxItems: 3 },
            risks: listSchema(5),
            acceptanceTests: listSchema(5),
            nextAction: TEXT_SCHEMA,
          },
          additionalProperties: false,
        },
        realityCheck: { type: 'array', items: REALITY_ITEM_SCHEMA, minItems: 1, maxItems: 3 },
      },
      additionalProperties: false,
    },
  },
  required: ['explanation', 'changes'],
  additionalProperties: false,
}

export interface GeneratedPlan {
  prd: Prd
  flow: FlowStep[]
  build: BuildPlanDraft
  realityCheck: RealityCheckItem[]
}

export interface GeneratedRefinement {
  answer?: string
  explanation: string
  changes: PlanChanges
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''
}

function prompt(input: PlanInput): string {
  return `You are Cairn, a direct product mentor for indie builders. Turn this rough idea into a practical MVP builder pack.

Rules:
1. Use only facts from the description. Do not invent market data, research, statistics, users, revenue, or integrations.
2. Make reasonable inferences explicit in assumptions. A reality check must challenge the plan, not praise it.
3. Use practical MVP planning. Do not use Scrum ceremonies, story points, sprints, or enterprise process language.
4. Keep the first release narrow. Return exactly 3 milestones and 8 to 12 total tasks.
5. Produce five to eight flow steps and exactly one decision step with exactly two branches.
6. Return only valid JSON. No markdown fences and no commentary.

Return this exact shape:
{
  "prd": {
    "summary": "string",
    "problem": "string",
    "targetUser": "string",
    "userGoal": "string",
    "coreFeatures": ["string"],
    "userStories": ["string"],
    "successCriteria": ["string"],
    "assumptions": ["string"],
    "outOfScope": ["string"]
  },
  "flow": [
    { "kind": "entry|action|decision|success|exit", "title": "string", "action": "string", "result": "string", "branches": [{"label":"string","result":"string"},{"label":"string","result":"string"}] }
  ],
  "build": {
    "mvpScope": ["3 to 5 strings"],
    "milestones": [
      { "title": "string", "outcome": "string", "tasks": ["strings"] },
      { "title": "string", "outcome": "string", "tasks": ["strings"] },
      { "title": "string", "outcome": "string", "tasks": ["strings"] }
    ],
    "risks": ["up to 5 strings"],
    "acceptanceTests": ["up to 5 observable strings"],
    "nextAction": "one small action"
  },
  "realityCheck": [
    { "priority": "high|medium|low", "concern": "string", "why": "string", "fix": "smallest test or fix" },
    { "priority": "high|medium|low", "concern": "string", "why": "string", "fix": "smallest test or fix" },
    { "priority": "high|medium|low", "concern": "string", "why": "string", "fix": "smallest test or fix" }
  ]
}

Product or feature name: ${input.name || '(not provided)'}
Idea: ${input.idea}
Target user: ${input.targetUser || '(not provided)'}
Main problem: ${input.problem || '(not provided)'}
Primary goal: ${input.goal || '(not provided)'}`
}

function planJson(plan: Plan | PublicPlan): string {
  // Tracker state belongs to the builder's device. Refinement receives the
  // builder pack text only, so private notes, dates, labels, priorities,
  // dependencies, and completion state cannot leak to Gemini or influence a
  // later AI rewrite.
  const build = {
    mvpScope: plan.build.mvpScope,
    milestones: plan.build.milestones.map((milestone) => ({
      title: milestone.title,
      outcome: milestone.outcome,
      tasks: milestone.tasks.map((task) => task.text),
    })),
    risks: plan.build.risks,
    acceptanceTests: plan.build.acceptanceTests,
    nextAction: plan.build.nextAction,
  }
  return JSON.stringify({
    name: plan.name,
    input: plan.input,
    prd: plan.prd,
    flow: plan.flow,
    build,
    realityCheck: plan.realityCheck,
  })
}

function actionInstruction(action: RefineAction, question?: string): string {
  if (action === 'cut_mvp_scope') return 'Cut the MVP to the smallest version that can prove the core outcome. Return a replacement mvpScope and, if needed, replacement milestones.'
  if (action === 'break_into_tasks') return 'Break the current milestones into smaller, observable tasks. Return replacement milestones only. Keep 8 to 12 total tasks.'
  if (action === 'find_missing_risks') return 'Find the most important untested risks. Return risks and exactly 3 realityCheck items. Do not rewrite unrelated fields.'
  if (action === 'improve_acceptance_tests') return 'Rewrite acceptance tests so they are observable and falsifiable. Return acceptanceTests only, with up to 5 items.'
  return `Answer this question directly for the builder. If a change would materially help, include only that targeted change in changes. Question: ${question ?? ''}`
}

function refinementPrompt(plan: Plan | PublicPlan, action: RefineAction, question?: string): string {
  return `You are Cairn, a direct product mentor for an indie builder. Review the current plan below and propose a targeted follow up.

Rules:
1. Use only the current plan and the question. Do not browse, research, or invent facts.
2. Return targeted changes only. Missing fields in changes mean "leave this field alone".
3. Never return task ids or done/completion flags. The client owns both.
4. Keep practical MVP planning. Do not add Scrum or enterprise process language.
5. Return only valid JSON. No markdown fences and no commentary.

Action: ${action}
${actionInstruction(action, question)}

Return this shape:
{
  "answer": "optional direct answer, especially for custom questions",
  "explanation": "one or two concise sentences",
  "changes": {
    "prd": { "optional changed PRD fields" },
    "flow": ["optional complete replacement flow"],
    "build": {
      "mvpScope": ["optional strings"],
      "milestones": [{"title":"string","outcome":"string","tasks":["strings"]}],
      "risks": ["optional strings"],
      "acceptanceTests": ["optional strings"],
      "nextAction": "optional string"
    },
    "realityCheck": [{"priority":"high|medium|low","concern":"string","why":"string","fix":"string"}]
  }
}

Current plan:
${planJson(plan)}`
}

function parseJson(value: string): unknown {
  const cleaned = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  return JSON.parse(cleaned)
}

async function askGemini(
  config: Config,
  key: string,
  content: string,
  maxTokens: number,
  schema: JsonSchema,
): Promise<unknown> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': key,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: content }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: maxTokens,
          responseMimeType: 'application/json',
          responseSchema: schema,
        },
      }),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }

  const declared = Number(response.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > GEMINI_MAX_RESPONSE_BYTES) {
    throw new Error('The model response was too large.')
  }
  const bodyText = await response.text()
  if (new TextEncoder().encode(bodyText).byteLength > GEMINI_MAX_RESPONSE_BYTES) {
    throw new Error('The model response was too large.')
  }
  const body = JSON.parse(bodyText) as GeminiResponse
  if (!response.ok) {
    const detail = body.error?.message ? `: ${body.error.message}` : ''
    throw new Error(`Gemini returned ${response.status}${detail}`)
  }
  const output = body.candidates
    ?.flatMap((candidate) => candidate.content?.parts ?? [])
    .map((part) => part.text ?? '')
    .find(Boolean)
  if (!output) throw new Error('The model returned no plan.')
  return parseJson(output)
}

export async function generateWithGemini(
  config: Config,
  key: string,
  input: PlanInput,
): Promise<GeneratedPlan> {
  const parsed = await askGemini(config, key, prompt(input), 5000, PLAN_SCHEMA)
  if (typeof parsed !== 'object' || parsed === null) throw new Error('The model returned an invalid plan.')
  const raw = parsed as Record<string, unknown>
  return {
    prd: clampPrd(raw.prd),
    flow: requireFlow(raw.flow),
    build: requireBuild(raw.build),
    realityCheck: requireRealityCheck(raw.realityCheck),
  }
}

export async function refineWithGemini(
  config: Config,
  key: string,
  plan: Plan | PublicPlan,
  action: RefineAction,
  question?: string,
): Promise<GeneratedRefinement> {
  const parsed = await askGemini(config, key, refinementPrompt(plan, action, question), 3200, REFINEMENT_SCHEMA)
  if (typeof parsed !== 'object' || parsed === null) throw new Error('The model returned an invalid refinement.')
  const raw = parsed as Record<string, unknown>
  const explanation = text(raw.explanation, 500)
  if (!explanation) throw new Error('The model returned no refinement explanation.')
  const changes = clampChanges(raw.changes)
  const answer = text(raw.answer, 1200)
  return { explanation, changes, ...(answer ? { answer } : {}) }
}
