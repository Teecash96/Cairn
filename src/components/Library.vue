<script setup lang="ts">
/**
 * Everything you have made, newest first.
 *
 * The spec asks for a sidebar of recent plans; on a portrait phone that is a tab.
 *
 * Plans live in this device's localStorage and nowhere else, which is a feature
 * — no account, nothing uploaded — right up until the WebView is in private mode
 * and refuses to write. Then it is data loss, so the screen says so plainly
 * rather than presenting an empty list as normal.
 */
import { ref, watch } from 'vue'
import CairnMark from './CairnMark.vue'
import { relativeTime, titleOf, type Plan } from '../lib/plan'

const { plans, persistent = true } = defineProps<{
  plans: Plan[]
  persistent?: boolean
}>()

const emit = defineEmits<{
  open: [id: string]
  create: []
  remove: [id: string]
  rename: [id: string, name: string]
}>()

/** Id of the row whose actions are showing, if any. */
const openRow = ref<string | null>(null)
const renamingId = ref<string | null>(null)
const draftName = ref('')
const confirmingId = ref<string | null>(null)

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
        {{ plans.length }} product {{ plans.length === 1 ? 'route' : 'routes' }} saved on this device.
      </p>
    </header>

    <p v-if="!persistent" class="warn">
      This browser is refusing to save anything — private mode, most likely. Plans will vanish when
      you close the app, so copy anything you want to keep.
    </p>

    <!-- Empty state, designed rather than defaulted. -->
    <div v-if="!plans.length" class="empty">
      <CairnMark :size="34" class="empty__mark" />
      <p class="empty__title">No routes marked yet</p>
      <p class="empty__body faint">
        Describe one rough idea. Cairn will map the product and mark the route to its first release.
      </p>
      <button type="button" class="btn btn--primary" @click="emit('create')">
        Map an idea
      </button>
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
