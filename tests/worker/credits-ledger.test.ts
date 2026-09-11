import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { grantPaid, isSpent, markSpent, readCredits, spendOne, stateOf } from '../../worker/credits'

class MemoryKv {
  values = new Map<string, string>()
  async get<T>(key: string, type?: string): Promise<T | string | null> {
    const value = this.values.get(key)
    if (value === undefined) return null
    return (type === 'json' ? JSON.parse(value) : value) as T
  }
  async put(key: string, value: string): Promise<void> {
    this.values.set(key, value)
  }
}

function env() {
  return { CAIRN: new MemoryKv() } as unknown as import('../../worker/types').Env
}

describe('paid credit ledger', () => {
  it('starts at zero and spends only granted credits', async () => {
    const runtime = env()
    assert.deepEqual(stateOf(await readCredits(runtime, 'NQ1')), { paid: 0, total: 0 })
    assert.equal(await spendOne(runtime, 'NQ1'), null)
    assert.deepEqual(await grantPaid(runtime, 'NQ1', 10), { paid: 10, total: 10 })
    assert.deepEqual(await spendOne(runtime, 'NQ1'), { paid: 9, total: 9 })
  })

  it('records a transaction hash as permanently spent', async () => {
    const runtime = env()
    assert.equal(await isSpent(runtime, 'abc'), false)
    await markSpent(runtime, 'abc', 'NQ1')
    assert.equal(await isSpent(runtime, 'abc'), true)
  })
})
