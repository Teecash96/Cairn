import assert from 'node:assert/strict'
import test from 'node:test'
import worker from '../../worker/index.ts'
import { addressFromPublicKey, normalizeAddress, readJson, securityHeaders } from '../../worker/http.ts'
import type { Env } from '../../worker/types.ts'
import { createExamplePlan } from '../../src/lib/example.ts'

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

function env(kv = new MemoryKV()): Env {
  return {
    CAIRN: kv as unknown as KVNamespace,
    ASSETS: {
      fetch: async () => new Response('<!doctype html><title>Cairn</title>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    } as unknown as Fetcher,
    DAILY_BUDGET: '400',
    APP_URL: 'https://cairn.example',
    GEMINI_MODEL: 'gemini-3.1-flash-lite',
    GEMINI_API_KEY: '',
  }
}

const AUTH_ADDRESS = 'NQ19E39QY9EQ937EYQYC13D24LCCUPTN3VPS'
const AUTH_TOKEN = 'a'.repeat(48)

async function seedSession(kv: MemoryKV): Promise<void> {
  await kv.put(`auth:session:${AUTH_TOKEN}`, JSON.stringify({
    address: AUTH_ADDRESS,
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  }))
}

test('strictly validates checksummed Nimiq addresses', () => {
  const valid = 'NQ19 E39Q Y9EQ 937E YQYC 13D2 4LCC UPTN 3VPS'
  assert.equal(normalizeAddress(valid), 'NQ19E39QY9EQ937EYQYC13D24LCCUPTN3VPS')
  assert.equal(normalizeAddress('NQ18 E39Q Y9EQ 937E YQYC 13D2 4LCC UPTN 3VPS'), null)
  assert.equal(addressFromPublicKey('00'.repeat(32)), 'NQ73H7MGSSLAD4ESUB6HBT83D69HRQ5997NA')
})
test('security headers are present and HSTS is HTTPS only', () => {
  const https = securityHeaders()
  assert.equal(https.get('x-content-type-options'), 'nosniff')
  assert.equal(https.get('content-security-policy')?.includes("frame-ancestors 'none'"), true)
  assert.equal(https.get('cross-origin-opener-policy'), 'same-origin-allow-popups')
  assert.equal(https.get('strict-transport-security'), 'max-age=31536000; includeSubDomains')
  const http = securityHeaders({}, false)
  assert.equal(http.get('strict-transport-security'), null)
})

test('remote HTTP is redirected and private routes reject missing sessions', async () => {
  const redirect = await worker.fetch(new Request('http://cairn.example/'), env())
  assert.equal(redirect.status, 301)
  assert.equal(redirect.headers.get('location'), 'https://cairn.example/')

  const response = await worker.fetch(new Request('https://cairn.example/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  }), env())
  assert.equal(response.status, 401)
  assert.equal((await response.json() as { error: string }).error, 'auth_required')
  assert.equal(response.headers.get('x-frame-options'), 'DENY')
})

test('free generation and refinement do not consult the credit ledger', async () => {
  const kv = new MemoryKV()
  await seedSession(kv)
  const workerEnv = env(kv)
  workerEnv.GEMINI_API_KEY = 'test-key'
  const previousFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: 'Temporary provider failure' } }), { status: 503 })) as typeof fetch

  try {
    const headers = {
      'content-type': 'application/json',
      authorization: `Bearer ${AUTH_TOKEN}`,
    }
    const generateResponse = await worker.fetch(new Request('https://cairn.example/api/generate', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        address: AUTH_ADDRESS,
        input: { name: 'Pothole report', idea: 'An app where cyclists report potholes and the council ranks streets.' },
      }),
    }), workerEnv)
    assert.equal(generateResponse.status, 502)
    assert.equal((await generateResponse.json() as { error: string }).error, 'generation_failed')

    const refineResponse = await worker.fetch(new Request('https://cairn.example/api/refine', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        address: AUTH_ADDRESS,
        action: 'cut_mvp_scope',
        plan: createExamplePlan(),
      }),
    }), workerEnv)
    assert.equal(refineResponse.status, 502)
    assert.equal((await refineResponse.json() as { error: string }).error, 'generation_failed')
  } finally {
    globalThis.fetch = previousFetch
  }

  assert.equal([...kv.values.keys()].some((key) => key.startsWith('credit:')), false)
})

test('JSON input rejects non JSON content and oversized UTF 8 payloads', async () => {
  const wrongType = await readJson(new Request('https://cairn.example', {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: '{}',
  }))
  assert.equal(wrongType, null)

  const oversized = await readJson(new Request('https://cairn.example', {
    method: 'POST',
    body: JSON.stringify({ text: '😀'.repeat(100) }),
  }), 100)
  assert.equal(oversized, null)
})
