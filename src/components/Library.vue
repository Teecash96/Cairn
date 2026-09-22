<script setup lang="ts">
/**
 * Personal plans and previously opened teammate routes, clearly separated.
 *
 * The spec asks for a sidebar of recent plans; on a portrait phone that is a tab.
 *
 * Personal plans live in this device's localStorage and nowhere else, which is a feature
 * — no account, nothing uploaded — right up until the WebView is in private mode
 * and refuses to write. Then it is data loss, so the screen says so plainly
 * rather than presenting an empty list as normal.
 */
import { ref, watch } from 'vue'
import CairnMark from './CairnMark.vue'
import WalletActionInbox from './WalletActionInbox.vue'
import { relativeTime, titleOf, type Plan } from '../lib/plan'
import type { TeamRoute } from '../lib/team-library'
import type { WalletInboxData } from '../lib/inbox'

const { plans, teamRoutes, walletConnected = false, walletAddress = null, inboxReady = false, inboxLoading = false, inboxError = null, persistent = true } = defineProps<{
  plans: Plan[]
  teamRoutes: TeamRoute[]
  walletConnected?: boolean
  walletAddress?: string | null
  walletInbox: WalletInboxData
  inboxReady?: boolean
  inboxLoading?: boolean
  inboxError?: string | null
  inboxUpdatedAt?: number
  persistent?: boolean
}>()

const emit = defineEmits<{
  open: [id: string]
  'open-team': [id: string]
  'forget-team': [id: string]
  create: []
  remove: [id: string]
  rename: [id: string, name: string]
  import: [text: string]
  connect: []
  'refresh-inbox': []
}>()

/** Id of the row whose actions are showing, if any. */
const openRow = ref<string | null>(null)
const renamingId = ref<string | null>(null)
const draftName = ref('')
const confirmingId = ref<string | null>(null)
const backupInput = ref<HTMLInputElement | null>(null)

async function importBackup(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  emit('import', await file.text())
  input.value = ''
}

// A row that disappears must not leave its menu state behind.
watch(
  () => plans.length,
  () => {
    openRow.value = null
    renamingId.value = null
    confirmingId.value = null
  },
)

function toggleRow(id: string): void {
  openRow.value = openRow.value === id ? null : id
  renamingId.value = null
  confirmingId.value = null
}

function startRename(plan: Plan): void {
  renamingId.value = plan.id
  draftName.value = plan.name || titleOf(plan)
  confirmingId.value = null
}

function commitRename(id: string): void {
  emit('rename', id, draftName.value.trim())
  renamingId.value = null
  openRow.value = null
}
</script>

<template>
  <div class="screen">
    <header>
      <p class="eyebrow">Local atlas</p>
      <h1 class="screen__title">Marked routes</h1>
      <p class="screen__sub">
        Your own plans and the protected team work available to this wallet.
      </p>
    </header>

    <WalletActionInbox
      :inbox="walletInbox"
      :wallet-address="walletAddress"
      :ready="inboxReady"
      :loading="inboxLoading"
      :error="inboxError"
      :updated-at="inboxUpdatedAt"
      @connect="emit('connect')"
      @refresh="emit('refresh-inbox')"
      @open-personal="emit('open', $event)"
      @open-team="emit('open-team', $event)"
    />

    <div class="storage-note">
      <strong>Personal work stays on this device.</strong>
      <span>Your wallet restores team access, but it does not restore personal plans. Save a JSON backup from a plan before changing browsers or devices.</span>
    </div>

    <div class="library-actions">
      <button type="button" class="btn btn--secondary btn--sm" @click="backupInput?.click()">Restore JSON backup</button>
      <input ref="backupInput" class="visually-hidden" type="file" accept="application/json,.json" @change="importBackup" />
    </div>

    <p v-if="!persistent" class="warn">
      This browser is refusing to save anything — private mode, most likely. Plans will vanish when
      you close the app, so copy anything you want to keep.
    </p>

    <section class="route-group" aria-labelledby="personal-routes-title">
      <div class="route-group__heading">
        <h2 id="personal-routes-title">Personal work</h2>
        <span class="route-group__count mono">{{ plans.length }}</span>
      </div>

      <div v-if="!plans.length" class="empty empty--compact">
        <CairnMark :size="30" class="empty__mark" />
        <p class="empty__title">No personal routes yet</p>
        <p class="empty__body faint">Map a rough idea and Cairn will keep its route on this device.</p>
        <button type="button" class="btn btn--primary btn--sm" @click="emit('create')">Map an idea</button>
      </div>

      <ul v-else class="list">
        <li v-for="plan in plans" :key="plan.id" class="item">
        <div class="row">
          <button type="button" class="open" @click="emit('open', plan.id)">
            <span class="name">{{ titleOf(plan) }}</span>
            <span class="meta faint">
              <span>{{ relativeTime(plan.updatedAt) }}</span>
              <span aria-hidden="true">·</span>
              <span>{{ plan.flow.length }} steps</span>
              <span v-if="plan.shareId" class="badge">Shared</span>
            </span>
          </button>

          <button
            type="button"
            class="more"
            :aria-expanded="openRow === plan.id"
            :aria-label="`Actions for ${titleOf(plan)}`"
            @click="toggleRow(plan.id)"
          >
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
              <circle cx="8" cy="3.5" r="1.4" />
              <circle cx="8" cy="8" r="1.4" />
              <circle cx="8" cy="12.5" r="1.4" />
            </svg>
          </button>
        </div>

        <div v-if="openRow === plan.id" class="tray">
          <div v-if="renamingId === plan.id" class="rename">
            <input
              v-model="draftName"
              class="input"
              aria-label="New plan name"
              autocapitalize="words"
              @keydown.enter="commitRename(plan.id)"
            />
            <div class="tray__row">
              <button type="button" class="btn btn--primary btn--sm" @click="commitRename(plan.id)">
                Save name
              </button>
              <button type="button" class="btn btn--secondary btn--sm" @click="renamingId = null">
                Cancel
              </button>
            </div>
          </div>

          <div v-else-if="confirmingId === plan.id" class="confirm">
            <p class="confirm__q">Delete this plan?</p>
            <div class="tray__row">
              <button type="button" class="btn btn--danger btn--sm" @click="emit('remove', plan.id)">
                Delete
              </button>
              <button type="button" class="btn btn--secondary btn--sm" @click="confirmingId = null">
                Keep it
              </button>
            </div>
          </div>

          <div v-else class="tray__row">
            <button type="button" class="btn btn--secondary btn--sm" @click="startRename(plan)">
              Rename
            </button>
            <button
              type="button"
              class="btn btn--ghost btn--sm danger"
              @click="confirmingId = plan.id"
            >
              Delete
            </button>
          </div>
        </div>
        </li>
      </ul>
    </section>

    <section class="route-group" aria-labelledby="team-routes-title">
      <div class="route-group__heading">
        <h2 id="team-routes-title">Teammate work</h2>
        <span class="route-group__count mono">{{ teamRoutes.length }}</span>
      </div>

      <div v-if="!teamRoutes.length" class="team-empty">
        <p class="team-empty__title">No teammate routes here yet</p>
        <p class="faint">
          {{ walletConnected
            ? 'Teams added to this signed wallet appear here automatically.'
            : 'Connect your Nimiq wallet on Map, then open a protected team invitation.' }}
        </p>
      </div>

      <ul v-else class="list team-list">
        <li v-for="route in teamRoutes" :key="route.teamId" class="item team-item">
          <button type="button" class="open" @click="emit('open-team', route.teamId)">
            <span class="name">{{ route.name }}</span>
            <span class="meta faint">
              <span class="badge">{{ route.role === 'editor' ? 'Editor' : 'Viewer' }}</span>
              <span>Protected Track</span>
            </span>
          </button>
          <button
            type="button"
            class="forget"
            :aria-label="`Remove ${route.name} from this device`"
            @click="emit('forget-team', route.teamId)"
          >
            Forget
          </button>
        </li>
      </ul>
    </section>

    <button v-if="plans.length" type="button" class="btn btn--primary btn--block" @click="emit('create')">
      Map another idea
    </button>
  </div>
</template>

<style scoped>
.warn {
  padding: var(--s3) var(--s4);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--danger-subtle);
  color: var(--text);
  font-size: var(--text-sm);
  line-height: var(--leading);
}

.eyebrow { margin: 0 0 var(--s2); color: var(--accent); font-family: var(--font-mono); font-size: .7rem; font-weight: 750; letter-spacing: .12em; text-transform: uppercase; }
.screen__title { font-family: var(--font-display); font-size: clamp(2.25rem, 8vw, 4.5rem); letter-spacing: -.045em; }
.storage-note { display: grid; gap: var(--s1); min-width: 0; margin-top: var(--s4); padding: var(--s3) var(--s4); border-left: 3px solid var(--accent); background: var(--surface-sunken); font-size: var(--text-sm); line-height: var(--leading); }
.storage-note span { color: var(--text-muted); overflow-wrap: anywhere; }
.library-actions { display: flex; justify-content: flex-end; margin: var(--s3) 0 var(--s4); }
.visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

/* -- empty --------------------------------------------------------------- */

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--s3);
  padding: var(--s10) var(--s4);
  text-align: center;
}

.empty__mark {
  color: var(--line-strong);
}

.empty__title {
  font-size: var(--text-lg);
  font-weight: 650;
}

.empty__body {
  max-width: 30ch;
  font-size: var(--text-sm);
  line-height: var(--leading-loose);
}

.empty--compact { padding: var(--s7) var(--s4); border: 1px solid var(--line); border-radius: var(--r-md); }

/* -- route groups -------------------------------------------------------- */

.route-group { min-width: 0; margin-top: var(--s6); }
.route-group__heading { display: flex; align-items: center; gap: var(--s2); min-width: 0; margin-bottom: var(--s3); }
.route-group__heading h2 { min-width: 0; font-family: var(--font-mono); font-size: var(--text-xs); font-weight: 800; letter-spacing: .09em; overflow-wrap: anywhere; text-transform: uppercase; }
.route-group__count { flex: 0 0 auto; display: grid; place-items: center; min-width: 24px; height: 24px; padding-inline: var(--s2); border: 1px solid var(--line); border-radius: 999px; color: var(--text-muted); font-size: .68rem; }
.team-empty { min-width: 0; padding: var(--s4); border: 1px dashed var(--line-strong); border-radius: var(--r-md); }
.team-empty p { overflow-wrap: anywhere; }
.team-empty__title { margin-bottom: var(--s1); font-size: var(--text-sm); font-weight: 750; }

/* -- list ---------------------------------------------------------------- */

.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0;
  border-top: 1px solid var(--line-strong);
}

.item {
  overflow: hidden;
  border-bottom: 1px solid var(--line-strong);
}

.row {
  display: flex;
  align-items: stretch;
}

.team-item { display: flex; align-items: stretch; min-width: 0; }
.team-item .open { min-width: 0; }
.forget { flex: 0 0 auto; align-self: stretch; padding: 0 var(--s3); border-left: 1px solid var(--line); color: var(--text-faint); font-size: var(--text-xs); font-weight: 700; white-space: normal; overflow-wrap: anywhere; }
.forget:hover { background: var(--surface-hover); color: var(--text); }

.open {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--s1);
  padding: var(--s5) var(--s2);
  text-align: left;
}

.open:hover {
  background: var(--surface-hover);
}

.name {
  font-family: var(--font-display);
  font-size: var(--text-lg);
  font-weight: 700;
  letter-spacing: -0.012em;
  /* One line: the library is for scanning, and the plan itself holds the detail. */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--s2);
  font-size: var(--text-xs);
}

.more {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  color: var(--text-faint);
  border-left: 1px solid var(--line);
  fill: currentColor;
}

.more:hover {
  background: var(--surface-hover);
  color: var(--text);
}

/* -- tray ---------------------------------------------------------------- */

.tray {
  display: flex;
  flex-direction: column;
  gap: var(--s3);
  padding: var(--s3) var(--s4) var(--s4);
  border-top: 1px solid var(--line);
  background: var(--surface-sunken);
}

.tray__row {
  display: flex;
  gap: var(--s2);
}

.rename,
.confirm {
  display: flex;
  flex-direction: column;
  gap: var(--s3);
}

.confirm__q {
  font-size: var(--text-sm);
}

.danger {
  color: var(--danger);
}
</style>
