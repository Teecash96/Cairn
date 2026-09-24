import assert from 'node:assert/strict'
import test from 'node:test'
import { UsageLedger } from '../../worker/usage.ts'

class MemoryStorage {
  readonly values = new Map<string, unknown>()

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value)
  }

  async list<T>(options: { prefix?: string; startAfter?: string; limit?: number } = {}): Promise<Map<string, T>> {
    const entries = [...this.values]
      .filter(([key]) => (!options.prefix || key.startsWith(options.prefix)) && (!options.startAfter || key > options.startAfter))
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, options.limit ?? 1000) as Array<[string, T]>
    return new Map(entries)
  }

  async transaction<T>(closure: (transaction: DurableObjectTransaction) => Promise<T>): Promise<T> {
    const pending = new Map(this.values)
    const transaction = {
      get: async <V>(key: string): Promise<V | undefined> => pending.get(key) as V | undefined,
      put: async <V>(key: string, value: V): Promise<void> => { pending.set(key, value) },
    } as unknown as DurableObjectTransaction
    const result = await closure(transaction)
    this.values.clear()
    for (const [key, value] of pending) this.values.set(key, value)
    return result
  }
}

function ledger(storage = new MemoryStorage()): { storage: MemoryStorage; object: UsageLedger } {
  const state = {
    storage: storage as unknown as DurableObjectStorage,
    blockConcurrencyWhile: <T>(callback: () => Promise<T>): Promise<T> => callback(),
  } as unknown as DurableObjectState
  return { storage, object: new UsageLedger(state) }
}

async function record(object: UsageLedger, address: string, event: string, at: number, source?: string, rewardedLuna?: number): Promise<void> {
  const response = await object.fetch(new Request('https://usage.internal/record', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address, event, at, source, rewardedLuna }),
  }))
  assert.equal(response.status, 200)
}

test('counts distinct, activated, repeat, action, source, and reward evidence', async () => {
  const { object } = ledger()
  const now = Date.now()
  const yesterday = now - 24 * 60 * 60 * 1000
  for (const wallet of ['wallet-a', 'wallet-b', 'wallet-c']) {
    await record(object, wallet, 'wallet_verified', yesterday, 'x-launch')
  }
  await record(object, 'wallet-a', 'wallet_verified', now, 'ignored-second-source')
  await record(object, 'wallet-a', 'plan_generated', now)
  await record(object, 'wallet-a', 'plan_refined', now)
  await record(object, 'wallet-b', 'team_created', now)
  await record(object, 'wallet-b', 'task_assigned', now)
  await record(object, 'wallet-b', 'reward_confirmed', now, undefined, 125_000)

  const response = await object.fetch(new Request('https://usage.internal/summary'))
  const summary = await response.json() as Record<string, unknown>
  assert.equal(summary.verifiedWallets, 3)
  assert.equal(summary.activatedWallets, 2)
  assert.equal(summary.repeatWallets, 2)
  assert.equal(summary.active7Days, 3)
  assert.equal(summary.plansGenerated, 1)
  assert.equal(summary.planRefinements, 1)
  assert.equal(summary.teamWorkspaces, 1)
  assert.equal(summary.teamParticipants, 1)
  assert.equal(summary.teamActions, 1)
  assert.equal(summary.rewardsConfirmed, 1)
  assert.equal(summary.rewardedLuna, 125_000)
  assert.deepEqual(summary.sources, [{ source: 'x-launch', wallets: 3 }])
  assert.equal(JSON.stringify(summary).includes('wallet-a'), false)
})

test('stores only keyed wallet digests and suppresses small referral cohorts', async () => {
  const { object, storage } = ledger()
  await record(object, 'NQ00-RAW-WALLET', 'wallet_verified', Date.now(), 'private-dm')
  const keys = [...storage.values.keys()]
  assert.equal(keys.some((key) => key.includes('NQ00-RAW-WALLET')), false)
  assert.equal(JSON.stringify([...storage.values.values()]).includes('NQ00-RAW-WALLET'), false)
  const summary = await (await object.fetch(new Request('https://usage.internal/summary'))).json() as { sources: unknown[] }
  assert.deepEqual(summary.sources, [])
})

test('rejects unknown events', async () => {
  const { object } = ledger()
  const response = await object.fetch(new Request('https://usage.internal/record', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address: 'wallet-a', event: 'page_view' }),
  }))
  assert.equal(response.status, 400)
})

test('does not invent a last event time for an empty ledger', async () => {
  const { object } = ledger()
  const summary = await (await object.fetch(new Request('https://usage.internal/summary'))).json() as { updatedAt: number }
  assert.equal(summary.updatedAt, 0)
})
