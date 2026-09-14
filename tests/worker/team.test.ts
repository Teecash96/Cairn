import assert from 'node:assert/strict'
import test from 'node:test'
import worker from '../../worker/index.ts'
import { addMember, createTeam, getTeam, removeMember, TeamCoordinator, TeamError, updateMember, updateTracker } from '../../worker/team.ts'
import { addressFromPublicKey } from '../../worker/http.ts'
import type { Env } from '../../worker/types.ts'

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
  const coordinator = new TeamCoordinator({} as DurableObjectState, testEnv)

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
  const stored = await getTeam(testEnv, created.teamId, owner, 'https://cairn.example')
  assert.equal(stored.revision, 2)
})
