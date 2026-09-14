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
    members.push({ address, role: memberRole, createdAt: raw.createdAt as number })
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

async function rawGetTeam(
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

async function rawAddMember(
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
  if (!owner || !member || !memberRole) throw new TeamError('invalid_request', 'Enter a valid wallet and role.', 400)
  const record = recordOrThrow(await readRecord(env, teamId))
  requireOwner(record, owner)
  if (member === record.owner) throw new TeamError('invalid_request', 'The owner is already in the team.', 400)
  if (record.members.some((item) => item.address === member)) {
    throw new TeamError('conflict', 'That wallet is already a team member.', 409)
  }
  if (record.members.length >= MAX_MEMBERS) throw new TeamError('invalid_request', 'A team can have up to 20 members.', 400)

  record.members.push({ address: member, role: memberRole, createdAt: Date.now() })
  record.updatedAt = Date.now()
  record.revision += 1
  await writeRecord(env, record)
  return viewOf(record, owner, appUrl)
}

async function rawUpdateMember(
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

async function rawRemoveMember(
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

async function rawUpdateTracker(
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


type TeamCommand =
  | { action: 'get'; teamId: string; address: string; appUrl: string }
  | { action: 'add'; teamId: string; owner: string; member: unknown; role: unknown; appUrl: string }
  | { action: 'update-member'; teamId: string; owner: string; member: unknown; role: unknown; appUrl: string }
  | { action: 'remove'; teamId: string; owner: string; member: unknown; appUrl: string }
  | { action: 'update-tracker'; teamId: string; address: string; build: unknown; revision: unknown; appUrl: string }

async function performTeamCommand(env: Env, command: TeamCommand): Promise<TeamView> {
  switch (command.action) {
    case 'get':
      return rawGetTeam(env, command.teamId, command.address, command.appUrl)
    case 'add':
      return rawAddMember(env, command.teamId, command.owner, command.member, command.role, command.appUrl)
    case 'update-member':
      return rawUpdateMember(env, command.teamId, command.owner, command.member, command.role, command.appUrl)
    case 'remove':
      return rawRemoveMember(env, command.teamId, command.owner, command.member, command.appUrl)
    case 'update-tracker':
      return rawUpdateTracker(env, command.teamId, command.address, command.build, command.revision, command.appUrl)
  }
}

/**
 * Serialize every read/check/write sequence for a team. KV remains the durable
 * record during rollout, while this object prevents two accepted revisions from
 * overwriting one another.
 */
export class TeamCoordinator {
  private tail: Promise<void> = Promise.resolve()

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {
    void this.state
  }

  async fetch(request: Request): Promise<Response> {
    const previous = this.tail
    let release: (() => void) | undefined
    this.tail = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
      const command = await request.json() as TeamCommand
      const result = await performTeamCommand(this.env, command)
      return Response.json({ ok: true, result })
    } catch (error) {
      if (error instanceof TeamError) {
        return Response.json({
          ok: false,
          error: { code: error.code, message: error.message, status: error.status },
        }, { status: error.status })
      }
      return Response.json({
        ok: false,
        error: { code: 'server', message: 'The team service is temporarily unavailable.', status: 503 },
      }, { status: 503 })
    } finally {
      release?.()
    }
  }
}

async function coordinated(env: Env, command: TeamCommand): Promise<TeamView> {
  if (!env.TEAM_COORDINATOR) return performTeamCommand(env, command)
  const id = env.TEAM_COORDINATOR.idFromName(command.teamId)
  const response = await env.TEAM_COORDINATOR.get(id).fetch('https://team.internal/', {
    method: 'POST',
    body: JSON.stringify(command),
  })
  const payload = await response.json() as {
    ok?: boolean
    result?: TeamView
    error?: { code?: TeamErrorCode; message?: string; status?: number }
  }
  if (response.ok && payload.result) return payload.result
  const code = payload.error?.code ?? 'not_found'
  const message = payload.error?.message ?? 'The team service is temporarily unavailable.'
  const status = payload.error?.status ?? response.status
  throw new TeamError(code, message, status)
}

export async function getTeam(
  env: Env,
  teamId: string,
  address: string,
  appUrl: string,
): Promise<TeamView> {
  return coordinated(env, { action: 'get', teamId, address, appUrl })
}

export async function addMember(
  env: Env,
  teamId: string,
  owner: string,
  member: unknown,
  memberRole: unknown,
  appUrl: string,
): Promise<TeamView> {
  return coordinated(env, { action: 'add', teamId, owner, member, role: memberRole, appUrl })
}

export async function updateMember(
  env: Env,
  teamId: string,
  owner: string,
  member: unknown,
  memberRole: unknown,
  appUrl: string,
): Promise<TeamView> {
  return coordinated(env, { action: 'update-member', teamId, owner, member, role: memberRole, appUrl })
}

export async function removeMember(
  env: Env,
  teamId: string,
  owner: string,
  member: unknown,
  appUrl: string,
): Promise<TeamView> {
  return coordinated(env, { action: 'remove', teamId, owner, member, appUrl })
}

export async function updateTracker(
  env: Env,
  teamId: string,
  address: string,
  build: unknown,
  revision: unknown,
  appUrl: string,
): Promise<TeamView> {
  return coordinated(env, { action: 'update-tracker', teamId, address, build, revision, appUrl })
}
