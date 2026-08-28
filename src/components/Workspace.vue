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
import FlowDiagram from './FlowDiagram.vue'
import PrdView from './PrdView.vue'
import { copyText, canDownload, downloadText } from '../lib/clipboard'
import { flowToText, planToMarkdown, prdToText } from '../lib/markdown'
import { relativeTime, slugOf, titleOf, type Plan } from '../lib/plan'

const {
  plan,
  readOnly = false,
  sharing = false,
  regenerating = false,
} = defineProps<{
  plan: Plan
  /** A plan shared with you: readable, exportable, not editable. */
  readOnly?: boolean
  sharing?: boolean
  regenerating?: boolean
}>()

const emit = defineEmits<{
  back: []
  regenerate: []
  share: []
  remove: []
  notify: [message: string, tone?: 'info' | 'success' | 'error']
}>()

type Tab = 'prd' | 'flow'

const tab = ref<Tab>('prd')
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
    tab.value = 'prd'
    editing.value = false
    confirmingRemove.value = false
  },
)

async function copy(what: 'prd' | 'flow' | 'markdown'): Promise<void> {
  const text =
    what === 'prd' ? prdToText(plan) : what === 'flow' ? flowToText(plan.flow) : planToMarkdown(plan)

  const label = what === 'markdown' ? 'Markdown' : what === 'prd' ? 'PRD' : 'Flow'

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
    tab.value = tab.value === 'prd' ? 'flow' : 'prd'
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
        id="tab-prd"
        type="button"
        role="tab"
        class="tab"
        :class="{ 'tab--on': tab === 'prd' }"
        :aria-selected="tab === 'prd'"
        aria-controls="panel-prd"
        :tabindex="tab === 'prd' ? 0 : -1"
        @click="select('prd')"
      >
        PRD
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
    </div>

    <div class="body">
      <section
        v-if="tab === 'prd'"
        id="panel-prd"
        role="tabpanel"
        aria-labelledby="tab-prd"
        tabindex="0"
      >
        <PrdView :prd="plan.prd" :editing="editing" />
      </section>

      <section
        v-else
        id="panel-flow"
        role="tabpanel"
        aria-labelledby="tab-flow"
        tabindex="0"
      >
        <FlowDiagram v-model="plan.flow" :editing="editing" />
      </section>

      <div class="actions">
        <button type="button" class="btn btn--secondary btn--sm" @click="copy(tab)">
          {{ tab === 'prd' ? 'Copy PRD' : 'Copy flow' }}
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
</style>
