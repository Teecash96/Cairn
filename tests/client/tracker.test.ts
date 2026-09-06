import assert from 'node:assert/strict'
import test from 'node:test'
import type { BuildPlan, Task } from '../../src/lib/plan.ts'
import { dependencyError, isOverdue, milestoneStatus, projectStats, taskIsBlocked } from '../../src/lib/tracker.ts'

function task(id: string, status: Task['status'] = 'todo', dependsOn: string[] = [], dueDate?: string): Task {
  return {
    id,
    text: id,
    status,
    priority: 'medium',
    labels: [],
    notes: '',
    dependsOn,
    ...(dueDate ? { dueDate } : {}),
  }
}

function build(): BuildPlan {
  return {
    mvpScope: [],
    milestones: [{
      id: 'm1',
      title: 'Foundation',
      outcome: 'Core path works',
      blocked: false,
      tasks: [task('first', 'done'), task('second', 'in_progress', ['first']), task('third', 'todo', ['second'], '2020-01-01')],
    }],
    risks: [],
    acceptanceTests: [],
    nextAction: '',
  }
}

test('computes progress, blockers, and overdue tasks', () => {
  const current = build()
  assert.equal(projectStats(current, '2026-09-06').progress, 33)
  assert.equal(projectStats(current, '2026-09-06').blockedTasks, 1)
  assert.equal(projectStats(current, '2026-09-06').overdueTasks, 1)
  assert.equal(taskIsBlocked(current.milestones[0]?.tasks[2] as Task, current.milestones[0]?.tasks ?? []), true)
})

test('computes milestone status from owner block and task progress', () => {
  const current = build()
  const milestone = current.milestones[0] as BuildPlan['milestones'][number]
  assert.equal(milestoneStatus(milestone), 'in_progress')
  milestone.blocked = true
  assert.equal(milestoneStatus(milestone), 'blocked')
  milestone.blocked = false
  milestone.tasks.forEach((item) => { item.status = 'done' })
  assert.equal(milestoneStatus(milestone), 'done')
})

test('rejects self dependencies and circular dependencies', () => {
  const current = build()
  assert.equal(dependencyError('first', ['first'], current), 'A task cannot depend on itself.')
  assert.equal(dependencyError('first', ['third'], current), 'Those blockers would create a circular dependency.')
})

test('validates overdue dates and ignores completed tasks', () => {
  const due = task('due', 'todo', [], '2026-09-05')
  const done = task('done', 'done', [], '2020-01-01')
  assert.equal(isOverdue(due, '2026-09-06'), true)
  assert.equal(isOverdue(done, '2026-09-06'), false)
})
