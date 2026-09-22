<script setup lang="ts">
import { computed } from 'vue'
import { displayDate } from '../lib/tracker'
import { relativeTime } from '../lib/plan'
import { formatNim, shortAddress } from '../lib/units'
import type { InboxTarget, WalletInboxData } from '../lib/inbox'

const {
  inbox,
  walletAddress = null,
  ready = false,
  loading = false,
  error = null,
  updatedAt,
} = defineProps<{
  inbox: WalletInboxData
  walletAddress?: string | null
  ready?: boolean
  loading?: boolean
  error?: string | null
  updatedAt?: number
}>()

const emit = defineEmits<{
  connect: []
  refresh: []
  'open-personal': [id: string]
  'open-team': [id: string]
}>()

const actionCount = computed(() => inbox.myWork.length + inbox.approvals.length + inbox.rewardsToSend.length + inbox.blocked.length)
const hasHistory = computed(() => inbox.rewardsReceived.length > 0 || inbox.activity.length > 0)

function open(target: InboxTarget): void {
  if (target.kind === 'personal') emit('open-personal', target.id)
  else emit('open-team', target.id)
}

function dueLabel(value: string | undefined): string {
  if (!value) return ''
  return value < new Date().toISOString().slice(0, 10) ? `Overdue ${displayDate(value)}` : `Due ${displayDate(value)}`
}

function activityLabel(action: string): string {
  return ({
    updated: 'updated the tracker',
    assigned: 'assigned a task',
    submitted: 'submitted work',
    approved: 'approved work',
    returned: 'returned work',
    rewarded: 'sent a reward',
  } as Record<string, string>)[action] ?? action.replace('_', ' ')
}
</script>

<template>
  <section class="wallet-inbox" aria-labelledby="wallet-inbox-title" :aria-busy="loading">
    <header class="wallet-inbox__head">
      <div>
        <p class="eyebrow">Wallet action inbox</p>
        <h2 id="wallet-inbox-title">What needs you now</h2>
        <p>Your tasks, reviews, rewards, blockers, and team activity across every route available to this wallet.</p>
      </div>
      <button v-if="ready" type="button" class="btn btn--secondary btn--sm" :disabled="loading" @click="emit('refresh')">
        {{ loading ? 'Refreshing…' : 'Refresh' }}
      </button>
    </header>

    <p v-if="error" class="inbox-error" role="alert">{{ error }}</p>

    <div v-if="!walletAddress" class="inbox-gate">
      <div>
        <strong>Connect your Nimiq wallet</strong>
        <p>No account is required. Cairn combines this device's personal work with the teammate actions assigned to your wallet.</p>
      </div>
      <button type="button" class="btn btn--primary" :disabled="loading" @click="emit('connect')">
        {{ loading ? 'Connecting…' : 'Connect wallet' }}
      </button>
    </div>

    <div v-else-if="!ready" class="inbox-gate inbox-gate--verified">
      <div>
        <span class="wallet-chip mono">{{ shortAddress(walletAddress) }}</span>
        <strong>Verify this wallet to load protected actions</strong>
        <p>The signature proves team access. Cairn does not create an account or request a payment.</p>
      </div>
      <button type="button" class="btn btn--primary" :disabled="loading" @click="emit('refresh')">
        {{ loading ? 'Loading inbox…' : 'Verify & load inbox' }}
      </button>
    </div>

    <template v-else>
      <div class="inbox-wallet-row">
        <span class="wallet-chip mono">{{ shortAddress(walletAddress) }}</span>
        <span v-if="updatedAt" class="faint">Updated {{ relativeTime(updatedAt) }}</span>
      </div>

      <div class="inbox-stats" aria-label="Wallet action counts">
        <div><strong>{{ inbox.myWork.length }}</strong><span>My work</span></div>
        <div><strong>{{ inbox.approvals.length }}</strong><span>Reviews</span></div>
        <div><strong>{{ inbox.rewardsToSend.length }}</strong><span>Rewards</span></div>
        <div><strong>{{ inbox.blocked.length }}</strong><span>Blocked</span></div>
      </div>

      <p v-if="actionCount === 0" class="inbox-clear">
        <strong>All clear.</strong> No assigned work, reviews, rewards, or blockers need this wallet now.
      </p>

      <section v-if="inbox.myWork.length" class="inbox-section" aria-labelledby="inbox-my-work">
        <div class="inbox-section__head"><h3 id="inbox-my-work">My work</h3><span>{{ inbox.myWork.length }}</span></div>
        <button v-for="item in inbox.myWork.slice(0, 6)" :key="item.id" type="button" class="inbox-item" @click="open(item.target)">
          <span class="inbox-item__mark" aria-hidden="true">→</span>
          <span class="inbox-item__body">
            <strong>{{ item.taskText }}</strong>
            <span>{{ item.routeName }} · {{ item.milestoneTitle }}</span>
            <span class="inbox-item__meta"><b>{{ item.label }}</b><i v-if="item.dueDate">{{ dueLabel(item.dueDate) }}</i></span>
          </span>
        </button>
        <p v-if="inbox.myWork.length > 6" class="inbox-more faint">{{ inbox.myWork.length - 6 }} more actions are available inside their routes.</p>
      </section>

      <section v-if="inbox.approvals.length" class="inbox-section" aria-labelledby="inbox-approvals">
        <div class="inbox-section__head"><h3 id="inbox-approvals">Waiting for my approval</h3><span>{{ inbox.approvals.length }}</span></div>
        <button v-for="item in inbox.approvals.slice(0, 6)" :key="item.id" type="button" class="inbox-item" @click="open(item.target)">
          <span class="inbox-item__mark inbox-item__mark--review" aria-hidden="true">✓</span>
          <span class="inbox-item__body">
            <strong>{{ item.taskText }}</strong>
            <span>{{ item.routeName }} · proof is ready to review</span>
            <span v-if="item.assignee" class="inbox-item__meta"><b>From {{ shortAddress(item.assignee) }}</b></span>
          </span>
        </button>
      </section>

      <section v-if="inbox.rewardsToSend.length" class="inbox-section" aria-labelledby="inbox-rewards-send">
        <div class="inbox-section__head"><h3 id="inbox-rewards-send">Rewards ready to send</h3><span>{{ inbox.rewardsToSend.length }}</span></div>
        <button v-for="item in inbox.rewardsToSend.slice(0, 6)" :key="item.id" type="button" class="inbox-item" @click="open(item.target)">
          <span class="inbox-item__mark inbox-item__mark--reward" aria-hidden="true">N</span>
          <span class="inbox-item__body">
            <strong>{{ item.taskText }}</strong>
            <span>{{ item.routeName }} · approved work</span>
            <span v-if="item.assignee" class="inbox-item__meta"><b>Pay {{ shortAddress(item.assignee) }}</b></span>
          </span>
        </button>
      </section>

      <section v-if="inbox.blocked.length" class="inbox-section" aria-labelledby="inbox-blocked">
        <div class="inbox-section__head"><h3 id="inbox-blocked">Blocked work</h3><span>{{ inbox.blocked.length }}</span></div>
        <button v-for="item in inbox.blocked.slice(0, 6)" :key="item.id" type="button" class="inbox-item" @click="open(item.target)">
          <span class="inbox-item__mark inbox-item__mark--blocked" aria-hidden="true">!</span>
          <span class="inbox-item__body">
            <strong>{{ item.milestoneTitle }}</strong>
            <span>{{ item.routeName }}</span>
            <span class="inbox-item__meta"><b>{{ item.openTasks }} open {{ item.openTasks === 1 ? 'task' : 'tasks' }}</b></span>
          </span>
        </button>
      </section>

      <section v-if="inbox.rewardsReceived.length" class="inbox-section" aria-labelledby="inbox-rewards-received">
        <div class="inbox-section__head"><h3 id="inbox-rewards-received">Rewards received</h3><span>{{ inbox.rewardsReceived.length }}</span></div>
        <button v-for="item in inbox.rewardsReceived.slice(0, 6)" :key="item.id" type="button" class="inbox-item" @click="open(item.target)">
          <span class="inbox-item__mark inbox-item__mark--reward" aria-hidden="true">N</span>
          <span class="inbox-item__body">
            <strong>{{ item.amountLuna ? `${formatNim(item.amountLuna)} NIM` : 'NIM reward' }} · {{ item.taskText }}</strong>
            <span>{{ item.routeName }} · verified on the public network</span>
            <span v-if="item.rewardedAt" class="inbox-item__meta"><b>{{ relativeTime(item.rewardedAt) }}</b></span>
          </span>
        </button>
      </section>

      <section v-if="inbox.activity.length" class="inbox-section" aria-labelledby="inbox-activity">
        <div class="inbox-section__head"><h3 id="inbox-activity">Recent team activity</h3><span>{{ inbox.activity.length }}</span></div>
        <button v-for="item in inbox.activity.slice(0, 8)" :key="`${item.teamId}:${item.id}`" type="button" class="inbox-item inbox-item--activity" @click="emit('open-team', item.teamId)">
          <span class="activity-dot" aria-hidden="true" />
          <span class="inbox-item__body">
            <strong>{{ item.actorIsWallet ? 'You' : shortAddress(item.address) }} {{ activityLabel(item.action) }}</strong>
            <span>{{ item.routeName }} · {{ item.taskText || item.detail || 'Team tracker' }}</span>
            <span class="inbox-item__meta"><b>{{ relativeTime(item.createdAt) }}</b></span>
          </span>
        </button>
      </section>

      <p v-if="!hasHistory && actionCount === 0" class="faint inbox-first-use">Assign work or invite a teammate and the signed activity will appear here.</p>
    </template>
  </section>
</template>

<style scoped>
.wallet-inbox { min-width: 0; padding: var(--s5); border: 1px solid var(--line-strong); border-radius: var(--r-lg); background: var(--surface); }
.wallet-inbox__head { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--s4); }
.wallet-inbox__head > div { min-width: 0; }
.wallet-inbox__head h2 { font-family: var(--font-display); font-size: clamp(1.7rem, 6vw, 2.5rem); letter-spacing: -.035em; overflow-wrap: anywhere; }
.wallet-inbox__head p:last-child { max-width: 43rem; margin-top: var(--s2); color: var(--text-muted); font-size: var(--text-sm); line-height: var(--leading-loose); }
.eyebrow { margin: 0 0 var(--s2); color: var(--accent); font-family: var(--font-mono); font-size: .7rem; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
.inbox-gate { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: var(--s4); margin-top: var(--s5); padding: var(--s4); border-left: 3px solid var(--nim); background: var(--surface-sunken); }
.inbox-gate > div { display: grid; gap: var(--s1); min-width: 0; }
.inbox-gate p { color: var(--text-muted); font-size: var(--text-sm); line-height: var(--leading); overflow-wrap: anywhere; }
.wallet-chip { display: inline-flex; justify-self: start; max-width: 100%; padding: .3rem .55rem; border: 1px solid color-mix(in srgb, var(--nim) 60%, var(--line)); border-radius: 999px; background: color-mix(in srgb, var(--nim) 16%, var(--surface)); color: var(--text); font-size: .72rem; overflow-wrap: anywhere; }
.inbox-wallet-row { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--s2); margin-top: var(--s4); font-size: var(--text-xs); }
.inbox-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--s2); margin-top: var(--s4); }
.inbox-stats div { display: grid; gap: .15rem; min-width: 0; padding: var(--s3); border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--bg); }
.inbox-stats strong { font-family: var(--font-display); font-size: 1.65rem; line-height: 1; }
.inbox-stats span { color: var(--text-muted); font-size: .72rem; overflow-wrap: anywhere; }
.inbox-clear { margin-top: var(--s4); padding: var(--s3) var(--s4); border: 1px solid color-mix(in srgb, var(--moss) 35%, var(--line)); border-radius: var(--r-sm); background: color-mix(in srgb, var(--moss) 12%, var(--surface)); font-size: var(--text-sm); line-height: var(--leading); }
.inbox-error { margin-top: var(--s3); padding: var(--s3); border: 1px solid color-mix(in srgb, var(--danger) 35%, var(--line)); border-radius: var(--r-sm); background: var(--danger-subtle); color: var(--danger); font-size: var(--text-sm); line-height: var(--leading); }
.inbox-section { min-width: 0; margin-top: var(--s5); }
.inbox-section__head { display: flex; align-items: center; justify-content: space-between; gap: var(--s3); margin-bottom: var(--s2); }
.inbox-section__head h3 { min-width: 0; font-family: var(--font-mono); font-size: var(--text-xs); letter-spacing: .08em; text-transform: uppercase; overflow-wrap: anywhere; }
.inbox-section__head span { display: grid; place-items: center; min-width: 23px; height: 23px; padding-inline: .35rem; border: 1px solid var(--line); border-radius: 999px; color: var(--text-muted); font-size: .68rem; }
.inbox-item { display: grid; grid-template-columns: 30px minmax(0, 1fr); align-items: start; gap: var(--s3); width: 100%; padding: var(--s3) var(--s2); border-top: 1px solid var(--line); text-align: left; }
.inbox-item:last-of-type { border-bottom: 1px solid var(--line); }
.inbox-item:hover { background: var(--surface-hover); }
.inbox-item__mark { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: var(--accent-subtle); color: var(--accent); font-weight: 850; }
.inbox-item__mark--review { background: color-mix(in srgb, var(--moss) 14%, var(--surface)); color: var(--moss); }
.inbox-item__mark--reward { background: color-mix(in srgb, var(--nim) 18%, var(--surface)); color: var(--text); font-family: var(--font-mono); }
.inbox-item__mark--blocked { background: var(--danger-subtle); color: var(--danger); }
.inbox-item__body { display: grid; gap: .2rem; min-width: 0; }
.inbox-item__body strong, .inbox-item__body > span { min-width: 0; overflow-wrap: anywhere; }
.inbox-item__body strong { font-size: var(--text-sm); line-height: var(--leading); }
.inbox-item__body > span { color: var(--text-muted); font-size: var(--text-xs); line-height: var(--leading); }
.inbox-item__meta { display: flex; flex-wrap: wrap; gap: var(--s2); margin-top: .1rem; }
.inbox-item__meta b, .inbox-item__meta i { color: var(--accent); font-size: .7rem; font-style: normal; font-weight: 750; }
.inbox-item__meta i { color: var(--danger); }
.inbox-item--activity { grid-template-columns: 12px minmax(0, 1fr); }
.activity-dot { width: 8px; height: 8px; margin-top: .42rem; border-radius: 50%; background: var(--accent); }
.inbox-more, .inbox-first-use { margin-top: var(--s2); font-size: var(--text-xs); line-height: var(--leading); }

@media (max-width: 560px) {
  .wallet-inbox { padding: var(--s4); }
  .wallet-inbox__head { flex-direction: column; }
  .inbox-gate { grid-template-columns: 1fr; }
  .inbox-gate .btn { width: 100%; white-space: normal; }
  .inbox-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
