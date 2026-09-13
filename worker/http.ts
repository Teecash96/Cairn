/**
 * Responses, CORS, and address handling.
 *
 * Error bodies match what `src/lib/api.ts` parses: `{ error, message }`, where
 * `error` is one of a closed set of codes so the client can map
 * each to a distinct UI state rather than showing raw server text.
 */
import type { ApiErrorCode } from './types'
import { blake2b } from '@noble/hashes/blake2.js'

export type Cors = Record<string, string>

const MAX_JSON_RESPONSE_BYTES = 256 * 1024
const NIMIQ_ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVXY'
const NIMIQ_PREFIX_NUMERIC = '2326'

/**
 * In production the app and the API are the same origin, so no CORS headers are
 * needed or sent. They exist for two development shapes: `vite dev` on :5173
 * talking to `wrangler dev` on :8787, and the same over a LAN address, which is
 * how the app gets tested inside Nimiq Pay on a real handset.
 *
 * Only loopback and private-range origins are ever allowed. A public origin gets
 * no CORS headers at all, which is the correct answer for a same-origin API.
 */
export function corsHeaders(request: Request): Cors {
  const origin = request.headers.get('origin')
  if (!origin || !isLocalOrigin(origin)) return {}

  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-max-age': '86400',
    vary: 'origin',
  }
}

function isLocalOrigin(origin: string): boolean {
  let host: string
  try {
    host = new URL(origin).hostname
  } catch {
    return false
  }
  return isLocalHost(host)
}

/**
 * True for loopback and RFC1918 hosts. A Worker on workers.dev or a custom
 * domain never sees a hostname in these ranges.
 */
export function isLocalHost(host: string): boolean {
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') return true
  if (host.endsWith('.localhost')) return true
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true
  if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host)) return true
  return false
}

export function json(data: unknown, status: number, cors: Cors): Response {
  const body = JSON.stringify(data)
  if (new TextEncoder().encode(body).byteLength > MAX_JSON_RESPONSE_BYTES) {
    return new Response(JSON.stringify({ error: 'server', message: 'Response too large.' }), {
      status: 500,
      headers: securityHeaders({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cors }),
    })
  }
  return new Response(body, {
    status,
    headers: securityHeaders({
      'content-type': 'application/json; charset=utf-8',
      // Every one of these responses is per-wallet. None of it is cacheable.
      'cache-control': 'no-store',
      ...cors,
    }),
  })
}

/** Security headers shared by API responses and the static app. */
export function securityHeaders(existing: HeadersInit = {}, https = true): Headers {
  const headers = new Headers(existing)
  headers.set('x-content-type-options', 'nosniff')
  headers.set('referrer-policy', 'no-referrer')
  headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=()')
  headers.set('content-security-policy', "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; form-action 'self'")
  // Nimiq Hub returns wallet signatures through a cross-origin popup. Keeping
  // the opener relationship is required for its postMessage handshake.
  headers.set('cross-origin-opener-policy', 'same-origin-allow-popups')
  headers.set('cross-origin-resource-policy', 'same-origin')
  headers.set('x-frame-options', 'DENY')
  if (https) headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains')
  return headers
}

export function fail(
  code: ApiErrorCode,
  message: string,
  status: number,
  cors: Cors,
  details: Record<string, unknown> = {},
): Response {
  return json({ ...details, error: code, message }, status, cors)
}

/**
 * Read a JSON body, with a size ceiling.
 *
 * Returns `null` rather than throwing, because every caller's response to a
 * malformed body is the same 400.
 */
export async function readJson(request: Request, maxBytes = 64 * 1024): Promise<unknown> {
  const contentType = request.headers.get('content-type')
  if (contentType && !/^application\/json(?:\s*;|$)/i.test(contentType)) return null
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > maxBytes) return null

  let text: string
  try {
    text = await request.text()
  } catch {
    return null
  }
  if (new TextEncoder().encode(text).byteLength > maxBytes) return null

  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

// -- addresses --------------------------------------------------------------

/**
 * Nimiq's user-friendly address alphabet: base32 without I, O, W or Z, so that
 * nothing in an address can be misread as something else.
 */
const ADDRESS = /^NQ[0-9]{2}[0-9A-HJ-NP-VXY]{32}$/

function mod97(value: string): number {
  let remainder = 0
  for (const character of value) {
    const expanded = /[A-Z]/.test(character) ? String(character.charCodeAt(0) - 55) : character
    for (const digit of expanded) remainder = (remainder * 10 + Number(digit)) % 97
  }
  return remainder
}

function decodePayload(payload: string): Uint8Array | null {
  const output = new Uint8Array(20)
  let accumulator = 0
  let bits = 0
  let offset = 0
  for (const character of payload) {
    const value = NIMIQ_ALPHABET.indexOf(character)
    if (value < 0) return null
    accumulator = (accumulator << 5) | value
    bits += 5
    while (bits >= 8) {
      bits -= 8
      if (offset >= output.length) return null
      output[offset] = (accumulator >> bits) & 0xff
      offset += 1
    }
  }
  return offset === output.length ? output : null
}

function encodePayload(bytes: Uint8Array): string {
  let output = ''
  let accumulator = 0
  let bits = 0
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      output += NIMIQ_ALPHABET[(accumulator >> bits) & 31]
    }
  }
  return output
}

function checksum(payload: string): string {
  const value = 98 - mod97(`${payload}${NIMIQ_PREFIX_NUMERIC}00`)
  return String(value).padStart(2, '0')
}

function isValidChecksum(compact: string): boolean {
  const payload = compact.slice(4)
  const checkDigits = compact.slice(2, 4)
  return mod97(`${payload}${NIMIQ_PREFIX_NUMERIC}${checkDigits}`) === 1
}

/** Decode and validate a compact Nimiq user-friendly address. */
export function addressBytes(value: unknown): Uint8Array | null {
  if (typeof value !== 'string') return null
  const compact = value.replace(/\s+/g, '').toUpperCase()
  if (!ADDRESS.test(compact) || !isValidChecksum(compact)) return null
  return decodePayload(compact.slice(4))
}

/** Derive a Nimiq address from an Ed25519 public key returned by `sign()`. */
export function addressFromPublicKey(publicKeyHex: string): string | null {
  if (!/^[0-9a-f]{64}$/i.test(publicKeyHex)) return null
  const publicKey = new Uint8Array(publicKeyHex.match(/../gi)?.map((part) => Number.parseInt(part, 16)) ?? [])
  if (publicKey.length !== 32) return null
  const payload = encodePayload(blake2b(publicKey, { dkLen: 32 }).slice(0, 20))
  if (payload.length !== 32) return null
  return `NQ${checksum(payload)}${payload}`
}

/**
 * Strip the display spaces and upper-case, so that one wallet is one KV key.
 *
 * This matters on both sides of a comparison: the SDK hands back a spaced,
 * human-readable address and so does the RPC node, and neither is guaranteed to
 * space it the same way.
 */
export function normalizeAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const compact = value.replace(/\s+/g, '').toUpperCase()
  return addressBytes(compact) ? compact : null
}

/** UTC day, for the daily counters. Never local time — the Worker has no locale. */
export function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Best-effort client IP. Cloudflare sets `CF-Connecting-IP` on every request and
 * it cannot be spoofed by the client; the fallbacks are for `wrangler dev`.
 * 
 * SECURITY: Only use CF-Connecting-IP in production. x-real-ip is client-controllable
 * and must never be trusted for security decisions.
 */
export function clientIp(request: Request): string {
  // In production (Cloudflare), only trust the verified CF header
  const cfIp = request.headers.get('cf-connecting-ip')
  if (cfIp) {
    return cfIp.replace(/[^0-9a-zA-Z:._-]/g, '').slice(0, 64) || 'unknown'
  }
  
  // For local development only, fall back to x-forwarded-for or x-real-ip
  // These headers are NOT trustworthy in production
  const forwardedFor = request.headers.get('x-forwarded-for')
  if (forwardedFor) {
    // Take the first IP in the chain (original client)
    const firstIp = forwardedFor.split(',')[0].trim()
    return firstIp.replace(/[^0-9a-zA-Z:._-]/g, '').slice(0, 64) || 'unknown'
  }
  
  return 'unknown'
}

/**
 * Random token from an alphabet with no look-alike characters, so a share link
 * survives being read aloud or retyped.
 * 
 * Uses cryptographically secure random values and avoids modulo bias by using
 * bitwise AND with a mask for power-of-2 alphabet sizes.
 */
export function token(length: number): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789' // 32 chars (power of 2)
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  let out = ''
  // Alphabet size is 32 (2^5), so we can use lower 5 bits directly without modulo bias
  const mask = 0b11111 // 31, for 32-character alphabet
  for (const byte of bytes) out += alphabet[byte & mask]
  return out
}
