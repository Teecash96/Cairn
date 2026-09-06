<script setup lang="ts">
/**
 * A visual reading of the PRD.
 *
 * The text Brief remains the editing source of truth. This view gives the same
 * fields a stronger visual order: context first, then the user promise, the
 * smallest release, proof, and guardrails. It is deliberately real HTML rather
 * than a canvas image, so it reflows, remains selectable, and works in a phone
 * WebView and with a screen reader.
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

function showProse(value: string): boolean {
  return editing || value.trim().length > 0
}

function showList(items: string[]): boolean {
  return editing || filled(items).length > 0
}
</script>

<template>
  <div class="visual-prd" aria-labelledby="visual-prd-heading">
    <header class="visual-intro">
      <div class="visual-intro__label">
        <span class="visual-intro__mark" aria-hidden="true">✦</span>
        <p class="eyebrow">Visual PRD</p>
      </div>
      <h3 id="visual-prd-heading">See the product at a glance</h3>
      <p class="muted visual-intro__copy">
        A visual path from the problem to the smallest useful release. Read it top to bottom.
      </p>
    </header>

    <div class="visual-map">
      <section class="visual-card visual-card--hero" aria-labelledby="visual-summary-heading">
        <div class="visual-card__top">
          <span class="visual-card__number" aria-hidden="true">01</span>
          <span class="badge badge--accent">North star</span>
        </div>
        <h4 id="visual-summary-heading">What are we building?</h4>
        <AutoTextarea
          v-if="editing"
          v-model="prd.summary"
          :rows="4"
          aria-label="Product summary"
          placeholder="One clear sentence about the product and its user."
        />
        <p v-else class="visual-card__lead" :class="{ 'visual-card__placeholder': !prd.summary.trim() }">
          {{ prd.summary.trim() || 'Add a product summary in Edit mode.' }}
        </p>
      </section>

      <div class="visual-connector" aria-hidden="true"><span /></div>

      <div class="visual-grid visual-grid--context">
        <section v-if="showProse(prd.problem)" class="visual-card visual-card--problem" aria-labelledby="visual-problem-heading">
          <div class="visual-card__top">
            <span class="visual-card__number" aria-hidden="true">02</span>
            <span class="badge">Tension</span>
          </div>
          <h4 id="visual-problem-heading">The problem</h4>
          <AutoTextarea
            v-if="editing"
            v-model="prd.problem"
            :rows="3"
            aria-label="Problem"
            placeholder="What is broken today?"
          />
          <p v-else class="prose">{{ prd.problem }}</p>
        </section>

        <section v-if="showProse(prd.targetUser)" class="visual-card visual-card--user" aria-labelledby="visual-user-heading">
          <div class="visual-card__top">
            <span class="visual-card__number" aria-hidden="true">03</span>
            <span class="badge">Person</span>
          </div>
          <h4 id="visual-user-heading">The user</h4>
          <AutoTextarea
            v-if="editing"
            v-model="prd.targetUser"
            :rows="3"
            aria-label="Target user"
            placeholder="Who specifically needs this?"
          />
          <p v-else class="prose">{{ prd.targetUser }}</p>
        </section>

        <section v-if="showProse(prd.userGoal)" class="visual-card visual-card--goal" aria-labelledby="visual-goal-heading">
          <div class="visual-card__top">
            <span class="visual-card__number" aria-hidden="true">04</span>
            <span class="badge badge--accent">Promise</span>
          </div>
          <h4 id="visual-goal-heading">The user should be able to</h4>
          <AutoTextarea
            v-if="editing"
            v-model="prd.userGoal"
            :rows="3"
            aria-label="User goal"
            placeholder="As a …, I want to …"
          />
          <p v-else class="prose">{{ prd.userGoal }}</p>
        </section>
      </div>

      <div class="visual-connector" aria-hidden="true"><span /></div>

      <section v-if="showList(prd.coreFeatures)" class="visual-card visual-card--release" aria-labelledby="visual-release-heading">
        <div class="visual-card__top">
          <span class="visual-card__number" aria-hidden="true">05</span>
          <span class="badge badge--accent">First release</span>
        </div>
        <h4 id="visual-release-heading">What belongs in the smallest useful release?</h4>
        <EditableList
          v-if="editing"
          v-model="prd.coreFeatures"
          label="Core features"
          :max="PRD_LIST_MAX"
          placeholder="One capability, stated plainly."
          add-label="Add feature"
        />
        <ol v-else class="feature-grid">
          <li v-for="(item, index) in filled(prd.coreFeatures)" :key="`${item}-${index}`" class="feature-item">
            <span class="feature-item__number" aria-hidden="true">{{ index + 1 }}</span>
            <span>{{ item }}</span>
          </li>
        </ol>
      </section>

      <div class="visual-connector" aria-hidden="true"><span /></div>

      <div class="visual-grid visual-grid--proof">
        <section v-if="showList(prd.successCriteria)" class="visual-card visual-card--proof" aria-labelledby="visual-proof-heading">
          <div class="visual-card__top">
            <span class="visual-card__number" aria-hidden="true">06</span>
            <span class="badge">Proof</span>
          </div>
          <h4 id="visual-proof-heading">How will we know it works?</h4>
          <EditableList
            v-if="editing"
            v-model="prd.successCriteria"
            label="Success criteria"
            :max="PRD_LIST_MAX"
            placeholder="A result you can observe."
            add-label="Add criterion"
          />
          <ul v-else class="check-list">
            <li v-for="item in filled(prd.successCriteria)" :key="item">
              <span class="check-list__mark" aria-hidden="true">✓</span>
              <span>{{ item }}</span>
            </li>
          </ul>
        </section>

        <section v-if="showList(prd.assumptions) || showList(prd.outOfScope)" class="visual-card visual-card--guardrails" aria-labelledby="visual-guardrails-heading">
          <div class="visual-card__top">
            <span class="visual-card__number" aria-hidden="true">07</span>
            <span class="badge">Guardrails</span>
          </div>
          <h4 id="visual-guardrails-heading">What we are not pretending to know</h4>
          <div v-if="showList(prd.assumptions)" class="guardrail-block">
            <p class="guardrail-block__label">Assumptions <span class="badge">Unverified</span></p>
            <EditableList
              v-if="editing"
              v-model="prd.assumptions"
              label="Assumptions"
              :max="8"
              placeholder="Something taken on faith."
              add-label="Add assumption"
            />
            <ul v-else class="plain-list">
              <li v-for="item in filled(prd.assumptions)" :key="item">{{ item }}</li>
            </ul>
          </div>
          <div v-if="showList(prd.outOfScope)" class="guardrail-block">
            <p class="guardrail-block__label">Out of scope</p>
            <EditableList
              v-if="editing"
              v-model="prd.outOfScope"
              label="Out of scope"
              :max="8"
              placeholder="Something you are deliberately not doing."
              add-label="Add exclusion"
            />
            <ul v-else class="plain-list plain-list--muted">
              <li v-for="item in filled(prd.outOfScope)" :key="item">{{ item }}</li>
            </ul>
          </div>
        </section>
      </div>
    </div>

    <p v-if="editing" class="visual-hint faint">This view edits the same PRD as Brief. Changes save automatically.</p>
  </div>
</template>

<style scoped>
.visual-prd { display: flex; flex-direction: column; gap: var(--s5); }
.visual-intro { display: flex; flex-direction: column; gap: var(--s2); }
.visual-intro__label { display: flex; align-items: center; gap: var(--s2); }
.visual-intro__mark { display: grid; place-items: center; width: 22px; height: 22px; border: 1px solid var(--accent-line); border-radius: 50%; color: var(--accent); font-size: var(--text-xs); }
.eyebrow { margin: 0; color: var(--accent); font-size: var(--text-xs); font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
.visual-intro h3 { font-size: var(--text-lg); letter-spacing: -.015em; }
.visual-intro__copy { max-width: 38rem; font-size: var(--text-sm); line-height: var(--leading); }
.visual-map { display: flex; flex-direction: column; gap: var(--s3); }
.visual-card { display: flex; flex-direction: column; gap: var(--s3); min-width: 0; padding: var(--s4); border: 1px solid var(--line); border-radius: var(--r-md); background: var(--surface); }
.visual-card--hero { border-color: var(--accent-line); background: var(--accent-subtle); }
.visual-card--goal { border-color: var(--accent-line); background: var(--surface-sunken); }
.visual-card--release { border-color: var(--line-strong); }
.visual-card--proof { background: var(--surface-sunken); }
.visual-card--guardrails { background: var(--surface-sunken); }
.visual-card__top { display: flex; align-items: center; justify-content: space-between; gap: var(--s2); }
.visual-card__number { color: var(--accent); font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: var(--text-xs); font-weight: 750; letter-spacing: .08em; }
.visual-card h4 { font-size: var(--text-md); line-height: var(--leading-tight); }
.visual-card__lead { max-width: 48rem; font-size: var(--text-lg); line-height: var(--leading); letter-spacing: -.008em; overflow-wrap: break-word; }
.visual-card__placeholder { color: var(--text-faint); font-size: var(--text-sm); letter-spacing: 0; }
.prose { color: var(--text-muted); font-size: var(--text-sm); line-height: var(--leading-loose); overflow-wrap: break-word; }
.visual-grid { display: grid; gap: var(--s3); }
.visual-grid--context { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.visual-grid--proof { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.visual-connector { align-self: center; position: relative; width: 1px; height: 20px; background: var(--accent-line); }
.visual-connector span { position: absolute; left: -3px; bottom: 0; width: 7px; height: 7px; border-right: 1px solid var(--accent); border-bottom: 1px solid var(--accent); transform: rotate(45deg); }
.feature-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--s2); margin: 0; padding: 0; list-style: none; counter-reset: feature; }
.feature-item { display: flex; align-items: flex-start; gap: var(--s2); min-width: 0; padding: var(--s3); border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--surface-sunken); color: var(--text-muted); font-size: var(--text-sm); line-height: var(--leading); }
.feature-item__number { display: grid; flex: 0 0 22px; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: var(--accent-subtle); color: var(--accent); font-size: var(--text-xs); font-weight: 750; }
.feature-item > span:last-child { min-width: 0; overflow-wrap: break-word; }
.check-list, .plain-list { display: flex; flex-direction: column; gap: var(--s2); margin: 0; padding: 0; list-style: none; }
.check-list li { display: flex; align-items: flex-start; gap: var(--s2); color: var(--text-muted); font-size: var(--text-sm); line-height: var(--leading); }
.check-list__mark { display: grid; flex: 0 0 20px; place-items: center; width: 20px; height: 20px; border: 1px solid var(--accent-line); border-radius: 50%; color: var(--accent); font-size: var(--text-xs); font-weight: 750; }
.plain-list { padding-left: var(--s4); list-style: disc; color: var(--text-muted); font-size: var(--text-sm); line-height: var(--leading); }
.plain-list li::marker { color: var(--accent); }
.plain-list--muted { color: var(--text-faint); }
.plain-list--muted li::marker { color: var(--text-faint); }
.guardrail-block { display: flex; flex-direction: column; gap: var(--s2); padding-top: var(--s3); border-top: 1px solid var(--line); }
.guardrail-block:first-of-type { padding-top: 0; border-top: 0; }
.guardrail-block__label { display: flex; align-items: center; gap: var(--s2); color: var(--text-muted); font-size: var(--text-xs); font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
.visual-hint { padding-top: var(--s2); border-top: 1px solid var(--line); font-size: var(--text-xs); text-align: center; }

@media (max-width: 42rem) {
  .visual-grid--context, .visual-grid--proof { grid-template-columns: 1fr; }
}

@media (max-width: 24rem) {
  .feature-grid { grid-template-columns: 1fr; }
}
</style>
