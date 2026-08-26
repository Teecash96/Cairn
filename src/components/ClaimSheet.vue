<script setup lang="ts">
/**
 * Bottom sheet for a tapped tile.
 *
 * The one thing this screen has to communicate: the NIM does not disappear into
 * the app. It goes to the person who grew the tile, in full. That framing is why
 * players accept being taken over — and why NIM circulates between wallets
 * instead of draining out of the ecosystem.
 */
import { computed } from 'vue'
import PlantGlyph from './PlantGlyph.vue'
import {
  CLAIM_FLOW_COST,
  FREE_SEED_LIMIT,
  MAX_STAGE,
  STAGE_NAMES,
  formatAge,
  isProtected,
  nextPriceOf,
  priceOf,
  protectionRemaining,
  stageOf,
  type Tile,
} from '../lib/game'
import { formatNim, shortAddress } from '../lib/units'

const props = defineProps<{
  tile: Tile
  flow: number
  now: number
  me: string | null
  /** False when the viewer already holds the maximum number of tiles. */
  canSeed: boolean
  busy: boolean
  error: string | null
}>()

const emit = defineEmits<{ close: []; claim: [] }>()

const stage = computed(() => stageOf(props.tile, props.flow, props.now))
const price = computed(() => priceOf(props.tile, props.flow, props.now))
const nextPrice = computed(() => nextPriceOf(props.tile, props.flow, props.now))
const isEmpty = computed(() => props.tile.holder === null)
const isMine = computed(() => props.me !== null && props.tile.holder === props.me)
const isGrown = computed(() => stage.value >= MAX_STAGE)
const guarded = computed(() => isProtected(props.tile, props.now))
const guardSeconds = computed(() => protectionRemaining(props.tile, props.now))

/** What the holder nets if this takeover goes through. */
const holderProfit = computed(() => price.value - props.tile.stakeLuna)

const age = computed(() =>
  props.tile.plantedAt ? formatAge(props.now - props.tile.plantedAt) : null,
)

const blocked = computed(
  () => isMine.value || (isEmpty.value && !props.canSeed) || (!isMine.value && guarded.value),
)

const cta = computed(() => {
  if (isMine.value) return 'This tile is yours'
  if (isEmpty.value) return props.canSeed ? 'Plant here — free' : 'Your plots are full'
  if (guarded.value) return `Protected for ${guardSeconds.value}s`
  return `Take over for ${formatNim(price.value)} NIM`
})
</script>

<template>
  <div class="scrim" @click.self="emit('close')">
    <section class="sheet" role="dialog" aria-modal="true" :aria-label="STAGE_NAMES[stage]">
      <div class="sheet__grip" aria-hidden="true" />

      <header class="sheet__head">
        <span class="sheet__plant">
          <PlantGlyph :stage="stage" />
        </span>
        <div class="sheet__id">
          <h2 class="sheet__stage">{{ STAGE_NAMES[stage] }}</h2>
          <p class="sheet__meta">
            <template v-if="isEmpty">Nobody has planted here yet</template>
            <template v-else>
              Growing {{ age }}
              <template v-if="tile.generation > 1"> · changed hands {{ tile.generation }}×</template>
              <template v-if="isGrown"> · fully grown</template>
            </template>
          </p>
        </div>
      </header>

      <!-- Where the money actually goes. -->
      <dl v-if="!isEmpty" class="rows">
        <div class="row">
          <dt>You pay</dt>
          <dd class="mono">{{ formatNim(price) }} NIM</dd>
        </div>
        <div class="row">
          <dt>Goes to</dt>
          <dd class="mono">{{ isMine ? 'you' : shortAddress(tile.holder!) }}</dd>
        </div>
        <div class="row row--good">
          <dt>{{ isMine ? 'Your' : 'Their' }} net</dt>
          <dd class="mono">+{{ formatNim(holderProfit) }} NIM</dd>
        </div>
        <div class="row" :class="{ 'row--good': !isGrown }">
          <dt>Worth at next stage</dt>
          <dd class="mono">{{ isGrown ? '— fully grown' : `${formatNim(nextPrice)} NIM` }}</dd>
        </div>
      </dl>

      <dl v-else class="rows">
        <div class="row">
          <dt>Cost to plant</dt>
          <dd class="mono">Free</dd>
        </div>
        <div class="row row--good">
          <dt>Worth once it sprouts</dt>
          <dd class="mono">{{ formatNim(nextPrice) }} NIM</dd>
        </div>
      </dl>

      <p class="note">
        <template v-if="isEmpty && !canSeed">
          You're already holding {{ FREE_SEED_LIMIT }} tiles. Let one go, or take someone else's.
        </template>
        <template v-else-if="isEmpty">
          Free to plant. Every stage it grows doubles what someone has to pay you for it.
        </template>
        <template v-else-if="isMine">
          Nothing to do — just let it grow. If someone takes it, they pay you
          {{ formatNim(price) }} NIM.
        </template>
        <template v-else-if="guarded">
          Just planted. New tiles are protected for a moment so nobody gets sniped the second they
          start out.
        </template>
        <template v-else>
          They keep every NIM you send. But taking a growing plant costs the whole grid
          {{ CLAIM_FLOW_COST }} Flow, and everything grows slower for everyone — including your own
          tiles.
        </template>
      </p>

      <p v-if="error" class="error" role="alert">{{ error }}</p>

      <footer class="sheet__foot">
        <button
          class="btn btn--primary"
          type="button"
          :disabled="busy || blocked"
          @click="emit('claim')"
        >
          {{ busy ? 'Waiting for your wallet…' : cta }}
        </button>
        <button class="btn btn--ghost" type="button" @click="emit('close')">
          {{ isMine || isEmpty ? 'Close' : 'Leave it growing' }}
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.scrim {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: flex-end;
  background: rgba(4, 7, 15, 0.62);
  backdrop-filter: blur(3px);
  animation: fade 0.18s ease;
}

.sheet {
  width: 100%;
  max-height: 88vh;
  overflow-y: auto;
  padding: 8px 18px calc(18px + var(--safe-bottom));
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  background: var(--surface);
  border-top: 1px solid var(--line);
  box-shadow: 0 -18px 40px rgba(0, 0, 0, 0.45);
  animation: rise 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.sheet__grip {
  width: 38px;
  height: 4px;
  margin: 0 auto 14px;
  border-radius: 99px;
  background: var(--line);
}

.sheet__head {
  display: flex;
  align-items: center;
  gap: 13px;
  margin-bottom: 16px;
}

.sheet__plant {
  flex: none;
  width: 48px;
  height: 48px;
  padding: 6px;
  border-radius: var(--radius);
  background: var(--surface-2);
  border: 1px solid var(--line);
}

.sheet__id {
  min-width: 0;
}

.sheet__stage {
  font-size: 19px;
  font-weight: 800;
  letter-spacing: -0.01em;
}

.sheet__meta {
  font-size: 12.5px;
  color: var(--muted);
}

.rows {
  margin: 0;
  padding: 4px 0;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
}

.row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 0;
}

.row + .row {
  border-top: 1px solid rgba(255, 255, 255, 0.04);
}

.row dt {
  font-size: 14px;
  color: var(--muted);
}

.row dd {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
}

.row--good dd {
  color: var(--flow);
}

.note {
  padding: 13px 0 4px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--muted);
}

.error {
  margin-bottom: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  font-size: 13px;
  color: #ffd9cf;
  background: rgba(242, 105, 76, 0.14);
  border: 1px solid rgba(242, 105, 76, 0.35);
}

.sheet__foot {
  display: grid;
  gap: 9px;
  padding-top: 6px;
}

@keyframes rise {
  from {
    transform: translateY(14%);
    opacity: 0.4;
  }
}

@keyframes fade {
  from {
    opacity: 0;
  }
}
</style>
