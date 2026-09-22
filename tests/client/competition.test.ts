import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createExamplePlan } from '../../src/lib/example.ts'
import { refinementDifferences, removedRefinementTasks, mergeRefinement } from '../../src/lib/refinement.ts'
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

test('the social preview is a valid 1200 by 630 PNG', () => {
  const image = readFileSync(new URL('../../public/social-card.png', import.meta.url))
  assert.deepEqual([...image.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  assert.equal(image.readUInt32BE(16), 1200)
  assert.equal(image.readUInt32BE(20), 630)
})

test('public metadata describes the free execution product', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
  assert.match(html, /Turn a rough idea into work your team can prove, reward, and ship/)
  const viewport = html.match(/<meta\s+name="viewport"\s+content="([^"]+)"/)
  assert.ok(viewport?.[1])
  assert.doesNotMatch(viewport[1], /maximum-scale|user-scalable=no/)
  const block = html.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/)
  assert.ok(block?.[1])
  const schema = JSON.parse(block[1]) as { isAccessibleForFree?: boolean; offers?: unknown }
  assert.equal(schema.isAccessibleForFree, true)
  assert.equal(schema.offers, undefined)
})
