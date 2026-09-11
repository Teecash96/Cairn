import assert from 'node:assert/strict'
import test from 'node:test'
import { inspectPayment, verifyPayment } from '../../worker/payments.ts'
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

test('matches canonical receipts case insensitively', async () => {
  const originalFetch = globalThis.fetch
  const hash = 'a'.repeat(64)
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { method: string }
    if (body.method === 'getTransactionHashesByAddress') {
      return new Response(JSON.stringify({ result: { data: [hash.toUpperCase()] } }), { status: 200 })
    }
    return new Response(JSON.stringify({
      result: {
        data: {
          hash: hash.toUpperCase(),
          from: sender,
          to: payTo,
          value: 1_000_000,
          confirmations: 1,
          blockNumber: 100,
        },
      },
    }), { status: 200 })
  }

  try {
    assert.deepEqual(await inspectPayment(config, sender, 1_000_000, hash), { status: 'verified', hash: hash.toUpperCase() })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('reports a canonical payment sent by another wallet', async () => {
  const originalFetch = globalThis.fetch
  const hash = 'b'.repeat(64)
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { method: string }
    if (body.method === 'getTransactionHashesByAddress') {
      return new Response(JSON.stringify({ result: { data: [hash] } }), { status: 200 })
    }
    return new Response(JSON.stringify({
      result: {
        data: {
          hash,
          from: 'NQ01CCCCCCCCCCCCCCCCCCCCCCCCCCCC',
          to: payTo,
          value: 1_000_000,
          confirmations: 12,
          blockNumber: 200,
        },
      },
    }), { status: 200 })
  }

  try {
    assert.deepEqual(await inspectPayment(config, sender, 1_000_000, hash), { status: 'wrong_wallet', hash: null })
    assert.equal(await verifyPayment(config, sender, 1_000_000, hash), null)
  } finally {
    globalThis.fetch = originalFetch
  }
})
