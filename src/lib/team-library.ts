/**
 * Small, device-local index of protected teammate workspaces already opened by
 * this browser. It stores only a team locator and display metadata. The locator
 * grants no access: every open still requires the matching signed wallet.
 */
import type { TeamAccess, TeamResult } from './api'

const STORAGE_KEY = 'cairn.team-library.v1'
const MAX_ROUTES = 20

export interface TeamRoute {
  teamId: string
  name: string
  role: Exclude<TeamAccess, 'owner'>
  wallet: string
  updatedAt: number
}

interface StoredTeamLibrary {
  version: 1
  routes: TeamRoute[]
}

function canonicalAddress(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase()
}

function storageOrNull(storage?: Storage): Storage | null {
  if (storage) return storage
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function normalize(value: unknown): TeamRoute | null {
  if (typeof value !== 'object' || value === null) return null
  const route = value as Partial<TeamRoute>
  if (!/^[a-z2-9]{16,32}$/i.test(route.teamId ?? '')) return null
  if (route.role !== 'viewer' && route.role !== 'editor') return null
  if (typeof route.wallet !== 'string' || !canonicalAddress(route.wallet)) return null
  if (typeof route.updatedAt !== 'number' || !Number.isFinite(route.updatedAt)) return null
  const name = typeof route.name === 'string' ? route.name.replace(/\s+/g, ' ').trim().slice(0, 80) : ''
  return {
    teamId: route.teamId!,
    name: name || 'Cairn team',
    role: route.role,
    wallet: canonicalAddress(route.wallet),
    updatedAt: route.updatedAt,
  }
}

function read(storage?: Storage): TeamRoute[] {
  const target = storageOrNull(storage)
  if (!target) return []
  try {
    const parsed: unknown = JSON.parse(target.getItem(STORAGE_KEY) ?? 'null')
    const routes = (parsed as Partial<StoredTeamLibrary> | null)?.routes
    return Array.isArray(routes) ? routes.flatMap((route) => normalize(route) ?? []) : []
  } catch {
    return []
  }
}

function write(routes: TeamRoute[], storage?: Storage): void {
  const target = storageOrNull(storage)
  if (!target) return
  try {
    target.setItem(STORAGE_KEY, JSON.stringify({ version: 1, routes } satisfies StoredTeamLibrary))
  } catch {
    // Team access still works through the invitation link when storage is off.
  }
}

export function listTeamRoutes(wallet: string | null, storage?: Storage): TeamRoute[] {
  if (!wallet) return []
  const address = canonicalAddress(wallet)
  return read(storage)
    .filter((route) => route.wallet === address)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export function rememberTeamRoute(team: TeamResult, wallet: string, storage?: Storage): void {
  if (team.role === 'owner') return
  const address = canonicalAddress(wallet)
  const remembered: TeamRoute = {
    teamId: team.teamId,
    name: team.name.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Cairn team',
    role: team.role,
    wallet: address,
    updatedAt: Date.now(),
  }
  const routes = read(storage).filter((route) => !(route.teamId === team.teamId && route.wallet === address))
  write([remembered, ...routes].slice(0, MAX_ROUTES), storage)
}

export function forgetTeamRoute(teamId: string, wallet: string, storage?: Storage): void {
  const address = canonicalAddress(wallet)
  write(read(storage).filter((route) => !(route.teamId === teamId && route.wallet === address)), storage)
}
