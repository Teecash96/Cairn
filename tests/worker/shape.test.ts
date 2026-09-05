import assert from 'node:assert/strict'
import test from 'node:test'
import { clampBuild, clampChanges, requireBuild, requireFlow, requireRealityCheck } from '../../worker/shape.ts'

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

test('clamps client task objects to text for a share snapshot', () => {
  const build = clampBuild({
    ...validBuild(),
    milestones: [{ title: 'One', outcome: 'Done', tasks: [{ id: 'secret', text: 'Keep this', done: true }] }],
  })
  assert.deepEqual(build.milestones[0]?.tasks, ['Keep this'])
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
