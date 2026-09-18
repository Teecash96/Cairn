import assert from 'node:assert/strict'
import test from 'node:test'
import { createExamplePlan } from '../../src/lib/example.ts'
import { buildProjectReport } from '../../src/lib/report.ts'

test('drafts a progress report from tasks, evidence, blockers, team activity, and next steps', () => {
  const plan = createExamplePlan()
  const [first, second] = plan.build.milestones[0]!.tasks
  first!.status = 'done'
  first!.assignee = 'NQ00 TEST'
  first!.approvalStatus = 'approved'
  second!.dependsOn = ['unfinished-dependency']
  plan.execution.checkIns.push({ id: 'check-1', createdAt: 1, completed: 'Interviewed two users', blocker: 'Waiting for copy', changed: 'The onboarding is shorter', nextStep: 'Test the shorter route' })
  plan.execution.experiments.push({ id: 'test-1', createdAt: 1, updatedAt: 2, hypothesis: 'Users understand the first screen', method: 'Test with five users', successMetric: 'Four continue', result: 'Five continued', decision: 'continue' })

  const report = buildProjectReport(plan, 'progress')
  assert.match(report, /## Overview/)
  assert.match(report, /Interview|Five continued|Users understand the first screen/)
  assert.match(report, /Waiting for copy|unfinished|blocked/i)
  assert.match(report, /1 assigned task\(s\), 1 approved/)
  assert.match(report, /Test the shorter route/)
})

test('drafts focused validation and milestone reports without private task notes', () => {
  const plan = createExamplePlan()
  plan.build.milestones[0]!.tasks[0]!.notes = 'Private customer name'
  plan.execution.experiments.push({ id: 'test-1', createdAt: 1, updatedAt: 2, hypothesis: 'The route is useful', method: 'Run a demo', successMetric: 'One task completed', result: 'A task was completed', decision: 'continue' })

  const validation = buildProjectReport(plan, 'validation')
  const milestone = buildProjectReport(plan, 'milestone')
  assert.match(validation, /## Questions tested/)
  assert.match(validation, /A task was completed/)
  assert.match(milestone, /## Milestones/)
  assert.doesNotMatch(`${validation}\n${milestone}`, /Private customer name/)
})
