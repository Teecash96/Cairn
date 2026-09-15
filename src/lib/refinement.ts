/**
 * Client side application of a targeted planner refinement.
 *
 * The Worker returns only the fields it proposes to change. This module applies
 * those fields and leaves the rest of the plan alone. Task ids are validated on
 * the client, while tracker state remains client-owned so the AI cannot mark
 * work complete.
 */
import {
  materializeBuildPlan,
  validateTaskReferences,
  type BuildPlanDraft,
  type Plan,
  type PlanChanges,
  type Prd,
} from './plan.ts'
import { toRaw } from 'vue'

function copy<T>(value: T): T {
  const source = toRaw(value)
  return typeof structuredClone === 'function'
    ? structuredClone(source)
    : (JSON.parse(JSON.stringify(source)) as T)
}

/** Make an immutable undo snapshot before applying a refinement. */
export function snapshotPlan(plan: Plan): Plan {
  return copy(plan)
}

function draftFromBuild(build: Plan['build']): BuildPlanDraft {
  return {
    mvpScope: [...build.mvpScope],
    milestones: build.milestones.map((milestone) => ({
      title: milestone.title,
      outcome: milestone.outcome,
      tasks: milestone.tasks.map((task) => ({ id: task.id, text: task.text })),
    })),
    risks: [...build.risks],
    acceptanceTests: [...build.acceptanceTests],
    nextAction: build.nextAction,
  }
}

function mergePrd(prd: Prd, patch: Partial<Prd>): Prd {
  const next: Prd = { ...prd }
  const fields: (keyof Prd)[] = [
    'summary',
    'problem',
    'targetUser',
    'userGoal',
    'coreFeatures',
    'userStories',
    'successCriteria',
    'assumptions',
    'outOfScope',
  ]

  for (const field of fields) {
    const value = patch[field]
    if (value === undefined) continue
    next[field] = Array.isArray(value) ? [...value] as never : value as never
  }
  return next
}

export function mergeRefinement(plan: Plan, changes: PlanChanges): Plan {
  const next = copy(plan)

  if (changes.prd) next.prd = mergePrd(next.prd, changes.prd)
  if (changes.flow) next.flow = copy(changes.flow)

  if (changes.build) {
    if (changes.build.milestones) validateTaskReferences(next.build, changes.build.milestones)
    const existing = draftFromBuild(next.build)
    const merged: BuildPlanDraft = {
      mvpScope: changes.build.mvpScope ?? existing.mvpScope,
      milestones: changes.build.milestones ?? existing.milestones,
      risks: changes.build.risks ?? existing.risks,
      acceptanceTests: changes.build.acceptanceTests ?? existing.acceptanceTests,
      nextAction: changes.build.nextAction ?? existing.nextAction,
    }
    next.build = materializeBuildPlan(merged, next.build)
  }

  if (changes.realityCheck) next.realityCheck = copy(changes.realityCheck)
  next.updatedAt = Date.now()
  return next
}

export interface RefinementDifference {
  label: string
  before: string
  after: string
}

function readable(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(readable).join('\n\n')
  if (value && typeof value === 'object' && 'text' in value && typeof (value as { text?: unknown }).text === 'string') {
    return readable((value as { text: string }).text)
  }
  if (value && typeof value === 'object') return Object.entries(value)
    .map(([key, item]) => `${key.replace(/([A-Z])/g, ' $1')}: ${readable(item)}`).join('\n')
  return ''
}

/** Compare only model-editable fields; never expose private tracker metadata. */
export function refinementDifferences(plan: Plan, changes: PlanChanges): RefinementDifference[] {
  const result: RefinementDifference[] = []
  function add(label: string, before: unknown, after: unknown) {
    if (after === undefined || JSON.stringify(before) === JSON.stringify(after)) return
    result.push({ label, before: readable(before), after: readable(after) })
  }
  for (const key of Object.keys(changes.prd ?? {}) as (keyof Prd)[]) {
    add(`Plan · ${key.replace(/([A-Z])/g, ' $1')}`, plan.prd[key], changes.prd?.[key])
  }
  add('User flow', plan.flow, changes.flow)
  const draft = draftFromBuild(plan.build)
  for (const key of Object.keys(changes.build ?? {}) as (keyof BuildPlanDraft)[]) {
    const label = `Build · ${key.replace(/([A-Z])/g, ' $1')}`
    if (key === 'milestones') {
      const textOnly = (value: unknown) => Array.isArray(value)
        ? value.map((milestone) => {
          if (!milestone || typeof milestone !== 'object') return milestone
          const raw = milestone as { tasks?: unknown }
          return {
            ...milestone,
            tasks: Array.isArray(raw.tasks)
              ? raw.tasks.map((task) => typeof task === 'string' ? task : task && typeof task === 'object' && 'text' in task ? (task as { text?: unknown }).text : '')
              : [],
          }
        })
        : value
      add(label, textOnly(draft[key]), textOnly(changes.build?.[key]))
    } else {
      add(label, draft[key], changes.build?.[key])
    }
  }
  add('Reality check', plan.realityCheck, changes.realityCheck)
  return result
}

export function removedRefinementTasks(plan: Plan, changes: PlanChanges) {
  if (!changes.build?.milestones) return []
  const merged = mergeRefinement(plan, changes)
  const retained = new Set(merged.build.milestones.flatMap((milestone) => milestone.tasks.map((task) => task.id)))
  return plan.build.milestones.flatMap((milestone) => milestone.tasks).filter((task) => !retained.has(task.id))
}
