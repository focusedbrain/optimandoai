/**
 * Open an http(s) URL through the app’s controlled path when available (Electron `app:openExternal` →
 * `shell.openExternal` in main), so links are not opened in hidden or ad-hoc windows. Falls back to
 * `window.open` in web/dev.
 */

export async function openAppExternalUrl(url: string): Promise<void> {
  const u = String(url).trim()
  if (!u) return
  if (!/^https?:\/\//i.test(u)) {
    try {
      // eslint-disable-next-line no-new
      new URL(u)
    } catch {
      return
    }
  }
  try {
    if (typeof window.appShell?.openExternal === 'function') {
      const r = await window.appShell.openExternal(u)
      if (r && typeof r === 'object' && 'ok' in r && (r as { ok: boolean }).ok) {
        return
      }
    }
  } catch {
    /* use fallback */
  }
  const w = window.open(u, '_blank', 'noopener,noreferrer')
  if (w) w.opener = null
}
