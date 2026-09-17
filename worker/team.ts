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
import type { Env, PublicBuildPlan, TeamActivity, TeamMember, TeamRecord, TeamRole } from './types'

const TEAM_TTL = 60 * 60 * 24 * 365
const MAX_MEMBERS = 20
const TEAM_ID = /^[a-z2-9]{16,32}$/i
const PLAN_ID = /^[a-z0-9_-]{1,96}$/i
const NAME_MAX = 80
/** The Durable Object is the canonical record for coordinated team writes. */
const TEAM_STORAGE_KEY = 'team-record'

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

export interface TeamSummary {
  teamId: string
  name: string
  role: 'owner' | TeamRole
  updatedAt: number
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
  updatedAt: number
  inviteUrl: string
  activity: TeamActivity[]
}

function teamKey(teamId: string): string {
  return `team:${teamId}`
}

function ownerPlanKey(owner: string, planId: string): string {
  return `team:owner:${owner}:${planId}`
}

function walletTeamKey(address: string): string {
  return `team:wallet:${address}`
}

async function readWalletTeams(env: Env, address: string): Promise<string[]> {
  const value = await env.CAIRN.get<{ teamIds?: unknown }>(walletTeamKey(address), 'json')
  return Array.isArray(value?.teamIds)
    ? value.teamIds.filter((id): id is string => validTeamId(id)).slice(0, 100)
    : []
}

async function addWalletTeam(env: Env, address: string, teamId: string): Promise<void> {
  const current = await readWalletTeams(env, address)
  if (current.includes(teamId)) return
  await env.CAIRN.put(walletTeamKey(address), JSON.stringify({ teamIds: [teamId, ...current].slice(0, 100) }), { expirationTtl: TEAM_TTL })
}

async function removeWalletTeam(env: Env, address: string, teamId: string): Promise<void> {
  const current = await readWalletTeams(env, address)
  const next = current.filter((id) => id !== teamId)
  if (next.length) await env.CAIRN.put(walletTeamKey(address), JSON.stringify({ teamIds: next }), { expirationTtl: TEAM_TTL })
  else await env.CAIRN.delete(walletTeamKey(address))
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
  if (!record || record.deletedAt || !validTeamId(record.id) || !validPlanId(record.planId)) {
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

function preserveVerifiedRewards(next: PublicBuildPlan, previous: PublicBuildPlan): PublicBuildPlan {
  const priorTasks = new Map(previous.milestones.flatMap((milestone) => milestone.tasks).map((task) => [task.id, task] as const))
  for (const task of priorTasks.values()) {
    if (task.reward && !next.milestones.some((milestone) => milestone.tasks.some((candidate) => candidate.id === task.id))) {
      throw new TeamError('conflict', 'A rewarded task cannot be removed from the team tracker.', 409)
    }
  }
  return {
    ...next,
    milestones: next.milestones.map((milestone) => ({
      ...milestone,
      tasks: milestone.tasks.map((task) => {
        const prior = priorTasks.get(task.id)
        if (!prior) return task
        return {
          ...task,
          ...(prior.assignee ? { assignee: prior.assignee } : {}),
          ...(prior.approvalStatus ? { approvalStatus: prior.approvalStatus } : {}),
          ...(prior.completionNote ? { completionNote: prior.completionNote } : {}),
          ...(prior.reviewNote ? { reviewNote: prior.reviewNote } : {}),
          ...(prior.reward ? { status: 'done' as const, reward: { ...prior.reward } } : {}),
        }
      }),
    })),
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
    updatedAt: record.updatedAt,
    inviteUrl: `${baseUrl(appUrl)}/?t=${encodeURIComponent(record.id)}`,
    activity: Array.isArray(record.activity) ? record.activity.slice(-100).map((item) => ({ ...item })) : [],
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
    if (env.TEAM_COORDINATOR) {
      try {
        // Read through the coordinator so an idempotent retry cannot return a
        // stale KV copy after the team has already been edited in the DO.
        return await coordinated(env, { action: 'get', teamId: existingId, address, appUrl })
      } catch (error) {
        if (!(error instanceof TeamError) || error.code !== 'not_found') throw error
      }
    } else {
      const existing = await readRecord(env, existingId)
      if (existing) {
        try {
          const valid = recordOrThrow(existing)
          if (valid.owner === address) return viewOf(valid, address, appUrl)
        } catch (error) {
          if (!(error instanceof TeamError) || error.code !== 'not_found') throw error
        }
      }
    }
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
    activity: [],
    createdAt: now,
    updatedAt: now,
  }
  await writeRecord(env, record)
  await env.CAIRN.put(ownerPlanKey(address, planId), id, { expirationTtl: TEAM_TTL })
  await addWalletTeam(env, address, id)
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
  const hasOpenAssignments = record.build.milestones.some((milestone) =>
    milestone.tasks.some((task) => task.assignee === member && task.status !== 'done'))
  if (hasOpenAssignments) throw new TeamError('conflict', 'Reassign this teammate’s open tasks before removing them.', 409)
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

  record.build = preserveVerifiedRewards(clampTeamBuild(build, record.id), record.build)
  record.revision += 1
  record.updatedAt = Date.now()
  record.activity = appendActivity(record, { address, action: 'updated', detail: 'Updated the team tracker' })
  await writeRecord(env, record)
  return viewOf(record, address, appUrl)
}

async function rawRecordReward(
  env: Env,
  teamId: string,
  ownerValue: string,
  taskIdValue: unknown,
  recipientValue: unknown,
  amountValue: unknown,
  hashValue: unknown,
  revisionValue: unknown,
  appUrl: string,
): Promise<TeamView> {
  const owner = normalizeAddress(ownerValue)
  const recipient = normalizeAddress(recipientValue)
  const taskId = typeof taskIdValue === 'string' ? taskIdValue : ''
  const transactionHash = typeof hashValue === 'string' ? hashValue.toLowerCase() : ''
  if (!owner || !recipient || !Number.isSafeInteger(amountValue) || (amountValue as number) < 1 ||
      !/^[0-9a-f]{64}$/.test(transactionHash) || !Number.isInteger(revisionValue)) {
    throw new TeamError('invalid_request', 'The reward details are invalid.', 400)
  }
  const record = recordOrThrow(await readRecord(env, teamId))
  requireOwner(record, owner)
  if (!record.members.some((member) => member.address === recipient)) {
    throw new TeamError('invalid_request', 'Rewards can only be sent to a current team member.', 400)
  }
  if (revisionValue !== record.revision) throw new TeamError('conflict', 'This tracker changed. Refresh before recording the reward.', 409)
  const allTasks = record.build.milestones.flatMap((milestone) => milestone.tasks)
  const task = allTasks.find((candidate) => candidate.id === taskId)
  if (!task || task.status !== 'done') throw new TeamError('invalid_request', 'Choose a completed team task.', 400)
  if (task.assignee !== recipient || task.approvalStatus !== 'approved') throw new TeamError('invalid_request', 'Reward only the approved assignee.', 400)
  if (task.reward) throw new TeamError('conflict', 'That task already has a recorded reward.', 409)
  if (allTasks.some((candidate) => candidate.reward?.transactionHash === transactionHash)) {
    throw new TeamError('conflict', 'That NIM transaction is already attached to a task.', 409)
  }
  task.reward = { recipient, amountLuna: amountValue as number, transactionHash, createdAt: Date.now() }
  record.revision += 1
  record.updatedAt = Date.now()
  record.activity = appendActivity(record, { address: owner, action: 'rewarded', taskId: task.id, taskText: task.text, detail: recipient })
  await writeRecord(env, record)
  return viewOf(record, owner, appUrl)
}

async function rawDeleteTeam(env: Env, teamId: string, ownerValue: string, appUrl: string): Promise<TeamView> {
  const owner = normalizeAddress(ownerValue)
  if (!owner) throw new TeamError('invalid_request', 'The wallet address is invalid.', 400)
  const record = recordOrThrow(await readRecord(env, teamId))
  requireOwner(record, owner)
  const view = viewOf(record, owner, appUrl)
  record.deletedAt = Date.now()
  record.revision += 1
  record.updatedAt = record.deletedAt
  await writeRecord(env, record)
  return view
}


type TaskOperation = 'assign' | 'submit' | 'approve' | 'return'

function appendActivity(record: TeamRecord, entry: Omit<TeamActivity, 'id' | 'createdAt'>): TeamActivity[] {
  return [...(record.activity ?? []), { ...entry, id: token(8), createdAt: Date.now() }].slice(-100)
}

function applyTaskAction(
  record: TeamRecord,
  address: string,
  taskId: string,
  operation: TaskOperation,
  assigneeValue: unknown,
  noteValue: unknown,
): TeamRecord {
  const access = requireAccess(record, address)
  const task = record.build.milestones.flatMap((milestone) => milestone.tasks).find((candidate) => candidate.id === taskId)
  if (!task) throw new TeamError('not_found', 'That team task does not exist.', 404)
  const note = typeof noteValue === 'string' ? noteValue.trim().slice(0, 500) : ''
  const assignee = normalizeAddress(assigneeValue)
  let action: TeamActivity['action']
  let detail = note

  if (operation === 'assign') {
    requireOwner(record, address)
    if (!assignee || !record.members.some((member) => member.address === assignee)) {
      throw new TeamError('invalid_request', 'Assign the task to a current teammate.', 400)
    }
    task.assignee = assignee
    task.approvalStatus = 'none'
    delete task.completionNote
    delete task.reviewNote
    if (task.status === 'done') task.status = 'todo'
    action = 'assigned'
    detail = assignee
  } else if (operation === 'submit') {
    if (access === 'viewer' || task.assignee !== address) {
      throw new TeamError('forbidden', 'Only the assigned editor can submit this task.', 403)
    }
    if (note.length < 2) throw new TeamError('invalid_request', 'Add a short completion note or proof link.', 400)
    task.status = 'in_progress'
    task.approvalStatus = 'pending'
    task.completionNote = note
    delete task.reviewNote
    action = 'submitted'
  } else {
    requireOwner(record, address)
    if (task.approvalStatus !== 'pending') throw new TeamError('conflict', 'This task is not awaiting approval.', 409)
    if (operation === 'approve') {
      task.status = 'done'
      task.approvalStatus = 'approved'
      delete task.reviewNote
      action = 'approved'
    } else {
      if (note.length < 2) throw new TeamError('invalid_request', 'Add a short reason for returning the task.', 400)
      task.status = 'in_progress'
      task.approvalStatus = 'changes_requested'
      task.reviewNote = note
      action = 'returned'
    }
  }

  const now = Date.now()
  return {
    ...record,
    build: { ...record.build },
    revision: record.revision + 1,
    updatedAt: now,
    activity: appendActivity(record, { address, action, taskId: task.id, taskText: task.text, ...(detail ? { detail } : {}) }),
  }
}

type TeamCommand =
  | { action: 'get'; teamId: string; address: string; appUrl: string }
  | { action: 'add'; teamId: string; owner: string; member: unknown; role: unknown; appUrl: string }
  | { action: 'update-member'; teamId: string; owner: string; member: unknown; role: unknown; appUrl: string }
  | { action: 'remove'; teamId: string; owner: string; member: unknown; appUrl: string }
  | { action: 'update-tracker'; teamId: string; address: string; build: unknown; revision: unknown; appUrl: string }
  | { action: 'record-reward'; teamId: string; owner: string; taskId: unknown; recipient: unknown; amountLuna: unknown; transactionHash: unknown; revision: unknown; appUrl: string }
  | { action: 'delete-team'; teamId: string; owner: string; appUrl: string }
  | { action: 'task'; teamId: string; address: string; taskId: string; operation: TaskOperation; assignee?: unknown; note?: unknown; appUrl: string }

interface CommandResult {
  record: TeamRecord
  address: string
  changed: boolean
}

/**
 * Apply one command to a validated record without performing I/O.
 *
 * The coordinator calls this from inside a Durable Object storage transaction,
 * so permission checks, revision checks, and the resulting write share one
 * atomic boundary. The raw KV functions above are retained only for the
 * explicit no-binding fallback used by local previews and older deployments.
 */
function applyTeamCommand(record: TeamRecord, command: TeamCommand): CommandResult {
  switch (command.action) {
    case 'get': {
      const address = normalizeAddress(command.address)
      if (!address) throw new TeamError('invalid_request', 'The wallet address is invalid.', 400)
      requireAccess(record, address)
      return { record, address, changed: false }
    }
    case 'add': {
      const owner = normalizeAddress(command.owner)
      const member = normalizeAddress(command.member)
      const memberRole = role(command.role)
      if (!owner || !member || !memberRole) throw new TeamError('invalid_request', 'Enter a valid wallet and role.', 400)
      requireOwner(record, owner)
      if (member === record.owner) throw new TeamError('invalid_request', 'The owner is already in the team.', 400)
      if (record.members.some((item) => item.address === member)) {
        throw new TeamError('conflict', 'That wallet is already a team member.', 409)
      }
      if (record.members.length >= MAX_MEMBERS) throw new TeamError('invalid_request', 'A team can have up to 20 members.', 400)
      const now = Date.now()
      return {
        address: owner,
        changed: true,
        record: {
          ...record,
          members: [...record.members, { address: member, role: memberRole, createdAt: now }],
          revision: record.revision + 1,
          updatedAt: now,
        },
      }
    }
    case 'update-member': {
      const owner = normalizeAddress(command.owner)
      const member = normalizeAddress(command.member)
      const memberRole = role(command.role)
      if (!owner || !member || !memberRole) throw new TeamError('invalid_request', 'Enter a valid role.', 400)
      requireOwner(record, owner)
      if (!record.members.some((item) => item.address === member)) {
        throw new TeamError('not_found', 'That wallet is not a team member.', 404)
      }
      const hasOpenAssignments = record.build.milestones.some((milestone) =>
        milestone.tasks.some((task) => task.assignee === member && task.status !== 'done'))
      if (hasOpenAssignments) throw new TeamError('conflict', 'Reassign this teammate’s open tasks before removing them.', 409)
      const now = Date.now()
      return {
        address: owner,
        changed: true,
        record: {
          ...record,
          members: record.members.map((item) => item.address === member ? { ...item, role: memberRole } : { ...item }),
          revision: record.revision + 1,
          updatedAt: now,
        },
      }
    }
    case 'remove': {
      const owner = normalizeAddress(command.owner)
      const member = normalizeAddress(command.member)
      if (!owner || !member) throw new TeamError('invalid_request', 'The wallet address is invalid.', 400)
      requireOwner(record, owner)
      if (!record.members.some((item) => item.address === member)) {
        throw new TeamError('not_found', 'That wallet is not a team member.', 404)
      }
      const now = Date.now()
      return {
        address: owner,
        changed: true,
        record: {
          ...record,
          members: record.members.filter((item) => item.address !== member),
          revision: record.revision + 1,
          updatedAt: now,
        },
      }
    }
    case 'update-tracker': {
      const address = normalizeAddress(command.address)
      if (!address || typeof command.revision !== 'number' || !Number.isInteger(command.revision) || command.revision < 1) {
        throw new TeamError('invalid_request', 'The tracker update is invalid.', 400)
      }
      const access = requireAccess(record, address)
      if (access === 'viewer') throw new TeamError('forbidden', 'Viewers cannot edit the tracker.', 403)
      if (command.revision !== record.revision) {
        throw new TeamError('conflict', 'This tracker changed. Refresh before saving again.', 409)
      }
      return {
        address,
        changed: true,
        record: {
          ...record,
          build: preserveVerifiedRewards(clampTeamBuild(command.build, record.id), record.build),
          revision: record.revision + 1,
          updatedAt: Date.now(),
          activity: appendActivity(record, { address, action: 'updated', detail: 'Updated the team tracker' }),
        },
      }
    }
    case 'record-reward': {
      const owner = normalizeAddress(command.owner)
      const recipient = normalizeAddress(command.recipient)
      const taskId = typeof command.taskId === 'string' ? command.taskId : ''
      const transactionHash = typeof command.transactionHash === 'string' ? command.transactionHash.toLowerCase() : ''
      if (!owner || !recipient || !Number.isSafeInteger(command.amountLuna) || (command.amountLuna as number) < 1 ||
          !/^[0-9a-f]{64}$/.test(transactionHash) || !Number.isInteger(command.revision)) {
        throw new TeamError('invalid_request', 'The reward details are invalid.', 400)
      }
      requireOwner(record, owner)
      if (!record.members.some((member) => member.address === recipient)) {
        throw new TeamError('invalid_request', 'Rewards can only be sent to a current team member.', 400)
      }
      if (command.revision !== record.revision) throw new TeamError('conflict', 'This tracker changed. Refresh before recording the reward.', 409)
      const allTasks = record.build.milestones.flatMap((milestone) => milestone.tasks)
      const task = allTasks.find((candidate) => candidate.id === taskId)
      if (!task || task.status !== 'done') throw new TeamError('invalid_request', 'Choose a completed team task.', 400)
      if (task.assignee !== recipient || task.approvalStatus !== 'approved') throw new TeamError('invalid_request', 'Reward only the approved assignee.', 400)
      if (task.reward) throw new TeamError('conflict', 'That task already has a recorded reward.', 409)
      if (allTasks.some((candidate) => candidate.reward?.transactionHash === transactionHash)) {
        throw new TeamError('conflict', 'That NIM transaction is already attached to a task.', 409)
      }
      const now = Date.now()
      return {
        address: owner,
        changed: true,
        record: {
          ...record,
          build: {
            ...record.build,
            milestones: record.build.milestones.map((milestone) => ({
              ...milestone,
              tasks: milestone.tasks.map((candidate) => candidate.id === taskId
                ? { ...candidate, reward: { recipient, amountLuna: command.amountLuna as number, transactionHash, createdAt: now } }
                : { ...candidate }),
            })),
          },
          revision: record.revision + 1,
          updatedAt: now,
          activity: appendActivity(record, { address: owner, action: 'rewarded', taskId: task.id, taskText: task.text, detail: recipient }),
        },
      }
    }
    case 'task': {
      const address = normalizeAddress(command.address)
      if (!address || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(command.taskId) ||
          !['assign', 'submit', 'approve', 'return'].includes(command.operation)) {
        throw new TeamError('invalid_request', 'The task action is invalid.', 400)
      }
      return { address, changed: true, record: applyTaskAction(record, address, command.taskId, command.operation, command.assignee, command.note) }
    }
    case 'delete-team': {
      const owner = normalizeAddress(command.owner)
      if (!owner) throw new TeamError('invalid_request', 'The wallet address is invalid.', 400)
      requireOwner(record, owner)
      const now = Date.now()
      return { address: owner, changed: true, record: { ...record, revision: record.revision + 1, updatedAt: now, deletedAt: now } }
    }
  }
}

async function rawTaskAction(env: Env, command: Extract<TeamCommand, { action: 'task' }>): Promise<TeamView> {
  const address = normalizeAddress(command.address)
  if (!address) throw new TeamError('invalid_request', 'The wallet address is invalid.', 400)
  const record = recordOrThrow(await readRecord(env, command.teamId))
  const next = applyTaskAction(record, address, command.taskId, command.operation, command.assignee, command.note)
  await writeRecord(env, next)
  return viewOf(next, address, command.appUrl)
}

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
    case 'record-reward':
      return rawRecordReward(env, command.teamId, command.owner, command.taskId, command.recipient, command.amountLuna, command.transactionHash, command.revision, command.appUrl)
    case 'delete-team':
      return rawDeleteTeam(env, command.teamId, command.owner, command.appUrl)
    case 'task':
      return rawTaskAction(env, command)
  }
}

/**
 * Coordinate one team's protected writes in Durable Object storage.
 *
 * Existing KV records are imported once, on first access, for backwards
 * compatibility. After that import the DO record is authoritative. Each
 * mutation runs permission checks, revision checks, and the write in one
 * storage transaction. This remains safe across object restarts and does not
 * depend on an in-memory request queue.
 */
export class TeamCoordinator {
  private readonly state: DurableObjectState
  private readonly env: Env
  private hydrated = false
  private hydration: Promise<void> | undefined

  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.env = env
  }

  private storage(): DurableObjectStorage | undefined {
    return (this.state as unknown as { storage?: DurableObjectStorage }).storage
  }

  private async ensureCanonical(teamId: string): Promise<void> {
    const storage = this.storage()
    if (!storage || this.hydrated) return
    if (!this.hydration) {
      this.hydration = (async () => {
        const existing = await storage.get<TeamRecord>(TEAM_STORAGE_KEY)
        if (!existing) {
          const legacy = await readRecord(this.env, teamId)
          if (legacy) await storage.put(TEAM_STORAGE_KEY, legacy)
        }
        this.hydrated = true
      })()
    }
    try {
      await this.hydration
    } finally {
      if (!this.hydrated) this.hydration = undefined
    }
  }

  private async run(command: TeamCommand): Promise<TeamView> {
    await this.ensureCanonical(command.teamId)
    const storage = this.storage()
    if (!storage?.transaction) return performTeamCommand(this.env, command)
    return storage.transaction(async (transaction) => {
      const record = recordOrThrow(await transaction.get<TeamRecord>(TEAM_STORAGE_KEY) ?? null)
      const result = applyTeamCommand(record, command)
      if (result.changed) await transaction.put(TEAM_STORAGE_KEY, result.record)
      return viewOf(result.record, result.address, command.appUrl)
    })
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const command = await request.json() as TeamCommand
      const result = await this.run(command)
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
  const result = await coordinated(env, { action: 'get', teamId, address, appUrl })
  const normalized = normalizeAddress(address)
  if (normalized) await addWalletTeam(env, normalized, teamId)
  return result
}

export async function listTeams(env: Env, addressValue: string, appUrl: string): Promise<TeamSummary[]> {
  const address = normalizeAddress(addressValue)
  if (!address) throw new TeamError('invalid_request', 'The wallet address is invalid.', 400)
  const teamIds = await readWalletTeams(env, address)
  const results = await Promise.allSettled(teamIds.map((teamId) => getTeam(env, teamId, address, appUrl)))
  const teams = results.flatMap((result) => result.status === 'fulfilled'
    ? [{ teamId: result.value.teamId, name: result.value.name, role: result.value.role, updatedAt: result.value.updatedAt }]
    : [])
  if (teams.length !== teamIds.length) {
    const validIds = teams.map((team) => team.teamId)
    if (validIds.length) await env.CAIRN.put(walletTeamKey(address), JSON.stringify({ teamIds: validIds }), { expirationTtl: TEAM_TTL })
    else await env.CAIRN.delete(walletTeamKey(address))
  }
  return teams
}

export async function addMember(
  env: Env,
  teamId: string,
  owner: string,
  member: unknown,
  memberRole: unknown,
  appUrl: string,
): Promise<TeamView> {
  const result = await coordinated(env, { action: 'add', teamId, owner, member, role: memberRole, appUrl })
  const address = normalizeAddress(member)
  if (address) await addWalletTeam(env, address, teamId)
  return result
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
  const result = await coordinated(env, { action: 'remove', teamId, owner, member, appUrl })
  const address = normalizeAddress(member)
  if (address) await removeWalletTeam(env, address, teamId)
  return result
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

export async function recordReward(
  env: Env,
  teamId: string,
  owner: string,
  input: { taskId: unknown; recipient: unknown; amountLuna: unknown; transactionHash: unknown; revision: unknown },
  appUrl: string,
): Promise<TeamView> {
  return coordinated(env, { action: 'record-reward', teamId, owner, ...input, appUrl })
}

export async function updateTeamTask(
  env: Env,
  teamId: string,
  address: string,
  taskId: string,
  operation: TaskOperation,
  input: { assignee?: unknown; note?: unknown },
  appUrl: string,
): Promise<TeamView> {
  return coordinated(env, { action: 'task', teamId, address, taskId, operation, ...input, appUrl })
}

export async function deleteTeam(env: Env, teamId: string, owner: string, appUrl: string): Promise<void> {
  const result = await coordinated(env, { action: 'delete-team', teamId, owner, appUrl })
  await Promise.all([result.owner, ...result.members.map((member) => member.address)]
    .map((address) => removeWalletTeam(env, address, teamId)))
}
