import assert from 'node:assert/strict'
import test from 'node:test'
import { budgetLeft, chargeBudget, tooFast, tooFastByKey } from '../../worker/limits.ts'
import type { Config } from '../../worker/config.ts'
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

const config: Config = {
  model: 'gemini-3.1-flash-lite',
  dailyBudget: 2,
  appUrl: 'https://cairn.example',
}

test('rate limits repeated wallet requests', async () => {
  const kv = new MemoryKV()
  for (let index = 0; index < 5; index += 1) {
    assert.equal(await tooFast(env(kv), 'wallet-a'), false)
  }
  assert.equal(await tooFast(env(kv), 'wallet-a'), true)
})

test('supports route specific rate limits', async () => {
  const kv = new MemoryKV()
  assert.equal(await tooFastByKey(env(kv), 'wallet-a', 'share', 1), false)
  assert.equal(await tooFastByKey(env(kv), 'wallet-a', 'share', 1), true)
  assert.equal(await tooFastByKey(env(kv), 'wallet-a', 'team', 1), false)
})

test('daily capacity falls when an AI attempt is charged', async () => {
  const kv = new MemoryKV()
  assert.equal(await budgetLeft(env(kv), config), 2)
  await chargeBudget(env(kv))
  assert.equal(await budgetLeft(env(kv), config), 1)
  await chargeBudget(env(kv))
  assert.equal(await budgetLeft(env(kv), config), 0)
})
