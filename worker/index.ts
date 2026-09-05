import { budgetLeft, chargeBudget, claimGift, ensureCredits, isSpent, markSpent, readCredits, spendOne, grantPaid, tooFast, stateOf } from './credits'
import { readConfig, quote } from './config'
import { fail, clientIp, corsHeaders, isLocalHost, json, normalizeAddress, readJson } from './http'
import { generateWithAnthropic, refineWithAnthropic } from './generate'
import { verifyPayment } from './payments'
import { clampPlan, isInvalid, readPlanInput } from './shape'
import { createShare, publicPlan, readShare } from './share'
import type { Env, PlanInput, RefineAction } from './types'

function bodyRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null
}

function addressFrom(value: unknown): string | null {
  return normalizeAddress(value)
}

function deviceFrom(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const device = value.trim()
  // Device identifiers are opaque, but they must stay bounded before they are
  // used as KV key material. Controls are rejected rather than normalised.
  if (!device || device.length > 128 || /[\u0000-\u001f\u007f]/.test(device)) return null
  return device
}

function refineAction(value: unknown): RefineAction | null {
  if (
    value === 'cut_mvp_scope' ||
    value === 'break_into_tasks' ||
    value === 'find_missing_risks' ||
    value === 'improve_acceptance_tests' ||
    value === 'custom'
  ) return value
  return null
}

function originIsLocal(request: Request): boolean {
  try { return isLocalHost(new URL(request.url).hostname) } catch { return false }
}

async function localReceiptKey(receipt: string): Promise<string> {
  const bytes = new TextEncoder().encode(receipt)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `dev:${hex}`
}

async function addressAndCredits(env: Env, request: Request, addressValue: unknown, deviceId: unknown) {
  const address = addressFrom(addressValue)
  if (!address) return null
  const config = readConfig(env)
  const record = await ensureCredits(env, config, address, deviceFrom(deviceId), clientIp(request))
  return { address, config, record }
}

async function handleCredits(env: Env, request: Request, url: URL, cors: Record<string, string>): Promise<Response> {
  const context = await addressAndCredits(env, request, url.searchParams.get('address'), url.searchParams.get('deviceId'))
  if (!context) return fail('invalid_request', 'Connect a valid Nimiq wallet.', 400, cors)
  return json({ credits: stateOf(context.record), price: context.config.payTo ? quote(context.config, context.config.payTo) : null }, 200, cors)
}

async function handleGenerate(env: Env, request: Request, cors: Record<string, string>): Promise<Response> {
  const raw = bodyRecord(await readJson(request))
  if (!raw) return fail('invalid_request', 'The request body is invalid.', 400, cors)
  const context = await addressAndCredits(env, request, raw.address, raw.deviceId)
  if (!context) return fail('invalid_request', 'Connect a valid Nimiq wallet.', 400, cors)
  const input = readPlanInput(raw.input)
  if (isInvalid(input)) return fail('invalid_request', input.message, 400, cors)

  if (raw.gift && typeof raw.gift === 'string') await claimGift(env, context.address, raw.gift)
  const refreshed = (await readCredits(env, context.address)) ?? context.record
  if (refreshed.free + refreshed.paid < 1) {
    return fail('payment_required', 'Your free plans are used. Add more plans with NIM.', 402, cors, {
      credits: stateOf(refreshed),
      price: context.config.payTo ? quote(context.config, context.config.payTo) : undefined,
    })
  }
  if (await tooFast(env, context.address)) return fail('rate_limited', 'Please wait a moment before generating again.', 429, cors)
  if (await budgetLeft(env, context.config) < 1) return fail('budget_exhausted', 'Today’s generation limit has been reached. Try again tomorrow.', 429, cors)
  if (!env.ANTHROPIC_API_KEY) return fail('server', 'Cairn is not configured with an AI key yet.', 503, cors)

  await chargeBudget(env)
  try {
    const result = await generateWithAnthropic(context.config, env.ANTHROPIC_API_KEY, input as PlanInput)
    const credits = await spendOne(env, context.address, refreshed)
    return json({ ...result, credits }, 200, cors)
  } catch {
    return fail('generation_failed', 'The plan could not be generated. Please try again.', 502, cors)
  }
}

async function handleRefine(env: Env, request: Request, cors: Record<string, string>): Promise<Response> {
  const raw = bodyRecord(await readJson(request))
  if (!raw) return fail('invalid_request', 'The request body is invalid.', 400, cors)
  const context = await addressAndCredits(env, request, raw.address, raw.deviceId)
  if (!context) return fail('invalid_request', 'Connect a valid Nimiq wallet.', 400, cors)

  const action = refineAction(raw.action)
  if (!action) return fail('invalid_request', 'Choose a valid planner action.', 400, cors)

  let question: string | undefined
  if (raw.question !== undefined) {
    if (typeof raw.question !== 'string' || raw.question.trim().length < 8 || raw.question.length > 500) {
      return fail('invalid_request', 'Ask a question with at least a few words.', 400, cors)
    }
    question = raw.question.trim()
  }
  if (action === 'custom' && !question) {
    return fail('invalid_request', 'Ask a question with at least a few words.', 400, cors)
  }

  const plan = clampPlan(raw.plan, 'refine', Date.now())
  if (isInvalid(plan)) return fail('invalid_request', plan.message, 400, cors)

  const refreshed = (await readCredits(env, context.address)) ?? context.record
  if (refreshed.free + refreshed.paid < 1) {
    return fail('payment_required', 'Your planner credits are used. Add more with NIM.', 402, cors, {
      credits: stateOf(refreshed),
      price: context.config.payTo ? quote(context.config, context.config.payTo) : undefined,
    })
  }
  if (await tooFast(env, context.address)) return fail('rate_limited', 'Please wait a moment before asking again.', 429, cors)
  if (await budgetLeft(env, context.config) < 1) return fail('budget_exhausted', 'Today’s generation limit has been reached. Try again tomorrow.', 429, cors)
  if (!env.ANTHROPIC_API_KEY) return fail('server', 'Cairn is not configured with an AI key yet.', 503, cors)

  await chargeBudget(env)
  try {
    const result = await refineWithAnthropic(context.config, env.ANTHROPIC_API_KEY, plan, action, question)
    const credits = await spendOne(env, context.address, refreshed)
    return json({ ...result, credits }, 200, cors)
  } catch {
    return fail('generation_failed', 'The follow up could not be completed. Please try again.', 502, cors)
  }
}

async function handleRedeem(env: Env, request: Request, cors: Record<string, string>): Promise<Response> {
  const raw = bodyRecord(await readJson(request))
  if (!raw) return fail('invalid_request', 'The request body is invalid.', 400, cors)
  const context = await addressAndCredits(env, request, raw.address, raw.deviceId)
  if (!context || typeof raw.receipt !== 'string' || raw.receipt.length > 4096) return fail('invalid_request', 'Payment details are invalid.', 400, cors)
  if (await tooFast(env, context.address, 'redeem')) return fail('rate_limited', 'Please wait a moment before checking that payment again.', 429, cors)
  const receipt = raw.receipt.trim()
  if (!receipt) return fail('invalid_request', 'Payment details are invalid.', 400, cors)
  // Only a normal transaction hash is safe to use as a KV key hint. A mobile
  // SDK may return a serialized transaction instead, which must never be placed
  // directly in a KV key because KV keys have a strict size limit.
  const keyHint = /^[0-9a-f]{64}$/i.test(receipt) ? receipt : null
  if (keyHint && await isSpent(env, keyHint)) return fail('payment_not_found', 'That payment was already used.', 402, cors)
  const trusted = context.config.trustPaymentsInDev && originIsLocal(request)
  const verifiedHash = trusted ? await localReceiptKey(receipt) : await verifyPayment(context.config, context.address, context.config.priceLuna, receipt)
  if (!verifiedHash || await isSpent(env, verifiedHash)) return fail('payment_not_found', 'Payment is not visible on the network yet.', 402, cors)
  await markSpent(env, verifiedHash, context.address)
  const credits = await grantPaid(env, context.address, context.config.plansPerPayment)
  return json({ credits, granted: context.config.plansPerPayment }, 200, cors)
}

async function handleShare(env: Env, request: Request, cors: Record<string, string>): Promise<Response> {
  const raw = bodyRecord(await readJson(request))
  if (!raw) return fail('invalid_request', 'The request body is invalid.', 400, cors)
  const address = addressFrom(raw.address)
  if (!address) return fail('invalid_request', 'Connect a valid Nimiq wallet.', 400, cors)
  if (await tooFast(env, address, 'share')) return fail('rate_limited', 'Please wait a moment before sharing again.', 429, cors)
  try {
    const result = await createShare(env, readConfig(env), address, raw.plan, new URL(request.url), clientIp(request))
    return json(result, 200, cors)
  } catch (error) {
    return fail('invalid_request', error instanceof Error ? error.message : 'That plan cannot be shared.', 400, cors)
  }
}

async function route(env: Env, request: Request): Promise<Response> {
  const cors = corsHeaders(request)
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  const url = new URL(request.url)
  if (url.pathname === '/api/credits' && request.method === 'GET') return handleCredits(env, request, url, cors)
  if (url.pathname === '/api/generate' && request.method === 'POST') return handleGenerate(env, request, cors)
  if (url.pathname === '/api/refine' && request.method === 'POST') return handleRefine(env, request, cors)
  if (url.pathname === '/api/redeem' && request.method === 'POST') return handleRedeem(env, request, cors)
  if (url.pathname === '/api/share' && request.method === 'POST') return handleShare(env, request, cors)
  if (url.pathname.startsWith('/api/share/') && request.method === 'GET') {
    const id = url.pathname.slice('/api/share/'.length).replace(/[^a-z0-9]/gi, '').slice(0, 32)
    const record = id ? await readShare(env, id) : null
    if (!record) return fail('not_found', 'That share link has expired.', 404, cors)
    return json({ plan: publicPlan(record), gift: record.gift || undefined }, 200, cors)
  }
  return env.ASSETS.fetch(request)
}

export default { fetch(request: Request, env: Env): Promise<Response> { return route(env, request) } }
