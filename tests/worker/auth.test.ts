import assert from 'node:assert/strict'
import test from 'node:test'
import { getPublicKeyAsync, signAsync } from '@noble/ed25519'
import { sha256 } from '@noble/hashes/sha2.js'
import { createChallenge, requireSession, verifyChallenge } from '../../worker/auth.ts'
import { addressFromPublicKey } from '../../worker/http.ts'
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

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

test('wallet challenge verifies an Ed25519 signature and creates a session', async () => {
  const secret = Uint8Array.from({ length: 32 }, (_, index) => index + 1)
  const publicKey = await getPublicKeyAsync(secret)
  const publicKeyHex = hex(publicKey)
  const address = addressFromPublicKey(publicKeyHex)
  assert.ok(address)

  const kv = new MemoryKV()
  const request = new Request(`https://cairn.example/api/auth/challenge?address=${address}`, {
    headers: { 'cf-connecting-ip': '198.51.100.10' },
  })
  const challenge = await createChallenge(env(kv), request, address)
  assert.ok(challenge)

  const payload = `\x16Nimiq Signed Message:\n${challenge?.message.length}${challenge?.message}`
  const signature = await signAsync(sha256(new TextEncoder().encode(payload)), secret)
  const verifyRequest = new Request('https://cairn.example/api/auth/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.10' },
    body: JSON.stringify({ address, challenge: challenge?.challenge, publicKey: publicKeyHex, signature: hex(signature) }),
  })
  const result = await verifyChallenge(env(kv), verifyRequest, await verifyRequest.clone().json())
  assert.ok(result)
  assert.equal(result?.address, address)

  const session = await requireSession(env(kv), new Request('https://cairn.example/api/generate', {
    headers: { authorization: `Bearer ${result?.token}` },
  }))
  assert.deepEqual(session, { token: result?.token, address })

  const replay = await verifyChallenge(env(kv), verifyRequest, await verifyRequest.clone().json())
  assert.equal(replay, null)
})
