import type { Config } from './config'
import type { FlowStep, PlanInput, Prd } from './types'
import { clampFlow, clampPrd } from './shape'

interface AnthropicResponse {
  content?: Array<{ type?: string; text?: string }>
}

export interface GeneratedPlan {
  prd: Prd
  flow: FlowStep[]
}

function prompt(input: PlanInput): string {
  return `You are a senior product manager. Turn this rough product idea into a concise, honest PRD and a user flow.

Rules:
1. Use only facts from the description. Do not invent market data, research, statistics, users, or integrations.
2. Label reasonable inferences as assumptions.
3. Keep each list to at most five items.
4. Produce five to eight flow steps and exactly one decision step with exactly two branches.
5. Return only valid JSON. No markdown fences and no commentary.

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
  ]
}

Product or feature name: ${input.name || '(not provided)'}
Idea: ${input.idea}
Target user: ${input.targetUser || '(not provided)'}
Main problem: ${input.problem || '(not provided)'}
Primary goal: ${input.goal || '(not provided)'}`
}

function parseJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  return JSON.parse(cleaned)
}

export async function generateWithAnthropic(
  config: Config,
  key: string,
  input: PlanInput,
): Promise<GeneratedPlan> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 3500,
      temperature: 0.2,
      system: 'You produce practical product documents. Be concise and honest.',
      messages: [{ role: 'user', content: prompt(input) }],
    }),
  })

  if (!response.ok) throw new Error(`Anthropic returned ${response.status}.`)
  const body = (await response.json()) as AnthropicResponse
  const text = body.content?.find((item) => item.type === 'text')?.text
  if (!text) throw new Error('The model returned no plan.')
  const parsed = parseJson(text)
  if (typeof parsed !== 'object' || parsed === null) throw new Error('The model returned an invalid plan.')
  const raw = parsed as Record<string, unknown>
  return { prd: clampPrd(raw.prd), flow: clampFlow(raw.flow) }
}

