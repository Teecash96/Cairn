import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { createRequire } from 'node:module'
import { CreditLedger } from '../../worker/credit-ledger.ts'
import { readCredits, redeemCredits, spendOne, stateOf } from '../../worker/credits.ts'
import worker from '../../worker/index.ts'
import type { Env } from '../../worker/types.ts'

// Exercise the real SQLite-backed Durable Object using Wrangler's own emulator.
const require = createRequire(import.meta.url)
const wranglerRequire = createRequire(require.resolve('wrangler/package.json'))
const { Miniflare, convertV4MiniflareOptions } = wranglerRequire('miniflare')
let runtime: InstanceType<typeof Miniflare>
let env: Env
let kv: KVNamespace

before(async () => {
  runtime = new Miniflare(convertV4MiniflareOptions({ workers: [{
    name: 'ledger-test',
    modules: true,
    script: `export ${CreditLedger.toString()}
export class FaultLedger extends CreditLedger {
  constructor(state, env) {
    let failOnce = true;
    super({storage: {
      get: state.storage.get.bind(state.storage),
      transaction: (callback) => state.storage.transaction(async (tx) => {
        const result = await callback(tx);
        if (failOnce) { failOnce = false; throw new Error('Injected failure after writes'); }
        return result;
      })
    }}, env);
  }
}
export default { fetch() { return new Response('test'); } }`,
    compatibilityDate: '2026-08-01',
    kvNamespaces: ['CAIRN'],
    durableObjects: { CREDIT_LEDGER: { className: 'CreditLedger', useSQLite: true }, FAULT_LEDGER: { className: 'FaultLedger', useSQLite: true } },
  }] }))
  kv = await runtime.getKVNamespace('CAIRN')
  env = { CREDIT_LEDGER: await runtime.getDurableObjectNamespace('CREDIT_LEDGER'), CREDIT_LEDGER_READY: '1' } as Env
})
after(async () => { await runtime?.dispose() })

describe('atomic paid credit ledger', () => {
  it('starts at zero, rejects an empty spend, and grants only verified receipts', async () => {
    assert.deepEqual(stateOf(await readCredits(env, 'wallet-empty')), { paid: 0, total: 0 })
    assert.equal(await spendOne(env, 'wallet-empty'), null)
    assert.deepEqual(await redeemCredits(env, 'wallet-empty', 'receipt-first', 10), { credits: { paid: 10, total: 10 }, granted: 10 })
    assert.deepEqual(await spendOne(env, 'wallet-empty'), { paid: 9, total: 9 })
  })

  it('allows exactly one concurrent spend from a one-credit balance', async () => {
    await redeemCredits(env, 'wallet-spend', 'receipt-spend', 1)
    const results = await Promise.all(Array.from({ length: 12 }, () => spendOne(env, 'wallet-spend')))
    assert.equal(results.filter(Boolean).length, 1)
    assert.equal((await readCredits(env, 'wallet-spend'))?.paid, 0)
  })

  it('does not lose concurrent grants from different payments', async () => {
    await Promise.all(Array.from({ length: 12 }, (_, i) => redeemCredits(env, 'wallet-grants', `receipt-grants-${i}`, 10)))
    assert.equal((await readCredits(env, 'wallet-grants'))?.paid, 120)
  })

  it('redeems concurrent retries once, and rejects another wallet reusing the hash', async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => redeemCredits(env, 'wallet-retry', 'receipt-retry', 10)))
    assert.equal(results.reduce((sum, result) => sum + (result?.granted ?? 0), 0), 10)
    assert.equal((await readCredits(env, 'wallet-retry'))?.paid, 10)
    assert.equal(await redeemCredits(env, 'wallet-other', 'receipt-retry', 10), null)
    await spendOne(env, 'wallet-retry')
    assert.deepEqual(await redeemCredits(env, 'wallet-retry', 'RECEIPT-RETRY', 10), { credits: { paid: 9, total: 9 }, granted: 0 })
  })

  it('imports legacy balance once, preserves old spent receipts, and never reimports spent credits', async () => {
    await kv.put('credit:wallet-legacy', JSON.stringify({ paid: 3, createdAt: 100 }))
    await kv.put('spent:receipt-legacy', 'wallet-legacy')
    const reads = await Promise.all(Array.from({ length: 6 }, () => readCredits(env, 'wallet-legacy')))
    assert.ok(reads.every((record) => record?.paid === 3 && record.createdAt === 100))
    assert.equal(await redeemCredits(env, 'wallet-legacy', 'receipt-legacy', 10), null)
    await Promise.all(Array.from({ length: 3 }, () => spendOne(env, 'wallet-legacy')))
    assert.equal((await readCredits(env, 'wallet-legacy'))?.paid, 0)
  })

  it('fails closed for a missing binding or unfinished cutover', async () => {
    await assert.rejects(readCredits({} as Env, 'wallet'), /maintenance/)
    await assert.rejects(readCredits({ ...env, CREDIT_LEDGER_READY: '0' }, 'wallet'), /maintenance/)
  })

  it('leaves a rejected grant redeemable after balance overflow', async () => {
    await kv.put('credit:wallet-overflow', JSON.stringify({ paid: Number.MAX_SAFE_INTEGER, createdAt: 100 }))
    await assert.rejects(redeemCredits(env, 'wallet-overflow', 'receipt-overflow', 1), /unavailable/)
    await spendOne(env, 'wallet-overflow')
    const retry = await redeemCredits(env, 'wallet-overflow', 'receipt-overflow', 1)
    assert.equal(retry?.granted, 1)
    assert.equal(retry?.credits.paid, Number.MAX_SAFE_INTEGER)
  })
})

it('rolls back both writes on a failure between transaction callback and commit', async () => {
  const faultEnv = { ...env, CREDIT_LEDGER: await runtime.getDurableObjectNamespace('FAULT_LEDGER') } as Env
  await assert.rejects(redeemCredits(faultEnv, 'wallet-fault', 'receipt-fault', 10), /unavailable/)
  assert.equal((await readCredits(faultEnv, 'wallet-fault'))?.paid, 0)
  assert.deepEqual(await redeemCredits(faultEnv, 'wallet-fault', 'receipt-fault', 10), { credits: { paid: 10, total: 10 }, granted: 10 })
})

it('returns maintenance without spending and preserves credits when generation fails', async () => {
  const address = 'NQ19E39QY9EQ937EYQYC13D24LCCUPTN3VPS'
  const token = 'a'.repeat(48)
  await kv.put(`auth:session:${token}`, JSON.stringify({ address, createdAt: Date.now(), expiresAt: Date.now() + 60_000 }))
  const requestEnv = { ...env, CAIRN: kv, DAILY_BUDGET: '400', GEMINI_API_KEY: 'test-key', GEMINI_MODEL: 'test-model' } as Env
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  const maintenance = await worker.fetch(new Request('https://cairn.example/api/credits', { headers }), { ...requestEnv, CREDIT_LEDGER_READY: '0' })
  assert.equal(maintenance.status, 503)
  await redeemCredits(env, address, 'receipt-ai-failure', 1)
  const previousFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'Temporary provider failure' } }), { status: 503 })
  try {
    const failed = await worker.fetch(new Request('https://cairn.example/api/generate', {
      method: 'POST', headers,
      body: JSON.stringify({ address, input: { name: 'Test plan', idea: 'A tool that helps meetup organisers manage ticket check-in.' } }),
    }), requestEnv)
    assert.equal(failed.status, 502)
    assert.equal((await readCredits(env, address))?.paid, 1)
  } finally { globalThis.fetch = previousFetch }
})
