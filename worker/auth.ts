import { verifyAsync } from '@noble/ed25519'
import { sha256 } from '@noble/hashes/sha2.js'
import { clientIp, addressFromPublicKey, normalizeAddress, token } from './http'
import { tooFastByKey } from './limits'
import type { AuthChallengeRecord, Env, SessionRecord } from './types'

const CHALLENGE_TTL = 5 * 60
const SESSION_TTL = 12 * 60 * 60

export interface AuthChallenge {
  challenge: string
  message: string
  expiresAt: number
}
export interface AuthResult {
  token: string
  address: string
  expiresAt: number
}

function hexBytes(value: unknown, length: number): Uint8Array | null {
  if (typeof value !== 'string' || value.length !== length * 2 || !/^[0-9a-f]+$/i.test(value)) return null
  const bytes = new Uint8Array(length)
  for (let index = 0; index < length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}

function signedMessageHash(message: string): Uint8Array {
  // Nimiq's signed message format is a one byte prefix length, the literal
  // prefix, the decimal message length, then the message itself. Challenge
  // messages are ASCII, so JS length and UTF-8 byte length are identical.
  const payload = `\x16Nimiq Signed Message:\n${message.length}${message}`
  return sha256(new TextEncoder().encode(payload))
}

function challengeKey(challenge: string): string {
  return `auth:challenge:${challenge}`
}

function sessionKey(value: string): string {
  return `auth:session:${value}`
}

export async function createChallenge(env: Env, request: Request, addressValue: unknown): Promise<AuthChallenge | null> {
  const address = normalizeAddress(addressValue)
  const hasAddress = addressValue !== null && addressValue !== undefined && addressValue !== ''
  if ((hasAddress && !address) || await tooFastByKey(env, clientIp(request), 'auth-challenge', 5)) return null

  const challenge = token(24)
  const expiresAt = Date.now() + CHALLENGE_TTL * 1000
  const message = `Sign in to Cairn\nNonce: ${challenge}\nExpires: ${expiresAt}`
  const record: AuthChallengeRecord = { address, message, expiresAt, ip: clientIp(request) }
  await env.CAIRN.put(challengeKey(challenge), JSON.stringify(record), { expirationTtl: CHALLENGE_TTL })
  return { challenge, message, expiresAt }
}

export async function verifyChallenge(
  env: Env,
  request: Request,
  raw: unknown,
): Promise<AuthResult | null> {
  if (await tooFastByKey(env, clientIp(request), 'auth-verify', 8)) return null
  if (typeof raw !== 'object' || raw === null) return null
  const body = raw as Record<string, unknown>
  const address = normalizeAddress(body.address)
  const challenge = typeof body.challenge === 'string' ? body.challenge.trim().slice(0, 64) : ''
  const publicKey = hexBytes(body.publicKey, 32)
  const signature = hexBytes(body.signature, 64)
  if (body.address !== undefined && !address) return null
  if (!/^[a-z0-9]{24}$/i.test(challenge) || !publicKey || !signature) return null

  const record = await env.CAIRN.get<AuthChallengeRecord>(challengeKey(challenge), 'json')
  if (!record || record.used || record.expiresAt <= Date.now()) return null
  const ip = clientIp(request)
  if (record.ip !== 'unknown' && ip !== 'unknown' && record.ip !== ip) return null

  try {
    const valid = await verifyAsync(signature, signedMessageHash(record.message), publicKey)
    if (!valid) return null
  } catch {
    return null
  }

  const publicKeyHex = Array.from(publicKey, (byte) => byte.toString(16).padStart(2, '0')).join('')
  const derivedAddress = addressFromPublicKey(publicKeyHex)
  if (!derivedAddress) return null
  if (record.address && record.address !== derivedAddress) return null
  if (address && address !== derivedAddress) return null

  // Atomically mark challenge as used and create session using optimistic locking
  const challengeLockKey = `lock:challenge:${challenge}`
  const existingLock = await env.CAIRN.get(challengeLockKey)
  
  if (existingLock !== null) {
    // Another request is processing this challenge, wait briefly and check if already used
    await new Promise(resolve => setTimeout(resolve, 100))
    const updatedRecord = await env.CAIRN.get<AuthChallengeRecord>(challengeKey(challenge), 'json')
    if (updatedRecord?.used) return null // Challenge was already consumed
    // Retry acquiring lock once
    const retryLock = await env.CAIRN.get(challengeLockKey)
    if (retryLock !== null) return null
  }
  
  // Set lock
  await env.CAIRN.put(challengeLockKey, '1', { expirationTtl: 5 })
  
  try {
    // Re-check record state after acquiring lock
    const freshRecord = await env.CAIRN.get<AuthChallengeRecord>(challengeKey(challenge), 'json')
    if (!freshRecord || freshRecord.used || freshRecord.expiresAt <= Date.now()) return null
    
    // Mark as used atomically within lock
    freshRecord.used = true
    await env.CAIRN.put(challengeKey(challenge), JSON.stringify(freshRecord), { expirationTtl: CHALLENGE_TTL })
    
    const session = token(48)
    const expiresAt = Date.now() + SESSION_TTL * 1000
    const sessionRecord: SessionRecord = { address: derivedAddress, createdAt: Date.now(), expiresAt }
    await env.CAIRN.put(sessionKey(session), JSON.stringify(sessionRecord), { expirationTtl: SESSION_TTL })
    return { token: session, address: derivedAddress, expiresAt }
  } finally {
    await env.CAIRN.delete(challengeLockKey)
  }
}

export interface AuthSession {
  token: string
  address: string
}

export async function requireSession(env: Env, request: Request): Promise<AuthSession | null> {
  const header = request.headers.get('authorization') ?? ''
  const match = /^Bearer ([a-z0-9]{32,96})$/i.exec(header.trim())
  if (!match) return null
  const value = match[1]
  if (!value) return null
  const record = await env.CAIRN.get<SessionRecord>(sessionKey(value), 'json')
  if (!record || record.expiresAt <= Date.now()) return null
  return { token: value, address: record.address }
}
