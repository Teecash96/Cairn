import assert from 'node:assert/strict'
import test from 'node:test'
import worker from '../../worker/index.ts'
import { addMember, createTeam, deleteTeam, getTeam, listTeams, recordReward, removeMember, TeamCoordinator, TeamError, updateMember, updateTeamTask, updateTracker } from '../../worker/team.ts'
import { addressFromPublicKey } from '../../worker/http.ts'
import type { Env, TeamRecord } from '../../worker/types.ts'

class MemoryKV {
  readonly values = new Map<string, string>()

  async get<T = unknown>(key: string, type?: 'json'): Promise<T | string | null> {
    const value = this.values.get(key)
    if (value === undefined) return null
    return type === 'json' ? JSON.parse(value) as T : value
  }

  async put(key: string, value: string): Promise<void> {
    this.values.set(key, value)
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key)
  }
}

class MemoryDurableObjectStorage {
  readonly values = new Map<string, unknown>()
  private tail: Promise<void> = Promise.resolve()

  async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined
  }

  async put<T = unknown>(key: string, value: T): Promise<void> {
    this.values.set(key, value)
  }

  async transaction<T>(closure: (transaction: DurableObjectTransaction) => Promise<T>): Promise<T> {
    const previous = this.tail
    let release: (() => void) | undefined
    this.tail = new Promise<void>((resolve) => { release = resolve })
    await previous

    const pending = new Map(this.values)
    try {
      const transaction = {
        get: async <V = unknown>(key: string): Promise<V | undefined> => pending.get(key) as V | undefined,
        put: async <V = unknown>(key: string, value: V): Promise<void> => { pending.set(key, value) },
        rollback: () => { throw new Error('transaction rolled back') },
      } as unknown as DurableObjectTransaction
      const result = await closure(transaction)
      this.values.clear()
      for (const [key, value] of pending) this.values.set(key, value)
      return result
    } finally {
      release?.()
    }
  }
}

function durableState(storage: MemoryDurableObjectStorage): DurableObjectState {
  return {
    storage: storage as unknown as DurableObjectStorage,
    blockConcurrencyWhile: async <T>(callback: () => Promise<T>): Promise<T> => callback(),
  } as unknown as DurableObjectState
}

function env(kv: MemoryKV): Env {
  return { CAIRN: kv as unknown as KVNamespace } as Env
}

function address(seed: number): string {
  return addressFromPublicKey(seed.toString(16).padStart(2, '0').repeat(32)) ?? ''
}

function build() {
  return {
    mvpScope: ['Private scope must not be exposed'],
    risks: ['Private risk must not be exposed'],
    acceptanceTests: ['Private acceptance test must not be exposed'],
    nextAction: 'Private next action must not be exposed',
    milestones: [{
      title: 'First release',
      outcome: 'A useful release is ready',
      startDate: '2026-09-01',
      dueDate: '2026-09-12',
      blocked: true,
      tasks: [{
        id: 'private-task-id',
        text: 'Ship the first release',
        status: 'in_progress',
        priority: 'high',
        labels: ['release'],
        notes: 'Private note must not be exposed',
        dueDate: '2026-09-10',
        dependsOn: ['another-private-task'],
      }],
    }],
  }
}


test('discovers current teams for each signed wallet', async () => {
  const kv = new MemoryKV()
  const testEnv = env(kv)
  const owner = address(20)
  const member = address(21)
  const created = await createTeam(testEnv, owner, {
    planId: 'discoverable-plan', name: 'Discovered team', build: build(),
  }, 'https://cairn.example')

  const ownerTeams = await listTeams(testEnv, owner, 'https://cairn.example')
  assert.deepEqual(ownerTeams.map((team) => team.teamId), [created.teamId])
  assert.equal(ownerTeams[0]?.planId, 'discoverable-plan')
  assert.equal(ownerTeams[0]?.role, 'owner')
  assert.equal(ownerTeams[0]?.build.milestones[0]?.tasks[0]?.text, 'Ship the first release')
  assert.equal('notes' in (ownerTeams[0]?.build.milestones[0]?.tasks[0] ?? {}), false)
  assert.deepEqual(ownerTeams[0]?.activity, [])
  await addMember(testEnv, created.teamId, owner, member, 'editor', 'https://cairn.example')
  assert.deepEqual((await listTeams(testEnv, member, 'https://cairn.example')).map((team) => team.name), ['Discovered team'])

  await removeMember(testEnv, created.teamId, owner, member, 'https://cairn.example')
  assert.deepEqual(await listTeams(testEnv, member, 'https://cairn.example'), [])
})

test('creates a protected team with a Track only projection', async () => {
  const kv = new MemoryKV()
  const owner = address(0)
  const result = await createTeam(env(kv), owner, {
    planId: 'plan-123',
    name: 'Launch team',
    build: build(),
  }, 'https://cairn.example')

  assert.ok(owner)
  assert.equal(result.role, 'owner')
  assert.equal(result.revision, 1)
  assert.match(result.inviteUrl, new RegExp(`https://cairn\\.example/\\?t=${result.teamId}`))
  assert.deepEqual(result.build.mvpScope, [])
  assert.deepEqual(result.build.risks, [])
  assert.deepEqual(result.build.acceptanceTests, [])
  assert.equal(result.build.nextAction, '')

  const task = result.build.milestones[0]?.tasks[0]
  assert.equal(task?.status, 'in_progress')
  assert.deepEqual(task?.labels, ['release'])
  assert.equal(task?.dueDate, '2026-09-10')
  assert.equal('priority' in (task ?? {}), false)
  assert.equal('notes' in (task ?? {}), false)
  assert.equal('dependsOn' in (task ?? {}), false)
})

test('owner controls roles and editors can change Track only', async () => {
  const kv = new MemoryKV()
  const owner = address(0)
  const viewer = address(1)
  const editor = address(2)
  const created = await createTeam(env(kv), owner, {
    planId: 'plan-roles',
    name: 'Roles',
    build: build(),
  }, 'https://cairn.example')

  const withViewer = await addMember(env(kv), created.teamId, owner, viewer, 'viewer', 'https://cairn.example')
  assert.equal(withViewer.members[0]?.role, 'viewer')
  assert.equal((await getTeam(env(kv), created.teamId, viewer, 'https://cairn.example')).role, 'viewer')

  await assert.rejects(
    () => updateTracker(env(kv), created.teamId, viewer, build(), withViewer.revision, 'https://cairn.example'),
    (error: unknown) => error instanceof TeamError && error.code === 'forbidden',
  )

  const withEditor = await updateMember(env(kv), created.teamId, owner, viewer, 'editor', 'https://cairn.example')
  assert.equal(withEditor.members[0]?.role, 'editor')
  const withSecondMember = await addMember(env(kv), created.teamId, owner, editor, 'viewer', 'https://cairn.example')
  assert.equal(withSecondMember.revision, withEditor.revision + 1)

  const updated = await updateTracker(env(kv), created.teamId, viewer, {
    milestones: [{
      title: 'First release',
      outcome: 'A useful release is ready',
      tasks: [{ text: 'Ship the first release', status: 'done', labels: ['shipped'], notes: 'discard', priority: 'high', dependsOn: [] }],
    }],
    mvpScope: ['must stay private'],
  }, withSecondMember.revision, 'https://cairn.example')
  assert.equal(updated.revision, withSecondMember.revision + 1)
  assert.equal(updated.build.milestones[0]?.tasks[0]?.status, 'done')
  assert.deepEqual(updated.build.milestones[0]?.tasks[0]?.labels, ['shipped'])
  assert.deepEqual(updated.build.mvpScope, [])

  await assert.rejects(
    () => updateTracker(env(kv), created.teamId, viewer, build(), withSecondMember.revision, 'https://cairn.example'),
    (error: unknown) => error instanceof TeamError && error.code === 'conflict',
  )
  await assert.rejects(
    () => addMember(env(kv), created.teamId, viewer, address(3), 'viewer', 'https://cairn.example'),
    (error: unknown) => error instanceof TeamError && error.code === 'forbidden',
  )
})

test('duplicate, owner, and removed member access are rejected', async () => {
  const kv = new MemoryKV()
  const owner = address(0)
  const member = address(1)
  const created = await createTeam(env(kv), owner, {
    planId: 'plan-members',
    name: 'Members',
    build: build(),
  }, 'https://cairn.example')

  await assert.rejects(
    () => addMember(env(kv), created.teamId, owner, owner, 'viewer', 'https://cairn.example'),
    (error: unknown) => error instanceof TeamError && error.code === 'invalid_request',
  )
  await addMember(env(kv), created.teamId, owner, member, 'viewer', 'https://cairn.example')
  await assert.rejects(
    () => addMember(env(kv), created.teamId, owner, member, 'editor', 'https://cairn.example'),
    (error: unknown) => error instanceof TeamError && error.code === 'conflict',
  )

  await removeMember(env(kv), created.teamId, owner, member, 'https://cairn.example')
  await assert.rejects(
    () => getTeam(env(kv), created.teamId, member, 'https://cairn.example'),
    (error: unknown) => error instanceof TeamError && error.code === 'forbidden',
  )
})

test('team routes require a wallet session before checking membership', async () => {
  const kv = new MemoryKV()
  const owner = address(0)
  const created = await createTeam(env(kv), owner, {
    planId: 'plan-route-auth',
    name: 'Route auth',
    build: build(),
  }, 'https://cairn.example')

  const missing = await worker.fetch(new Request(`https://cairn.example/api/team/${created.teamId}`), env(kv))
  assert.equal(missing.status, 401)

  const sessionToken = 'sessiontoken'.repeat(4)
  await kv.put(`auth:session:${sessionToken}`, JSON.stringify({
    address: owner,
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  }))
  const response = await worker.fetch(new Request(`https://cairn.example/api/team/${created.teamId}`, {
    headers: { authorization: `Bearer ${sessionToken}` },
  }), env(kv))
  assert.equal(response.status, 200)
  assert.equal((await response.json() as { role: string }).role, 'owner')
})


test('the coordinator accepts only one concurrent update for a revision', async () => {
  const kv = new MemoryKV()
  const testEnv = env(kv)
  const owner = address(9)
  const created = await createTeam(testEnv, owner, {
    planId: 'concurrent-plan',
    name: 'Concurrent team',
    build: build(),
  }, 'https://cairn.example')
  const storage = new MemoryDurableObjectStorage()
  const coordinator = new TeamCoordinator(durableState(storage), testEnv)

  const command = (text: string) => {
    const candidate = build()
    candidate.milestones[0]!.tasks[0]!.text = text
    return new Request('https://team.internal/', {
      method: 'POST',
      body: JSON.stringify({
        action: 'update-tracker',
        teamId: created.teamId,
        address: owner,
        build: candidate,
        revision: 1,
        appUrl: 'https://cairn.example',
      }),
    })
  }
  const responses = await Promise.all([
    coordinator.fetch(command('First edit')),
    coordinator.fetch(command('Second edit')),
  ])

  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409])
  const stored = await storage.get<TeamRecord>('team-record')
  assert.equal(stored?.revision, 2)
  assert.equal(stored?.build.milestones[0]?.tasks[0]?.text === 'First edit' || stored?.build.milestones[0]?.tasks[0]?.text === 'Second edit', true)
})

test('membership changes use the same transaction and reject one competing add', async () => {
  const kv = new MemoryKV()
  const testEnv = env(kv)
  const owner = address(10)
  const member = address(11)
  const created = await createTeam(testEnv, owner, {
    planId: 'concurrent-members',
    name: 'Concurrent members',
    build: build(),
  }, 'https://cairn.example')
  const storage = new MemoryDurableObjectStorage()
  const coordinator = new TeamCoordinator(durableState(storage), testEnv)
  const command = (memberRole: 'viewer' | 'editor') => new Request('https://team.internal/', {
    method: 'POST',
    body: JSON.stringify({
      action: 'add',
      teamId: created.teamId,
      owner,
      member,
      role: memberRole,
      appUrl: 'https://cairn.example',
    }),
  })

  const responses = await Promise.all([
    coordinator.fetch(command('viewer')),
    coordinator.fetch(command('editor')),
  ])

  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409])
  const stored = await storage.get<TeamRecord>('team-record')
  assert.equal(stored?.revision, 2)
  assert.equal(stored?.members.length, 1)
})

test('records a verified reward once and preserves it across tracker edits', async () => {
  const kv = new MemoryKV()
  const testEnv = env(kv)
  const owner = address(20)
  const member = address(21)
  const created = await createTeam(testEnv, owner, {
    planId: 'reward-plan', name: 'Reward team', build: build(),
  }, 'https://cairn.example')
  const joined = await addMember(testEnv, created.teamId, owner, member, 'editor', 'https://cairn.example')
  const taskId = joined.build.milestones[0]!.tasks[0]!.id
  const assigned = await updateTeamTask(testEnv, created.teamId, owner, taskId, 'assign', { assignee: member }, 'https://cairn.example')
  const submitted = await updateTeamTask(testEnv, created.teamId, member, taskId, 'submit', { note: 'Proof: https://example.com/work' }, 'https://cairn.example')
  assert.equal(submitted.build.milestones[0]!.tasks[0]!.approvalStatus, 'pending')
  await assert.rejects(
    () => updateTeamTask(testEnv, created.teamId, address(99), taskId, 'submit', { note: 'Not my work' }, 'https://cairn.example'),
    (error: unknown) => error instanceof TeamError && error.code === 'forbidden',
  )
  const completed = await updateTeamTask(testEnv, created.teamId, owner, taskId, 'approve', {}, 'https://cairn.example')
  assert.equal(completed.build.milestones[0]!.tasks[0]!.status, 'done')
  assert.equal(completed.build.milestones[0]!.tasks[0]!.approvalStatus, 'approved')
  assert.deepEqual(completed.activity.slice(-3).map((entry) => entry.action), ['assigned', 'submitted', 'approved'])
  const rewarded = await recordReward(testEnv, created.teamId, owner, {
    taskId, recipient: member, amountLuna: 100_000, transactionHash: 'ab'.repeat(32), revision: completed.revision,
  }, 'https://cairn.example')

  assert.equal(rewarded.build.milestones[0]!.tasks[0]!.reward?.amountLuna, 100_000)
  await assert.rejects(
    () => recordReward(testEnv, created.teamId, owner, {
      taskId, recipient: member, amountLuna: 100_000, transactionHash: 'cd'.repeat(32), revision: rewarded.revision,
    }, 'https://cairn.example'),
    (error: unknown) => error instanceof TeamError && error.code === 'conflict',
  )

  const edited = build()
  edited.milestones[0]!.tasks[0]!.status = 'done'
  const afterEdit = await updateTracker(testEnv, created.teamId, member, edited, rewarded.revision, 'https://cairn.example')
  assert.equal(afterEdit.build.milestones[0]!.tasks[0]!.reward?.transactionHash, 'ab'.repeat(32))
  assert.equal(afterEdit.build.milestones[0]!.tasks[0]!.status, 'done')

  await assert.rejects(
    () => updateTracker(testEnv, created.teamId, member, {
      ...edited,
      milestones: [{ ...edited.milestones[0]!, tasks: [] }],
    }, afterEdit.revision, 'https://cairn.example'),
    (error: unknown) => error instanceof TeamError && error.code === 'conflict',
  )
})

test('assigns work only to Editors who can submit it', async () => {
  const testEnv = env(new MemoryKV())
  const owner = address(20)
  const viewer = address(21)
  const editor = address(22)
  const created = await createTeam(testEnv, owner, {
    planId: 'assignable-team', name: 'Assignable team', build: build(),
  }, 'https://cairn.example')
  const withViewer = await addMember(testEnv, created.teamId, owner, viewer, 'viewer', 'https://cairn.example')
  const taskId = withViewer.build.milestones[0]!.tasks[0]!.id

  await assert.rejects(
    () => updateTeamTask(testEnv, created.teamId, owner, taskId, 'assign', { assignee: viewer }, 'https://cairn.example'),
    (error: unknown) => error instanceof TeamError && error.code === 'invalid_request',
  )

  await addMember(testEnv, created.teamId, owner, editor, 'editor', 'https://cairn.example')
  const assigned = await updateTeamTask(testEnv, created.teamId, owner, taskId, 'assign', { assignee: editor }, 'https://cairn.example')
  assert.equal(assigned.build.milestones[0]!.tasks[0]!.assignee, editor)
})

test('owner deletion revokes team access and permits a fresh workspace', async () => {
  const kv = new MemoryKV()
  const testEnv = env(kv)
  const owner = address(22)
  const created = await createTeam(testEnv, owner, {
    planId: 'deletable-plan', name: 'Delete team', build: build(),
  }, 'https://cairn.example')

  await deleteTeam(testEnv, created.teamId, owner, 'https://cairn.example')
  await assert.rejects(
    () => getTeam(testEnv, created.teamId, owner, 'https://cairn.example'),
    (error: unknown) => error instanceof TeamError && error.code === 'not_found',
  )
  const recreated = await createTeam(testEnv, owner, {
    planId: 'deletable-plan', name: 'Fresh team', build: build(),
  }, 'https://cairn.example')
  assert.notEqual(recreated.teamId, created.teamId)
})
