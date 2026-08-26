/**
 * Grid persistence.
 *
 * `GridStore` is deliberately async and coarse-grained so the local
 * implementation can be swapped for an HTTP client against the real backend
 * without touching a single component. The backend's job, when it exists, is to
 * verify the payment receipt against a Nimiq node BEFORE moving a tile — the
 * client has no authority to assert that it paid.
 *
 * Until then `LocalGridStore` keeps state in localStorage so the grid is fully
 * playable and demoable on one device.
 */
import { CLAIM_FLOW_COST, clamp, createGrid, regenerateFlow, type GridState } from './game'

export interface ClaimRequest {
  tileIndex: number
  /** Wallet taking the tile. */
  holder: string
  /** What they paid, in Luna. Zero when seeding bare soil. */
  pricePaidLuna: number
  /** Whoever got paid, or null when seeding bare soil. */
  paidTo: string | null
  /**
   * Opaque string returned by `sendBasicTransaction`. The server will resolve
   * this against a Nimiq node and reject the claim unless recipient and amount
   * match. Null when no payment was needed or in preview mode.
   */
  receipt: string | null
}

export interface GridStore {
  load(): Promise<GridState>
  /** Advance time-based state (Flow regeneration). Cheap; safe to call often. */
  tick(now: number): Promise<GridState>
  claim(request: ClaimRequest): Promise<GridState>
}

const STORAGE_KEY = 'ecoflow.grid.v1'

/** `structuredClone` is missing in older WebViews; JSON is enough for this shape. */
function clone<T>(value: T): T {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : (JSON.parse(JSON.stringify(value)) as T)
}

function isGridState(value: unknown): value is GridState {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as GridState).tiles) &&
    typeof (value as GridState).flow === 'number'
  )
}

export class LocalGridStore implements GridStore {
  #state: GridState | null = null

  async load(): Promise<GridState> {
    this.#state ??= this.#read() ?? createGrid(Date.now())
    return this.tick(Date.now())
  }

  async tick(now: number): Promise<GridState> {
    this.#state ??= this.#read() ?? createGrid(now)
    const state = this.#state
    const regen = regenerateFlow(state, now)
    if (regen.flowUpdatedAt !== state.flowUpdatedAt) {
      Object.assign(state, regen)
      this.#write(state)
    }
    return this.#snapshot()
  }

  async claim(request: ClaimRequest): Promise<GridState> {
    if (!this.#state) await this.load()
    const state = this.#state!
    const tile = state.tiles[request.tileIndex]
    if (!tile) throw new Error(`No tile at index ${request.tileIndex}`)

    tile.holder = request.holder
    tile.stakeLuna = request.pricePaidLuna
    tile.plantedAt = Date.now()
    tile.generation += 1

    // A takeover costs the commons; seeding bare soil does not.
    if (request.paidTo) {
      state.flow = clamp(state.flow - CLAIM_FLOW_COST, 0, 100)
    }

    this.#write(state)
    return this.#snapshot()
  }

  /** Wipe local state. Dev affordance — not reachable from the shipped UI. */
  async reset(): Promise<GridState> {
    this.#state = createGrid(Date.now())
    this.#write(this.#state)
    return this.#snapshot()
  }

  #snapshot(): GridState {
    return clone(this.#state!)
  }

  #read(): GridState | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return null
      const parsed: unknown = JSON.parse(raw)
      return isGridState(parsed) ? parsed : null
    } catch {
      // Private-mode WebViews can throw on localStorage access. Not fatal.
      return null
    }
  }

  #write(state: GridState): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      /* non-fatal */
    }
  }
}
