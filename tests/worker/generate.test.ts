import assert from 'node:assert/strict'
import test from 'node:test'
import { generateWithGemini } from '../../worker/generate.ts'
import type { Config } from '../../worker/config.ts'

const config: Config = {
  model: 'gemini-3.1-flash-lite',
  dailyBudget: 400,
  appUrl: 'https://cairn.example',
}

const generatedPlan = {
  prd: {
    summary: 'A focused pothole reporting path.',
    problem: 'The council cannot see which streets need attention first.',
    targetUser: 'Cyclists and council staff.',
    userGoal: 'Report a pothole and prioritize repairs.',
    coreFeatures: ['Report a pothole'],
    userStories: ['As a cyclist, I can send a report.'],
    successCriteria: ['A report appears in the ranked list.'],
    assumptions: ['Cyclists can provide a street location.'],
    outOfScope: ['Automated road repairs'],
  },
  flow: [
    { kind: 'entry', title: 'Start', action: 'Open the report form', result: 'The form is ready' },
    { kind: 'action', title: 'Describe', action: 'Add the pothole details', result: 'The report has enough context' },
    { kind: 'decision', title: 'Location', action: 'Check the street location', result: 'The report can be ranked', branches: [{ label: 'Known street', result: 'Continue' }, { label: 'Unknown street', result: 'Ask for the street' }] },
    { kind: 'action', title: 'Submit', action: 'Send the report', result: 'The report is saved' },
    { kind: 'success', title: 'Rank', action: 'Show the ranked street', result: 'The council sees the priority' },
  ],
  build: {
    mvpScope: ['Report potholes', 'Rank streets', 'Show one council view'],
    milestones: [
      { title: 'Foundation', outcome: 'A report can be created', tasks: ['Create the form', 'Validate the location', 'Save a report'] },
      { title: 'Ranking', outcome: 'Reports become a useful priority list', tasks: ['Define ranking inputs', 'Calculate street priority', 'Show the ranked list'] },
      { title: 'Proof', outcome: 'A council user can review the result', tasks: ['Add the council view', 'Test one real report'] },
    ],
    risks: ['Reports may lack reliable locations'],
    acceptanceTests: ['A cyclist can submit a report'],
    nextAction: 'Test the form with one cyclist',
  },
  realityCheck: [
    { priority: 'high', concern: 'Location data may be incomplete', why: 'Ranking depends on a usable street', fix: 'Test location capture with five reports' },
    { priority: 'medium', concern: 'The council may not trust the rank', why: 'A score without context is hard to act on', fix: 'Show the inputs behind one rank' },
    { priority: 'low', concern: 'The report path may be slow', why: 'A long form reduces participation', fix: 'Time one report from start to finish' },
  ],
}

test('retries Gemini 3 structured output as plain JSON text after a 400', async () => {
  const calls: Array<Record<string, unknown>> = []
  const previousFetch = globalThis.fetch
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body)) as Record<string, unknown>
    calls.push(payload)
    if (calls.length === 1) {
      return new Response(JSON.stringify({ error: { message: 'The structured response was rejected.' } }), { status: 400 })
    }
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(generatedPlan) }] } }] }), { status: 200 })
  }) as typeof fetch

  try {
    const result = await generateWithGemini(config, 'test-key', {
      name: 'Pothole report',
      idea: 'An app where cyclists report potholes and the council ranks streets.',
    })
    assert.equal(result.build.milestones.length, 3)
  } finally {
    globalThis.fetch = previousFetch
  }

  assert.equal(calls.length, 2)
  const firstConfig = calls[0]?.generationConfig as Record<string, unknown>
  const secondConfig = calls[1]?.generationConfig as Record<string, unknown>
  assert.ok(firstConfig.responseFormat)
  const prompt = (((calls[0]?.contents as Array<Record<string, unknown>>)?.[0]?.parts as Array<Record<string, unknown>>)?.[0]?.text as string)
  assert.match(prompt, /"task 9"/)
  const responseFormat = firstConfig.responseFormat as { text: { schema: Record<string, unknown> } }
  const planProperties = responseFormat.text.schema.properties as Record<string, Record<string, unknown>>
  const buildProperties = planProperties.build.properties as Record<string, Record<string, unknown>>
  assert.equal(buildProperties.mvpScope.minItems, 3)
  const milestoneItems = buildProperties.milestones.items as Record<string, Record<string, unknown>>
  const milestoneProperties = milestoneItems.properties as Record<string, Record<string, unknown>>
  assert.equal(milestoneProperties.tasks.minItems, 3)
  assert.equal(milestoneProperties.tasks.maxItems, 4)
  assert.equal('responseFormat' in secondConfig, false)
  assert.equal('responseMimeType' in secondConfig, false)
  assert.equal('responseSchema' in secondConfig, false)
})

test('adds Nimiq architecture guidance only for relevant projects', async () => {
  const prompts: string[] = []
  const previousFetch = globalThis.fetch
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body)) as Record<string, unknown>
    const text = (((payload.contents as Array<Record<string, unknown>>)?.[0]?.parts as Array<Record<string, unknown>>)?.[0]?.text as string)
    prompts.push(text)
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(generatedPlan) }] } }] }), { status: 200 })
  }) as typeof fetch

  try {
    await generateWithGemini(config, 'test-key', { name: 'Nimiq merchant app', idea: 'A useful wallet tool for local merchants accepting direct payments.' })
    await generateWithGemini(config, 'test-key', { name: 'Shopping list', idea: 'A voice note becomes a shopping list grouped by aisle.' })
  } finally {
    globalThis.fetch = previousFetch
  }

  assert.match(prompts[0] ?? '', /@nimiq\/mini-app-sdk/)
  assert.match(prompts[0] ?? '', /Nimiq Hub/)
  assert.doesNotMatch(prompts[1] ?? '', /@nimiq\/mini-app-sdk/)
})
