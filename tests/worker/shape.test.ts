import assert from 'node:assert/strict'
import test from 'node:test'
import { clampBuild, clampChanges, clampPlan, requireBuild, requireFlow, requireRealityCheck } from '../../worker/shape.ts'

function validBuild() {
  return {
    mvpScope: ['One outcome', 'One path', 'One proof'],
    milestones: [
      { title: 'Foundation', outcome: 'The core path exists', tasks: ['Write the path', 'Try the path', 'Fix confusion'] },
      { title: 'Dependability', outcome: 'The path handles errors', tasks: ['Handle empty input', 'Add an error state', 'Write a test'] },
      { title: 'Learning', outcome: 'The next decision has evidence', tasks: ['Release to users', 'Watch one signal'] },
    ],
    risks: ['The scope is too broad'],
    acceptanceTests: ['A user reaches the result'],
    nextAction: 'Test the path with one person',
  }
}

test('accepts a complete builder pack and enforces its limits', () => {
  const build = requireBuild(validBuild())
  assert.equal(build.milestones.length, 3)
  assert.equal(build.milestones.reduce((sum, milestone) => sum + milestone.tasks.length, 0), 8)
  assert.throws(() => requireBuild({ ...validBuild(), milestones: validBuild().milestones.slice(0, 2) }))
})

test('clamps refinement task objects while preserving their stable id', () => {
  const build = clampBuild({
    ...validBuild(),
    milestones: [{ title: 'One', outcome: 'Done', tasks: [{ id: 'secret', text: 'Keep this', done: true }] }],
  })
  assert.deepEqual(build.milestones[0]?.tasks, [{ id: 'secret', text: 'Keep this' }])
})

test('returns only valid targeted refinement fields', () => {
  const changes = clampChanges({
    build: {
      risks: ['A real risk'],
      nonsense: 'must be dropped',
    },
    explanation: 'ignored here',
  })
  assert.deepEqual(changes, { build: { risks: ['A real risk'] } })
})

test('rejects malformed flow patches instead of weakening the diagram contract', () => {
  const changes = clampChanges({
    flow: [
      { kind: 'entry', title: 'Start', action: 'Open the app', result: 'The brief is visible' },
    ],
  })
  assert.deepEqual(changes, {})

  assert.throws(() => requireFlow([]))
})

test('requires exactly three complete reality check items', () => {
  const item = { priority: 'high', concern: 'A concern', why: 'A reason', fix: 'A test' }
  assert.equal(requireRealityCheck([item, item, item]).length, 3)
  assert.throws(() => requireRealityCheck([item]))
})

test('shared snapshots retain public tracker fields and strip private fields', () => {
  const result = clampPlan({
    input: { idea: 'A useful idea described in enough detail for Cairn.' },
    prd: { summary: 'A summary' },
    flow: [],
    build: {
      mvpScope: ['One outcome'],
      milestones: [{
        title: 'Foundation',
        outcome: 'Core path works',
        startDate: '2026-09-01',
        dueDate: '2026-09-12',
        blocked: true,
        tasks: [{
          text: 'Connect the wallet',
          status: 'done',
          priority: 'high',
          labels: ['setup', 'wallet'],
          notes: 'Do not publish this',
          dueDate: '2026-09-05',
          dependsOn: ['other-task'],
        }],
      }],
    },
  }, 'share-1', 100)

  assert.ok(!('message' in result))
  if ('message' in result) return
  const shared = result.build.milestones[0]
  const sharedTask = shared?.tasks[0]
  assert.equal(shared?.blocked, true)
  assert.equal(shared?.startDate, '2026-09-01')
  assert.equal(sharedTask?.status, 'done')
  assert.deepEqual(sharedTask?.labels, ['setup', 'wallet'])
  assert.equal(sharedTask?.dueDate, '2026-09-05')
  assert.equal('notes' in (sharedTask ?? {}), false)
  assert.equal('priority' in (sharedTask ?? {}), false)
  assert.equal('dependsOn' in (sharedTask ?? {}), false)
})

test('shared snapshots keep owner added milestones within the public cap', () => {
  const result = clampPlan({
    input: { idea: 'A useful idea described in enough detail for Cairn.' },
    prd: { summary: 'A summary' },
    flow: [],
    build: {
      milestones: Array.from({ length: 4 }, (_, index) => ({
        title: `Milestone ${index + 1}`,
        outcome: 'A useful outcome',
        tasks: [{ text: `Task ${index + 1}`, status: 'todo', labels: [] }],
      })),
    },
  }, 'share-2', 100)

  assert.ok(!('message' in result))
  if ('message' in result) return
  assert.equal(result.build.milestones.length, 4)
})
