<script setup lang="ts">
import { ref } from 'vue'
import { shortAddress } from '../lib/units'
import type { TeamMember, TeamRole } from '../lib/api'

const {
  teamId = null,
  owner = '',
  role = 'owner',
  members = [],
  inviteUrl = '',
  loading = false,
  error = null,
  syncing = false,
} = defineProps<{
  teamId?: string | null
  owner?: string
  role?: 'owner' | TeamRole
  members?: TeamMember[]
  inviteUrl?: string
  loading?: boolean
  error?: string | null
  syncing?: boolean
}>()

const emit = defineEmits<{
  create: []
  add: [address: string, role: TeamRole]
  update: [address: string, role: TeamRole]
  remove: [address: string]
  copy: [url: string]
}>()

const address = ref('')
const memberRole = ref<TeamRole>('viewer')
const confirming = ref<string | null>(null)

function add(): void {
  const value = address.value.trim()
  if (!value || loading) return
  emit('add', value, memberRole.value)
  address.value = ''
}

function changeRole(member: TeamMember, event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  if (value === 'viewer' || value === 'editor') emit('update', member.address, value)
}

function confirmRemove(member: TeamMember): void {
  if (confirming.value === member.address) {
    confirming.value = null
    emit('remove', member.address)
    return
  }
  confirming.value = member.address
}
</script>

<template>
  <section class="team" aria-labelledby="team-heading">
    <header class="team__intro">
      <p class="eyebrow">Team workspace</p>
      <h3 id="team-heading">Share the work, keep the brief private</h3>
      <p class="muted">Invite a Nimiq wallet to the Track board. The PRD, flow, notes, priorities, and blockers stay with you.</p>
    </header>

    <div v-if="error" class="team-error" role="alert">{{ error }}</div>

    <div v-if="!teamId" class="team-start card">
      <p><strong>Create a protected team board</strong></p>
      <p class="muted">Members open a link and sign in with their own wallet. You choose whether each person can view or edit Track.</p>
      <button type="button" class="btn btn--primary btn--block" :disabled="loading" @click="emit('create')">
        {{ loading ? 'Creating team…' : 'Create team workspace' }}
      </button>
    </div>

    <template v-else>
      <div class="team-link card">
        <div>
          <p class="team-link__title">Invite link</p>
          <p class="muted">Send this link to a wallet you trust. The link alone gives no access.</p>
          <span v-if="syncing" class="badge badge--accent">Saving Track changes…</span>
        </div>
        <div class="team-link__row">
          <input class="input mono" :value="inviteUrl" readonly aria-label="Protected team invite link" />
          <button type="button" class="btn btn--secondary btn--sm" :disabled="!inviteUrl" @click="emit('copy', inviteUrl)">Copy</button>
        </div>
      </div>

      <form class="member-form card" @submit.prevent="add">
        <div>
          <h4>Add a member</h4>
          <p class="muted">Use the full Nimiq address. There are no email invitations.</p>
        </div>
        <label class="field">
          <span class="field__label">Wallet address</span>
          <input v-model="address" class="input mono" inputmode="text" autocomplete="off" placeholder="NQ…" aria-describedby="team-address-help" />
        </label>
        <p id="team-address-help" class="faint">The member must open the invite with this wallet.</p>
        <label class="field">
          <span class="field__label">Permission</span>
          <select v-model="memberRole" class="input">
            <option value="viewer">Viewer · can see Track</option>
            <option value="editor">Editor · can change Track</option>
          </select>
        </label>
        <button type="submit" class="btn btn--primary btn--block" :disabled="loading || !address.trim()">Add member</button>
      </form>

      <section class="member-list" aria-labelledby="member-list-heading">
        <div class="section-heading">
          <h4 id="member-list-heading">People with access</h4>
          <span class="badge">{{ members.length }}</span>
        </div>
        <div class="member-row member-row--owner">
          <div>
            <strong>{{ role === 'owner' ? 'You' : shortAddress(owner) }}</strong>
            <span class="muted">Owner</span>
          </div>
          <span class="badge badge--accent">Full access</span>
        </div>
        <div v-for="member in members" :key="member.address" class="member-row">
          <div class="member-row__identity">
            <strong class="mono">{{ shortAddress(member.address) }}</strong>
            <span class="muted">Wallet member</span>
          </div>
          <div class="member-row__actions">
            <select class="role-select" :value="member.role" aria-label="Member permission" :disabled="loading" @change="changeRole(member, $event)">
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
            </select>
            <button type="button" class="btn btn--ghost btn--sm" :class="{ 'btn--danger': confirming === member.address }" :disabled="loading" @click="confirmRemove(member)">
              {{ confirming === member.address ? 'Confirm remove' : 'Remove' }}
            </button>
          </div>
        </div>
        <p v-if="!members.length" class="empty-team muted">No members yet. Copy the link after adding someone.</p>
      </section>
    </template>
  </section>
</template>

<style scoped>
.team { display: flex; flex-direction: column; gap: var(--s5); }
.eyebrow { margin: 0 0 var(--s1); color: var(--accent); font-size: var(--text-xs); font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
.team__intro { display: flex; flex-direction: column; gap: var(--s2); }
.team__intro h3 { font-size: var(--text-lg); letter-spacing: -.015em; }
.team__intro p:last-child { max-width: 38rem; font-size: var(--text-sm); line-height: var(--leading); }
.team-error { padding: var(--s3); border: 1px solid var(--danger); border-radius: var(--r-md); background: var(--danger-subtle); color: var(--danger); font-size: var(--text-sm); line-height: var(--leading); }
.team-start, .team-link, .member-form { display: flex; flex-direction: column; gap: var(--s3); }
.team-start p, .member-form p { font-size: var(--text-sm); line-height: var(--leading); }
.team-start p + p { margin-top: calc(var(--s2) * -1); }
.team-link__title { font-weight: 700; }
.team-link__row { display: flex; gap: var(--s2); }
.team-link__row .input { min-width: 0; flex: 1; font-size: var(--text-xs); }
.member-form h4, .member-list h4 { font-size: var(--text-md); }
.member-form .faint { margin-top: calc(var(--s2) * -1); }
.member-list { display: flex; flex-direction: column; gap: var(--s2); }
.member-row { display: flex; align-items: center; justify-content: space-between; gap: var(--s3); padding: var(--s3); border: 1px solid var(--line); border-radius: var(--r-md); background: var(--surface-sunken); }
.member-row--owner { background: var(--accent-subtle); border-color: var(--accent-line); }
.member-row > div, .member-row__identity { display: flex; min-width: 0; flex-direction: column; gap: 2px; }
.member-row strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.member-row .muted { font-size: var(--text-xs); }
.member-row__actions { display: flex; align-items: center; gap: var(--s2); }
.role-select { min-height: 38px; padding: 0 var(--s2); border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--surface); color: var(--text); font-size: var(--text-xs); }
.empty-team { padding: var(--s3); font-size: var(--text-sm); text-align: center; }
@media (max-width: 28rem) {
  .member-row { align-items: flex-start; flex-direction: column; }
  .member-row__actions { align-self: stretch; justify-content: flex-end; }
}
</style>
