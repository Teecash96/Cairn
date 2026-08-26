/**
 * Ecoflow game rules.
 *
 * One shared grid. Every tile is a plant.
 *
 *  - Bare soil is FREE to seed (up to FREE_SEED_LIMIT tiles at a time). Nothing
 *    stands between a new player and their first plant.
 *  - A planted tile grows through five stages while left alone.
 *  - Anyone can take a tile by paying its CURRENT VALUE straight to its holder,
 *    wallet to wallet. Ecoflow never touches the funds and holds no treasury.
 *  - Value is a function of GROWTH, not of what was paid. So letting a plant
 *    grow is literally how you get paid more, and mature tiles price their own
 *    attackers out.
 *
 * Flow is the shared resource. It rises while the grid is left to grow and falls
 * with every takeover. High Flow speeds growth for EVERYONE; low Flow stalls it
 * for everyone. Churn is individually tempting and collectively ruinous — and
 * none of it is self-reported. It's all derived from on-chain payments.
 */
import { nimToLuna } from './units'

export const GRID_COLS = 6
export const GRID_ROWS = 6
export const TILE_COUNT = GRID_COLS * GRID_ROWS

export const MAX_STAGE = 4
export type Stage = 0 | 1 | 2 | 3 | 4

/**
 * What a tile is worth at each growth stage, in Luna. The holder receives this
 * in full. Doubling per stage is what makes an ancient tile expensive enough to
 * be worth defending and cheap enough to still be taken.
 */
export const STAGE_VALUE_LUNA: Record<Stage, number> = {
  0: 0,
  1: nimToLuna(1),
  2: nimToLuna(2),
  3: nimToLuna(4),
  4: nimToLuna(8),
}

/** How many tiles one wallet may hold at once. Keeps the grid from being swept. */
export const FREE_SEED_LIMIT = 3

/** Base time to advance one growth stage, at neutral Flow. */
const BASE_STAGE_MS = 60_000

/**
 * A tile cannot be taken for this long after it changes hands. Without it a new
 * player's first plant can be sniped the instant it appears, which is both
 * unkind and the fastest way to teach someone that the grid is hostile.
 */
export const TAKEOVER_GRACE_MS = 30_000

/** Each takeover drains this much Flow. Seeding bare soil costs nothing. */
export const CLAIM_FLOW_COST = 5

const FLOW_REGEN = 1
const FLOW_REGEN_INTERVAL_MS = 6_000
export const FLOW_START = 68

export interface Tile {
  index: number
  /** Nimiq address of the current holder, or null for bare soil. */
  holder: string | null
  /** What the holder paid to get it, in Luna. Zero when they seeded it free. */
  stakeLuna: number
  /** Wall-clock ms when the tile last changed hands. Growth is measured from here. */
  plantedAt: number
  /** How many times this tile has changed hands. */
  generation: number
}

export interface GridState {
  tiles: Tile[]
  /** 0-100 shared resource meter. */
  flow: number
  /** Last time Flow regeneration was applied. */
  flowUpdatedAt: number
}

export function createTile(index: number): Tile {
  return { index, holder: null, stakeLuna: 0, plantedAt: 0, generation: 0 }
}

export function createGrid(now: number): GridState {
  return {
    tiles: Array.from({ length: TILE_COUNT }, (_, i) => createTile(i)),
    flow: FLOW_START,
    flowUpdatedAt: now,
  }
}

/** Higher Flow = faster growth, for everyone at once. */
export function stageDurationMs(flow: number): number {
  const t = clamp(flow, 0, 100) / 100
  // flow 0 -> 1.6x slower; flow 100 -> 0.7x faster
  return BASE_STAGE_MS * (1.6 - 0.9 * t)
}

/** Growth stage of a tile as of `now`. */
export function stageOf(tile: Tile, flow: number, now: number): Stage {
  if (!tile.holder) return 0
  const elapsed = now - tile.plantedAt
  const stage = Math.floor(elapsed / stageDurationMs(flow)) + 1
  return clamp(stage, 1, MAX_STAGE) as Stage
}

/** 0-1 progress toward the next stage, for the growth ring. */
export function stageProgress(tile: Tile, flow: number, now: number): number {
  if (!tile.holder) return 0
  if (stageOf(tile, flow, now) >= MAX_STAGE) return 1
  const per = stageDurationMs(flow)
  return ((now - tile.plantedAt) % per) / per
}

/** What it costs to take this tile right now, in Luna. Zero for bare soil. */
export function priceOf(tile: Tile, flow: number, now: number): number {
  return STAGE_VALUE_LUNA[stageOf(tile, flow, now)]
}

/** What it will cost once this tile reaches its next stage. */
export function nextPriceOf(tile: Tile, flow: number, now: number): number {
  const next = clamp(stageOf(tile, flow, now) + 1, 0, MAX_STAGE) as Stage
  return STAGE_VALUE_LUNA[next]
}

export function tilesHeldBy(state: GridState, address: string | null): number {
  if (!address) return 0
  return state.tiles.reduce((n, tile) => (tile.holder === address ? n + 1 : n), 0)
}

/** True while a tile is inside its post-claim protection window. */
export function isProtected(tile: Tile, now: number): boolean {
  return tile.holder !== null && now - tile.plantedAt < TAKEOVER_GRACE_MS
}

/** Whole seconds of protection left, for the countdown. */
export function protectionRemaining(tile: Tile, now: number): number {
  if (!isProtected(tile, now)) return 0
  return Math.ceil((TAKEOVER_GRACE_MS - (now - tile.plantedAt)) / 1000)
}

/** Seeding is free, but only while under the holding limit. */
export function canSeed(state: GridState, address: string | null): boolean {
  return tilesHeldBy(state, address) < FREE_SEED_LIMIT
}

/** Apply Flow regeneration for elapsed calm. Pure — returns the new values. */
export function regenerateFlow(
  state: GridState,
  now: number,
): { flow: number; flowUpdatedAt: number } {
  const ticks = Math.floor((now - state.flowUpdatedAt) / FLOW_REGEN_INTERVAL_MS)
  if (ticks <= 0) return { flow: state.flow, flowUpdatedAt: state.flowUpdatedAt }
  return {
    flow: clamp(state.flow + ticks * FLOW_REGEN, 0, 100),
    flowUpdatedAt: state.flowUpdatedAt + ticks * FLOW_REGEN_INTERVAL_MS,
  }
}

export type FlowBand = 'thriving' | 'steady' | 'strained' | 'collapsing'

export function flowBand(flow: number): FlowBand {
  if (flow >= 80) return 'thriving'
  if (flow >= 50) return 'steady'
  if (flow >= 25) return 'strained'
  return 'collapsing'
}

export const FLOW_COPY: Record<FlowBand, string> = {
  thriving: 'The grid is thriving — everything grows faster',
  steady: 'Steady growth across the grid',
  strained: 'Churn is straining the grid — growth is slowing',
  collapsing: 'The grid is collapsing. Let it rest to recover',
}

export const STAGE_NAMES: Record<Stage, string> = {
  0: 'Bare soil',
  1: 'Sprout',
  2: 'Seedling',
  3: 'Mature',
  4: 'Ancient',
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

/** Human-readable "4m" style duration. */
export function formatAge(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}
