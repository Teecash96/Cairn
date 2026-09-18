import { titleOf, type Plan, type ReportKind, type Task } from './plan'

export const REPORT_KIND_LABELS: Record<ReportKind, string> = {
  progress: 'Progress update',
  milestone: 'Milestone review',
  validation: 'Validation report',
  stakeholder: 'Stakeholder brief',
}

function bullets(items: string[], empty: string): string {
  return items.length ? items.map((item) => `- ${item}`).join('\n') : `- ${empty}`
}

function blockedTasks(tasks: Task[]): Task[] {
  const done = new Set(tasks.filter((task) => task.status === 'done').map((task) => task.id))
  return tasks.filter((task) => task.status !== 'done' && task.dependsOn.some((id) => !done.has(id)))
}

/** Build an editable local report from the route's existing execution evidence. */
export function buildProjectReport(plan: Plan, kind: ReportKind): string {
  const tasks = plan.build.milestones.flatMap((milestone) => milestone.tasks)
  const done = tasks.filter((task) => task.status === 'done')
  const blocked = blockedTasks(tasks)
  const progress = tasks.length ? Math.round((done.length / tasks.length) * 100) : 0
  const latest = plan.execution.checkIns.at(-1)
  const evidence = plan.execution.experiments.filter((item) => item.result.trim())
  const decisions = plan.execution.experiments.filter((item) => item.decision !== 'open')
  const blockers = [...new Set([...blocked.map((task) => task.text), ...(latest?.blocker ? [latest.blocker] : [])])]
  const assigned = tasks.filter((task) => task.assignee)
  const approved = assigned.filter((task) => task.approvalStatus === 'approved')
  const rewarded = assigned.filter((task) => task.reward)
  const next = latest?.nextStep || plan.build.nextAction || tasks.find((task) => task.status !== 'done')?.text || 'Define the next useful move.'
  const heading = REPORT_KIND_LABELS[kind]
  const overview = `${titleOf(plan)} is ${progress}% complete with ${done.length} of ${tasks.length} mapped tasks done.`

  if (kind === 'validation') {
    return `## Summary\n${overview}\n\n## Questions tested\n${bullets(plan.execution.experiments.map((item) => `${item.hypothesis} — ${item.method}`), 'No validation experiments recorded.')}\n\n## Evidence\n${bullets(evidence.map((item) => `${item.hypothesis}: ${item.result}`), 'No results recorded yet.')}\n\n## Decisions\n${bullets(decisions.map((item) => `${item.decision.toUpperCase()}: ${item.hypothesis}`), 'No evidence-based decisions recorded yet.')}\n\n## Next test\n- ${next}`
  }

  if (kind === 'milestone') {
    const milestones = plan.build.milestones.map((milestone) => {
      const complete = milestone.tasks.filter((task) => task.status === 'done').length
      return `${milestone.title}: ${complete}/${milestone.tasks.length} tasks complete${milestone.blocked ? ' · blocked' : ''} — ${milestone.outcome}`
    })
    return `## Summary\n${overview}\n\n## Milestones\n${bullets(milestones, 'No milestones recorded.')}\n\n## Completed work\n${bullets(done.map((task) => task.text), 'No tasks completed yet.')}\n\n## Blockers\n${bullets(blockers, 'No dependency blockers recorded.')}\n\n## Next move\n- ${next}`
  }

  const team = assigned.length
    ? `${assigned.length} assigned task(s), ${approved.length} approved, and ${rewarded.length} rewarded.`
    : 'No teammate assignments recorded.'
  const change = latest?.changed || decisions.at(-1)?.hypothesis || 'No route change recorded.'
  const sections = kind === 'stakeholder'
    ? `## Status\n${overview}\n\n## What changed\n- ${change}\n\n## Evidence\n${bullets(evidence.slice(-3).map((item) => `${item.hypothesis}: ${item.result}`), 'No validation results recorded yet.')}\n\n## Risks and blockers\n${bullets(blockers, 'No active blockers recorded.')}\n\n## Team\n${team}\n\n## Next move\n- ${next}`
    : `## Overview\n${overview}\n\n## Completed\n${bullets(done.slice(-8).map((task) => task.text), latest?.completed || 'No completed work recorded yet.')}\n\n## Evidence and decisions\n${bullets(evidence.slice(-5).map((item) => `${item.hypothesis}: ${item.result} (${item.decision})`), 'No validation results recorded yet.')}\n\n## Blockers\n${bullets(blockers, 'No active blockers recorded.')}\n\n## Changes\n- ${change}\n\n## Team activity\n${team}\n\n## Next steps\n- ${next}`

  return `# ${heading}\n\n${sections}`
}
