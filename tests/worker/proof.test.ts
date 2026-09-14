import assert from 'node:assert/strict'
import test from 'node:test'
import { getPublicKeyAsync, signAsync } from '@noble/ed25519'
import { sha256 } from '@noble/hashes/sha2.js'
import { addressFromPublicKey } from '../../worker/http.ts'
import { createPlanProofChallenge, verifyPlanProof } from '../../worker/proof.ts'
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

function signedEnvelope(message: string): Uint8Array {
  return sha256(new TextEncoder().encode(`\x16Nimiq Signed Message:\n${message.length}${message}`))
}

test('plan proof binds one wallet signature to the exact plan hash', async () => {
  const secret = Uint8Array.from({ length: 32 }, (_, index) => index + 11)
  const publicKey = await getPublicKeyAsync(secret)
  const publicKeyHex = hex(publicKey)
  const address = addressFromPublicKey(publicKeyHex)
  assert.ok(address)

  const hash = 'a'.repeat(64)
  const kv = new MemoryKV()
  const challenge = await createPlanProofChallenge(env(kv), address ?? '', hash)
  assert.ok(challenge)

  const signature = await signAsync(signedEnvelope(challenge?.message ?? ''), secret)
  const proof = await verifyPlanProof(env(kv), address ?? '', {
    challenge: challenge?.challenge,
    hash,
    publicKey: publicKeyHex,
    signature: hex(signature),
  })

  assert.equal(proof?.address, address)
  assert.equal(proof?.hash, hash)
  assert.equal(proof?.publicKey, publicKeyHex)
  assert.equal(proof?.signature, hex(signature))
  assert.match(proof?.message ?? '', /Confirm this Cairn plan/)

  const replay = await verifyPlanProof(env(kv), address ?? '', {
    challenge: challenge?.challenge,
    hash,
    publicKey: publicKeyHex,
    signature: hex(signature),
  })
  assert.equal(replay, null)
})

test('plan proof rejects a changed hash or a different wallet', async () => {
  const firstSecret = Uint8Array.from({ length: 32 }, (_, index) => index + 41)
  const secondSecret = Uint8Array.from({ length: 32 }, (_, index) => index + 81)
  const firstPublicKey = await getPublicKeyAsync(firstSecret)
  const secondPublicKey = await getPublicKeyAsync(secondSecret)
  const firstPublicKeyHex = hex(firstPublicKey)
  const secondPublicKeyHex = hex(secondPublicKey)
  const firstAddress = addressFromPublicKey(firstPublicKeyHex)
  const secondAddress = addressFromPublicKey(secondPublicKeyHex)
  assert.ok(firstAddress)
  assert.ok(secondAddress)

  const hash = 'b'.repeat(64)
  const kv = new MemoryKV()
  const challenge = await createPlanProofChallenge(env(kv), firstAddress ?? '', hash)
  assert.ok(challenge)
  const signature = await signAsync(signedEnvelope(challenge?.message ?? ''), secondSecret)

  assert.equal(await verifyPlanProof(env(kv), firstAddress ?? '', {
    challenge: challenge?.challenge,
    hash: 'c'.repeat(64),
    publicKey: secondPublicKeyHex,
    signature: hex(signature),
  }), null)
  assert.equal(await verifyPlanProof(env(kv), firstAddress ?? '', {
    challenge: challenge?.challenge,
    hash,
    publicKey: secondPublicKeyHex,
    signature: hex(signature),
  }), null)
})
