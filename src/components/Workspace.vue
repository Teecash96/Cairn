<script setup lang="ts">
/**
 * One plan, open: the PRD and the flow, side by side behind two tabs.
 *
 * The same component serves a plan you own and a plan someone shared with you —
 * `readOnly` removes every mutating affordance rather than a second, nearly
 * identical screen drifting out of sync with this one. The shared view is a
 * marketing surface as much as a feature, so it has to be the good one.
 *
 * Copy is the primary export path. A page cannot be trusted to start a file
 * download inside the Nimiq Pay WebView, so "Save .md" appears only where the
 * browser actually supports it, and never as the main action.
 */
import { computed, ref, watch } from 'vue'
import BuildView from './BuildView.vue'
import FlowDiagram from './FlowDiagram.vue'
import PrdView from './PrdView.vue'
import { copyText, canDownload, downloadText } from '../lib/clipboard'
import { buildToText, flowToText, planToMarkdown, prdToText } from '../lib/markdown'
import type { RefineAction } from '../lib/api'
import { relativeTime, slugOf, titleOf, type Plan } from '../lib/plan'

const {
  plan,
  readOnly = false,
  sharing = false,
  regenerating = false,
  refining = false,
} = defineProps<{
  plan: Plan
  /** A plan shared with you: readable, exportable, not editable. */
  readOnly?: boolean
  sharing?: boolean
  regenerating?: boolean
  refining?: boolean
}>()

const emit = defineEmits<{
  back: []
  regenerate: []
  share: []
  refine: [action: RefineAction]
  remove: []
  notify: [message: string, tone?: 'info' | 'success' | 'error']
}>()

type Tab = 'brief' | 'flow' | 'build'

const tab = ref<Tab>('brief')
const editing = ref(false)
const confirmingRemove = ref(false)

/** Checked once: it is a capability of the browser, not of this plan. */
const downloadable = canDownload()

const heading = computed(() => titleOf(plan))
const edited = computed(() => relativeTime(plan.updatedAt))

// Opening a different plan must not inherit the previous one's mode.
watch(
  () => plan.id,
  () => {
    tab.value = 'brief'
    editing.value = false
    confirmingRemove.value = false
  },
)

async function copy(what: 'prd' | 'flow' | 'build' | 'markdown'): Promise<void> {
  const text =
    what === 'prd'
      ? prdToText(plan)
      : what === 'flow'
        ? flowToText(plan.flow)
        : what === 'build'
          ? buildToText(plan)
          : planToMarkdown(plan)

  const label =
    what === 'markdown' ? 'Markdown' : what === 'prd' ? 'Brief' : what === 'flow' ? 'Flow' : 'Builder pack'

  if (await copyText(text)) emit('notify', `${label} copied`, 'success')
  else emit('notify', "This browser wouldn't let us copy", 'error')
}

function save(): void {
  if (downloadText(`${slugOf(plan)}-plan.md`, planToMarkdown(plan))) {
    emit('notify', 'Saved as Markdown', 'success')
  } else {
    emit('notify', "This browser can't save files — copy instead", 'error')
  }
}

function select(next: Tab): void {
  tab.value = next
}

/** Left/right arrows move between tabs, as the tab pattern requires. */
function onTabKey(event: KeyboardEvent): void {
  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
    event.preventDefault()
    const tabs: Tab[] = ['brief', 'flow', 'build']
    const currentIndex = tabs.indexOf(tab.value)
    const offset = event.key === 'ArrowRight' ? 1 : -1
    tab.value = tabs[(currentIndex + offset + tabs.length) % tabs.length] ?? 'brief'
  }
}
</script>

<template>
  <div class="screen screen--flush">
    <header class="bar">
      <button type="button" class="btn btn--ghost back" @click="emit('back')">
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
          <path
            d="M9.5 3.5L5 8l4.5 4.5"
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        Back
      </button>

      <button
        v-if="!readOnly"
        type="button"
        class="btn btn--ghost"
        :aria-pressed="editing"
        @click="editing = !editing"
      >
        {{ editing ? 'Done' : 'Edit' }}
      </button>
    </header>

    <slot name="banner" />

    <div class="titling">
      <input
        v-if="editing"
        v-model="plan.name"
        class="input name"
        aria-label="Plan name"
        :placeholder="heading"
        autocapitalize="sentences"
      />
      <h2 v-else class="screen__title">{{ heading }}</h2>

      <p class="meta faint">
        <span>{{ plan.flow.length }} steps</span>
        <span aria-hidden="true">·</span>
        <span>{{ readOnly ? 'shared with you' : `edited ${edited}` }}</span>
        <span v-if="plan.shareId && !readOnly" class="badge">Shared</span>
      </p>
    </div>

    <div class="tabs" role="tablist" aria-label="Plan sections" @keydown="onTabKey">
      <button
        id="tab-brief"
        type="button"
        role="tab"
        class="tab"
        :class="{ 'tab--on': tab === 'brief' }"
        :aria-selected="tab === 'brief'"
        aria-controls="panel-brief"
        :tabindex="tab === 'brief' ? 0 : -1"
        @click="select('brief')"
      >
        Brief
      </button>
      <button
        id="tab-flow"
        type="button"
        role="tab"
        class="tab"
        :class="{ 'tab--on': tab === 'flow' }"
        :aria-selected="tab === 'flow'"
        aria-controls="panel-flow"
        :tabindex="tab === 'flow' ? 0 : -1"
        @click="select('flow')"
      >
        User flow
      </button>
      <button
        id="tab-build"
        type="button"
        role="tab"
        class="tab"
        :class="{ 'tab--on': tab === 'build' }"
        :aria-selected="tab === 'build'"
        aria-controls="panel-build"
        :tabindex="tab === 'build' ? 0 : -1"
        @click="select('build')"
      >
        Build
      </button>
    </div>

    <div class="body">
      <section
        v-if="tab === 'brief'"
        id="panel-brief"
        role="tabpanel"
        aria-labelledby="tab-brief"
        tabindex="0"
      >
        <PrdView :prd="plan.prd" :editing="editing" />
      </section>

      <section
        v-else-if="tab === 'flow'"
        id="panel-flow"
        role="tabpanel"
        aria-labelledby="tab-flow"
        tabindex="0"
      >
        <FlowDiagram v-model="plan.flow" :editing="editing" />
      </section>

      <section
        v-else
        id="panel-build"
        role="tabpanel"
        aria-labelledby="tab-build"
        tabindex="0"
      >
        <BuildView :build="plan.build" :reality-check="plan.realityCheck" :read-only="readOnly" />
        <div v-if="!readOnly" class="followups">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Follow up</p>
              <h3>Ask Cairn to sharpen this plan</h3>
            </div>
            <span v-if="refining" class="badge badge--accent">Working…</span>
          </div>
          <div class="quick-actions">
            <button type="button" class="btn btn--secondary btn--sm" :disabled="refining" @click="emit('refine', 'cut_mvp_scope')">Cut MVP scope</button>
            <button type="button" class="btn btn--secondary btn--sm" :disabled="refining" @click="emit('refine', 'break_into_tasks')">Break into tasks</button>
            <button type="button" class="btn btn--secondary btn--sm" :disabled="refining" @click="emit('refine', 'find_missing_risks')">Find missing risks</button>
            <button type="button" class="btn btn--secondary btn--sm" :disabled="refining" @click="emit('refine', 'improve_acceptance_tests')">Improve acceptance tests</button>
          </div>
          <button type="button" class="btn btn--ghost btn--block" :disabled="refining" @click="emit('refine', 'custom')">Ask a custom question</button>
        </div>
      </section>

      <div class="actions">
        <button type="button" class="btn btn--secondary btn--sm" @click="copy(tab === 'brief' ? 'prd' : tab)">
          {{ tab === 'brief' ? 'Copy brief' : tab === 'flow' ? 'Copy flow' : 'Copy builder pack' }}
        </button>
        <button type="button" class="btn btn--secondary btn--sm" @click="copy('markdown')">
          Copy Markdown
        </button>
        <button
          v-if="!readOnly"
          type="button"
          class="btn btn--primary btn--sm"
          :disabled="sharing"
          @click="emit('share')"
        >
          {{ sharing ? 'Sharing…' : plan.shareId ? 'Copy link' : 'Share' }}
        </button>
        <button v-if="downloadable" type="button" class="btn btn--ghost btn--sm" @click="save">
          Save .md
        </button>
      </div>

      <template v-if="!readOnly">
        <hr class="divider" />

        <div class="footer">
          <button
            type="button"
            class="btn btn--secondary btn--block"
            :disabled="regenerating"
            @click="emit('regenerate')"
          >
            {{ regenerating ? 'Generating…' : 'Try again from my description' }}
          </button>
          <p class="faint hint">Your original description is kept, so nothing is retyped.</p>

          <div v-if="confirmingRemove" class="confirm">
            <p class="confirm__q">Delete this plan? It only exists on this device.</p>
            <div class="confirm__row">
              <button type="button" class="btn btn--danger btn--sm" @click="emit('remove')">
                Delete
              </button>
              <button
                type="button"
                class="btn btn--secondary btn--sm"
                @click="confirmingRemove = false"
              >
                Keep it
              </button>
            </div>
          </div>
          <button
            v-else
            type="button"
            class="btn btn--ghost btn--sm remove"
            @click="confirmingRemove = true"
          >
            Delete plan
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* Sticky so Back and Edit stay reachable down a long PRD. */
.bar {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s2);
  padding: var(--safe-top) var(--s2) 0;
  min-height: calc(var(--safe-top) + 52px);
  background: var(--bg);
  border-bottom: 1px solid var(--line);
}

.back {
  padding-left: var(--s2);
}

.titling {
  padding: var(--s5) var(--s4) 0;
}

.name {
  font-size: var(--text-xl);
  font-weight: 650;
  letter-spacing: -0.018em;
  padding: var(--s2) var(--s3);
}

.meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--s2);
  margin-top: var(--s2);
  font-size: var(--text-xs);
}

/* -- tabs ---------------------------------------------------------------- */

.tabs {
  position: sticky;
  /* Directly under the bar, which is 52px plus the inset. */
  top: calc(var(--safe-top) + 52px);
  z-index: 15;
  display: flex;
  gap: var(--s1);
  margin-top: var(--s5);
  padding: 0 var(--s4);
  background: var(--bg);
  border-bottom: 1px solid var(--line);
}

.tab {
  padding: var(--s3) var(--s3);
  font-size: var(--text-sm);
  font-weight: 650;
  color: var(--text-muted);
  /* Reserved at rest so selecting a tab shifts nothing. */
  border-bottom: 2px solid transparent;
}

.tab--on {
  color: var(--text);
  border-bottom-color: var(--accent);
}

/* -- body ---------------------------------------------------------------- */

.body {
  display: flex;
  flex-direction: column;
  gap: var(--s6);
  padding: var(--s6) var(--s4) 0;
}

/* The panel is focusable for the tab pattern, but it is a container, not a
   control — the default ring on a full-width block is noise. */
.body [role='tabpanel']:focus {
  outline: none;
}

.body [role='tabpanel']:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 4px;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s2);
}

.footer {
  display: flex;
  flex-direction: column;
  gap: var(--s3);
}

.hint {
  font-size: var(--text-xs);
  line-height: var(--leading);
  text-align: center;
}

.remove {
  align-self: center;
  color: var(--text-faint);
}

.confirm {
  display: flex;
  flex-direction: column;
  gap: var(--s3);
  padding: var(--s4);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--danger-subtle);
}

.confirm__q {
  font-size: var(--text-sm);
  line-height: var(--leading);
}

.confirm__row {
  display: flex;
  gap: var(--s2);
}

.followups {
  display: flex;
  flex-direction: column;
  gap: var(--s3);
  padding: var(--s4);
  border: 1px solid var(--accent-line);
  border-radius: var(--r-md);
  background: var(--accent-subtle);
}

.followups h3 { font-size: var(--text-md); }
.eyebrow { margin: 0 0 var(--s1); color: var(--accent); font-size: var(--text-xs); font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
.quick-actions { display: flex; flex-wrap: wrap; gap: var(--s2); }
.quick-actions .btn { flex: 1 1 9rem; }
</style>
