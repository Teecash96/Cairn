import assert from 'node:assert/strict'
import test from 'node:test'
import { verifyPayment } from '../../worker/payments.ts'
import type { Config } from '../../worker/config.ts'

const sender = 'NQ01AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const payTo = 'NQ01BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'

const config: Config = {
  model: 'gemini-3.1-flash-lite',
  priceLuna: 1_000_000,
  plansPerPayment: 10,
  dailyBudget: 400,
  rpcUrl: 'https://rpc.test',
  payTo,
  appUrl: '',
  trustPaymentsInDev: false,
}

test('verifies a matching incoming transaction by sender and amount', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { method: string }
    if (body.method === 'getTransactionHashesByAddress') {
      return new Response(JSON.stringify({ result: { data: ['hash-1'] } }), { status: 200 })
    }
    return new Response(JSON.stringify({
      result: {
        data: {
          hash: 'hash-1',
          from: 'NQ01 AAAA AAAA AAAA AAAA AAAA AAAA AAAA AAAA',
          to: 'NQ01 BBBB BBBB BBBB BBBB BBBB BBBB BBBB BBBB',
          value: '1000000',
          confirmations: 2,
          blockNumber: 100,
        },
      },
    }), { status: 200 })
  }

  try {
    assert.equal(await verifyPayment(config, sender, 1_000_000, 'opaque-receipt'), 'hash-1')
    assert.equal(await verifyPayment(config, sender, 1_000_000), 'hash-1')
    assert.equal(await verifyPayment(config, sender, 2_000_000, 'opaque-receipt'), null)
  } finally {
    globalThis.fetch = originalFetch
  }
})


test('checks a canonical receipt directly without loading address history', async () => {
  const hash = 'a'.repeat(64)
  const calls: string[] = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body))
    calls.push(request.method)
    assert.deepEqual(request.params, [hash])
    return new Response(JSON.stringify({ result: { data: { hash, from: sender, to: payTo, value: 1000000, confirmations: 1 } } }))
  }
  try {
    assert.equal(await verifyPayment(config, sender, 1000000, hash.toUpperCase()), hash)
    assert.deepEqual(calls, ['getTransactionByHash'])
  } finally { globalThis.fetch = originalFetch }
})

test('direct lookup never grants for a missing, unconfirmed, mismatched or underpaid transaction', async () => {
  const hash = 'b'.repeat(64)
  const valid = { hash, from: sender, to: payTo, value: 1000000, confirmations: 1 }
  const originalFetch = globalThis.fetch
  try {
    for (const transaction of [null, { ...valid, confirmations: 0 }, { ...valid, hash: 'c'.repeat(64) }, { ...valid, from: payTo }, { ...valid, to: sender }, { ...valid, value: 1 }]) {
      const calls: string[] = []
      globalThis.fetch = async (_input, init) => {
        calls.push(JSON.parse(String(init?.body)).method)
        return new Response(JSON.stringify({ result: { data: transaction } }))
      }
      assert.equal(await verifyPayment(config, sender, 1000000, hash), null)
      assert.deepEqual(calls, ['getTransactionByHash'])
    }
  } finally { globalThis.fetch = originalFetch }
})
