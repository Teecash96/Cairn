/** Pure cross-route calculations for the wallet action inbox. */
import type { TeamActivity, TeamInboxTeam } from './api'
import { titleOf, type Plan } from './plan'
import { recommendedTask, todayIso } from './tracker'

export interface InboxTarget {
  kind: 'personal' | 'team'
  id: string
}

export interface InboxTaskItem {
  id: string
  target: InboxTarget
  routeName: string
  taskText: string
  milestoneTitle: string
  label: string
  dueDate?: string
  assignee?: string
}

export interface InboxRewardItem extends InboxTaskItem {
  amountLuna?: number
  transactionHash?: string
  rewardedAt?: number
}

export interface InboxBlockedItem {
  id: string
  target: InboxTarget
  routeName: string
  milestoneTitle: string
  openTasks: number
}

export interface InboxActivityItem extends TeamActivity {
  teamId: string
  routeName: string
  actorIsWallet: boolean
}

export interface WalletInboxData {
  myWork: InboxTaskItem[]
  approvals: InboxTaskItem[]
  rewardsToSend: InboxRewardItem[]
  rewardsReceived: InboxRewardItem[]
  blocked: InboxBlockedItem[]
  activity: InboxActivityItem[]
}

export function emptyWalletInbox(): WalletInboxData {
  return {
    myWork: [],
    approvals: [],
    rewardsToSend: [],
    rewardsReceived: [],
    blocked: [],
    activity: [],
  }
}

function walletKey(value: string | null | undefined): string {
  return typeof value === 'string' ? value.replace(/\s+/g, '').toUpperCase() : ''
}

function targetFor(team: TeamInboxTeam): InboxTarget {
  return { kind: 'team', id: team.teamId }
}

function sortTasks(items: InboxTaskItem[], today: string): void {
  items.sort((a, b) => {
    const aOverdue = Boolean(a.dueDate && a.dueDate < today)
    const bOverdue = Boolean(b.dueDate && b.dueDate < today)
    if (aOverdue !== bOverdue) return Number(bOverdue) - Number(aOverdue)
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate)
    if (a.dueDate) return -1
    if (b.dueDate) return 1
    return a.routeName.localeCompare(b.routeName)
  })
}

/**
 * Combine private local routes with the public Track projection of every team
 * available to the authenticated wallet. No private PRD, notes, priority, or
 * dependency data is needed from the server.
 */
export function buildWalletInbox(
  plans: Plan[],
  teams: TeamInboxTeam[],
  wallet: string | null,
  today = todayIso(),
): WalletInboxData {
  const inbox = emptyWalletInbox()
  const address = walletKey(wallet)
  if (!address) return inbox

  const ownerTeamPlanIds = new Set(teams.filter((team) => team.role === 'owner').map((team) => team.planId))

  for (const plan of plans) {
    const next = recommendedTask(plan.build)
    if (next) {
      inbox.myWork.push({
        id: `personal:${plan.id}:${next.task.id}`,
        target: { kind: 'personal', id: plan.id },
        routeName: titleOf(plan),
        taskText: next.task.text,
        milestoneTitle: next.milestone.title,
        label: next.task.status === 'in_progress' ? 'Continue personal work' : 'Personal next move',
        ...(next.task.dueDate ? { dueDate: next.task.dueDate } : {}),
      })
    }

    // A protected owner team is fresher than the local Track snapshot because
    // it includes teammate changes made on other devices.
    if (ownerTeamPlanIds.has(plan.id)) continue
    for (const milestone of plan.build.milestones.filter((item) => item.blocked)) {
      inbox.blocked.push({
        id: `personal:${plan.id}:${milestone.id}`,
        target: { kind: 'personal', id: plan.id },
        routeName: titleOf(plan),
        milestoneTitle: milestone.title,
        openTasks: milestone.tasks.filter((task) => task.status !== 'done').length,
      })
    }
  }

  for (const team of teams) {
    const target = targetFor(team)
    for (const milestone of team.build.milestones) {
      if (milestone.blocked) {
        inbox.blocked.push({
          id: `team:${team.teamId}:${milestone.id}`,
          target,
          routeName: team.name,
          milestoneTitle: milestone.title,
          openTasks: milestone.tasks.filter((task) => task.status !== 'done').length,
        })
      }

      for (const task of milestone.tasks) {
        const taskId = `team:${team.teamId}:${task.id}`
        const common: InboxTaskItem = {
          id: taskId,
          target,
          routeName: team.name,
          taskText: task.text,
          milestoneTitle: milestone.title,
          label: '',
          ...(task.dueDate ? { dueDate: task.dueDate } : {}),
          ...(task.assignee ? { assignee: task.assignee } : {}),
        }

        if (walletKey(task.assignee) === address && task.status !== 'done' && task.approvalStatus !== 'pending') {
          inbox.myWork.push({
            ...common,
            label: task.approvalStatus === 'changes_requested'
              ? 'Changes requested'
              : task.status === 'in_progress' ? 'Continue assigned task' : 'Assigned to you',
          })
        }

        if (team.role === 'owner' && task.approvalStatus === 'pending') {
          inbox.approvals.push({ ...common, label: 'Review completion proof' })
        }

        if (team.role === 'owner' && task.status === 'done' && task.approvalStatus === 'approved' && task.assignee && !task.reward) {
          inbox.rewardsToSend.push({ ...common, label: 'Approved · reward ready' })
        }

        if (task.reward && walletKey(task.reward.recipient) === address) {
          inbox.rewardsReceived.push({
            ...common,
            label: 'Verified NIM reward',
            amountLuna: task.reward.amountLuna,
            transactionHash: task.reward.transactionHash,
            rewardedAt: task.reward.createdAt,
          })
        }
      }
    }

    for (const entry of team.activity) {
      inbox.activity.push({
        ...entry,
        teamId: team.teamId,
        routeName: team.name,
        actorIsWallet: walletKey(entry.address) === address,
      })
    }
  }

  sortTasks(inbox.myWork, today)
  sortTasks(inbox.approvals, today)
  sortTasks(inbox.rewardsToSend, today)
  inbox.rewardsReceived.sort((a, b) => (b.rewardedAt ?? 0) - (a.rewardedAt ?? 0))
  inbox.blocked.sort((a, b) => a.routeName.localeCompare(b.routeName))
  inbox.activity.sort((a, b) => b.createdAt - a.createdAt)
  inbox.activity = inbox.activity.slice(0, 12)
  return inbox
}
