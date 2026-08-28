<script setup lang="ts">
/**
 * The PRD, readable and editable.
 *
 * Read mode omits empty sections — every field is user-editable, so a blank is a
 * normal state, and a document full of empty headings reads like a broken
 * template. Edit mode shows all of them, because that is when a blank is an
 * invitation.
 *
 * Assumptions get their own tinted block on purpose. The generator is instructed
 * never to invent market data, and to label anything it inferred as an
 * assumption; giving those a visually distinct home is what makes that promise
 * legible instead of buried in a bullet list.
 *
 * Edits are written straight into the plan object the parent owns, which then
 * autosaves. There is no draft copy and no explicit save button — losing an edit
 * to a forgotten tap is worse than any consistency it would buy.
 */
import AutoTextarea from './AutoTextarea.vue'
import EditableList from './EditableList.vue'
import { PRD_LIST_MAX, type Prd } from '../lib/plan'

const { prd, editing } = defineProps<{
  prd: Prd
  editing: boolean
}>()

function filled(items: string[]): string[] {
  return items.map((item) => item.trim()).filter(Boolean)
}

/** Read mode hides a section with nothing in it; edit mode always shows it. */
function showProse(value: string): boolean {
  return editing || value.trim().length > 0
}

function showList(items: string[]): boolean {
  return editing || filled(items).length > 0
}
</script>

<template>
  <div class="prd">
    <section v-if="showProse(prd.summary)" class="block">
      <h3 class="head">Product summary</h3>
      <AutoTextarea
        v-if="editing"
        v-model="prd.summary"
        :rows="4"
        aria-label="Product summary"
        placeholder="One paragraph: what this is and who it is for."
      />
      <p v-else class="prose lede">{{ prd.summary }}</p>
    </section>

    <section v-if="showProse(prd.problem)" class="block">
      <h3 class="head">Problem</h3>
      <AutoTextarea
        v-if="editing"
        v-model="prd.problem"
        :rows="3"
        aria-label="Problem"
        placeholder="What is broken today, and what does it cost?"
      />
      <p v-else class="prose">{{ prd.problem }}</p>
    </section>

    <div class="pair">
      <section v-if="showProse(prd.targetUser)" class="block">
        <h3 class="head">Target user</h3>
        <AutoTextarea
          v-if="editing"
          v-model="prd.targetUser"
          :rows="2"
          aria-label="Target user"
          placeholder="Who specifically?"
        />
        <p v-else class="prose">{{ prd.targetUser }}</p>
      </section>

      <section v-if="showProse(prd.userGoal)" class="block">
        <h3 class="head">User goal</h3>
        <AutoTextarea
          v-if="editing"
          v-model="prd.userGoal"
          :rows="2"
          aria-label="User goal"
          placeholder="As a …, I want to …"
        />
        <p v-else class="prose">{{ prd.userGoal }}</p>
      </section>
    </div>

    <section v-if="showList(prd.coreFeatures)" class="block">
      <h3 class="head">Core features</h3>
      <EditableList
        v-if="editing"
        v-model="prd.coreFeatures"
        label="Core features"
        :max="PRD_LIST_MAX"
        placeholder="One capability, stated plainly."
        add-label="Add feature"
      />
      <ul v-else class="bullets">
        <li v-for="(item, i) in filled(prd.coreFeatures)" :key="i">{{ item }}</li>
      </ul>
    </section>

    <section v-if="showList(prd.userStories)" class="block">
      <h3 class="head">User stories</h3>
      <EditableList
        v-if="editing"
        v-model="prd.userStories"
        label="User stories"
        :max="PRD_LIST_MAX"
        placeholder="As a …, I can …"
        add-label="Add story"
      />
      <ul v-else class="bullets">
        <li v-for="(item, i) in filled(prd.userStories)" :key="i">{{ item }}</li>
      </ul>
    </section>

    <section v-if="showList(prd.successCriteria)" class="block">
      <h3 class="head">Success criteria</h3>
      <EditableList
        v-if="editing"
        v-model="prd.successCriteria"
        label="Success criteria"
        :max="PRD_LIST_MAX"
        placeholder="How you will know it worked."
        add-label="Add criterion"
      />
      <ul v-else class="bullets">
        <li v-for="(item, i) in filled(prd.successCriteria)" :key="i">{{ item }}</li>
      </ul>
    </section>

    <section v-if="showList(prd.assumptions)" class="block block--noted">
      <h3 class="head">
        Assumptions
        <span class="badge">Unverified</span>
      </h3>
      <p class="note faint">Inferred from your description, not researched. Check these before you build.</p>
      <EditableList
        v-if="editing"
        v-model="prd.assumptions"
        label="Assumptions"
        :max="8"
        placeholder="Something taken on faith."
        add-label="Add assumption"
      />
      <ul v-else class="bullets">
        <li v-for="(item, i) in filled(prd.assumptions)" :key="i">{{ item }}</li>
      </ul>
    </section>

    <section v-if="showList(prd.outOfScope)" class="block">
      <h3 class="head">Out of scope</h3>
      <EditableList
        v-if="editing"
        v-model="prd.outOfScope"
        label="Out of scope"
        :max="8"
        placeholder="Something you are deliberately not doing."
        add-label="Add exclusion"
      />
      <ul v-else class="bullets bullets--muted">
        <li v-for="(item, i) in filled(prd.outOfScope)" :key="i">{{ item }}</li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.prd {
  display: flex;
  flex-direction: column;
  gap: var(--s6);
}

.block {
  display: flex;
  flex-direction: column;
  gap: var(--s2);
}

/* Assumptions: set apart so the caveat can't be skimmed past. */
.block--noted {
  padding: var(--s4);
  margin: 0 calc(var(--s1) * -1);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--surface-sunken);
}

.head {
  display: flex;
  align-items: center;
  gap: var(--s2);
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.note {
  font-size: var(--text-xs);
  line-height: var(--leading);
  margin-bottom: var(--s1);
}

.prose {
  line-height: var(--leading-loose);
  /* Long unbroken strings (URLs, product names) must not widen the page. */
  overflow-wrap: break-word;
}

.lede {
  font-size: var(--text-lg);
  line-height: var(--leading);
  letter-spacing: -0.008em;
}

.pair {
  display: flex;
  flex-direction: column;
  gap: var(--s6);
}

.bullets {
  display: flex;
  flex-direction: column;
  gap: var(--s2);
  margin: 0;
  padding-left: var(--s5);
  line-height: var(--leading-loose);
}

.bullets li {
  overflow-wrap: break-word;
}

.bullets li::marker {
  color: var(--accent);
}

.bullets--muted {
  color: var(--text-muted);
}

.bullets--muted li::marker {
  color: var(--text-faint);
}

/* Two-up only where there is genuinely room; portrait phones stay stacked. */
@media (min-width: 33rem) {
  .pair {
    flex-direction: row;
    gap: var(--s6);
  }

  .pair > .block {
    flex: 1 1 0;
    min-width: 0;
  }
}
</style>
