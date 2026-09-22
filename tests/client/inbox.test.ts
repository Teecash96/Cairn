import assert from 'node:assert/strict'
import test from 'node:test'
import { createExamplePlan } from '../../src/lib/example.ts'
import { buildWalletInbox } from '../../src/lib/inbox.ts'
import { publicTrackOf } from '../../src/lib/plan.ts'
import type { TeamInboxTeam } from '../../src/lib/api.ts'

const wallet = 'NQ00 WALLET MEMBER'
const teammate = 'NQ11 TEAM MEMBER'

function teamFrom(
  plan: ReturnType<typeof createExamplePlan>,
  teamId: string,
  role: TeamInboxTeam['role'],
  activity: TeamInboxTeam['activity'] = [],
): TeamInboxTeam {
  return {
    teamId,
    planId: plan.id,
    name: plan.name || plan.input.name,
    role,
    updatedAt: 1_800_000_000_000,
    build: publicTrackOf(plan.build),
    activity,
  }
}

test('combines local next moves with wallet assignments, reviews, rewards, blockers, and activity', () => {
  const personal = createExamplePlan()
  personal.name = 'Personal launch'
  personal.build.milestones[0]!.tasks[0]!.dueDate = '2026-09-20'

  const editorPlan = createExamplePlan()
  editorPlan.name = 'Editor route'
  const editorTasks = editorPlan.build.milestones[0]!.tasks
  Object.assign(editorTasks[0]!, { assignee: wallet, status: 'in_progress' })
  Object.assign(editorTasks[1]!, {
    assignee: wallet,
    status: 'done',
    approvalStatus: 'approved',
    reward: { recipient: wallet, amountLuna: 125_000, transactionHash: 'reward-hash', createdAt: 200 },
  })

  const ownerPlan = createExamplePlan()
  ownerPlan.name = 'Owner route'
  ownerPlan.build.milestones[1]!.blocked = true
  const ownerTasks = ownerPlan.build.milestones[0]!.tasks
  Object.assign(ownerTasks[0]!, { assignee: teammate, status: 'done', approvalStatus: 'pending' })
  Object.assign(ownerTasks[1]!, { assignee: teammate, status: 'done', approvalStatus: 'approved' })

  const teams = [
    teamFrom(editorPlan, 'team-editor', 'editor', [{
      id: 'activity-old', address: teammate, action: 'assigned', taskText: editorTasks[0]!.text, createdAt: 100,
    }]),
    teamFrom(ownerPlan, 'team-owner', 'owner', [{
      id: 'activity-new', address: wallet, action: 'approved', taskText: ownerTasks[1]!.text, createdAt: 300,
    }]),
  ]

  const inbox = buildWalletInbox([personal, ownerPlan], teams, wallet, '2026-09-22')

  assert.equal(inbox.myWork.length, 3)
  assert.equal(inbox.myWork[0]?.routeName, 'Personal launch')
  assert.equal(inbox.myWork.some((item) => item.target.kind === 'team' && item.target.id === 'team-editor'), true)
  assert.equal(inbox.approvals.length, 1)
  assert.equal(inbox.approvals[0]?.target.id, 'team-owner')
  assert.equal(inbox.rewardsToSend.length, 1)
  assert.equal(inbox.rewardsReceived[0]?.amountLuna, 125_000)
  assert.equal(inbox.blocked.length, 1, 'owner Track is not duplicated by the local plan snapshot')
  assert.equal(inbox.activity[0]?.actorIsWallet, true)
  assert.equal(inbox.activity[0]?.id, 'activity-new')
})

test('returns no wallet actions until an identity is connected', () => {
  const plan = createExamplePlan()
  const inbox = buildWalletInbox([plan], [], null)
  assert.deepEqual(inbox, {
    myWork: [], approvals: [], rewardsToSend: [], rewardsReceived: [], blocked: [], activity: [],
  })
})
