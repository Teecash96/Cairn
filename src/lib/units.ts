export const LUNA_PER_NIM = 100_000

export function formatNim(luna: number): string {
  const nim = luna / LUNA_PER_NIM
  if (Number.isInteger(nim)) return String(nim)
  return nim.toFixed(2).replace(/\.?0+$/, '')
}

/** Shorten a Nimiq address for display: "NQ12 3456 …  WXYZ" */
export function shortAddress(address: string): string {
  const compact = address.replace(/\s+/g, '')
  if (compact.length <= 12) return address
  return `${compact.slice(0, 4)} ${compact.slice(4, 8)} … ${compact.slice(-4)}`
}
