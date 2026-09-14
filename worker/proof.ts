/**
 * Wallet proof for a plan snapshot.
 *
 * This is deliberately a signed message, not a payment. The wallet owner
 * approves a short, plan-hash-bound statement. The Worker verifies the
 * signature and returns the evidence needed to show that this exact plan was
 * claimed by that wallet.
 */
import { verifyAsync } from '@noble/ed25519'
import { addressFromPublicKey, normalizeAddress, token } from './http'
import { signedMessageHash } from './auth'
import { tooFastByKey } from './limits'
import type { Env, WalletProof, WalletProofChallenge, WalletProofChallengeRecord } from './types'

const PROOF_TTL = 5 * 60
const HASH = /^[a-f0-9]{64}$/i
const CHALLENGE = /^[a-z0-9]{24}$/i

function proofKey(challenge: string): string {
  return `proof:challenge:${challenge}`
}

function hexBytes(value: unknown, length: number): Uint8Array | null {
  if (typeof value !== 'string' || value.length !== length * 2 || !/^[0-9a-f]+$/i.test(value)) return null
  const bytes = new Uint8Array(length)
  for (let index = 0; index < length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}

function hex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Keep the signed text readable in Nimiq Pay and deterministic on the Worker. */
export function planProofMessage(address: string, hash: string, challenge: string, expiresAt: number): string {
  return `Confirm this Cairn plan\nHash: ${hash.toLowerCase()}\nWallet: ${address}\nNonce: ${challenge}\nExpires: ${expiresAt}`
}

export async function createPlanProofChallenge(
  env: Env,
  address: string,
  hash: string,
): Promise<WalletProofChallenge | null> {
  if (!HASH.test(hash) || await tooFastByKey(env, address, 'proof-challenge', 5)) return null

  const challenge = token(24)
  const expiresAt = Date.now() + PROOF_TTL * 1000
  const canonicalHash = hash.toLowerCase()
  const message = planProofMessage(address, canonicalHash, challenge, expiresAt)
  const record: WalletProofChallengeRecord = {
    challenge,
    hash: canonicalHash,
    message,
    expiresAt,
    address,
  }
  await env.CAIRN.put(proofKey(challenge), JSON.stringify(record), { expirationTtl: PROOF_TTL })
  return { challenge, hash: canonicalHash, message, expiresAt }
}

export async function verifyPlanProof(
  env: Env,
  address: string,
  raw: unknown,
): Promise<WalletProof | null> {
  if (await tooFastByKey(env, address, 'proof-verify', 8)) return null
  if (typeof raw !== 'object' || raw === null) return null
  const body = raw as Record<string, unknown>
  const challenge = typeof body.challenge === 'string' ? body.challenge.trim().slice(0, 64) : ''
  const hash = typeof body.hash === 'string' ? body.hash.trim().toLowerCase() : ''
  const publicKey = hexBytes(body.publicKey, 32)
  const signature = hexBytes(body.signature, 64)
  if (!CHALLENGE.test(challenge) || !HASH.test(hash) || !publicKey || !signature) return null

  const record = await env.CAIRN.get<WalletProofChallengeRecord>(proofKey(challenge), 'json')
  if (
    !record ||
    record.used ||
    record.expiresAt <= Date.now() ||
    record.address !== address ||
    record.hash !== hash
  ) return null

  try {
    if (!await verifyAsync(signature, signedMessageHash(record.message), publicKey)) return null
  } catch {
    return null
  }

  const publicKeyHex = hex(publicKey)
  const derivedAddress = addressFromPublicKey(publicKeyHex)
  if (!derivedAddress || normalizeAddress(derivedAddress) !== address) return null

  // KV has no compare-and-swap. Marking used before returning evidence makes
  // the common replay path fail while keeping the same race semantics as auth.
  record.used = true
  await env.CAIRN.put(proofKey(challenge), JSON.stringify(record), { expirationTtl: PROOF_TTL })

  return {
    hash,
    address,
    publicKey: publicKeyHex,
    signature: hex(signature),
    message: record.message,
    createdAt: Date.now(),
  }
}
