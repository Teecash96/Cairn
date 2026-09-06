<script setup lang="ts">
import { computed } from 'vue'
import type { BuildPlan, RealityCheckItem } from '../lib/plan'
import { projectStats, TASK_STATUS_LABEL } from '../lib/tracker'

const { build, realityCheck } = defineProps<{
  build: BuildPlan
  realityCheck: RealityCheckItem[]
}>()

const stats = computed(() => projectStats(build))

function visible(items: string[]): string[] {
  return items.filter((item) => item.trim())
}
</script>

<template>
  <div class="build-view">
    <section class="build-intro" aria-labelledby="build-heading">
      <div>
        <p class="eyebrow">Builder pack</p>
        <h3 id="build-heading">A practical path to a first release</h3>
        <p class="muted build-intro__copy">
          Small steps, clear proof, and an honest check on what may still be a guess.
        </p>
      </div>
      <div class="progress" aria-label="Task progress">
        <strong>{{ stats.progress }}%</strong>
        <span>{{ stats.completedTasks }}/{{ stats.totalTasks }} done</span>
      </div>
    </section>

    <section v-if="visible(build.mvpScope).length" class="build-block" aria-labelledby="scope-heading">
      <div class="section-heading">
        <h4 id="scope-heading">MVP scope</h4>
        <span class="badge badge--accent">Keep it small</span>
      </div>
      <ul class="clean-list">
        <li v-for="item in visible(build.mvpScope)" :key="item">{{ item }}</li>
      </ul>
    </section>

    <section class="build-block" aria-labelledby="milestones-heading">
      <div class="section-heading">
        <h4 id="milestones-heading">Milestones</h4>
        <span class="muted">{{ stats.progress }}%</span>
      </div>
      <div class="progress-track" role="progressbar" :aria-valuenow="stats.progress" aria-valuemin="0" aria-valuemax="100">
        <span class="progress-track__fill" :style="{ width: `${stats.progress}%` }" />
      </div>

      <div v-if="!build.milestones.length" class="empty-pack muted">
        Generate a plan to get three milestones and a task list.
      </div>
      <article v-for="(milestone, index) in build.milestones" :key="milestone.id" class="milestone">
        <div class="milestone__head">
          <span class="step-number" aria-hidden="true">{{ index + 1 }}</span>
          <div>
            <h5>{{ milestone.title || `Milestone ${index + 1}` }}</h5>
            <p v-if="milestone.outcome" class="muted">{{ milestone.outcome }}</p>
          </div>
        </div>
        <ul class="task-list">
          <li v-for="task in milestone.tasks" :key="task.id" class="task">
            <span class="task__status" :class="`task__status--${task.status}`" aria-hidden="true" />
            <span :class="{ 'task__text--done': task.status === 'done' }">{{ task.text }}</span>
            <span class="badge">{{ TASK_STATUS_LABEL[task.status] }}</span>
          </li>
        </ul>
      </article>
    </section>

    <section v-if="visible(build.risks).length" class="build-block build-block--risk" aria-labelledby="risk-heading">
      <div class="section-heading">
        <h4 id="risk-heading">Risks to test early</h4>
        <span class="badge">Watch</span>
      </div>
      <ul class="clean-list clean-list--muted">
        <li v-for="risk in visible(build.risks)" :key="risk">{{ risk }}</li>
      </ul>
    </section>

    <section v-if="visible(build.acceptanceTests).length" class="build-block" aria-labelledby="tests-heading">
      <div class="section-heading">
        <h4 id="tests-heading">Acceptance tests</h4>
        <span class="badge">Definition of done</span>
      </div>
      <ul class="clean-list clean-list--checks">
        <li v-for="test in visible(build.acceptanceTests)" :key="test">{{ test }}</li>
      </ul>
    </section>

    <section v-if="build.nextAction.trim()" class="next-action" aria-labelledby="next-heading">
      <p class="eyebrow">Next action</p>
      <h4 id="next-heading">{{ build.nextAction }}</h4>
    </section>

    <section v-if="realityCheck.length" class="reality" aria-labelledby="reality-heading">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Reality check</p>
          <h4 id="reality-heading">Where this plan may be wrong</h4>
        </div>
        <span class="badge">Be honest</span>
      </div>
      <article v-for="item in realityCheck" :key="`${item.priority}-${item.concern}`" class="reality-item">
        <div class="reality-item__top">
          <span class="priority" :class="`priority--${item.priority}`">{{ item.priority }}</span>
          <h5>{{ item.concern }}</h5>
        </div>
        <p><strong>Why:</strong> {{ item.why }}</p>
        <p><strong>Smallest fix or test:</strong> {{ item.fix }}</p>
      </article>
    </section>
  </div>
</template>

<style scoped>
.build-view { display: flex; flex-direction: column; gap: var(--s5); }
.build-intro { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--s4); }
.eyebrow { margin: 0 0 var(--s1); color: var(--accent); font-size: var(--text-xs); font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
.build-intro h3 { font-size: var(--text-lg); letter-spacing: -.015em; }
.build-intro__copy { max-width: 36rem; margin-top: var(--s2); line-height: var(--leading); }
.progress { flex: 0 0 auto; display: flex; flex-direction: column; align-items: flex-end; color: var(--text-muted); font-size: var(--text-xs); }
.progress strong { color: var(--text); font-size: var(--text-lg); letter-spacing: -.03em; }
.build-block { display: flex; flex-direction: column; gap: var(--s3); padding: var(--s4); border: 1px solid var(--line); border-radius: var(--r-md); background: var(--surface); }
.build-block--risk { background: var(--danger-subtle); border-color: color-mix(in srgb, var(--danger) 25%, var(--line)); }
.section-heading { display: flex; align-items: center; justify-content: space-between; gap: var(--s3); }
.section-heading h4 { font-size: var(--text-md); }
.clean-list { display: flex; flex-direction: column; gap: var(--s2); margin: 0; padding: 0; list-style: none; }
.clean-list li { position: relative; padding-left: var(--s4); color: var(--text-muted); font-size: var(--text-sm); line-height: var(--leading); }
.clean-list li::before { content: ''; position: absolute; left: 0; top: .6em; width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }
.clean-list--muted li::before { background: var(--danger); }
.clean-list--checks li::before { width: 12px; height: 12px; top: .25em; border: 1px solid var(--accent); border-radius: 3px; background: transparent; }
.progress-track { height: 6px; overflow: hidden; border-radius: var(--r-full); background: var(--surface-sunken); }
.progress-track__fill { display: block; height: 100%; border-radius: inherit; background: var(--accent); transition: width 220ms ease; }
.empty-pack { padding: var(--s3) 0; font-size: var(--text-sm); }
.milestone { display: flex; flex-direction: column; gap: var(--s3); padding-top: var(--s4); border-top: 1px solid var(--line); }
.milestone:first-of-type { padding-top: 0; border-top: 0; }
.milestone__head { display: flex; align-items: flex-start; gap: var(--s3); }
.step-number { display: grid; flex: 0 0 26px; place-items: center; width: 26px; height: 26px; border-radius: 50%; background: var(--accent-subtle); color: var(--accent); font-size: var(--text-xs); font-weight: 750; }
.milestone h5 { font-size: var(--text-md); }
.milestone p { margin-top: var(--s1); font-size: var(--text-sm); line-height: var(--leading); }
.task-list { display: flex; flex-direction: column; gap: var(--s2); margin: 0; padding: 0 0 0 calc(26px + var(--s3)); list-style: none; }
.task { display: flex; align-items: flex-start; gap: var(--s2); color: var(--text-muted); font-size: var(--text-sm); line-height: var(--leading); }
.task > span:nth-child(2) { flex: 1; }
.task__status { flex: 0 0 9px; width: 9px; height: 9px; margin-top: .42em; border-radius: 50%; background: var(--line-strong); }
.task__status--in_progress { background: var(--accent); }
.task__status--done { background: var(--success); }
.task__text--done { color: var(--text-faint); text-decoration: line-through; }
.task .badge { flex: 0 0 auto; margin-top: 1px; }
.next-action { padding: var(--s4); border: 1px solid var(--accent-line); border-radius: var(--r-md); background: var(--accent-subtle); }
.next-action h4 { font-size: var(--text-md); line-height: var(--leading); }
.reality { display: flex; flex-direction: column; gap: var(--s3); padding: var(--s4); border: 1px solid var(--line); border-radius: var(--r-md); background: var(--surface-sunken); }
.reality h4 { font-size: var(--text-md); }
.reality-item { display: flex; flex-direction: column; gap: var(--s2); padding-top: var(--s3); border-top: 1px solid var(--line); }
.reality-item:first-of-type { border-top: 0; padding-top: 0; }
.reality-item__top { display: flex; align-items: flex-start; gap: var(--s2); }
.reality-item h5 { font-size: var(--text-sm); line-height: var(--leading); }
.reality-item p { color: var(--text-muted); font-size: var(--text-sm); line-height: var(--leading); }
.reality-item strong { color: var(--text); }
.priority { flex: 0 0 auto; padding: 2px var(--s2); border-radius: var(--r-sm); font-size: var(--text-xs); font-weight: 750; letter-spacing: .04em; text-transform: uppercase; }
.priority--high { color: var(--danger); background: var(--danger-subtle); }
.priority--medium { color: var(--accent); background: var(--accent-subtle); }
.priority--low { color: var(--text-muted); background: var(--surface); }

@media (prefers-reduced-motion: reduce) { .progress-track__fill { transition: none; } }
</style>
