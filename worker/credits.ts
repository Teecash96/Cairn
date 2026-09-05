/**
 * The credit ledger, the free tier, and the limits that keep both from being
 * farmed.
 *
 * ## Why free credits are capped per device rather than per wallet
 *
 * A Nimiq wallet costs nothing to create. A free tier keyed only to an address is
 * therefore a free tier keyed to nothing: mint a wallet, take three plans, mint
 * another. So the *primary* cap is the device — `requestDeviceIdentifier()` gives
 * a pseudonymous, per-origin identifier that survives a new wallet — with the
 * client IP as a cheap second layer for anyone who declines that prompt.
 *
 * Declining the device prompt must not block anything. It only means the IP cap
 * is the one doing the work.
 *
 * ## The honest caveat about KV
 *
 * Workers KV is eventually consistent and has no atomic increment. Two requests
 * that arrive at the same instant can both read a balance of 1 and both spend it,
 * and a determined attacker with parallel requests can win a few free credits
 * that way. Three things make that acceptable rather than alarming:
 *
 *  1. The prize is a generation, not money. Nothing here custodies funds.
 *  2. `budget:<day>` is a hard ceiling on the total cost of a day, so the worst
 *     case is bounded no matter how the race goes.
 *  3. Paid credits are granted from a verified on-chain payment whose hash is
 *     recorded in `spent:<hash>`, and *that* is the path where being wrong would
 *     actually cost someone something.
 *
 * A Durable Object per address is the correct primitive if this ever needs to be
 * exact. It is a deliberate deferral, not an oversight.
 */
import { today } from './http'
import type { Config } from './config'
import type { CreditRecord, CreditState, DeviceRecord, Env, GiftRecord } from './types'

/** Two is a person with a spare wallet. More is a script. */
const FREE_WALLETS_PER_DEVICE = 2
/** Per UTC day. NimJump used the same shape of limit and placed second. */
const FREE_WALLETS_PER_IP = 3
/** Generations one address may ask for in a minute. Generous; stops a hot loop. */
const REQUESTS_PER_MINUTE = 5
/** Shares one address may mint gift-bearing links for in a day. */
const GIFTS_PER_DAY = 5
/** A second cap protects the gift pool when callers rotate fake addresses. */
const GIFTS_PER_IP = 10

const DAY = 86_400
const KEEP_COUNTERS = 2 * DAY

export function stateOf(record: CreditRecord): CreditState {
  return { free: record.free, paid: record.paid, total: record.free + record.paid }
}

export function creditKey(address: string): string {
  return `credit:${address}`
}

export async function readCredits(env: Env, address: string): Promise<CreditRecord | null> {
  return await env.CAIRN.get<CreditRecord>(creditKey(address), 'json')
}

async function writeCredits(env: Env, address: string, record: CreditRecord): Promise<void> {
  await env.CAIRN.put(creditKey(address), JSON.stringify(record))
}

/**
 * Fetch this wallet's balance, creating it on first sight.
 *
 * The free grant happens exactly once per address, and only if the device and IP
 * behind it have not already had their share. A wallet that arrives from an
 * exhausted device is created with a balance of zero rather than refused — it can
 * still pay, and it still counts as a connected wallet.
 */
export async function ensureCredits(
  env: Env,
  config: Config,
  address: string,
  deviceId: string | null,
  ip: string,
): Promise<CreditRecord> {
  const existing = await readCredits(env, address)
  if (existing) return existing

  const eligible = config.freePlans > 0 && (await claimFreeAllowance(env, address, deviceId, ip))
  const granted = eligible ? config.freePlans : 0

  const record: CreditRecord = {
    free: granted,
    paid: 0,
    createdAt: Date.now(),
    grantedFree: granted,
  }
  await writeCredits(env, address, record)
  return record
}

/**
 * Is this device/IP still allowed to introduce a wallet that gets free plans?
 *
 * Records the address against both counters when it says yes, so the same wallet
 * asking twice is idempotent rather than consuming a second slot.
 */
async function claimFreeAllowance(
  env: Env,
  address: string,
  deviceId: string | null,
  ip: string,
): Promise<boolean> {
  if (deviceId) {
    const key = `device:${deviceId}`
    const record = (await env.CAIRN.get<DeviceRecord>(key, 'json')) ?? {
      addresses: [],
      granted: 0,
    }
    if (record.addresses.includes(address)) return true
    if (record.addresses.length >= FREE_WALLETS_PER_DEVICE) return false

    record.addresses.push(address)
    record.granted += 1
    await env.CAIRN.put(key, JSON.stringify(record))
    return true
  }

  // No device identifier — the prompt was declined, or we are on a browser that
  // has none. Fall back to the IP, which is coarser and shared behind NAT, hence
  // the slightly higher allowance.
  const key = `ipfree:${today()}:${ip}`
  const record = (await env.CAIRN.get<DeviceRecord>(key, 'json')) ?? { addresses: [], granted: 0 }
  if (record.addresses.includes(address)) return true
  if (record.addresses.length >= FREE_WALLETS_PER_IP) return false

  record.addresses.push(address)
  record.granted += 1
  await env.CAIRN.put(key, JSON.stringify(record), { expirationTtl: KEEP_COUNTERS })
  return true
}

/** Spend one generation, free credits first. Returns the balance afterwards. */
export async function spendOne(
  env: Env,
  address: string,
  record: CreditRecord,
): Promise<CreditState> {
  const updated: CreditRecord = { ...record }
  if (updated.free > 0) updated.free -= 1
  else if (updated.paid > 0) updated.paid -= 1

  await writeCredits(env, address, updated)
  return stateOf(updated)
}

/** Add paid credits after a payment has been verified on-chain. */
export async function grantPaid(
  env: Env,
  address: string,
  amount: number,
): Promise<CreditState> {
  const record: CreditRecord = (await readCredits(env, address)) ?? {
    free: 0,
    paid: 0,
    createdAt: Date.now(),
    grantedFree: 0,
  }
  record.paid += amount
  await writeCredits(env, address, record)
  return stateOf(record)
}

// -- gifts ------------------------------------------------------------------

/**
 * Claim the free generation a shared link carries.
 *
 * Single use, and never claimable by the wallet that shared it — otherwise
 * "share, claim your own gift" would be an infinite free tier. Returns how many
 * credits were added, which is 0 for a token that is unknown, already spent, or
 * the claimer's own.
 *
 * Failures are silent by design: a stale link should still open and still work,
 * it just doesn't hand anything over.
 */
export async function claimGift(
  env: Env,
  address: string,
  rawToken: string | null | undefined,
): Promise<number> {
  if (!rawToken || typeof rawToken !== 'string') return 0
  const key = `gift:${rawToken.trim().slice(0, 64)}`

  const gift = await env.CAIRN.get<GiftRecord>(key, 'json')
  if (!gift || gift.claimedBy || gift.from === address) return 0

  gift.claimedBy = address
  await env.CAIRN.put(key, JSON.stringify(gift))

  const record = (await readCredits(env, address)) ?? {
    free: 0,
    paid: 0,
    createdAt: Date.now(),
    grantedFree: 0,
  }
  record.free += 1
  record.grantedFree += 1
  await writeCredits(env, address, record)
  return 1
}

/**
 * Cap on gift-bearing links one wallet can mint per day.
 *
 * Without it, one wallet could share the same plan repeatedly and hand every
 * token to a wallet it also controls. Sharing itself is never blocked — only the
 * gift attached to it. Returns whether a gift may be minted.
 */
export async function allowGift(env: Env, address: string, ip = 'unknown'): Promise<boolean> {
  const key = `giftday:${today()}:${address}`
  const used = (await env.CAIRN.get<number>(key, 'json')) ?? 0
  if (used >= GIFTS_PER_DAY) return false

  const ipKey = `giftip:${today()}:${ip}`
  const ipUsed = (await env.CAIRN.get<number>(ipKey, 'json')) ?? 0
  if (ipUsed >= GIFTS_PER_IP) return false

  await env.CAIRN.put(key, JSON.stringify(used + 1), { expirationTtl: KEEP_COUNTERS })
  await env.CAIRN.put(ipKey, JSON.stringify(ipUsed + 1), { expirationTtl: KEEP_COUNTERS })
  return true
}

// -- limits -----------------------------------------------------------------

/** True when this address is asking faster than any person would. */
export async function tooFast(env: Env, address: string, scope = 'address'): Promise<boolean> {
  const minute = Math.floor(Date.now() / 60_000)
  const key = `rl:${scope}:${address}:${minute}`
  const used = (await env.CAIRN.get<number>(key, 'json')) ?? 0
  if (used >= REQUESTS_PER_MINUTE) return true
  await env.CAIRN.put(key, JSON.stringify(used + 1), { expirationTtl: 120 })
  return false
}

/**
 * The day's spend ceiling.
 *
 * Counted on *attempt*, not on success, because an attempt is what costs money at
 * the model. This is the one limit that must never be bypassable — it is the
 * reason an unbounded bill is impossible.
 */
export async function budgetLeft(env: Env, config: Config): Promise<number> {
  const used = (await env.CAIRN.get<number>(`budget:${today()}`, 'json')) ?? 0
  return Math.max(0, config.dailyBudget - used)
}

export async function chargeBudget(env: Env): Promise<void> {
  const key = `budget:${today()}`
  const used = (await env.CAIRN.get<number>(key, 'json')) ?? 0
  await env.CAIRN.put(key, JSON.stringify(used + 1), { expirationTtl: KEEP_COUNTERS })
}

/** Receipts are single-use, permanently. No TTL — a replay must always be refused. */
export async function isSpent(env: Env, hash: string): Promise<boolean> {
  return (await env.CAIRN.get(`spent:${hash}`)) !== null
}

export async function markSpent(env: Env, hash: string, address: string): Promise<void> {
  await env.CAIRN.put(`spent:${hash}`, address)
}
