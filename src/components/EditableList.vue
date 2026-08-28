<script setup lang="ts">
/**
 * A short, editable list of one-line-ish entries — core features, user stories,
 * success criteria, assumptions.
 *
 * The generator is capped at five entries per list, but this component takes the
 * cap as a prop and never assumes the incoming array respects it: a hand-edited
 * plan, or one restored from an older build, can carry more. Over the cap you can
 * still edit and remove, just not add.
 *
 * Updates replace the array rather than mutating it, so the parent's `v-model`
 * assignment is the single write path.
 */
import AutoTextarea from './AutoTextarea.vue'

const model = defineModel<string[]>({ required: true })

const {
  label,
  max = 5,
  placeholder = '',
  addLabel = 'Add',
} = defineProps<{
  /** Used to label each field for screen readers: "Core features, item 2". */
  label: string
  max?: number
  placeholder?: string
  addLabel?: string
}>()

function setItem(index: number, value: string): void {
  model.value = model.value.map((item, i) => (i === index ? value : item))
}

function add(): void {
  if (model.value.length >= max) return
  model.value = [...model.value, '']
}

function remove(index: number): void {
  model.value = model.value.filter((_, i) => i !== index)
}
</script>

<template>
  <div class="list">
    <div v-for="(item, index) in model" :key="index" class="row">
      <span class="bullet" aria-hidden="true">{{ index + 1 }}</span>

      <AutoTextarea
        :model-value="item"
        :placeholder="placeholder"
        :aria-label="`${label}, item ${index + 1}`"
        @update:model-value="setItem(index, $event)"
      />

      <button
        type="button"
        class="remove"
        :aria-label="`Remove ${label.toLowerCase()} item ${index + 1}`"
        @click="remove(index)"
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
          <path
            d="M4 4l8 8M12 4l-8 8"
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
          />
        </svg>
      </button>
    </div>

    <div class="foot">
      <button type="button" class="btn btn--secondary btn--sm" :disabled="model.length >= max" @click="add">
        {{ addLabel }}
      </button>
      <span class="faint count mono">{{ model.length }} of {{ max }}</span>
    </div>
  </div>
</template>

<style scoped>
.list {
  display: flex;
  flex-direction: column;
  gap: var(--s2);
}

.row {
  display: grid;
  /* number · field · remove */
  grid-template-columns: 20px 1fr 32px;
  align-items: start;
  gap: var(--s2);
}

.bullet {
  padding-top: var(--s3);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  color: var(--text-faint);
  text-align: right;
}

.remove {
  display: flex;
  align-items: center;
  justify-content: center;
  /* Sits beside a field whose top padding is --s3; this lines the × up with the
     first line of text rather than the middle of a grown textarea. */
  height: 44px;
  width: 32px;
  margin-top: -4px;
  border-radius: var(--r-sm);
  color: var(--text-faint);
}

.remove:hover {
  background: var(--surface-hover);
  color: var(--danger);
}

.foot {
  display: flex;
  align-items: center;
  gap: var(--s3);
  padding-left: calc(20px + var(--s2));
}

.count {
  font-size: var(--text-xs);
}
</style>
