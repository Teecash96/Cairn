<script setup lang="ts">
/**
 * Ecoflow — a shared living grid inside Nimiq Pay.
 *
 * The whole app is one screen. Seeding is free, so a first-time player can act
 * within seconds of opening it; the wallet prompt lands on that first tap
 * rather than behind a splash screen.
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import ClaimSheet from './components/ClaimSheet.vue'
import FlowMeter from './components/FlowMeter.vue'
import TileCell from './components/TileCell.vue'
import WalletBar from './components/WalletBar.vue'
import {
  FREE_SEED_LIMIT,
  GRID_COLS,
  canSeed,
  isProtected,
  priceOf,
  tilesHeldBy,
  type GridState,
} from './lib/game'
import { useSession } from './lib/session'
import { LocalGridStore } from './lib/store'
import { formatNim } from './lib/units'

const session = useSession()
const store = new LocalGridStore()

const state = ref<GridState | null>(null)
const now = ref(Date.now())
const selectedIndex = ref<number | null>(null)
const busy = ref(false)
const introDismissed = ref(false)

let ticker: number | undefined
let tickCount = 0

onMounted(async () => {
  await session.boot()
  state.value = await store.load()
  ticker = window.setInterval(tick, 1000)
})

onUnmounted(() => window.clearInterval(ticker))

async function tick() {
  now.value = Date.now()
  state.value = await store.tick(now.value)
  // Block height is only a liveness signal — poll it sparingly.
  if (++tickCount % 30 === 0) void session.refreshChain()
}

const selectedTile = computed(() =>
  selectedIndex.value === null ? null : (state.value?.tiles[selectedIndex.value] ?? null),
)

const myTiles = computed(() => (state.value ? tilesHeldBy(state.value, session.address.value) : 0))

const seedable = computed(() =>
  state.value ? canSeed(state.value, session.address.value) : false,
)

/** Total NIM a player would collect if every tile they hold were taken today. */
const myValueLuna = computed(() => {
  if (!state.value || !session.address.value) return 0
  return state.value.tiles
    .filter((tile) => tile.holder === session.address.value)
    .reduce((sum, tile) => sum + priceOf(tile, state.value!.flow, now.value), 0)
})

function openTile(index: number) {
  session.lastError.value = null
  selectedIndex.value = index
}

function closeSheet() {
  selectedIndex.value = null
  session.lastError.value = null
}

async function claim() {
  const tile = selectedTile.value
  if (!tile || !state.value || busy.value) return

  busy.value = true
  try {
    // First meaningful tap is also the wallet prompt.
    const me = await session.connect()
    if (!me) return

    const price = priceOf(tile, state.value.flow, now.value)
    let receipt: string | null = null

    if (tile.holder === me) {
      return
    } else if (tile.holder) {
      // Protection window — re-checked here, not just in the UI.
      if (isProtected(tile, Date.now())) {
        session.lastError.value = 'This tile was just planted. Give it a moment.'
        return
      }
      // Straight to the previous holder. Nothing routes through Ecoflow.
      receipt = await session.pay(tile.holder, price, `Ecoflow tile ${tile.index}`)
      if (!receipt) return // declined or failed — the sheet shows why
    } else if (!canSeed(state.value, me)) {
      session.lastError.value = `You're already holding ${FREE_SEED_LIMIT} tiles.`
      return
    }

    state.value = await store.claim({
      tileIndex: tile.index,
      holder: me,
      pricePaidLuna: tile.holder ? price : 0,
      paidTo: tile.holder,
      receipt,
    })
    introDismissed.value = true
    selectedIndex.value = null
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="app">
    <div class="app__inner">
      <WalletBar
        :address="session.address.value"
        :connecting="session.connecting.value"
        :is-preview="session.isPreview.value"
        :block-height="session.blockHeight.value"
        :consensus="session.consensus.value"
        @connect="session.connect()"
      />

      <template v-if="state">
        <FlowMeter :flow="state.flow" />

        <!-- One-time explainer. Two sentences is the whole rulebook. -->
        <p v-if="!introDismissed && myTiles === 0" class="intro">
          <strong>Plant a free tile.</strong> The longer it grows the more it's worth — and anyone
          who wants it has to pay <em>you</em> for it.
        </p>

        <div v-else class="holdings">
          <span
            >{{ myTiles }} {{ myTiles === 1 ? 'tile' : 'tiles' }} of
            {{ FREE_SEED_LIMIT }}</span
          >
          <span class="holdings__value mono">worth {{ formatNim(myValueLuna) }} NIM</span>
        </div>

        <div class="grid" :style="{ '--cols': GRID_COLS }" role="group" aria-label="Ecoflow grid">
          <TileCell
            v-for="tile in state.tiles"
            :key="tile.index"
            :tile="tile"
            :flow="state.flow"
            :now="now"
            :me="session.address.value"
            @click="openTile(tile.index)"
          />
        </div>

        <p v-if="session.lastError.value && selectedIndex === null" class="banner" role="alert">
          {{ session.lastError.value }}
        </p>

        <p v-if="session.isPreview.value" class="preview-note">
          Browser preview — payments are simulated. Open in Nimiq Pay to play for real.
        </p>
      </template>

      <div v-else class="boot">
        <span class="boot__spinner" aria-hidden="true" />
        <p class="muted">Reaching the grid…</p>
      </div>
    </div>

    <ClaimSheet
      v-if="selectedTile && state"
      :tile="selectedTile"
      :flow="state.flow"
      :now="now"
      :me="session.address.value"
      :can-seed="seedable"
      :busy="busy"
      :error="session.lastError.value"
      @close="closeSheet"
      @claim="claim"
    />
  </div>
</template>

<style scoped>
.app {
  min-height: 100dvh;
  padding: calc(14px + var(--safe-top)) 14px calc(20px + var(--safe-bottom));
}

.app__inner {
  display: grid;
  gap: 13px;
  max-width: 460px;
  margin: 0 auto;
}

.grid {
  display: grid;
  grid-template-columns: repeat(var(--cols), 1fr);
  gap: 7px;
}

.intro {
  padding: 12px 14px;
  border-radius: var(--radius);
  font-size: 13.5px;
  line-height: 1.5;
  color: var(--muted);
  background: linear-gradient(180deg, rgba(74, 222, 155, 0.1) 0%, rgba(74, 222, 155, 0.03) 100%);
  border: 1px solid rgba(74, 222, 155, 0.22);
}

.intro strong {
  color: var(--text);
}

.intro em {
  font-style: normal;
  color: var(--flow);
  font-weight: 700;
}

.holdings {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  padding: 0 3px;
  font-size: 13px;
  color: var(--muted);
}

.holdings__value {
  font-weight: 700;
  color: var(--gold);
}

.banner {
  padding: 11px 13px;
  border-radius: var(--radius);
  font-size: 13px;
  color: #ffd9cf;
  background: rgba(242, 105, 76, 0.14);
  border: 1px solid rgba(242, 105, 76, 0.35);
}

.preview-note {
  padding: 0 3px;
  font-size: 11.5px;
  color: var(--muted-dim);
  text-align: center;
}

.boot {
  display: grid;
  place-items: center;
  gap: 14px;
  padding: 22vh 0;
  font-size: 14px;
}

.boot__spinner {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 2px solid var(--line);
  border-top-color: var(--flow);
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
