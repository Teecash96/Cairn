import { blake2b } from '@noble/hashes/blake2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import type { Plan } from './plan'

/** Stable PRD payload. Tracker progress and local notes do not change this proof. */
export function prdPayload(plan: Pick<Plan, 'name' | 'prd'>): string {
  return JSON.stringify({
    version: 1,
    name: plan.name.trim(),
    prd: {
      summary: plan.prd.summary,
      problem: plan.prd.problem,
      targetUser: plan.prd.targetUser,
      userGoal: plan.prd.userGoal,
      coreFeatures: plan.prd.coreFeatures,
      userStories: plan.prd.userStories,
      successCriteria: plan.prd.successCriteria,
      assumptions: plan.prd.assumptions,
      outOfScope: plan.prd.outOfScope,
    },
  })
}

export function hashPrd(plan: Pick<Plan, 'name' | 'prd'>): string {
  return bytesToHex(blake2b(new TextEncoder().encode(prdPayload(plan)), { dkLen: 32 }))
}

export function explorerTransactionUrl(hash: string): string {
  return `https://nimiq.watch/#${encodeURIComponent(hash)}`
}
