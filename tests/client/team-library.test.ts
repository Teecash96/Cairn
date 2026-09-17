import assert from 'node:assert/strict'
import test from 'node:test'
import type { TeamResult } from '../../src/lib/api.ts'
import { forgetTeamRoute, listTeamRoutes, rememberTeamRoute } from '../../src/lib/team-library.ts'

class MemoryStorage {
  readonly values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return Array.from(this.values.keys())[index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

function team(overrides: Partial<TeamResult> = {}): TeamResult {
  return {
    teamId: 'abcdefghijklmnop',
    planId: 'plan-one',
    name: 'Launch route',
    owner: 'NQ00 OWNER',
    role: 'editor',
    members: [],
    build: { mvpScope: [], milestones: [], risks: [] },
    revision: 1,
    inviteUrl: 'https://cairn.example/?t=abcdefghijklmnop',
    ...overrides,
  }
}

test('remembers teammate routes only for the wallet that opened them', () => {
  const storage = new MemoryStorage()
  const originalNow = Date.now
  Date.now = () => 100
  try {
    rememberTeamRoute(team(), 'NQ00 TEAM MATE', storage)
  } finally {
    Date.now = originalNow
  }

  assert.deepEqual(listTeamRoutes('nq00 teammate', storage), [{
    teamId: 'abcdefghijklmnop',
    name: 'Launch route',
    role: 'editor',
    wallet: 'NQ00TEAMMATE',
    updatedAt: 100,
  }])
  assert.deepEqual(listTeamRoutes('NQ00 SOMEONE ELSE', storage), [])
})

test('does not duplicate routes and lets the wallet forget one', () => {
  const storage = new MemoryStorage()
  rememberTeamRoute(team(), 'NQ00 TEAM MATE', storage)
  rememberTeamRoute(team({ name: 'Renamed route', role: 'viewer' }), 'NQ00 TEAM MATE', storage)

  assert.equal(listTeamRoutes('NQ00 TEAM MATE', storage).length, 1)
  assert.equal(listTeamRoutes('NQ00 TEAM MATE', storage)[0]?.name, 'Renamed route')
  forgetTeamRoute('abcdefghijklmnop', 'NQ00 TEAM MATE', storage)
  assert.deepEqual(listTeamRoutes('NQ00 TEAM MATE', storage), [])
})

test('owner work remains in the personal routes list', () => {
  const storage = new MemoryStorage()
  rememberTeamRoute(team({ role: 'owner' }), 'NQ00 OWNER', storage)
  assert.deepEqual(listTeamRoutes('NQ00 OWNER', storage), [])
})
