import { budgetLeft, chargeBudget, tooFast, tooFastByKey } from './limits'
import { createChallenge, requireSession, verifyChallenge, type AuthSession } from './auth'
import { readConfig } from './config'
import { fail, corsHeaders, isLocalHost, json, normalizeAddress, readJson, securityHeaders } from './http'
import { generateWithGemini, refineWithGemini } from './generate'
import { clampPlan, isInvalid, readPlanInput } from './shape'
import { createShare, publicPlan, readShare } from './share'
import { addMember, createTeam, getTeam, removeMember, TeamError, updateMember, updateTracker } from './team'
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

/**
 * Keep provider details on the Worker, but give the phone a useful next step.
 * The old generic message made key, quota, model, timeout, and malformed output
 * failures indistinguishable. Never include the provider response verbatim: it
 * can contain request metadata that is useful in logs but not to a user.
 */
function generationFailure(error: unknown, fallback: string, cors: Record<string, string>): Response {
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

async function handleGenerate(env: Env, request: Request, cors: Record<string, string>): Promise<Response> {
  const raw = bodyRecord(await readJson(request))
  if (!raw) return fail('invalid_request', 'The request body is invalid.', 400, cors)
  const session = await requireSession(env, request)
  if (!session) return authRequired(cors)
  const address = authenticatedAddress(raw, session)
  if (!address) return fail('invalid_request', 'Connect a valid Nimiq wallet.', 400, cors)
  const input = readPlanInput(raw.input)
  if (isInvalid(input)) return fail('invalid_request', input.message, 400, cors)

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

  const plan = clampPlan(raw.plan, 'refine', Date.now())
  if (isInvalid(plan)) return fail('invalid_request', plan.message, 400, cors)

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
  if (url.pathname === '/api/generate' && request.method === 'POST') return handleGenerate(env, request, cors)
  if (url.pathname === '/api/refine' && request.method === 'POST') return handleRefine(env, request, cors)
  if (url.pathname === '/api/share' && request.method === 'POST') return handleShare(env, request, cors)
  if (url.pathname === '/api/team' && request.method === 'POST') return handleTeamCreate(env, request, cors)
  const teamMatch = /^\/api\/team\/([a-z2-9]{16,32})$/i.exec(url.pathname)
  if (teamMatch?.[1] && request.method === 'GET') return handleTeamRead(env, request, teamMatch[1], cors)
  const teamMembersMatch = /^\/api\/team\/([a-z2-9]{16,32})\/members$/i.exec(url.pathname)
  if (teamMembersMatch?.[1] && request.method === 'POST') return handleTeamAddMember(env, request, teamMembersMatch[1], cors)
  const teamMemberMatch = /^\/api\/team\/([a-z2-9]{16,32})\/members\/([^/]+)$/i.exec(url.pathname)
  if (teamMemberMatch?.[1] && teamMemberMatch[2] && request.method === 'PATCH') return handleTeamUpdateMember(env, request, teamMemberMatch[1], teamMemberMatch[2], cors)
  if (teamMemberMatch?.[1] && teamMemberMatch[2] && request.method === 'DELETE') return handleTeamRemoveMember(env, request, teamMemberMatch[1], teamMemberMatch[2], cors)
  const teamTrackerMatch = /^\/api\/team\/([a-z2-9]{16,32})\/tracker$/i.exec(url.pathname)
  if (teamTrackerMatch?.[1] && request.method === 'PUT') return handleTeamTracker(env, request, teamTrackerMatch[1], cors)
  if (url.pathname.startsWith('/api/share/') && request.method === 'GET') {
    const id = url.pathname.slice('/api/share/'.length).replace(/[^a-z0-9]/gi, '').slice(0, 32)
    const record = id ? await readShare(env, id) : null
    if (!record) return fail('not_found', 'That share link has expired.', 404, cors)
    return json({ plan: publicPlan(record) }, 200, cors)
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

export default { fetch(request: Request, env: Env): Promise<Response> { return route(env, request) } }
