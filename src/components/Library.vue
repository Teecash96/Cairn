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
import { computed, ref, watch } from 'vue'
import CairnMark from './CairnMark.vue'
import { relativeTime, titleOf, type Plan } from '../lib/plan'
import { projectStats } from '../lib/tracker'

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
const totals = computed(() => plans.reduce(
  (sum, plan) => {
    const stats = projectStats(plan.build)
    sum.tasks += stats.totalTasks
    sum.done += stats.completedTasks
    return sum
  },
  { tasks: 0, done: 0 },
))

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
  <div class="screen library-screen">
    <header class="library-head">
      <div class="library-brand" aria-label="Cairn">
        <span><CairnMark :size="20" /></span>
        <strong>Cairn</strong>
      </div>
      <div class="library-title">
        <p class="eyebrow">Project home</p>
        <h1 class="screen__title">Keep every idea moving.</h1>
        <p class="screen__sub">Return to the work, find the next useful task, or start something new.</p>
      </div>
      <button type="button" class="btn btn--primary library-create" @click="emit('create')">
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
          <path d="M10 4v12M4 10h12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
        </svg>
        New project
      </button>
    </header>

    <p v-if="!persistent" class="warn">
      This browser cannot save your projects. Copy anything you need before you close the app.
    </p>

    <section v-if="plans.length" class="library-stats" aria-label="Project overview">
      <div><strong>{{ plans.length }}</strong><span>Active projects</span></div>
      <div><strong>{{ totals.tasks }}</strong><span>Planned tasks</span></div>
      <div><strong>{{ totals.done }}</strong><span>Completed</span></div>
    </section>

    <div v-if="!plans.length" class="empty">
      <span class="empty__mark"><CairnMark :size="34" /></span>
      <p class="empty__title">Your project space is ready</p>
      <p class="empty__body faint">
        Describe one rough idea. Cairn will connect the plan, build steps, and next action.
      </p>
      <button type="button" class="btn btn--primary" @click="emit('create')">
        Create the first plan
      </button>
    </div>

    <ul v-else class="project-grid">
      <li v-for="(plan, index) in plans" :key="plan.id" class="project-item" :class="`project-item--tone-${index % 3}`">
        <button type="button" class="project-card" @click="emit('open', plan.id)">
          <span class="project-card__top">
            <span class="project-card__kind"><i aria-hidden="true" />Project</span>
            <span class="project-card__time">{{ relativeTime(plan.updatedAt) }}</span>
          </span>
          <span class="name">{{ titleOf(plan) }}</span>
          <span class="next-label">Next useful move</span>
          <span class="next-value">{{ plan.build.nextAction || 'Review the plan and choose the next task.' }}</span>
          <span class="project-card__progress">
            <span>{{ projectStats(plan.build).completedTasks }}/{{ projectStats(plan.build).totalTasks }} tasks</span>
            <strong>{{ projectStats(plan.build).progress }}%</strong>
          </span>
          <span class="progress-track" aria-hidden="true">
            <span :style="{ width: `${projectStats(plan.build).progress}%` }" />
          </span>
          <span class="project-card__foot">
            <span>{{ plan.flow.length }} mapped steps</span>
            <span v-if="plan.shareId" class="badge">Shared</span>
          </span>
        </button>

        <button type="button" class="more" :aria-expanded="openRow === plan.id" :aria-label="`Actions for ${titleOf(plan)}`" @click="toggleRow(plan.id)">
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
            <circle cx="8" cy="3.5" r="1.4" />
            <circle cx="8" cy="8" r="1.4" />
            <circle cx="8" cy="12.5" r="1.4" />
          </svg>
        </button>

        <Transition name="tray-reveal">
          <div v-if="openRow === plan.id" class="tray">
            <div v-if="renamingId === plan.id" class="rename">
              <input v-model="draftName" class="input" aria-label="New plan name" autocapitalize="words" @keydown.enter="commitRename(plan.id)" />
              <div class="tray__row">
                <button type="button" class="btn btn--primary btn--sm" @click="commitRename(plan.id)">Save name</button>
                <button type="button" class="btn btn--secondary btn--sm" @click="renamingId = null">Cancel</button>
              </div>
            </div>

            <div v-else-if="confirmingId === plan.id" class="confirm">
              <p class="confirm__q">Delete this project?</p>
              <div class="tray__row">
                <button type="button" class="btn btn--danger btn--sm" @click="emit('remove', plan.id)">Delete</button>
                <button type="button" class="btn btn--secondary btn--sm" @click="confirmingId = null">Keep it</button>
              </div>
            </div>

            <div v-else class="tray__row">
              <button type="button" class="btn btn--secondary btn--sm" @click="startRename(plan)">Rename</button>
              <button type="button" class="btn btn--ghost btn--sm danger" @click="confirmingId = plan.id">Delete</button>
            </div>
          </div>
        </Transition>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.library-screen { width: min(100%, 1120px); gap: var(--s8); }
.library-head { display: grid; grid-template-columns: 1fr auto; align-items: end; gap: var(--s6); }
.library-brand { grid-column: 1 / -1; display: flex; align-items: center; gap: var(--s2); }
.library-brand > span { display: grid; place-items: center; width: 36px; height: 36px; color: var(--ink); background: var(--nim); border-radius: 12px; }
.library-brand strong { font-family: var(--font-display); font-size: var(--text-md); }
.library-title { display: grid; gap: var(--s2); }
.library-title .screen__sub { max-width: 40rem; margin: 0; font-size: var(--text-base); }
.library-create { align-self: end; }
.warn {
  padding: var(--s3) var(--s4);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--danger-subtle);
  color: var(--text);
  font-size: var(--text-sm);
  line-height: var(--leading);
}

.eyebrow { margin: 0; color: var(--accent); font-size: var(--text-xs); font-weight: 800; letter-spacing: .065em; text-transform: uppercase; }
.screen__title { max-width: 15ch; font-family: var(--font-display); font-size: clamp(2.2rem, 6vw, 4rem); letter-spacing: -.05em; }

.library-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--s3); }
.library-stats > div { display: grid; gap: var(--s1); padding: var(--s4); background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-md); }
.library-stats strong { font-family: var(--font-display); font-size: 1.6rem; letter-spacing: -.04em; }
.library-stats span { color: var(--text-muted); font-size: var(--text-xs); }

/* -- empty --------------------------------------------------------------- */

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--s3);
  padding: var(--s12) var(--s4);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-xl);
  text-align: center;
}

.empty__mark { display: grid; place-items: center; width: 64px; height: 64px; color: var(--accent); background: var(--accent-subtle); border-radius: 22px; }

.empty__title {
  font-size: var(--text-lg);
  font-weight: 650;
}

.empty__body {
  max-width: 30ch;
  font-size: var(--text-sm);
  line-height: var(--leading-loose);
}

.project-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--s4); margin: 0; padding: 0; list-style: none; }
.project-item { position: relative; min-width: 0; }
.project-card { display: flex; flex-direction: column; gap: var(--s3); width: 100%; height: 100%; min-height: 260px; padding: var(--s5); text-align: left; background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-lg); box-shadow: 0 1px 2px rgb(35 40 32 / 3%); transition: transform var(--duration-fast) var(--ease-smooth-out), box-shadow var(--duration-fast) var(--ease-smooth-out), border-color var(--duration-fast) var(--ease-smooth-out); }
.project-card:hover { transform: translateY(-3px); border-color: var(--line-strong); box-shadow: var(--shadow-card); }
.project-card__top, .project-card__progress, .project-card__foot { display: flex; align-items: center; justify-content: space-between; gap: var(--s3); }
.project-card__top { min-width: 0; padding-right: calc(44px + var(--s3)); }
.project-card__kind { display: inline-flex; align-items: center; gap: var(--s2); min-width: 0; overflow: hidden; color: var(--text-muted); font-size: var(--text-xs); font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
.project-card__kind i { width: 8px; height: 8px; background: var(--accent); border-radius: 50%; }
.project-item--tone-1 .project-card__kind i { background: var(--moss); }
.project-item--tone-2 .project-card__kind i { background: var(--clay); }
.project-card__time { flex: 0 1 auto; min-width: 0; max-width: 42%; overflow: hidden; color: var(--text-faint); font-size: var(--text-xs); text-align: right; text-overflow: ellipsis; white-space: nowrap; }

.name {
  font-family: var(--font-display);
  font-size: 1.35rem;
  font-weight: 700;
  letter-spacing: -.035em;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.next-label { margin-top: var(--s2); color: var(--accent); font-size: .68rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
.next-value { flex: 1; min-width: 0; color: var(--text-muted); font-size: var(--text-sm); line-height: var(--leading); display: -webkit-box; overflow: hidden; overflow-wrap: anywhere; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.project-card__progress { color: var(--text-muted); font-size: var(--text-xs); }
.project-card__progress strong { color: var(--text); font-size: var(--text-xs); }
.progress-track { height: 5px; overflow: hidden; background: var(--surface-sunken); border-radius: var(--r-full); }
.progress-track > span { display: block; height: 100%; background: var(--accent); border-radius: inherit; transition: width var(--duration-slow) var(--ease-smooth-out); }
.project-card__foot { color: var(--text-faint); font-size: var(--text-xs); }

.more {
  position: absolute;
  z-index: 2;
  top: var(--s3);
  right: var(--s3);
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  color: var(--text-faint);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 14px;
  fill: currentColor;
}

.more:hover {
  background: var(--surface-hover);
  color: var(--text);
}

/* -- tray ---------------------------------------------------------------- */

.tray {
  position: absolute;
  z-index: 5;
  top: 3.8rem;
  right: var(--s3);
  display: flex;
  flex-direction: column;
  gap: var(--s3);
  width: min(19rem, calc(100% - 1.5rem));
  padding: var(--s4);
  background: var(--surface);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-float);
  transform-origin: top right;
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

/* transitions.dev menu-dropdown. */
.tray-reveal-enter-active { transition: opacity var(--dropdown-open-dur) var(--dropdown-ease), transform var(--dropdown-open-dur) var(--dropdown-ease), filter var(--dropdown-open-dur) var(--dropdown-ease); }
.tray-reveal-leave-active { transition: opacity var(--dropdown-close-dur) var(--dropdown-ease), transform var(--dropdown-close-dur) var(--dropdown-ease), filter var(--dropdown-close-dur) var(--dropdown-ease); }
.tray-reveal-enter-from, .tray-reveal-leave-to { opacity: 0; transform: scale(.97) translateY(calc(var(--distance-micro) * -1)); filter: blur(var(--blur-small)); }

@media (max-width: 720px) {
  .library-head { grid-template-columns: 1fr; align-items: start; }
  .library-brand { grid-column: auto; }
  .library-create { width: 100%; }
  .project-grid { grid-template-columns: 1fr; }
  .library-stats { overflow-x: auto; grid-template-columns: repeat(3, minmax(8.5rem, 1fr)); padding-bottom: var(--s1); }
}

@media (max-width: 480px) {
  .library-screen { gap: var(--s6); }
  .library-title .screen__title { font-size: 2.35rem; }
  .library-stats { grid-template-columns: repeat(3, minmax(0, 1fr)); overflow-x: visible; padding-bottom: 0; }
  .library-stats > div { min-width: 0; padding: var(--s3); }
  .library-stats span { overflow-wrap: anywhere; }
  .project-card { min-height: 238px; padding: var(--s4); }
}
</style>
