<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import CairnMark from './CairnMark.vue'
import { ApiError, getUsageSummary, type UsageSummary } from '../lib/api'

const summary = ref<UsageSummary | null>(null)
const loading = ref(true)
const error = ref('')

const nimRewarded = computed(() => {
  const value = (summary.value?.rewardedLuna ?? 0) / 100_000
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 5 }).format(value)
})

const updated = computed(() => summary.value
  ? summary.value.updatedAt > 0
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(summary.value.updatedAt)
    : 'No recorded event yet'
  : '')

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    summary.value = await getUsageSummary()
  } catch (cause) {
    error.value = cause instanceof ApiError ? cause.message : 'Could not load the usage evidence.'
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <main class="usage-shell">
    <header class="usage-header">
      <a class="brand" href="/" aria-label="Cairn home">
        <CairnMark :size="28" />
        <span>Cairn</span>
      </a>
      <a class="back-link" href="/">Open app</a>
    </header>

    <section class="usage-hero">
      <p class="eyebrow">PUBLIC USAGE EVIDENCE</p>
      <h1>Real work, counted without tracking people.</h1>
      <p class="usage-lede">Every person below proved control of a Nimiq wallet. Cairn counts successful product actions, then publishes aggregates only.</p>
      <div class="proof-note">
        <span class="proof-dot" aria-hidden="true"></span>
        No cookies, raw wallet addresses, IP history, plan text, or task content.
      </div>
    </section>

    <section v-if="loading" class="state-card" role="status" aria-live="polite">
      <span class="spinner" aria-hidden="true"></span>
      Loading verified usage…
    </section>

    <section v-else-if="error" class="state-card state-card--error" role="alert">
      <p>{{ error }}</p>
      <button type="button" class="btn btn--primary" @click="load">Try again</button>
    </section>

    <template v-else-if="summary">
      <section class="primary-grid" aria-label="Wallet usage">
        <article class="metric metric--featured">
          <span class="metric__value">{{ summary.verifiedWallets }}</span>
          <h2>Verified wallets</h2>
          <p>Distinct wallets that completed Cairn's signed login.</p>
        </article>
        <article class="metric">
          <span class="metric__value">{{ summary.activatedWallets }}</span>
          <h2>Activated wallets</h2>
          <p>Wallets that completed at least one useful action after login.</p>
        </article>
        <article class="metric">
          <span class="metric__value">{{ summary.repeatWallets }}</span>
          <h2>Repeat wallets</h2>
          <p>Wallets active on two or more UTC days.</p>
        </article>
        <article class="metric">
          <span class="metric__value">{{ summary.active7Days }}</span>
          <h2>Active in 7 days</h2>
          <p>Distinct verified wallets active during the current seven-day window.</p>
        </article>
      </section>

      <section class="evidence-section" aria-labelledby="work-heading">
        <div class="section-heading">
          <div><p class="eyebrow">MEANINGFUL ACTIONS</p><h2 id="work-heading">What people completed</h2></div>
          <span class="today-pill">{{ summary.activeToday }} active today</span>
        </div>
        <div class="work-grid">
          <article><strong>{{ summary.plansGenerated }}</strong><span>Plans generated</span></article>
          <article><strong>{{ summary.planRefinements }}</strong><span>Plan refinements</span></article>
          <article><strong>{{ summary.teamWorkspaces }}</strong><span>Team workspaces</span></article>
          <article><strong>{{ summary.teamParticipants }}</strong><span>Team participants</span></article>
          <article><strong>{{ summary.teamActions }}</strong><span>Team actions</span></article>
          <article><strong>{{ summary.sharesCreated }}</strong><span>Shares created</span></article>
          <article><strong>{{ summary.rewardsConfirmed }}</strong><span>Rewards confirmed</span></article>
        </div>
      </section>

      <section class="reward-card" aria-labelledby="reward-heading">
        <div>
          <p class="eyebrow">NIMIQ VALUE</p>
          <h2 id="reward-heading">Direct rewards for approved work</h2>
          <p>Cairn verifies each public transaction. Funds move wallet to wallet; Cairn never holds them.</p>
        </div>
        <div class="reward-total"><strong>{{ nimRewarded }}</strong><span>NIM rewarded</span></div>
      </section>

      <section v-if="summary.sources.length" class="evidence-section" aria-labelledby="sources-heading">
        <div class="section-heading"><div><p class="eyebrow">FIRST TOUCH</p><h2 id="sources-heading">Where verified users came from</h2></div></div>
        <ul class="source-list">
          <li v-for="item in summary.sources" :key="item.source"><span>{{ item.source }}</span><strong>{{ item.wallets }}</strong></li>
        </ul>
        <p class="privacy-caption">Sources with fewer than three wallets stay hidden.</p>
      </section>

      <section class="method-card">
        <p class="eyebrow">HOW THIS IS VERIFIED</p>
        <h2>Auditable code. Private identity.</h2>
        <p>A private HMAC key inside Cloudflare converts each signed wallet into a stable anonymous identifier. The key and raw address never appear in this report. Counts start when this ledger is deployed.</p>
        <div class="method-links">
          <a href="https://github.com/Teecash96/cairn/blob/main/docs/product/usage-evidence.md" target="_blank" rel="noreferrer">Read the method</a>
          <a href="https://github.com/Teecash96/cairn/tree/main/worker" target="_blank" rel="noreferrer">Audit the code</a>
        </div>
        <p class="updated">Last successful usage event: {{ updated }}</p>
      </section>
    </template>
  </main>
</template>

<style scoped>
.usage-shell { width: min(100%, 960px); min-height: 100vh; margin: 0 auto; padding: max(var(--s4), var(--safe-top)) var(--s4) var(--s12); overflow-x: hidden; }
.usage-header, .brand, .section-heading, .proof-note, .method-links { display: flex; align-items: center; }
.usage-header { justify-content: space-between; gap: var(--s4); padding-bottom: var(--s8); }
.brand { gap: var(--s2); color: var(--text); font-size: var(--text-lg); font-weight: 800; text-decoration: none; }
.back-link, .method-links a { color: var(--accent); font-weight: 800; text-decoration: none; }
.back-link { padding: var(--s2) var(--s3); border: 1px solid var(--line-strong); border-radius: var(--r-sm); }
.usage-hero { max-width: 720px; padding: var(--s8) 0 var(--s10); }
.eyebrow { color: var(--accent); font-family: var(--font-mono); font-size: var(--text-xs); font-weight: 800; letter-spacing: .12em; }
h1 { max-width: 700px; margin-top: var(--s3); font-family: var(--font-display); font-size: clamp(2rem, 8vw, 4.2rem); line-height: 1.02; overflow-wrap: anywhere; }
.usage-lede { max-width: 660px; margin-top: var(--s4); color: var(--text-muted); font-size: var(--text-lg); line-height: var(--leading); }
.proof-note { align-items: flex-start; gap: var(--s2); margin-top: var(--s5); color: var(--text-muted); font-size: var(--text-sm); line-height: var(--leading); }
.proof-dot { flex: 0 0 9px; width: 9px; height: 9px; margin-top: .36rem; border-radius: 50%; background: var(--success); }
.primary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--s3); }
.metric, .evidence-section, .reward-card, .method-card, .state-card { min-width: 0; border: 1px solid var(--line); border-radius: var(--r-md); background: var(--surface); }
.metric { padding: var(--s5); border-top: 4px solid var(--line-strong); }
.metric--featured { border-top-color: var(--nim); }
.metric__value { display: block; font-family: var(--font-display); font-size: clamp(2.25rem, 7vw, 3.5rem); font-weight: 800; line-height: 1; }
.metric h2 { margin-top: var(--s3); font-size: var(--text-base); }
.metric p { margin-top: var(--s2); color: var(--text-muted); font-size: var(--text-xs); line-height: var(--leading); overflow-wrap: anywhere; }
.evidence-section, .method-card { margin-top: var(--s4); padding: var(--s5); }
.section-heading { justify-content: space-between; gap: var(--s4); margin-bottom: var(--s4); }
.section-heading h2, .reward-card h2, .method-card h2 { margin-top: var(--s1); font-size: var(--text-xl); }
.today-pill { flex: 0 0 auto; padding: var(--s2) var(--s3); border-radius: var(--r-full); background: var(--accent-subtle); color: var(--accent); font-size: var(--text-xs); font-weight: 800; }
.work-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border: 1px solid var(--line); }
.work-grid article { display: grid; min-width: 0; gap: var(--s1); padding: var(--s4); border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.work-grid article:nth-child(3n) { border-right: 0; }
  .work-grid article:nth-child(n+7) { border-bottom: 0; }
.work-grid strong { font-family: var(--font-display); font-size: var(--text-2xl); }
.work-grid span { color: var(--text-muted); font-size: var(--text-sm); overflow-wrap: anywhere; }
.reward-card { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: var(--s8); margin-top: var(--s4); padding: var(--s5); border-left: 5px solid var(--nim); }
.reward-card > div:first-child p:last-child, .method-card > p:not(.eyebrow), .privacy-caption { margin-top: var(--s2); color: var(--text-muted); line-height: var(--leading); }
.reward-total { min-width: 150px; text-align: right; }
.reward-total strong, .reward-total span { display: block; }
.reward-total strong { font-family: var(--font-display); font-size: var(--text-2xl); overflow-wrap: anywhere; }
.reward-total span { color: var(--text-muted); font-size: var(--text-xs); }
.source-list { list-style: none; border-top: 1px solid var(--line); }
.source-list li { display: flex; justify-content: space-between; gap: var(--s4); padding: var(--s3) 0; border-bottom: 1px solid var(--line); }
.source-list span { min-width: 0; overflow-wrap: anywhere; }
.privacy-caption, .updated { font-size: var(--text-xs); }
.method-links { flex-wrap: wrap; gap: var(--s4); margin-top: var(--s4); }
.updated { margin-top: var(--s5) !important; }
.state-card { display: flex; align-items: center; gap: var(--s3); padding: var(--s6); }
.state-card--error { align-items: flex-start; justify-content: space-between; }
.spinner { width: 20px; height: 20px; border: 2px solid var(--line-strong); border-top-color: var(--accent); border-radius: 50%; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 720px) {
  .primary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .work-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .work-grid article:nth-child(3n) { border-right: 1px solid var(--line); }
  .work-grid article:nth-child(2n) { border-right: 0; }
}
@media (max-width: 460px) {
  .usage-shell { padding-inline: var(--s3); }
  .usage-hero { padding-top: var(--s5); }
  .primary-grid { grid-template-columns: 1fr; }
  .reward-card { grid-template-columns: 1fr; gap: var(--s4); }
  .reward-total { text-align: left; }
  .section-heading { align-items: flex-start; flex-direction: column; }
}
@media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
</style>
