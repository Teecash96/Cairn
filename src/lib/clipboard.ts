/**
 * Copying text, including where the modern clipboard API isn't there.
 *
 * `navigator.clipboard` requires a secure context. Testing this app on a real
 * handset means loading it over LAN HTTP — which is *not* a secure context — so
 * the async API is simply absent for the entire on-device development cycle.
 * Since the copy buttons are this app's primary export path, the deprecated
 * `execCommand` fallback is load-bearing rather than decorative.
 */

/** Resolves false when the copy did not happen, so the UI can say so honestly. */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false

  // Preferred path — available in the deployed HTTPS app.
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Denied, or a non-secure context that still exposes the object. Fall back.
    }
  }

  return legacyCopy(text)
}

/**
 * Hidden-textarea + `execCommand('copy')`. Must run inside the user gesture
 * that triggered it, which is why `copyText` does no awaiting before reaching
 * here on the fallback path.
 */
function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined') return false

  const textarea = document.createElement('textarea')
  textarea.value = text
  // Read-only still permits selection, and stops the soft keyboard appearing.
  textarea.setAttribute('readonly', '')
  textarea.setAttribute('aria-hidden', 'true')
  textarea.style.cssText =
    'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:none;' +
    'outline:none;box-shadow:none;background:transparent;opacity:0;' +
    // 16px stops iOS zooming the viewport when the field takes focus.
    'font-size:16px;'

  document.body.appendChild(textarea)

  // Preserve whatever the user had selected before we hijacked the selection.
  const selection = document.getSelection()
  const previous = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null

  let copied = false
  try {
    textarea.focus()
    textarea.select()
    // iOS ignores select() on a textarea; this is the form it honours.
    textarea.setSelectionRange(0, text.length)
    copied = document.execCommand('copy')
  } catch {
    copied = false
  } finally {
    textarea.remove()

    if (selection) {
      selection.removeAllRanges()
      if (previous) selection.addRange(previous)
    }
  }

  return copied
}

/**
 * True when this browser can be asked to save a file.
 *
 * Deliberately only ever a *secondary* affordance: the spec's "Export Markdown
 * saves one .md file" assumes a desktop app, and a WebView may silently ignore
 * a page-initiated download. The primary export is always the clipboard.
 */
export function canDownload(): boolean {
  return (
    typeof document !== 'undefined' &&
    'download' in document.createElement('a') &&
    typeof URL !== 'undefined' &&
    typeof URL.createObjectURL === 'function'
  )
}

/** Offer `text` as a file. Returns false if the browser cannot do it. */
export function downloadFile(filename: string, text: string, mimeType = 'text/plain;charset=utf-8'): boolean {
  if (!canDownload()) return false

  let url: string | null = null
  try {
    const blob = new Blob([text], { type: mimeType })
    url = URL.createObjectURL(blob)

    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.rel = 'noopener'
    anchor.style.display = 'none'

    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    return true
  } catch {
    return false
  } finally {
    // Revoke on the next frame — revoking synchronously can cancel the download.
    if (url) setTimeout(() => URL.revokeObjectURL(url as string), 10_000)
  }
}

/** Offer Markdown as a file without making existing callers know its MIME type. */
export function downloadText(filename: string, text: string): boolean {
  return downloadFile(filename, text, 'text/markdown;charset=utf-8')
}

/** Prefer the operating-system share sheet; copy is the dependable fallback. */
export async function shareLink(title: string, text: string, url: string): Promise<'shared' | 'copied' | 'cancelled' | 'failed'> {
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text, url })
      return 'shared'
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'
      // WebViews can advertise share() and then reject it. Copy still works.
    }
  }
  return await copyText(url) ? 'copied' : 'failed'
}
