/**
 * Settings, parsed once per request.
 *
 * Every tunable is a `[vars]` entry in `wrangler.toml`. Vars arrive as strings,
 * so parsing happens here and exactly once.
 */
import type { Env } from './types'

export interface Config {
  /** Gemini model name. Kept configurable for safe upgrades. */
  model: string
  /** Ceiling on generations per UTC day, across everyone. */
  dailyBudget: number
  /** Base for share links; empty means "derive it from the request". */
  appUrl: string
}

function int(value: string | undefined, fallback: number, min: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback
}

export function readConfig(env: Env): Config {
  return {
    model: (env.GEMINI_MODEL ?? 'gemini-3.1-flash-lite').trim(),
    dailyBudget: int(env.DAILY_BUDGET, 400, 0),
    appUrl: (env.APP_URL ?? '').trim().replace(/\/+$/, ''),
  }
}
