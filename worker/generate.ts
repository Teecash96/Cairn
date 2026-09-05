import type { Config } from './config'
import type {
  BuildPlanDraft,
  FlowStep,
  Plan,
  PlanChanges,
  PlanInput,
  Prd,
  RefineAction,
  RealityCheckItem,
} from './types'
import { clampChanges, clampPrd, requireBuild, requireFlow, requireRealityCheck } from './shape'

interface AnthropicResponse {
  content?: Array<{ type?: string; text?: string }>
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

function planJson(plan: Plan): string {
  return JSON.stringify({
    name: plan.name,
    input: plan.input,
    prd: plan.prd,
    flow: plan.flow,
    build: plan.build,
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

function refinementPrompt(plan: Plan, action: RefineAction, question?: string): string {
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

async function askAnthropic(config: Config, key: string, content: string, maxTokens: number): Promise<unknown> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: maxTokens,
      temperature: 0.2,
      system: 'You produce practical product documents. Be concise and honest.',
      messages: [{ role: 'user', content }],
    }),
  })

  if (!response.ok) throw new Error(`Anthropic returned ${response.status}.`)
  const body = (await response.json()) as AnthropicResponse
  const output = body.content?.find((item) => item.type === 'text')?.text
  if (!output) throw new Error('The model returned no plan.')
  return parseJson(output)
}

export async function generateWithAnthropic(
  config: Config,
  key: string,
  input: PlanInput,
): Promise<GeneratedPlan> {
  const parsed = await askAnthropic(config, key, prompt(input), 5000)
  if (typeof parsed !== 'object' || parsed === null) throw new Error('The model returned an invalid plan.')
  const raw = parsed as Record<string, unknown>
  return {
    prd: clampPrd(raw.prd),
    flow: requireFlow(raw.flow),
    build: requireBuild(raw.build),
    realityCheck: requireRealityCheck(raw.realityCheck),
  }
}

export async function refineWithAnthropic(
  config: Config,
  key: string,
  plan: Plan,
  action: RefineAction,
  question?: string,
): Promise<GeneratedRefinement> {
  const parsed = await askAnthropic(config, key, refinementPrompt(plan, action, question), 3200)
  if (typeof parsed !== 'object' || parsed === null) throw new Error('The model returned an invalid refinement.')
  const raw = parsed as Record<string, unknown>
  const explanation = text(raw.explanation, 500)
  if (!explanation) throw new Error('The model returned no refinement explanation.')
  const changes = clampChanges(raw.changes)
  const answer = text(raw.answer, 1200)
  return { explanation, changes, ...(answer ? { answer } : {}) }
}
