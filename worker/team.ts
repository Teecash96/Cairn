/**
 * Protected team workspaces.
 *
 * A team is deliberately smaller than an account system. The owner enters a
 * Nimiq address, chooses a role, then sends the protected link to that wallet.
 * Every request still needs a short lived wallet session. The URL is only a
 * locator, never a permission.
 *
 * Only the public Track projection is stored. The PRD, user flow, private
 * notes, priorities, and dependency details never cross this module.
 */
import { clampTeamBuild } from './shape'
import { normalizeAddress, token } from './http'
import type { Env, PublicBuildPlan, TeamMember, TeamRecord, TeamRole } from './types'

const TEAM_TTL = 60 * 60 * 24 * 365
const MAX_MEMBERS = 20
const TEAM_ID = /^[a-z2-9]{16,32}$/i
const PLAN_ID = /^[a-z0-9_-]{1,96}$/i
const NAME_MAX = 80
const MEMBER_TITLE_MAX = 48

export type TeamErrorCode = 'invalid_request' | 'not_found' | 'forbidden' | 'conflict'

export class TeamError extends Error {
  readonly code: TeamErrorCode
  readonly status: number

  constructor(code: TeamErrorCode, message: string, status: number) {
    super(message)
    this.name = 'TeamError'
    this.code = code
    this.status = status
  }
}

export interface TeamView {
  teamId: string
  planId: string
  name: string
  owner: string
  role: 'owner' | TeamRole
  members: TeamMember[]
  build: PublicBuildPlan
  revision: number
  inviteUrl: string
}

function teamKey(teamId: string): string {
  return `team:${teamId}`
}

function ownerPlanKey(owner: string, planId: string): string {
  return `team:owner:${owner}:${planId}`
}

function validTeamId(value: unknown): value is string {
  return typeof value === 'string' && TEAM_ID.test(value)
}

function validPlanId(value: unknown): value is string {
  return typeof value === 'string' && PLAN_ID.test(value.trim())
}

function role(value: unknown): TeamRole | null {
  return value === 'viewer' || value === 'editor' ? value : null
}

function memberTitle(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, MEMBER_TITLE_MAX) : ''
}

function recordOrThrow(record: TeamRecord | null): TeamRecord {
  if (!record || !validTeamId(record.id) || !validPlanId(record.planId)) {
    throw new TeamError('not_found', 'That team workspace does not exist.', 404)
  }

  const owner = normalizeAddress(record.owner)
  if (!owner || typeof record.name !== 'string' || record.name.length > NAME_MAX) {
    throw new TeamError('not_found', 'That team workspace does not exist.', 404)
  }
  if (!Array.isArray(record.members) || record.members.length > MAX_MEMBERS) {
    throw new TeamError('not_found', 'That team workspace does not exist.', 404)
  }
  if (!Number.isInteger(record.revision) || record.revision < 1 || !Number.isFinite(record.createdAt) || !Number.isFinite(record.updatedAt)) {
    throw new TeamError('not_found', 'That team workspace does not exist.', 404)
  }

  const seen = new Set<string>([owner])
  const members: TeamMember[] = []
  for (const item of record.members) {
    if (typeof item !== 'object' || item === null) {
      throw new TeamError('not_found', 'That team workspace does not exist.', 404)
    }
    const raw = item as Partial<TeamMember>
    const address = normalizeAddress(raw.address)
    const memberRole = role(raw.role)
    if (!address || !memberRole || seen.has(address) || !Number.isFinite(raw.createdAt)) {
      throw new TeamError('not_found', 'That team workspace does not exist.', 404)
    }
    seen.add(address)
    members.push({ address, title: memberTitle(raw.title) || 'Team member', role: memberRole, createdAt: raw.createdAt as number })
  }

  return {
    ...record,
    owner,
    name: record.name.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) || 'Cairn team',
    members,
    build: clampTeamBuild(record.build, record.id),
  }
}

function accessOf(record: TeamRecord, address: string): 'owner' | TeamRole | null {
  if (record.owner === address) return 'owner'
  return record.members.find((member) => member.address === address)?.role ?? null
}

function requireAccess(record: TeamRecord, address: string): 'owner' | TeamRole {
  const access = accessOf(record, address)
  if (!access) throw new TeamError('forbidden', 'This wallet is not a member of that team.', 403)
  return access
}

function requireOwner(record: TeamRecord, address: string): void {
  if (record.owner !== address) throw new TeamError('forbidden', 'Only the team owner can manage members.', 403)
}

function baseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '')
  return trimmed || 'https://cairn.invalid'
}

function viewOf(record: TeamRecord, address: string, appUrl: string): TeamView {
  const access = requireAccess(record, address)
  return {
    teamId: record.id,
    planId: record.planId,
    name: record.name,
    owner: record.owner,
    role: access,
    members: record.members.map((member) => ({ ...member })),
    build: record.build,
    revision: record.revision,
    inviteUrl: `${baseUrl(appUrl)}/?t=${encodeURIComponent(record.id)}`,
  }
}

async function readRecord(env: Env, teamId: string): Promise<TeamRecord | null> {
  if (!validTeamId(teamId)) throw new TeamError('not_found', 'That team workspace does not exist.', 404)
  return await env.CAIRN.get<TeamRecord>(teamKey(teamId), 'json')
}

async function writeRecord(env: Env, record: TeamRecord): Promise<void> {
  await env.CAIRN.put(teamKey(record.id), JSON.stringify(record), { expirationTtl: TEAM_TTL })
}

export interface CreateTeamInput {
  planId: string
  name: string
  build: unknown
}

export async function createTeam(
  env: Env,
  owner: string,
  input: CreateTeamInput,
  appUrl: string,
): Promise<TeamView> {
  const address = normalizeAddress(owner)
  const planId = typeof input.planId === 'string' ? input.planId.trim() : ''
  if (!address || !validPlanId(planId)) {
    throw new TeamError('invalid_request', 'The plan identity is invalid.', 400)
  }

  // A retry after a lost response must not create a second team for one plan.
  const existingId = await env.CAIRN.get<string>(ownerPlanKey(address, planId))
  if (existingId && validTeamId(existingId)) {
    const existing = await readRecord(env, existingId)
    if (existing && existing.owner === address) return viewOf(existing, address, appUrl)
  }

  const id = token(16)
  const rawName = typeof input.name === 'string' ? input.name.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) : ''
  const now = Date.now()
  const record: TeamRecord = {
    id,
    planId,
    name: rawName || 'Cairn team',
    owner: address,
    members: [],
    build: clampTeamBuild(input.build, id),
    revision: 1,
    createdAt: now,
    updatedAt: now,
  }
  await writeRecord(env, record)
  await env.CAIRN.put(ownerPlanKey(address, planId), id, { expirationTtl: TEAM_TTL })
  return viewOf(record, address, appUrl)
}

export async function getTeam(
  env: Env,
  teamId: string,
  addressValue: string,
  appUrl: string,
): Promise<TeamView> {
  const address = normalizeAddress(addressValue)
  if (!address) throw new TeamError('invalid_request', 'The wallet address is invalid.', 400)
  const record = recordOrThrow(await readRecord(env, teamId))
  return viewOf(record, address, appUrl)
}

export async function addMember(
  env: Env,
  teamId: string,
  ownerValue: string,
  memberValue: unknown,
  titleValue: unknown,
  roleValue: unknown,
  appUrl: string,
): Promise<TeamView> {
  const owner = normalizeAddress(ownerValue)
  const member = normalizeAddress(memberValue)
  const title = memberTitle(titleValue)
  const memberRole = role(roleValue)
  if (!owner || !member || !title || !memberRole) throw new TeamError('invalid_request', 'Enter a valid wallet, role title, and permission.', 400)
  const record = recordOrThrow(await readRecord(env, teamId))
  requireOwner(record, owner)
  if (member === record.owner) throw new TeamError('invalid_request', 'The owner is already in the team.', 400)
  if (record.members.some((item) => item.address === member)) {
    throw new TeamError('conflict', 'That wallet is already a team member.', 409)
  }
  if (record.members.length >= MAX_MEMBERS) throw new TeamError('invalid_request', 'A team can have up to 20 members.', 400)

  record.members.push({ address: member, title, role: memberRole, createdAt: Date.now() })
  record.updatedAt = Date.now()
  record.revision += 1
  await writeRecord(env, record)
  return viewOf(record, owner, appUrl)
}

export async function updateMember(
  env: Env,
  teamId: string,
  ownerValue: string,
  memberValue: unknown,
  roleValue: unknown,
  appUrl: string,
): Promise<TeamView> {
  const owner = normalizeAddress(ownerValue)
  const member = normalizeAddress(memberValue)
  const memberRole = role(roleValue)
  if (!owner || !member || !memberRole) throw new TeamError('invalid_request', 'Enter a valid role.', 400)
  const record = recordOrThrow(await readRecord(env, teamId))
  requireOwner(record, owner)
  const target = record.members.find((item) => item.address === member)
  if (!target) throw new TeamError('not_found', 'That wallet is not a team member.', 404)
  target.role = memberRole
  record.updatedAt = Date.now()
  record.revision += 1
  await writeRecord(env, record)
  return viewOf(record, owner, appUrl)
}

export async function removeMember(
  env: Env,
  teamId: string,
  ownerValue: string,
  memberValue: unknown,
  appUrl: string,
): Promise<TeamView> {
  const owner = normalizeAddress(ownerValue)
  const member = normalizeAddress(memberValue)
  if (!owner || !member) throw new TeamError('invalid_request', 'The wallet address is invalid.', 400)
  const record = recordOrThrow(await readRecord(env, teamId))
  requireOwner(record, owner)
  const index = record.members.findIndex((item) => item.address === member)
  if (index < 0) throw new TeamError('not_found', 'That wallet is not a team member.', 404)
  record.members.splice(index, 1)
  record.updatedAt = Date.now()
  record.revision += 1
  await writeRecord(env, record)
  return viewOf(record, owner, appUrl)
}

export async function updateTracker(
  env: Env,
  teamId: string,
  addressValue: string,
  build: unknown,
  revisionValue: unknown,
  appUrl: string,
): Promise<TeamView> {
  const address = normalizeAddress(addressValue)
  if (!address || typeof revisionValue !== 'number' || !Number.isInteger(revisionValue) || revisionValue < 1) {
    throw new TeamError('invalid_request', 'The tracker update is invalid.', 400)
  }
  const record = recordOrThrow(await readRecord(env, teamId))
  const access = requireAccess(record, address)
  if (access === 'viewer') throw new TeamError('forbidden', 'Viewers cannot edit the tracker.', 403)
  if (revisionValue !== record.revision) {
    throw new TeamError('conflict', 'This tracker changed. Refresh before saving again.', 409)
  }

  record.build = clampTeamBuild(build, record.id)
  record.revision += 1
  record.updatedAt = Date.now()
  await writeRecord(env, record)
  return viewOf(record, address, appUrl)
}
