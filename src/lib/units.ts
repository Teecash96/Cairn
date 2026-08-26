/**
 * Nimiq amounts are denominated in Luna, never NIM.
 *
 *   1 NIM = 100,000 Luna
 *
 * Every `value` / `fee` field on the provider takes Luna. Passing NIM by
 * mistake underpays by five orders of magnitude, so the rule in this codebase
 * is: Luna everywhere internally, convert only at the UI boundary.
 */
export const LUNA_PER_NIM = 100_000

export function nimToLuna(nim: number): number {
  return Math.round(nim * LUNA_PER_NIM)
}

export function lunaToNim(luna: number): number {
  return luna / LUNA_PER_NIM
}

/** Render Luna as a short NIM string: 100000 -> "1", 130000 -> "1.3" */
export function formatNim(luna: number): string {
  const nim = lunaToNim(luna)
  if (Number.isInteger(nim)) return String(nim)
  return nim.toFixed(2).replace(/\.?0+$/, '')
}

/** Shorten a Nimiq address for display: "NQ12 3456 …  WXYZ" */
export function shortAddress(address: string): string {
  const compact = address.replace(/\s+/g, '')
  if (compact.length <= 12) return address
  return `${compact.slice(0, 4)} ${compact.slice(4, 8)} … ${compact.slice(-4)}`
}
