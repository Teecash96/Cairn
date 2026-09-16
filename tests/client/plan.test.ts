import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getPlan,
  exportPlanBackup,
  importPlanBackup,
  listPlans,
  materializeBuildPlan,
  savePlan,
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
          { id: 'task-done', text: 'Connect the wallet', status: 'done', priority: 'high', labels: ['setup'], notes: 'Private note', dueDate: '2026-09-10', dependsOn: [] },
          { id: 'task-open', text: 'Generate the first plan', status: 'todo', priority: 'medium', labels: [], notes: '', dependsOn: ['task-done'] },
        ],
        blocked: false,
      },
    ],
    risks: ['The first result may be too broad'],
    acceptanceTests: ['A builder gets a plan in under two minutes'],
    nextAction: 'Test one real idea',
  }
}

test('migrates a v1 library into v3 without deleting the source data', () => {
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
  assert.equal(JSON.parse(storage.getItem('cairn.library.v3') ?? '{}').version, 3)
})

test('migrates v2 done flags and fills tracker defaults', () => {
  const storage = new MemoryStorage()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
  storage.setItem('cairn.library.v2', JSON.stringify({
    version: 2,
    plans: [{
      ...legacyPlan(),
      build: {
        mvpScope: [],
        milestones: [{
          id: 'old-milestone',
          title: 'Foundation',
          outcome: 'The core path works',
          tasks: [{ id: 'old-task', text: 'Connect the wallet', done: true }],
        }],
        risks: [], acceptanceTests: [], nextAction: '',
      },
      realityCheck: [],
    }],
  }))

  const plan = listPlans()[0]
  const task = plan?.build.milestones[0]?.tasks[0]
  assert.equal(task?.status, 'done')
  assert.equal(task?.priority, 'medium')
  assert.deepEqual(task?.labels, [])
  assert.deepEqual(task?.dependsOn, [])
  assert.equal(plan?.build.milestones[0]?.blocked, false)
})

test('normalizes tracker fields before saving them', () => {
  const storage = new MemoryStorage()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
  const plan: Plan = {
    ...legacyPlan(),
    build: {
      ...buildWithCompletedTask(),
      milestones: [{
        ...buildWithCompletedTask().milestones[0]!,
        startDate: '2026-02-30',
        dueDate: '2026-09-12',
        tasks: [{
          ...buildWithCompletedTask().milestones[0]!.tasks[0]!,
          dueDate: 'not-a-date',
          labels: ['one', 'two', 'three', 'four'],
          dependsOn: ['missing-task'],
        }],
      }],
    },
    realityCheck: [],
  }

  assert.equal(savePlan(plan), true)
  const saved = getPlan(plan.id)
  const milestone = saved?.build.milestones[0]
  const task = milestone?.tasks[0]
  assert.equal(milestone?.startDate, undefined)
  assert.equal(milestone?.dueDate, '2026-09-12')
  assert.equal(task?.dueDate, undefined)
  assert.deepEqual(task?.labels, ['one', 'two', 'three'])
  assert.deepEqual(task?.dependsOn, [])
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
  assert.equal(next.milestones[0]?.tasks[0]?.status, 'done')
  assert.equal(next.milestones[0]?.tasks[1]?.status, 'todo')
  assert.deepEqual(next.milestones[0]?.tasks[1]?.dependsOn, [])
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
  assert.equal(updated.build.milestones[0]?.tasks[0]?.status, 'done')
})

test('preserves tracker metadata and drops dependencies to removed tasks during refinement', () => {
  const old: BuildPlan = {
    ...buildWithCompletedTask(),
    milestones: [{
      id: 'm1',
      title: 'Foundation',
      outcome: 'Core path works',
      blocked: true,
      startDate: '2026-09-01',
      dueDate: '2026-09-12',
      tasks: [
        { id: 'task-done', text: 'Connect the wallet', status: 'done', priority: 'high', labels: ['setup'], notes: 'Keep this private', dueDate: '2026-09-04', dependsOn: [] },
        { id: 'task-open', text: 'Generate the first plan', status: 'in_progress', priority: 'low', labels: ['ai'], notes: 'Watch the response', dependsOn: ['task-done'] },
      ],
    }],
  }
  const next = materializeBuildPlan({
    mvpScope: [],
    milestones: [{ title: 'Foundation', outcome: 'Core path works', tasks: ['Connect the wallet', 'Generate the first plan'] }],
    risks: [], acceptanceTests: [], nextAction: '',
  }, old)
  const retained = next.milestones[0]
  assert.equal(retained?.blocked, true)
  assert.equal(retained?.startDate, '2026-09-01')
  assert.equal(retained?.tasks[0]?.priority, 'high')
  assert.deepEqual(retained?.tasks[0]?.labels, ['setup'])
  assert.equal(retained?.tasks[0]?.notes, 'Keep this private')
  assert.equal(retained?.tasks[1]?.status, 'in_progress')
  assert.deepEqual(retained?.tasks[1]?.dependsOn, ['task-done'])

  const removed = materializeBuildPlan({
    mvpScope: [],
    milestones: [{ title: 'Foundation', outcome: 'Core path works', tasks: ['Generate the first plan'] }],
    risks: [], acceptanceTests: [], nextAction: '',
  }, old)
  assert.deepEqual(removed.milestones[0]?.tasks[0]?.dependsOn, [])
})


test('a same-shape refinement keeps task identity when task wording changes', () => {
  const previous: BuildPlan = {
    mvpScope: ['Core'],
    milestones: [{
      id: 'milestone-1',
      title: 'Launch',
      outcome: 'Ready',
      blocked: false,
      tasks: [{
        id: 'task-1',
        text: 'Publish the first version',
        status: 'in_progress',
        priority: 'high',
        labels: ['release'],
        notes: 'Keep rollout notes',
        dueDate: '2026-09-30',
        dependsOn: [],
      }],
    }],
    risks: [],
    acceptanceTests: [],
    nextAction: 'Publish',
  }

  const next = materializeBuildPlan({
    mvpScope: ['Core'],
    milestones: [{
      title: 'Launch',
      outcome: 'Ready',
      tasks: ['Publish the first production version'],
    }],
    risks: [],
    acceptanceTests: [],
    nextAction: 'Publish',
  }, previous)

  assert.equal(next.milestones[0]?.tasks[0]?.id, 'task-1')
  assert.equal(next.milestones[0]?.tasks[0]?.status, 'in_progress')
  assert.equal(next.milestones[0]?.tasks[0]?.notes, 'Keep rollout notes')
  assert.equal(next.milestones[0]?.tasks[0]?.dueDate, '2026-09-30')
})

test('an explicit refinement task id preserves progress when the wording changes', () => {
  const previous: BuildPlan = {
    mvpScope: ['Core'],
    milestones: [{
      id: 'milestone-1',
      title: 'Launch',
      outcome: 'Ready',
      blocked: false,
      tasks: [{
        id: 'task-1',
        text: 'Publish the first version',
        status: 'done',
        priority: 'high',
        labels: ['release'],
        notes: 'Keep rollout notes',
        dueDate: '2026-09-30',
        dependsOn: [],
      }],
    }],
    risks: [],
    acceptanceTests: [],
    nextAction: 'Publish',
  }

  const next = materializeBuildPlan({
    mvpScope: ['Core'],
    milestones: [{
      title: 'Launch',
      outcome: 'Ready',
      tasks: [{ id: 'task-1', text: 'Publish the first production version' }],
    }],
    risks: [],
    acceptanceTests: [],
    nextAction: 'Publish',
  }, previous)

  const task = next.milestones[0]?.tasks[0]
  assert.equal(task?.id, 'task-1')
  assert.equal(task?.text, 'Publish the first production version')
  assert.equal(task?.status, 'done')
  assert.equal(task?.notes, 'Keep rollout notes')
  assert.equal(task?.dueDate, '2026-09-30')
})

test('rejects unknown and duplicate refinement task references', () => {
  const previous = buildWithCompletedTask()
  assert.throws(() => materializeBuildPlan({
    mvpScope: [],
    milestones: [{
      title: 'Foundation',
      outcome: 'The core path works',
      tasks: [{ id: 'missing-task', text: 'A replacement' }],
    }],
    risks: [],
    acceptanceTests: [],
    nextAction: '',
  }, previous), /unknown task/)

  assert.throws(() => materializeBuildPlan({
    mvpScope: [],
    milestones: [{
      title: 'Foundation',
      outcome: 'The core path works',
      tasks: [{ id: 'task-done', text: 'First copy' }, { id: 'task-done', text: 'Second copy' }],
    }],
    risks: [],
    acceptanceTests: [],
    nextAction: '',
  }, previous), /same task more than once/)
})

test('exports and restores a route without inheriting share or team control', () => {
  const original: Plan = {
    ...legacyPlan(),
    shareId: 'public-share',
    teamId: 'abcdefghijklmnop',
    build: buildWithCompletedTask(),
    realityCheck: [],
  }
  original.build.milestones[0]!.tasks[0]!.reward = {
    recipient: 'NQ01AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    amountLuna: 100_000,
    transactionHash: 'ab'.repeat(32),
    createdAt: 123,
  }

  const restored = importPlanBackup(JSON.stringify(exportPlanBackup(original)))
  assert.ok(restored)
  assert.notEqual(restored?.id, original.id)
  assert.equal(restored?.shareId, undefined)
  assert.equal(restored?.teamId, undefined)
  assert.equal(restored?.build.milestones[0]?.tasks[0]?.reward?.transactionHash, 'ab'.repeat(32))
  assert.equal(importPlanBackup('{broken'), null)
})
