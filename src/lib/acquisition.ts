const STORAGE_KEY = 'cairn:acquisition-source'

export function normalizeAcquisitionSource(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  const source = value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').slice(0, 32).replace(/^-+|-+$/g, '')
  return source || undefined
}

/**
 * Keep first-touch campaign attribution for this browser tab only. Cairn does
 * not set an analytics cookie or load a third-party tracker.
 */
export function acquisitionSource(): string | undefined {
  try {
    const params = new URLSearchParams(window.location.search)
    const incoming = normalizeAcquisitionSource(params.get('ref') ?? params.get('utm_source'))
    const existing = normalizeAcquisitionSource(window.sessionStorage.getItem(STORAGE_KEY))
    const source = existing ?? incoming
    if (source && !existing) window.sessionStorage.setItem(STORAGE_KEY, source)
    return source
  } catch {
    return undefined
  }
}
