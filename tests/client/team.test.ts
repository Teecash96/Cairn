import assert from 'node:assert/strict'
import test from 'node:test'
import { hydratePublicBuild, publicTrackOf, type BuildPlan } from '../../src/lib/plan.ts'

function privateBuild(): BuildPlan {
  return {
    mvpScope: ['Private scope'],
    risks: ['Private risk'],
    acceptanceTests: ['Private test'],
    nextAction: 'Private next action',
    milestones: [{
      id: 'm1',
      title: 'Release',
      outcome: 'Ship it',
      blocked: true,
      tasks: [{
        id: 't1',
        text: 'Ship it',
        status: 'done',
        priority: 'high',
        labels: ['release'],
        notes: 'Keep private',
        dueDate: '2026-09-10',
        dependsOn: ['t0'],
      }],
    }],
  }
}

test('team projection exposes Track fields and drops private builder data', () => {
  const projection = publicTrackOf(privateBuild())
  assert.deepEqual(projection.mvpScope, [])
  assert.deepEqual(projection.risks, [])
  assert.deepEqual(projection.acceptanceTests, [])
  assert.equal(projection.nextAction, '')
  const task = projection.milestones[0]?.tasks[0]
  assert.equal(task?.status, 'done')
  assert.deepEqual(task?.labels, ['release'])
  assert.equal(task?.dueDate, '2026-09-10')
  assert.equal('priority' in (task ?? {}), false)
  assert.equal('notes' in (task ?? {}), false)
  assert.equal('dependsOn' in (task ?? {}), false)
})

test('team projection hydrates with safe local defaults', () => {
  const build = hydratePublicBuild({
    mvpScope: [],
    risks: [],
    acceptanceTests: [],
    nextAction: '',
    milestones: [{
      id: 'server-m1',
      title: 'Release',
      outcome: 'Ship it',
      blocked: false,
      tasks: [{ id: 'server-t1', text: 'Ship it', status: 'todo', labels: ['release'] }],
    }],
  })
  const task = build.milestones[0]?.tasks[0]
  assert.equal(task?.id, 'server-t1')
  assert.equal(task?.priority, 'medium')
  assert.equal(task?.notes, '')
  assert.deepEqual(task?.dependsOn, [])
})
