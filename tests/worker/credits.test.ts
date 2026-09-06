import assert from 'node:assert/strict'
import test from 'node:test'
import { allowGift, claimGift, ensureCredits, grantPaid, spendOne, stateOf, tooFast } from '../../worker/credits.ts'
import type { Config } from '../../worker/config.ts'
import type { CreditRecord, Env, GiftRecord } from '../../worker/types.ts'

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

const config: Config = {
  model: 'gemini-3.1-flash-lite',
  priceLuna: 1_000_000,
  plansPerPayment: 10,
  freePlans: 3,
  dailyBudget: 400,
  rpcUrl: '',
  payTo: null,
  appUrl: '',
  trustPaymentsInDev: false,
}

test('spends free credits before paid credits', async () => {
  const kv = new MemoryKV()
  const record: CreditRecord = { free: 1, paid: 2, createdAt: 0, grantedFree: 1 }
  assert.deepEqual(await spendOne(env(kv), 'NQ01AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', record), { free: 0, paid: 2, total: 2 })
  assert.deepEqual(await spendOne(env(kv), 'NQ01AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', { ...record, free: 0 }), { free: 0, paid: 1, total: 1 })
})

test('paid credits are granted and reflected in the total', async () => {
  const kv = new MemoryKV()
  const result = await grantPaid(env(kv), 'NQ01AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 10)
  assert.deepEqual(result, stateOf({ free: 0, paid: 10, createdAt: 0, grantedFree: 0 }))
})

test('a pay-it-forward gift is single use and cannot be claimed by its giver', async () => {
  const kv = new MemoryKV()
  const giver = 'NQ01AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
  const recipient = 'NQ01BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
  const gift: GiftRecord = { from: giver, shareId: 'share-1' }
  await kv.put('gift:gift-1', JSON.stringify(gift))

  assert.equal(await claimGift(env(kv), giver, 'gift-1'), 0)
  assert.equal(await claimGift(env(kv), recipient, 'gift-1'), 1)
  assert.equal(await claimGift(env(kv), recipient, 'gift-1'), 0)
})

test('gift creation is capped by both wallet and client network', async () => {
  const kv = new MemoryKV()
  assert.equal(await allowGift(env(kv), 'wallet-a', '198.51.100.10'), true)
  assert.equal(await allowGift(env(kv), 'wallet-a', '198.51.100.10'), true)
  assert.equal(await allowGift(env(kv), 'wallet-a', '198.51.100.10'), true)
  assert.equal(await allowGift(env(kv), 'wallet-a', '198.51.100.10'), true)
  assert.equal(await allowGift(env(kv), 'wallet-a', '198.51.100.10'), true)
  assert.equal(await allowGift(env(kv), 'wallet-a', '198.51.100.10'), false)

  const otherKv = new MemoryKV()
  for (let index = 0; index < 10; index += 1) {
    assert.equal(await allowGift(env(otherKv), `wallet-${index}`, '198.51.100.11'), true)
  }
  assert.equal(await allowGift(env(otherKv), 'wallet-11', '198.51.100.11'), false)
})

test('rate-limit scopes do not collide across expensive routes', async () => {
  const kv = new MemoryKV()
  assert.equal(await tooFast(env(kv), 'wallet-a', 'redeem'), false)
  assert.equal(await tooFast(env(kv), 'wallet-a', 'share'), false)
})

test('fake device identifiers cannot bypass the server observed IP free cap', async () => {
  const kv = new MemoryKV()
  const ip = '198.51.100.20'

  for (let index = 0; index < 3; index += 1) {
    const record = await ensureCredits(env(kv), config, `wallet-${index}`, `fake-device-${index}`, ip)
    assert.equal(record.free, 3)
  }

  const fourth = await ensureCredits(env(kv), config, 'wallet-3', 'another-fake-device', ip)
  assert.equal(fourth.free, 0)
})
