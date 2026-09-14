<script setup lang="ts">
import { computed, ref } from 'vue'
import { newId, type BuilderLogEntry } from '../lib/plan'

const entries = defineModel<BuilderLogEntry[]>({ required: true })
const note = ref('')

function localDate(timestamp = Date.now()): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dayNumber(value: string): number {
  const [year, month, day] = value.split('-').map(Number)
  return Math.floor(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1) / 86_400_000)
}

const sorted = computed(() => [...entries.value].sort((a, b) => b.createdAt - a.createdAt))
const streak = computed(() => {
  const days = [...new Set(sorted.value.map((entry) => entry.date))].sort((a, b) => dayNumber(b) - dayNumber(a))
  if (!days.length) return 0
  const gap = dayNumber(localDate()) - dayNumber(days[0] ?? '')
  if (gap > 1) return 0
  let count = 1
  for (let index = 1; index < days.length; index += 1) {
    if (dayNumber(days[index - 1] ?? '') - dayNumber(days[index] ?? '') !== 1) break
    count += 1
  }
  return count
})

function submit(): void {
  const text = note.value.replace(/\s+/g, ' ').trim().slice(0, 280)
  if (!text) return
  entries.value = [{ id: newId(), date: localDate(), text, createdAt: Date.now() }, ...entries.value].slice(0, 180)
  note.value = ''
}
</script>

<template>
  <section class="standup" aria-labelledby="standup-heading">
    <div class="standup__head">
      <div>
        <p class="standup__eyebrow">Daily builder standup</p>
        <h3 id="standup-heading">What did you build today?</h3>
      </div>
      <div class="streak" :class="{ 'streak--active': streak > 0 }">
        <strong>{{ streak }}</strong>
        <span>day streak</span>
      </div>
    </div>
    <form class="standup__form" @submit.prevent="submit">
      <label class="sr-only" for="builder-note">Today’s progress</label>
      <textarea id="builder-note" v-model="note" class="textarea" maxlength="280" placeholder="Shipped the wallet selection fix and tested it on mobile…" />
      <div class="standup__submit">
        <span class="faint">{{ note.length }}/280 · saved on this device</span>
        <button type="submit" class="btn btn--primary btn--sm" :disabled="!note.trim()">Log progress</button>
      </div>
    </form>
    <ol v-if="sorted.length" class="standup__history" aria-label="Recent builder progress">
      <li v-for="entry in sorted.slice(0, 5)" :key="entry.id">
        <time :datetime="entry.date">{{ entry.date === localDate() ? 'Today' : entry.date }}</time>
        <p>{{ entry.text }}</p>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.standup { display: grid; gap: var(--s4); margin-bottom: var(--s5); padding: clamp(var(--s4), 4vw, var(--s5)); background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-lg); box-shadow: var(--shadow-card); }
.standup__head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--s4); }
.standup__eyebrow { margin: 0 0 var(--s1); color: var(--accent); font-size: var(--text-xs); font-weight: 800; letter-spacing: .065em; text-transform: uppercase; }
.standup h3 { font-family: var(--font-display); font-size: var(--text-lg); }
.streak { display: grid; grid-template-columns: auto auto; align-items: baseline; gap: .35rem; padding: .45rem .7rem; color: var(--text-muted); background: var(--surface-sunken); border-radius: var(--r-full); white-space: nowrap; }
.streak strong { font-size: var(--text-md); }
.streak span { font-size: var(--text-xs); }
.streak--active { color: var(--moss); background: var(--sage-subtle); }
.standup__form { display: grid; gap: var(--s2); }
.standup .textarea { min-height: 92px; }
.standup__submit { display: flex; align-items: center; justify-content: space-between; gap: var(--s3); }
.standup__submit span { font-size: var(--text-xs); }
.standup__history { display: grid; gap: var(--s2); margin: 0; padding: var(--s3) 0 0; border-top: 1px solid var(--line); list-style: none; }
.standup__history li { display: grid; grid-template-columns: 5rem 1fr; gap: var(--s3); }
.standup__history time { color: var(--text-faint); font-size: var(--text-xs); }
.standup__history p { font-size: var(--text-sm); line-height: var(--leading); }
@media (max-width: 520px) { .standup__head, .standup__submit { align-items: stretch; flex-direction: column; } .streak { align-self: flex-start; } .standup__history li { grid-template-columns: 1fr; gap: var(--s1); } }
</style>
