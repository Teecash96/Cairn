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

/**
 * Stable payload for the fee free wallet proof.
 *
 * The proof covers the product map and the actionable build state, but never
 * includes private builder notes or the local standup log. Task IDs and status
 * are included so a tracker change makes the old proof visibly stale.
 */
export function planProofPayload(plan: Pick<Plan, 'name' | 'prd' | 'flow' | 'build'>): string {
  return JSON.stringify({
    version: 1,
    name: plan.name.trim(),
    prd: plan.prd,
    flow: plan.flow,
    build: {
      mvpScope: plan.build.mvpScope,
      milestones: plan.build.milestones.map((milestone) => ({
        id: milestone.id,
        title: milestone.title,
        outcome: milestone.outcome,
        startDate: milestone.startDate ?? null,
        dueDate: milestone.dueDate ?? null,
        blocked: milestone.blocked,
        bounty: milestone.bounty ?? null,
        tasks: milestone.tasks.map((task) => ({
          id: task.id,
          text: task.text,
          status: task.status,
          priority: task.priority,
          labels: task.labels,
          dueDate: task.dueDate ?? null,
          dependsOn: task.dependsOn,
        })),
      })),
      risks: plan.build.risks,
      acceptanceTests: plan.build.acceptanceTests,
      nextAction: plan.build.nextAction,
    },
  })
}

export function hashPlan(plan: Pick<Plan, 'name' | 'prd' | 'flow' | 'build'>): string {
  return bytesToHex(blake2b(new TextEncoder().encode(planProofPayload(plan)), { dkLen: 32 }))
}

export function explorerTransactionUrl(hash: string): string {
  return `https://nimiq.watch/#${encodeURIComponent(hash)}`
}
