import { token } from './http'
import { clampPlan } from './shape'
import type { Config } from './config'
import type { Env, PublicPlan, ShareRecord } from './types'

const SHARE_TTL = 60 * 60 * 24 * 365

export async function createShare(
  env: Env,
  config: Config,
  address: string,
  rawPlan: unknown,
  requestUrl: URL,
): Promise<{ shareId: string; url: string }> {
  const shareId = token(12)
  const plan = clampPlan(rawPlan, shareId, Date.now())
  if ('message' in plan) throw new Error(plan.message)

  const record: ShareRecord = { plan, by: address, createdAt: Date.now() }
  await env.CAIRN.put(`share:${shareId}`, JSON.stringify(record), { expirationTtl: SHARE_TTL })

  const base = config.appUrl || requestUrl.origin
  const url = new URL(`${base}/`)
  url.searchParams.set('s', shareId)
  return { shareId, url: url.toString() }
}

export async function readShare(env: Env, shareId: string): Promise<ShareRecord | null> {
  return await env.CAIRN.get<ShareRecord>(`share:${shareId}`, 'json')
}

export function publicPlan(record: ShareRecord): PublicPlan {
  return { ...record.plan, shareId: record.plan.id }
}
