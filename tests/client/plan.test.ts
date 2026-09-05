import assert from 'node:assert/strict'
import test from 'node:test'
import {
  listPlans,
  materializeBuildPlan,
  type BuildPlan,
  type Plan,
} from '../../src/lib/plan.ts'
import { mergeRefinement } from '../../src/lib/refinement.ts'

class MemoryStorage {
  readonly #values = new Map<string, string>()

  get length(): number {
    return this.#values.size
  }

  clear(): void {
    this.#values.clear()
  }

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null
  }

  key(index: number): string | null {
    return Array.from(this.#values.keys())[index] ?? null
  }

  removeItem(key: string): void {
    this.#values.delete(key)
  }

  setItem(key: string, value: string): void {
    this.#values.set(key, value)
  }
}

function legacyPlan(): Omit<Plan, 'build' | 'realityCheck'> {
  return {
    id: 'legacy-plan',
    name: 'Legacy idea',
    createdAt: 10,
    updatedAt: 20,
    input: { name: 'Legacy idea', idea: 'A useful idea described in enough detail for Cairn.' },
    prd: {
      summary: 'A summary',
      problem: 'A problem',
      targetUser: 'Indie builders',
      userGoal: 'Ship a focused product',
      coreFeatures: ['One feature'],
      userStories: ['One story'],
      successCriteria: ['One test'],
      assumptions: ['One assumption'],
      outOfScope: ['One exclusion'],
    },
    flow: [],
  }
}

function buildWithCompletedTask(): BuildPlan {
  return {
    mvpScope: ['Generate a useful plan'],
    milestones: [
      {
        id: 'milestone-one',
        title: 'Foundation',
        outcome: 'The core path works',
        tasks: [
          { id: 'task-done', text: 'Connect the wallet', done: true },
          { id: 'task-open', text: 'Generate the first plan', done: false },
        ],
      },
    ],
    risks: ['The first result may be too broad'],
    acceptanceTests: ['A builder gets a plan in under two minutes'],
    nextAction: 'Test one real idea',
  }
}

test('migrates a v1 library into v2 without deleting the source data', () => {
  const storage = new MemoryStorage()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  })
  storage.setItem(
    'cairn.library.v1',
    JSON.stringify({ version: 1, plans: [legacyPlan()] }),
  )

  const plans = listPlans()

  assert.equal(plans.length, 1)
  assert.deepEqual(plans[0]?.build, {
    mvpScope: [],
    milestones: [],
    risks: [],
    acceptanceTests: [],
    nextAction: '',
  })
  assert.deepEqual(plans[0]?.realityCheck, [])
  assert.ok(storage.getItem('cairn.library.v1'))
  assert.equal(JSON.parse(storage.getItem('cairn.library.v2') ?? '{}').version, 2)
})

test('preserves task identity and progress when matching text survives refinement', () => {
  const next = materializeBuildPlan(
    {
      mvpScope: ['Generate a useful plan'],
      milestones: [
        {
          title: 'First release',
          outcome: 'The core path works',
          tasks: ['  connect THE wallet  ', 'Add a useful error state'],
        },
      ],
      risks: [],
      acceptanceTests: [],
      nextAction: 'Open the app on a phone',
    },
    buildWithCompletedTask(),
  )

  assert.equal(next.milestones[0]?.tasks[0]?.id, 'task-done')
  assert.equal(next.milestones[0]?.tasks[0]?.done, true)
  assert.equal(next.milestones[0]?.tasks[1]?.done, false)
})

test('applies only proposed fields and leaves unrelated plan content intact', () => {
  const old = legacyPlan()
  const plan: Plan = {
    ...old,
    build: buildWithCompletedTask(),
    realityCheck: [],
  }

  const updated = mergeRefinement(plan, {
    build: { risks: ['Users may not understand the credit model'] },
  })

  assert.deepEqual(updated.prd, plan.prd)
  assert.deepEqual(updated.flow, plan.flow)
  assert.deepEqual(updated.build.risks, ['Users may not understand the credit model'])
  assert.equal(updated.build.milestones[0]?.tasks[0]?.done, true)
})
