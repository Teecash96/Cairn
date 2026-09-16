import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clearPendingPayment,
  clearPendingReward,
  loadPendingPayment,
  loadPendingReward,
  savePendingPayment,
  savePendingReward,
} from '../../src/lib/payment-session.ts'

class MemoryStorage {
  readonly values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return Array.from(this.values.keys())[index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

test('pending payments survive a new app session and can be cleared', () => {
  const storage = new MemoryStorage()
  const now = Date.now()
  const originalNow = Date.now
  Date.now = () => now
  try {
    savePendingPayment({ address: 'NQ00 payer', receipt: 'transaction-hash' }, storage)
  } finally {
    Date.now = originalNow
  }

  assert.deepEqual(loadPendingPayment(storage, now + 60_000), {
    address: 'NQ00 payer',
    receipt: 'transaction-hash',
  })
  clearPendingPayment(storage)
  assert.equal(loadPendingPayment(storage, now + 60_000), null)
})

test('expired pending payments are discarded', () => {
  const storage = new MemoryStorage()
  const now = Date.now()
  const originalNow = Date.now
  Date.now = () => now
  try {
    savePendingPayment({ address: 'NQ00 payer', receipt: 'old-hash' }, storage)
  } finally {
    Date.now = originalNow
  }

  assert.equal(loadPendingPayment(storage, now + 8 * 24 * 60 * 60 * 1000), null)
  assert.equal(storage.length, 0)
})

test('pending teammate rewards survive reloads without requesting another payment', () => {
  const storage = new MemoryStorage()
  const reward = {
    teamId: 'abcdefghijklmnop', taskId: 'task-one', recipient: 'NQ00 teammate',
    amountLuna: 100_000, receipt: 'reward-hash', revision: 4,
  }
  savePendingReward(reward, storage)
  assert.deepEqual(loadPendingReward(storage), reward)
  clearPendingReward(storage)
  assert.equal(loadPendingReward(storage), null)
})
