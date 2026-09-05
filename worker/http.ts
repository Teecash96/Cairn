/**
 * Responses, CORS, and address handling.
 *
 * Error bodies match what `src/lib/api.ts` parses: `{ error, message, price?,
 * credits? }`, where `error` is one of a closed set of codes so the client can map
 * each to a distinct UI state rather than showing raw server text.
 */
import type { ApiErrorCode, CreditState, PriceQuote } from './types'

export type Cors = Record<string, string>

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
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
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
 * True for loopback and RFC1918 hosts. Used both for CORS and — more
 * importantly — to gate the `DEV_TRUST_PAYMENTS` escape hatch, which must be
 * unreachable on a deployed Worker. A Worker on workers.dev or a custom domain
 * never sees a hostname in these ranges.
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
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Every one of these responses is per-wallet. None of it is cacheable.
      'cache-control': 'no-store',
      ...cors,
    },
  })
}

export function fail(
  code: ApiErrorCode,
  message: string,
  status: number,
  cors: Cors,
  extra: { price?: PriceQuote; credits?: CreditState } = {},
): Response {
  return json({ error: code, message, ...extra }, status, cors)
}

/**
 * Read a JSON body, with a size ceiling.
 *
 * Returns `null` rather than throwing, because every caller's response to a
 * malformed body is the same 400.
 */
export async function readJson(request: Request, maxBytes = 64 * 1024): Promise<unknown> {
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > maxBytes) return null

  let text: string
  try {
    text = await request.text()
  } catch {
    return null
  }
  if (text.length > maxBytes) return null

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
  return ADDRESS.test(compact) ? compact : null
}

/** UTC day, for the daily counters. Never local time — the Worker has no locale. */
export function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Best-effort client IP. Cloudflare sets `CF-Connecting-IP` on every request and
 * it cannot be spoofed by the client; the fallbacks are for `wrangler dev`.
 */
export function clientIp(request: Request): string {
  const value = (
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-real-ip') ??
    'unknown'
  )
  // The Cloudflare header is authoritative in production. The fallback is
  // client supplied during local development, so keep it bounded and printable
  // before it becomes part of a KV key.
  return value.replace(/[^0-9a-zA-Z:._-]/g, '').slice(0, 64) || 'unknown'
}

/**
 * Random token from an alphabet with no look-alike characters, so a share link
 * survives being read aloud or retyped.
 */
export function token(length: number): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  let out = ''
  for (const byte of bytes) out += alphabet[byte % alphabet.length]
  return out
}
