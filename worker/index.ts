export { CreditLedger } from './credit-ledger'
export { TeamCoordinator } from './team'
import { budgetLeft, chargeBudget, tooFast, tooFastByKey } from './limits'
import { createChallenge, requireSession, verifyChallenge, type AuthSession } from './auth'
import { quote, readConfig } from './config'
import { CreditLedgerUnavailable, redeemCredits, readCredits, stateOf } from './credits'
import { fail, corsHeaders, isLocalHost, json, normalizeAddress, readJson, securityHeaders } from './http'
import { generateWithGemini, refineWithGemini } from './generate'
import { inspectPayment, type PaymentInspection } from './payments'
import { clampPlan, isInvalid, readPlanInput } from './shape'
import { createShare, publicPlan, readShare, revokeShare } from './share'
import { addMember, createTeam, deleteTeam, getTeam, recordReward, removeMember, TeamError, updateMember, updateTracker } from './team'
import type { Env, PlanInput, RefineAction } from './types'

function bodyRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null
}

function addressFrom(value: unknown): string | null {
  return normalizeAddress(value)
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

function authenticatedAddress(raw: Record<string, unknown>, session: AuthSession): string | null {
  if (raw.address === undefined) return session.address
  const supplied = addressFrom(raw.address)
  return supplied === session.address ? session.address : null
}

function authRequired(cors: Record<string, string>): Response {
  return fail('auth_required', 'Sign in with your Nimiq wallet first.', 401, cors)
}

function originIsLocal(request: Request): boolean {
  try { return isLocalHost(new URL(request.url).hostname) } catch { return false }
}

async function localReceiptKey(receipt: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(receipt))
  return `dev-${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

function paymentDetails(env: Env) {
  const config = readConfig(env)
  return {
    config,
    price: config.payTo ? quote(config, config.payTo) : null,
  }
}

/**
 * Keep provider details on the Worker, but give the phone a useful next step.
 * The old generic message made key, quota, model, timeout, and malformed output
 * failures indistinguishable. Never include the provider response verbatim: it
 * can contain request metadata that is useful in logs but not to a user.
 */
function generationFailure(error: unknown, fallback: string, cors: Record<string, string>): Response {
  if (error instanceof CreditLedgerUnavailable) throw error
  const detail = error instanceof Error ? error.message.slice(0, 300) : 'unknown error'
  console.error('Cairn AI generation failed', detail)

  const status = /Gemini returned (\d{3})/i.exec(detail)?.[1]
  const keyDetail = /api[\s_-]?key|key\s+(?:is\s+)?(?:not\s+valid|invalid|rejected|not\s+found)|key.{0,40}(?:invalid|rejected|leaked)|standard key|authorization key/i.test(detail)
  const message = status === '401' || status === '403' || (status === '400' && keyDetail)
    ? 'Cairn’s Gemini key was rejected. Create a new authorization key in Google AI Studio, then update GEMINI_API_KEY in Cloudflare.'
    : status === '404'
      ? 'Cairn’s configured AI model is unavailable. Check GEMINI_MODEL in Cloudflare.'
      : status === '400'
        ? 'Cairn’s AI request was rejected. Check the Gemini model and key configuration.'
      : status === '429'
        ? 'The AI provider is out of quota or rate limited. Try again shortly.'
        : /timed out|abort/i.test(detail)
          ? 'The AI provider took too long to respond. Try again.'
          : fallback

  return fail('generation_failed', message, 502, cors)
}

async function handleAuthChallenge(env: Env, request: Request, url: URL, cors: Record<string, string>): Promise<Response> {
  const rawAddress = url.searchParams.get('address')
  const address = rawAddress && rawAddress.trim() ? addressFrom(rawAddress) : null
  if (rawAddress && rawAddress.trim() && !address) {
    return fail('invalid_request', 'Connect a valid Nimiq wallet.', 400, cors)
  }
  const challenge = await createChallenge(env, request, address)
  if (!challenge) return fail('rate_limited', 'Please wait before requesting another sign in challenge.', 429, cors)
  return json(challenge, 200, cors)
}

async function handleAuthVerify(env: Env, request: Request, cors: Record<string, string>): Promise<Response> {
  const raw = await readJson(request, 8 * 1024)
  if (!bodyRecord(raw)) return fail('invalid_request', 'The sign in request is invalid.', 400, cors)
  const result = await verifyChallenge(env, request, raw)
  if (!result) return authRequired(cors)
  return json(result, 200, cors)
}

async function handleCredits(env: Env, request: Request, cors: Record<string, string>): Promise<Response> {
  const session = await requireSession(env, request)
  if (!session) return authRequired(cors)
  const { price } = paymentDetails(env)
  return json({ credits: stateOf(await readCredits(env, session.address)), price }, 200, cors)
}

async function handleGenerate(env: Env, request: Request, cors: Record<string, string>): Promise<Response> {
  const raw = bodyRecord(await readJson(request))
  if (!raw) return fail('invalid_request', 'The request body is invalid.', 400, cors)
  const session = await requireSession(env, request)
  if (!session) return authRequired(cors)
  const address = authenticatedAddress(raw, session)
  if (!address) return fail('invalid_request', 'Connect a valid Nimiq wallet.', 400, cors)
  const input = readPlanInput(raw.input)
  if (isInvalid(input)) return fail('invalid_request', input.message, 400, cors)

  // Planning is free. The wallet session proves identity and gives Cairn a
  // stable abuse-limit key, but it never gates a successful generation.
  const config = readConfig(env)
  if (await tooFast(env, address)) return fail('rate_limited', 'Please wait a moment before generating again.', 429, cors)
  if (await budgetLeft(env, config) < 1) return fail('budget_exhausted', 'Today’s free generation limit has been reached. Try again tomorrow.', 429, cors)
  const geminiKey = env.GEMINI_API_KEY?.trim()
  if (!geminiKey) return fail('server', 'Cairn is not configured with an AI key yet.', 503, cors)

  await chargeBudget(env)
  try {
    const result = await generateWithGemini(config, geminiKey, input as PlanInput)
    return json(result, 200, cors)
  } catch (error) {
    return generationFailure(error, 'The AI returned an incomplete plan. Try again.', cors)
  }
}

async function handleRefine(env: Env, request: Request, cors: Record<string, string>): Promise<Response> {
  const raw = bodyRecord(await readJson(request))
  if (!raw) return fail('invalid_request', 'The request body is invalid.', 400, cors)
  const session = await requireSession(env, request)
  if (!session) return authRequired(cors)
  const address = authenticatedAddress(raw, session)
  if (!address) return fail('invalid_request', 'Connect a valid Nimiq wallet.', 400, cors)

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

  // Keep the owner's opaque task ids in the refinement context so the model
  // can return them and the client can preserve tracker state across renames.
  const plan = clampPlan(raw.plan, 'refine', Date.now(), { preserveTaskIds: true })
  if (isInvalid(plan)) return fail('invalid_request', plan.message, 400, cors)

  // Refinements use the same free, wallet-authenticated path as generation.
  const config = readConfig(env)
  if (await tooFast(env, address)) return fail('rate_limited', 'Please wait a moment before asking again.', 429, cors)
  if (await budgetLeft(env, config) < 1) return fail('budget_exhausted', 'Today’s free generation limit has been reached. Try again tomorrow.', 429, cors)
  const geminiKey = env.GEMINI_API_KEY?.trim()
  if (!geminiKey) return fail('server', 'Cairn is not configured with an AI key yet.', 503, cors)

  await chargeBudget(env)
  try {
    const result = await refineWithGemini(config, geminiKey, plan, action, question)
    return json(result, 200, cors)
  } catch (error) {
    return generationFailure(error, 'The AI returned an incomplete follow up. Try again.', cors)
  }
}

async function handleRedeem(env: Env, request: Request, cors: Record<string, string>): Promise<Response> {
  const raw = bodyRecord(await readJson(request))
  if (!raw || (raw.receipt !== undefined && (typeof raw.receipt !== 'string' || raw.receipt.length < 1 || raw.receipt.length > 4096))) {
    return fail('invalid_request', 'Payment details are invalid.', 400, cors)
  }
  const session = await requireSession(env, request)
  if (!session) return authRequired(cors)
  const address = authenticatedAddress(raw, session)
  if (!address) return fail('invalid_request', 'Connect a valid Nimiq wallet.', 400, cors)
  if (await tooFastByKey(env, address, 'redeem', 30)) return fail('rate_limited', 'Please wait before checking payment again.', 429, cors)

  const { config } = paymentDetails(env)
  const receipt = typeof raw.receipt === 'string' ? raw.receipt.trim() : ''
  const trusted = config.trustPaymentsInDev && originIsLocal(request)
  if (trusted && !receipt) return fail('payment_not_found', 'Payment details are required in local development.', 402, cors)
  const inspection: PaymentInspection = trusted
    ? { status: 'verified', hash: await localReceiptKey(receipt) }
    : await inspectPayment(config, address, config.priceLuna, receipt)
  if (inspection?.status === 'wrong_wallet') {
    return fail(
      'payment_wrong_wallet',
      'This payment came from a different Nimiq wallet. Cairn cleared this session. Connect the wallet that sent it, then tap Check payment.',
      409,
      cors,
    )
  }
  const verifiedHash = inspection?.status === 'verified' ? inspection.hash : null
  if (!verifiedHash) {
    return fail('payment_not_found', 'Payment is not visible on the network yet.', 402, cors)
  }
  const redeemed = await redeemCredits(env, address, verifiedHash, config.plansPerPayment)
  if (!redeemed) return fail('payment_not_found', 'That payment was already used.', 402, cors)
  return json(redeemed, 200, cors)
}

async function handleShare(env: Env, request: Request, cors: Record<string, string>): Promise<Response> {
  const raw = bodyRecord(await readJson(request))
  if (!raw) return fail('invalid_request', 'The request body is invalid.', 400, cors)
  const session = await requireSession(env, request)
  if (!session) return authRequired(cors)
  const address = authenticatedAddress(raw, session)
  if (!address) return fail('invalid_request', 'Connect a valid Nimiq wallet.', 400, cors)
  if (await tooFast(env, address, 'share')) return fail('rate_limited', 'Please wait a moment before sharing again.', 429, cors)
  try {
    const result = await createShare(env, readConfig(env), address, raw.plan, new URL(request.url))
    return json(result, 200, cors)
  } catch (error) {
    return fail('invalid_request', error instanceof Error ? error.message : 'That plan cannot be shared.', 400, cors)
  }
}

async function handleShareRevoke(env: Env, request: Request, shareId: string, cors: Record<string, string>): Promise<Response> {
  const session = await requireSession(env, request)
  if (!session) return authRequired(cors)
  try {
    await revokeShare(env, shareId, session.address)
    return json({ revoked: true }, 200, cors)
  } catch (error) {
    return fail('forbidden', error instanceof Error ? error.message : 'That share link cannot be revoked.', 403, cors)
  }
}

function teamBaseUrl(env: Env, request: Request): string {
  return readConfig(env).appUrl || new URL(request.url).origin
}

function teamFailure(error: unknown, cors: Record<string, string>): Response {
  if (error instanceof TeamError) return fail(error.code, error.message, error.status, cors)
  return fail('server', 'The team service is temporarily unavailable.', 503, cors)
}

async function handleTeamCreate(env: Env, request: Request, cors: Record<string, string>): Promise<Response> {
  const raw = bodyRecord(await readJson(request, 128 * 1024))
  if (!raw) return fail('invalid_request', 'The team request is invalid.', 400, cors)
  const session = await requireSession(env, request)
  if (!session) return authRequired(cors)
  if (await tooFastByKey(env, session.address, 'team-create', 5)) return fail('rate_limited', 'Please wait before creating another team.', 429, cors)

  try {
    const result = await createTeam(env, session.address, {
      planId: raw.planId as string,
      name: raw.name as string,
      build: raw.build,
    }, teamBaseUrl(env, request))
    return json(result, 200, cors)
  } catch (error) {
    return teamFailure(error, cors)
  }
}

async function handleTeamRead(env: Env, request: Request, teamId: string, cors: Record<string, string>): Promise<Response> {
  const session = await requireSession(env, request)
  if (!session) return authRequired(cors)
  try {
    const result = await getTeam(env, teamId, session.address, teamBaseUrl(env, request))
    return json(result, 200, cors)
  } catch (error) {
    return teamFailure(error, cors)
  }
}

async function handleTeamAddMember(env: Env, request: Request, teamId: string, cors: Record<string, string>): Promise<Response> {
  const raw = bodyRecord(await readJson(request, 16 * 1024))
  if (!raw) return fail('invalid_request', 'The member request is invalid.', 400, cors)
  const session = await requireSession(env, request)
  if (!session) return authRequired(cors)
  if (await tooFastByKey(env, session.address, 'team-member', 20)) return fail('rate_limited', 'Please wait before changing team members again.', 429, cors)
  try {
    const result = await addMember(env, teamId, session.address, raw.address, raw.role, teamBaseUrl(env, request))
    return json(result, 200, cors)
  } catch (error) {
    return teamFailure(error, cors)
  }
}

async function handleTeamUpdateMember(env: Env, request: Request, teamId: string, memberAddress: string, cors: Record<string, string>): Promise<Response> {
  const raw = bodyRecord(await readJson(request, 8 * 1024))
  if (!raw) return fail('invalid_request', 'The member request is invalid.', 400, cors)
  const session = await requireSession(env, request)
  if (!session) return authRequired(cors)
  if (await tooFastByKey(env, session.address, 'team-member', 20)) return fail('rate_limited', 'Please wait before changing team members again.', 429, cors)
  try {
    const result = await updateMember(env, teamId, session.address, memberAddress, raw.role, teamBaseUrl(env, request))
    return json(result, 200, cors)
  } catch (error) {
    return teamFailure(error, cors)
  }
}

async function handleTeamRemoveMember(env: Env, request: Request, teamId: string, memberAddress: string, cors: Record<string, string>): Promise<Response> {
  const session = await requireSession(env, request)
  if (!session) return authRequired(cors)
  if (await tooFastByKey(env, session.address, 'team-member', 20)) return fail('rate_limited', 'Please wait before changing team members again.', 429, cors)
  try {
    const result = await removeMember(env, teamId, session.address, memberAddress, teamBaseUrl(env, request))
    return json(result, 200, cors)
  } catch (error) {
    return teamFailure(error, cors)
  }
}

async function handleTeamTracker(env: Env, request: Request, teamId: string, cors: Record<string, string>): Promise<Response> {
  const raw = bodyRecord(await readJson(request, 128 * 1024))
  if (!raw) return fail('invalid_request', 'The tracker request is invalid.', 400, cors)
  const session = await requireSession(env, request)
  if (!session) return authRequired(cors)
  if (await tooFastByKey(env, session.address, 'team-tracker', 30)) return fail('rate_limited', 'Please wait before saving more tracker changes.', 429, cors)
  try {
    const result = await updateTracker(env, teamId, session.address, raw.build, raw.revision, teamBaseUrl(env, request))
    return json(result, 200, cors)
  } catch (error) {
    return teamFailure(error, cors)
  }
}

async function handleTeamReward(env: Env, request: Request, teamId: string, cors: Record<string, string>): Promise<Response> {
  const raw = bodyRecord(await readJson(request, 16 * 1024))
  if (!raw || typeof raw.receipt !== 'string' || raw.receipt.length < 1 || raw.receipt.length > 4096) {
    return fail('invalid_request', 'The reward details are invalid.', 400, cors)
  }
  const session = await requireSession(env, request)
  if (!session) return authRequired(cors)
  const recipient = normalizeAddress(raw.recipient)
  const amountLuna = raw.amountLuna
  if (!recipient || typeof amountLuna !== 'number' || !Number.isSafeInteger(amountLuna) || amountLuna < 1 || amountLuna > 100_000_000_000) {
    return fail('invalid_request', 'Enter a valid NIM reward.', 400, cors)
  }
  try {
    const team = await getTeam(env, teamId, session.address, teamBaseUrl(env, request))
    const taskId = typeof raw.taskId === 'string' ? raw.taskId : ''
    const task = team.build.milestones.flatMap((milestone) => milestone.tasks).find((candidate) => candidate.id === taskId)
    if (team.role !== 'owner') return fail('forbidden', 'Only the team owner can record rewards.', 403, cors)
    if (!team.members.some((member) => member.address === recipient)) {
      return fail('invalid_request', 'Rewards can only be sent to a current team member.', 400, cors)
    }
    if (!task || task.status !== 'done') return fail('invalid_request', 'Choose a completed team task.', 400, cors)
    if (task.reward) return fail('conflict', 'That task already has a recorded reward.', 409, cors)
  } catch (error) {
    return teamFailure(error, cors)
  }
  if (await tooFastByKey(env, session.address, 'team-reward', 60)) return fail('rate_limited', 'Please wait before checking the reward again.', 429, cors)
  const config = { ...readConfig(env), payTo: recipient }
  const inspection = await inspectPayment(config, session.address, amountLuna, raw.receipt)
  if (inspection?.status === 'wrong_wallet') return fail('payment_wrong_wallet', 'The reward came from a different wallet.', 409, cors)
  if (inspection?.status !== 'verified') return fail('payment_not_found', 'The reward is not visible on the network yet.', 402, cors)
  try {
    const result = await recordReward(env, teamId, session.address, {
      taskId: raw.taskId,
      recipient,
      amountLuna,
      transactionHash: inspection.hash,
      revision: raw.revision,
    }, teamBaseUrl(env, request))
    return json(result, 200, cors)
  } catch (error) {
    return teamFailure(error, cors)
  }
}

async function handleTeamDelete(env: Env, request: Request, teamId: string, cors: Record<string, string>): Promise<Response> {
  const session = await requireSession(env, request)
  if (!session) return authRequired(cors)
  try {
    await deleteTeam(env, teamId, session.address, teamBaseUrl(env, request))
    return json({ deleted: true }, 200, cors)
  } catch (error) {
    return teamFailure(error, cors)
  }
}

async function route(env: Env, request: Request): Promise<Response> {
  const url = new URL(request.url)
  if (url.protocol === 'http:' && !isLocalHost(url.hostname)) {
    const target = new URL(request.url)
    target.protocol = 'https:'
    return new Response(null, {
      status: 301,
      headers: securityHeaders({ location: target.toString() }, false),
    })
  }
  const cors = corsHeaders(request)
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: securityHeaders(cors, url.protocol === 'https:') })
  if (url.pathname === '/api/auth/challenge' && request.method === 'GET') return handleAuthChallenge(env, request, url, cors)
  if (url.pathname === '/api/auth/verify' && request.method === 'POST') return handleAuthVerify(env, request, cors)
  if (url.pathname === '/api/credits' && request.method === 'GET') return handleCredits(env, request, cors)
  if (url.pathname === '/api/generate' && request.method === 'POST') return handleGenerate(env, request, cors)
  if (url.pathname === '/api/refine' && request.method === 'POST') return handleRefine(env, request, cors)
  if (url.pathname === '/api/redeem' && request.method === 'POST') return handleRedeem(env, request, cors)
  if (url.pathname === '/api/share' && request.method === 'POST') return handleShare(env, request, cors)
  if (url.pathname === '/api/team' && request.method === 'POST') return handleTeamCreate(env, request, cors)
  const teamMatch = /^\/api\/team\/([a-z2-9]{16,32})$/i.exec(url.pathname)
  if (teamMatch?.[1] && request.method === 'GET') return handleTeamRead(env, request, teamMatch[1], cors)
  if (teamMatch?.[1] && request.method === 'DELETE') return handleTeamDelete(env, request, teamMatch[1], cors)
  const teamMembersMatch = /^\/api\/team\/([a-z2-9]{16,32})\/members$/i.exec(url.pathname)
  if (teamMembersMatch?.[1] && request.method === 'POST') return handleTeamAddMember(env, request, teamMembersMatch[1], cors)
  const teamMemberMatch = /^\/api\/team\/([a-z2-9]{16,32})\/members\/([^/]+)$/i.exec(url.pathname)
  if (teamMemberMatch?.[1] && teamMemberMatch[2] && request.method === 'PATCH') return handleTeamUpdateMember(env, request, teamMemberMatch[1], teamMemberMatch[2], cors)
  if (teamMemberMatch?.[1] && teamMemberMatch[2] && request.method === 'DELETE') return handleTeamRemoveMember(env, request, teamMemberMatch[1], teamMemberMatch[2], cors)
  const teamTrackerMatch = /^\/api\/team\/([a-z2-9]{16,32})\/tracker$/i.exec(url.pathname)
  if (teamTrackerMatch?.[1] && request.method === 'PUT') return handleTeamTracker(env, request, teamTrackerMatch[1], cors)
  const teamRewardMatch = /^\/api\/team\/([a-z2-9]{16,32})\/rewards$/i.exec(url.pathname)
  if (teamRewardMatch?.[1] && request.method === 'POST') return handleTeamReward(env, request, teamRewardMatch[1], cors)
  if (url.pathname.startsWith('/api/share/') && request.method === 'GET') {
    const id = url.pathname.slice('/api/share/'.length).replace(/[^a-z0-9]/gi, '').slice(0, 32)
    const record = id ? await readShare(env, id) : null
    if (!record) return fail('not_found', 'That share link has expired.', 404, cors)
    return json({ plan: publicPlan(record) }, 200, cors)
  }
  if (url.pathname.startsWith('/api/share/') && request.method === 'DELETE') {
    const id = url.pathname.slice('/api/share/'.length).replace(/[^a-z0-9]/gi, '').slice(0, 32)
    return id ? handleShareRevoke(env, request, id, cors) : fail('not_found', 'That share link has expired.', 404, cors)
  }
  const asset = await env.ASSETS.fetch(request)
  if (asset.status !== 404 || url.pathname === '/404.html') {
    return new Response(asset.body, { status: asset.status, statusText: asset.statusText, headers: securityHeaders(asset.headers, url.protocol === 'https:') })
  }

  // Cloudflare's asset binding returns its own plain 404 by default. Serve the
  // branded page while preserving the 404 status, so browsers and crawlers do
  // not mistake a missing route for a valid page.
  const notFoundUrl = new URL('/404.html', request.url)
  const notFoundRequest = new Request(notFoundUrl, {
    method: 'GET',
    headers: request.headers,
  })
  const notFound = await env.ASSETS.fetch(notFoundRequest)
  return new Response(notFound.body, {
    status: 404,
    statusText: 'Not Found',
    headers: securityHeaders(notFound.headers, url.protocol === 'https:'),
  })
}

export default { async fetch(request: Request, env: Env): Promise<Response> {
  try { return await route(env, request) } catch (error) {
    if (error instanceof CreditLedgerUnavailable) {
      return fail('server', 'Credit service maintenance. Please try again later; do not send another payment.', 503, corsHeaders(request))
    }
    throw error
  }
} }
