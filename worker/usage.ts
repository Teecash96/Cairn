import type { Env } from './types'

export const USAGE_EVENTS = [
  'wallet_verified',
  'plan_generated',
  'plan_refined',
  'share_created',
  'team_created',
  'team_opened',
  'tracker_saved',
  'task_assigned',
  'work_submitted',
  'work_approved',
  'work_returned',
  'reward_confirmed',
] as const

export type UsageEvent = typeof USAGE_EVENTS[number]

interface UsageUser {
  firstSeen: number
  lastSeen: number
  activeDays: string[]
  source?: string
  events: Partial<Record<UsageEvent, number>>
  rewardedLuna: number
}

export interface UsageSummary {
  updatedAt: number
  verifiedWallets: number
  activatedWallets: number
  repeatWallets: number
  activeToday: number
  active7Days: number
  plansGenerated: number
  planRefinements: number
  sharesCreated: number
  teamWorkspaces: number
  teamParticipants: number
  teamActions: number
  rewardsConfirmed: number
  rewardedLuna: number
  sources: Array<{ source: string; wallets: number }>
}

const encoder = new TextEncoder()
const ACTIVATION_EVENTS = USAGE_EVENTS.filter((event) => event !== 'wallet_verified')

function dayOf(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10)
}

function safeSource(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const source = value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').slice(0, 32).replace(/^-+|-+$/g, '')
  return source || undefined
}

function safeTimestamp(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return Date.now()
  // The timestamp comes only from this Worker, but keep the Durable Object
  // defensive if it is exercised directly in a local test.
  return Math.max(0, Math.min(value, Date.now() + 60_000))
}

function emptySummary(now = 0): UsageSummary {
  return {
    updatedAt: now,
    verifiedWallets: 0,
    activatedWallets: 0,
    repeatWallets: 0,
    activeToday: 0,
    active7Days: 0,
    plansGenerated: 0,
    planRefinements: 0,
    sharesCreated: 0,
    teamWorkspaces: 0,
    teamParticipants: 0,
    teamActions: 0,
    rewardsConfirmed: 0,
    rewardedLuna: 0,
    sources: [],
  }
}

/**
 * One global Durable Object owns exact usage counts. It creates an HMAC key in
 * its own private storage and persists only keyed wallet digests. The Worker
 * can count the same signed wallet twice without storing or exposing its
 * address, and a database leak cannot be matched against public addresses.
 */
export class UsageLedger {
  private storage: DurableObjectStorage
  private pepper: Promise<Uint8Array>

  constructor(state: DurableObjectState) {
    this.storage = state.storage
    this.pepper = state.blockConcurrencyWhile(async () => {
      const existing = await this.storage.get<Uint8Array>('config:pepper')
      if (existing?.byteLength === 32) return existing
      const created = crypto.getRandomValues(new Uint8Array(32))
      await this.storage.put('config:pepper', created)
      return created
    })
  }

  private async walletKey(address: string): Promise<string> {
    const key = await crypto.subtle.importKey('raw', await this.pepper, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(address))
    return `user:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
  }

  private async record(input: Record<string, unknown>): Promise<Response> {
    const address = typeof input.address === 'string' ? input.address : ''
    const event = typeof input.event === 'string' && USAGE_EVENTS.includes(input.event as UsageEvent)
      ? input.event as UsageEvent
      : null
    if (!address || address.length > 64 || !event) return new Response('Invalid usage event', { status: 400 })

    const at = safeTimestamp(input.at)
    const day = dayOf(at)
    const source = safeSource(input.source)
    const rewardedLuna = event === 'reward_confirmed' && Number.isSafeInteger(input.rewardedLuna) && Number(input.rewardedLuna) > 0
      ? Math.min(Number(input.rewardedLuna), 100_000_000_000)
      : 0
    const key = await this.walletKey(address)

    await this.storage.transaction(async (transaction) => {
      const prior = await transaction.get<UsageUser>(key)
      const days = prior?.activeDays.includes(day)
        ? prior.activeDays
        : [...(prior?.activeDays ?? []), day].sort().slice(-120)
      const record: UsageUser = {
        firstSeen: prior?.firstSeen ?? at,
        lastSeen: Math.max(prior?.lastSeen ?? 0, at),
        activeDays: days,
        ...(prior?.source || source ? { source: prior?.source ?? source } : {}),
        events: {
          ...(prior?.events ?? {}),
          [event]: (prior?.events[event] ?? 0) + 1,
        },
        rewardedLuna: (prior?.rewardedLuna ?? 0) + rewardedLuna,
      }
      await transaction.put(key, record)
      await transaction.put('meta:updatedAt', at)
    })
    return Response.json({ recorded: true })
  }

  private async summary(): Promise<Response> {
    const now = Date.now()
    const summary = emptySummary(await this.storage.get<number>('meta:updatedAt') ?? 0)
    const today = dayOf(now)
    const sevenDaysAgo = dayOf(now - 6 * 24 * 60 * 60 * 1000)
    const sourceCounts = new Map<string, number>()
    let startAfter: string | undefined

    do {
      const page = await this.storage.list<UsageUser>({
        prefix: 'user:',
        limit: 1000,
        ...(startAfter ? { startAfter } : {}),
      })
      for (const [key, user] of page) {
        startAfter = key
        summary.verifiedWallets += 1
        if (ACTIVATION_EVENTS.some((event) => (user.events[event] ?? 0) > 0)) summary.activatedWallets += 1
        if (user.activeDays.length > 1) summary.repeatWallets += 1
        if (user.activeDays.includes(today)) summary.activeToday += 1
        if (user.activeDays.some((day) => day >= sevenDaysAgo && day <= today)) summary.active7Days += 1
        summary.plansGenerated += user.events.plan_generated ?? 0
        summary.planRefinements += user.events.plan_refined ?? 0
        summary.sharesCreated += user.events.share_created ?? 0
        summary.teamWorkspaces += user.events.team_created ?? 0
        if ((user.events.team_opened ?? 0) > 0 || (user.events.team_created ?? 0) > 0) summary.teamParticipants += 1
        summary.teamActions += (user.events.tracker_saved ?? 0) +
          (user.events.task_assigned ?? 0) + (user.events.work_submitted ?? 0) +
          (user.events.work_approved ?? 0) + (user.events.work_returned ?? 0)
        summary.rewardsConfirmed += user.events.reward_confirmed ?? 0
        summary.rewardedLuna += user.rewardedLuna
        if (user.source) sourceCounts.set(user.source, (sourceCounts.get(user.source) ?? 0) + 1)
      }
      if (page.size < 1000) break
    } while (startAfter)

    // Small source cohorts can identify an individual. Suppress them until at
    // least three independently verified wallets share the same source.
    summary.sources = [...sourceCounts]
      .filter(([, wallets]) => wallets >= 3)
      .map(([source, wallets]) => ({ source, wallets }))
      .sort((a, b) => b.wallets - a.wallets || a.source.localeCompare(b.source))
    return Response.json(summary, { headers: { 'cache-control': 'public, max-age=60' } })
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname
    if (request.method === 'GET' && path === '/summary') return this.summary()
    if (request.method !== 'POST' || path !== '/record') return new Response('Not found', { status: 404 })
    const input = await request.json<Record<string, unknown>>().catch(() => null)
    return input ? this.record(input) : new Response('Invalid usage event', { status: 400 })
  }
}

function stub(env: Env): DurableObjectStub | null {
  return env.USAGE_LEDGER?.getByName('global') ?? null
}

/** Usage evidence must never make a product action fail. */
export async function recordUsage(
  env: Env,
  address: string,
  event: UsageEvent,
  options: { source?: unknown; rewardedLuna?: number } = {},
): Promise<void> {
  const target = stub(env)
  if (!target) return
  try {
    const response = await target.fetch('https://usage.internal/record', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address, event, at: Date.now(), ...options }),
    })
    if (!response.ok) console.error(JSON.stringify({ event: 'usage_record_failed', status: response.status }))
  } catch {
    console.error(JSON.stringify({ event: 'usage_record_failed', status: 0 }))
  }
}

export async function readUsage(env: Env): Promise<UsageSummary> {
  const target = stub(env)
  if (!target) return emptySummary()
  try {
    const response = await target.fetch('https://usage.internal/summary')
    return response.ok ? await response.json<UsageSummary>() : emptySummary()
  } catch {
    return emptySummary()
  }
}
