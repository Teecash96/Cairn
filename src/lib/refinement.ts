/**
 * Client side application of a targeted planner refinement.
 *
 * The Worker returns only the fields it proposes to change. This module applies
 * those fields and leaves the rest of the plan alone. Task ids and tracker
 * state are rebuilt on the client so the AI cannot mark work complete.
 */
import {
  materializeBuildPlan,
  type BuildPlanDraft,
  type Plan,
  type PlanChanges,
  type Prd,
  type TaskStatus,
} from './plan.ts'
import { toRaw } from 'vue'

function copy<T>(value: T): T {
  const source = toRaw(value)
  return typeof structuredClone === 'function'
    ? structuredClone(source)
    : (JSON.parse(JSON.stringify(source)) as T)
}

function draftFromBuild(build: Plan['build']): BuildPlanDraft {
  return {
    mvpScope: [...build.mvpScope],
    milestones: build.milestones.map((milestone) => ({
      title: milestone.title,
      outcome: milestone.outcome,
      tasks: milestone.tasks.map((task) => task.text),
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
    add(`Build · ${key.replace(/([A-Z])/g, ' $1')}`, draft[key], changes.build?.[key])
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

export interface RefinementTaskImpact {
  text: string
  kind: 'added' | 'removed'
  id?: string
  status?: TaskStatus
}

export interface RefinementImpact {
  /** Human readable plan sections that will change together. */
  sections: string[]
  /** Existing task count that remains linked to its local tracker state. */
  preservedTasks: number
  addedTasks: RefinementTaskImpact[]
  removedTasks: RefinementTaskImpact[]
}

function textKey(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

function differs(before: unknown, after: unknown): boolean {
  return after !== undefined && JSON.stringify(before) !== JSON.stringify(after)
}

/**
 * Explain the blast radius of a proposed change without sending tracker
 * metadata to the model. Task ids, status, notes, dates, labels, and
 * dependencies remain local; only task text is compared here.
 */
export function refinementImpact(plan: Plan, changes: PlanChanges): RefinementImpact {
  const sections: string[] = []
  const addSection = (section: string): void => {
    if (!sections.includes(section)) sections.push(section)
  }

  const prdFields = Object.keys(changes.prd ?? {}) as (keyof Prd)[]
  const changedPrdFields = prdFields.filter((field) => differs(plan.prd[field], changes.prd?.[field]))
  if (changedPrdFields.some((field) => ['coreFeatures', 'userStories', 'successCriteria'].includes(field))) {
    addSection('Product requirements')
  }
  if (changedPrdFields.some((field) => ['summary', 'problem', 'targetUser', 'userGoal'].includes(field))) {
    addSection('Product brief')
  }
  if (changedPrdFields.some((field) => ['assumptions', 'outOfScope'].includes(field))) {
    addSection('Constraints')
  }
  if (differs(plan.flow, changes.flow)) addSection('User flow')

  const build = changes.build
  if (build) {
    if (differs(plan.build.mvpScope, build.mvpScope)) addSection('MVP scope')
    if (differs(draftFromBuild(plan.build).milestones, build.milestones)) addSection('Build milestones and tasks')
    if (differs(plan.build.risks, build.risks)) addSection('Risks')
    if (differs(plan.build.acceptanceTests, build.acceptanceTests)) addSection('Acceptance tests')
    if (differs(plan.build.nextAction, build.nextAction)) addSection('Next action')
  }
  if (differs(plan.realityCheck, changes.realityCheck)) addSection('Reality check')

  const previousTasks = plan.build.milestones.flatMap((milestone) => milestone.tasks)
  const addedTasks: RefinementTaskImpact[] = []
  const removedTasks: RefinementTaskImpact[] = []
  let preservedTasks = previousTasks.length

  if (build?.milestones && differs(draftFromBuild(plan.build).milestones, build.milestones)) {
    const oldByText = new Map<string, typeof previousTasks>()
    for (const task of previousTasks) {
      const bucket = oldByText.get(textKey(task.text)) ?? []
      bucket.push(task)
      oldByText.set(textKey(task.text), bucket)
    }

    const used = new Set<string>()
    preservedTasks = 0
    for (const milestone of build.milestones) {
      for (const text of milestone.tasks) {
        const match = (oldByText.get(textKey(text)) ?? []).find((task) => !used.has(task.id))
        if (match) {
          used.add(match.id)
          preservedTasks += 1
        } else {
          addedTasks.push({ kind: 'added', text })
        }
      }
    }

    for (const task of previousTasks) {
      if (used.has(task.id)) continue
      removedTasks.push({ kind: 'removed', id: task.id, text: task.text, status: task.status })
    }
  }

  return { sections, preservedTasks, addedTasks, removedTasks }
}
