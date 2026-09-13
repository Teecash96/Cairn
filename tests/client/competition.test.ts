import assert from 'node:assert/strict'
import test from 'node:test'
import { createExamplePlan } from '../../src/lib/example.ts'
import { refinementDifferences, refinementImpact, removedRefinementTasks, mergeRefinement } from '../../src/lib/refinement.ts'
import { recommendedTask } from '../../src/lib/tracker.ts'
import type { PlanChanges } from '../../src/lib/plan.ts'

test('recommendations exclude blocked milestones and dependencies, prioritise ongoing work, and finish cleanly', () => {
  const { build } = createExamplePlan()
  const [first, second] = build.milestones
  first!.blocked = true
  const [blocked, ready, ongoing] = second!.tasks
  blocked!.priority = 'high'
  blocked!.dependsOn = [ready!.id]
  ongoing!.status = 'in_progress'
  assert.equal(recommendedTask(build)?.task.id, ongoing!.id)
  ongoing!.status = 'done'
  ready!.priority = 'high'
  assert.equal(recommendedTask(build)?.task.id, ready!.id)
  build.milestones.forEach((milestone) => { milestone.blocked = true })
  assert.equal(recommendedTask(build), null)
  build.milestones.forEach((milestone) => {
    milestone.blocked = false
    milestone.tasks.forEach((task) => { task.status = 'done' })
  })
  assert.equal(recommendedTask(build), null)
})

test('refinement previews warn about replaced completed tasks without mutating the original or exposing private notes', () => {
  const plan = createExamplePlan()
  const task = plan.build.milestones[0]!.tasks[0]!
  task.status = 'done'
  task.notes = 'Private interview notes'
  const original = JSON.stringify(plan)
  const changes: PlanChanges = { build: { milestones: plan.build.milestones.map((milestone, index) => ({
    title: milestone.title,
    outcome: milestone.outcome,
    tasks: milestone.tasks.map((item, taskIndex) => index === 0 && taskIndex === 0 ? 'Interview two organisers.' : item.text),
  })) } }
  const removed = removedRefinementTasks(plan, changes)
  assert.equal(removed.length, 1)
  assert.equal(removed[0]!.id, task.id)
  assert.equal(removed[0]!.status, 'done')
  const differences = refinementDifferences(plan, changes)
  assert.match(differences[0]!.after, /Interview two organisers/)
  assert.ok(!JSON.stringify(differences).includes(task.notes))
  assert.equal(JSON.stringify(plan), original)
})

test('moving an unchanged task preserves identity, progress and notes without a removal warning', () => {
  const plan = createExamplePlan()
  const task = plan.build.milestones[0]!.tasks[0]!
  task.status = 'done'
  task.notes = 'Keep this decision'
  const milestones = plan.build.milestones.map((milestone) => ({
    title: milestone.title, outcome: milestone.outcome, tasks: milestone.tasks.map((item) => item.text),
  }))
  milestones[0]!.tasks.shift()
  milestones[1]!.tasks.push(task.text)
  const changes = { build: { milestones } }
  assert.deepEqual(removedRefinementTasks(plan, changes), [])
  const updated = mergeRefinement(plan, changes)
  const moved = updated.build.milestones[1]!.tasks.find((item) => item.id === task.id)
  assert.equal(moved?.status, 'done')
  assert.equal(moved?.notes, task.notes)
})

test('unchanged proposals produce no differences and each sample has independent state', () => {
  const first = createExamplePlan()
  assert.deepEqual(refinementDifferences(first, { prd: { summary: first.prd.summary } }), [])
  first.build.milestones[0]!.tasks[0]!.status = 'done'
  const second = createExamplePlan()
  assert.notEqual(first.id, second.id)
  assert.equal(second.build.milestones[0]!.tasks[0]!.status, 'todo')
})

test('change plan impact traces one requirement across the flow, build, and tracker', () => {
  const plan = createExamplePlan()
  const completed = plan.build.milestones[1]!.tasks[0]!
  completed.status = 'done'
  completed.notes = 'Keep this implementation note private'
  const original = JSON.stringify(plan)
  const requirement = 'Guests should be able to try the app before connecting a wallet.'
  const changes: PlanChanges = {
    prd: {
      userStories: [...plan.prd.userStories, 'As a guest, I can try the app before connecting a wallet.'],
      successCriteria: [...plan.prd.successCriteria, 'A guest can try the core path before wallet connection.'],
    },
    flow: plan.flow.map((step, index) => index === 1
      ? { ...step, title: 'Try as a guest', action: requirement, result: 'The guest path is available before wallet connection.' }
      : step),
    build: {
      mvpScope: [...plan.build.mvpScope, 'A guest path before wallet connection'],
      milestones: plan.build.milestones.map((milestone, index) => index === 1
        ? { title: milestone.title, outcome: milestone.outcome, tasks: [...milestone.tasks.map((task) => task.text), 'Add guest access before wallet connection.'] }
        : { title: milestone.title, outcome: milestone.outcome, tasks: milestone.tasks.map((task) => task.text) }),
      acceptanceTests: [...plan.build.acceptanceTests, 'A guest can try the core path before connecting a wallet.'],
      nextAction: 'Test the guest path with one new user.',
    },
  }

  const impact = refinementImpact(plan, changes)
  assert.ok(impact.sections.includes('Product requirements'))
  assert.ok(impact.sections.includes('User flow'))
  assert.ok(impact.sections.includes('Build milestones and tasks'))
  assert.ok(impact.sections.includes('Acceptance tests'))
  assert.equal(impact.preservedTasks, 10)
  assert.deepEqual(impact.addedTasks.map((task) => task.text), ['Add guest access before wallet connection.'])
  assert.ok(!JSON.stringify(impact).includes(completed.notes))

  const updated = mergeRefinement(plan, changes)
  const retained = updated.build.milestones[1]!.tasks.find((task) => task.id === completed.id)
  assert.equal(retained?.status, 'done')
  assert.equal(retained?.notes, completed.notes)
  assert.equal(updated.flow[1]?.title, 'Try as a guest')
  assert.equal(updated.build.nextAction, 'Test the guest path with one new user.')
  assert.equal(JSON.stringify(plan), original)
})
