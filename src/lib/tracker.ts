/** Pure tracker calculations. These functions have no browser or Vue state. */
import type { BuildPlan, Milestone, Task, TaskStatus } from './plan'
import { isValidDate } from './plan'

export type MilestoneStatus = 'todo' | 'in_progress' | 'done' | 'blocked'

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  done: 'Done',
}

export const MILESTONE_STATUS_LABEL: Record<MilestoneStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  done: 'Done',
  blocked: 'Blocked',
}

export function allTasks(build: BuildPlan): Task[] {
  return build.milestones.flatMap((milestone) => milestone.tasks)
}

export function taskMap(build: BuildPlan): Map<string, Task> {
  return new Map(allTasks(build).map((task) => [task.id, task]))
}

/** A task is blocked only by a dependency that has not reached done. */
export function taskIsBlocked(task: Task, tasks: Iterable<Task> | Map<string, Task>): boolean {
  const map = tasks instanceof Map ? tasks : new Map(Array.from(tasks, (item) => [item.id, item]))
  return task.dependsOn.some((id) => map.get(id)?.status !== 'done')
}

export function milestoneStatus(milestone: Milestone, tasks = milestone.tasks): MilestoneStatus {
  if (milestone.blocked) return 'blocked'
  if (tasks.length > 0 && tasks.every((task) => task.status === 'done')) return 'done'
  if (tasks.some((task) => task.status === 'in_progress' || task.status === 'done')) return 'in_progress'
  return 'todo'
}

export interface TrackerStats {
  totalTasks: number
  completedTasks: number
  progress: number
  blockedTasks: number
  blockedMilestones: number
  overdueTasks: number
}

export function todayIso(now = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function isOverdue(task: Task, today = todayIso()): boolean {
  return Boolean(task.dueDate && isValidDate(task.dueDate) && task.status !== 'done' && task.dueDate < today)
}

export function projectStats(build: BuildPlan, today = todayIso()): TrackerStats {
  const tasks = allTasks(build)
  const map = new Map(tasks.map((task) => [task.id, task]))
  const completedTasks = tasks.filter((task) => task.status === 'done').length
  return {
    totalTasks: tasks.length,
    completedTasks,
    progress: tasks.length ? Math.round((completedTasks / tasks.length) * 100) : 0,
    blockedTasks: tasks.filter((task) => taskIsBlocked(task, map)).length,
    blockedMilestones: build.milestones.filter((milestone) => milestone.blocked).length,
    overdueTasks: tasks.filter((task) => isOverdue(task, today)).length,
  }
}

export function dependencyError(taskId: string, dependsOn: string[], build: BuildPlan): string | null {
  if (dependsOn.includes(taskId)) return 'A task cannot depend on itself.'
  const tasks = allTasks(build)
  const ids = new Set(tasks.map((task) => task.id))
  if (dependsOn.some((id) => !ids.has(id))) return 'Choose tasks from this project only.'

  const graph = new Map(tasks.map((task) => [task.id, task.dependsOn.filter((id) => ids.has(id))]))
  graph.set(taskId, dependsOn)
  const visiting = new Set<string>()
  const visited = new Set<string>()

  function visit(id: string): boolean {
    if (visiting.has(id)) return true
    if (visited.has(id)) return false
    visiting.add(id)
    for (const dependency of graph.get(id) ?? []) {
      if (visit(dependency)) return true
    }
    visiting.delete(id)
    visited.add(id)
    return false
  }

  for (const id of graph.keys()) {
    if (visit(id)) return 'Those blockers would create a circular dependency.'
  }
  return null
}

export function nextStatus(status: TaskStatus): TaskStatus {
  if (status === 'todo') return 'in_progress'
  if (status === 'in_progress') return 'done'
  return 'todo'
}

/** Suggest only actionable work. Ties retain the owner's milestone/task order. */
export function recommendedTask(build: BuildPlan): { task: Task; milestone: Milestone; reason: string } | null {
  const map = taskMap(build)
  const priorities = { high: 2, medium: 1, low: 0 }
  const candidates = build.milestones.flatMap((milestone) => milestone.blocked ? [] :
    milestone.tasks.filter((task) => task.status !== 'done' && !taskIsBlocked(task, map))
      .map((task) => ({ task, milestone })))
  candidates.sort((a, b) =>
    Number(b.task.status === 'in_progress') - Number(a.task.status === 'in_progress') ||
    priorities[b.task.priority] - priorities[a.task.priority])
  const next = candidates[0]
  if (!next) return null
  return { ...next, reason: next.task.status === 'in_progress'
    ? 'Continue work already in progress; no unfinished dependencies are blocking it.'
    : next.task.priority === 'high'
      ? 'This is high-priority work with no unfinished dependencies.'
      : 'This is the next available task in your build order at the highest available priority.' }
}

export function dateRange(milestone: Milestone): string {
  if (milestone.startDate && milestone.dueDate) return `${milestone.startDate} to ${milestone.dueDate}`
  if (milestone.startDate) return `From ${milestone.startDate}`
  if (milestone.dueDate) return `Due ${milestone.dueDate}`
  return 'No dates set'
}

export function displayDate(value: string | undefined): string {
  if (!value || !isValidDate(value)) return ''
  const [year, month, day] = value.split('-').map(Number)
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(
    new Date(year, month - 1, day),
  )
}
