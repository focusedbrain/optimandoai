/**
 * Merge tags from Electron host (`tagged-triggers.json` via GET /api/wrchat/tagged-triggers)
 * into `chrome.storage.local` so popup, sidepanel, and dashboard WR Chat lists stay aligned.
 */

const BASE_URL = 'http://127.0.0.1:51248'

function getLaunchSecret(): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: 'GET_LAUNCH_SECRET' }, (resp: { secret?: string | null } | undefined) => {
        if (chrome.runtime.lastError) {
          resolve(null)
          return
        }
        resolve(resp?.secret ?? null)
      })
    } catch {
      resolve(null)
    }
  })
}

/** Returns true if storage was updated with new triggers from the host. */
export async function mergeTaggedTriggersFromHost(): Promise<boolean> {
  try {
    const secret = await getLaunchSecret()
    const r = await fetch(`${BASE_URL}/api/wrchat/tagged-triggers`, {
      headers: { 'Content-Type': 'application/json', 'X-Launch-Secret': secret ?? '' },
    })
    if (!r.ok) return false
    const j = (await r.json()) as { triggers?: unknown[]; ok?: boolean }
    if (!Array.isArray(j.triggers) || j.triggers.length === 0) return false

    return await new Promise<boolean>((resolve) => {
      try {
        chrome.storage?.local?.get(['optimando-tagged-triggers'], (data: Record<string, unknown>) => {
          const local = Array.isArray(data?.['optimando-tagged-triggers'])
            ? (data['optimando-tagged-triggers'] as unknown[])
            : []
          const merged = [...local]
          const keys = new Set(
            local.map((t: { name?: string; at?: number }) => `${String((t as { name?: string }).name ?? '')}|${(t as { at?: number }).at ?? 0}`),
          )
          for (const t of j.triggers as { name?: string; at?: number }[]) {
            const k = `${String(t?.name ?? '')}|${t?.at ?? 0}`
            if (!keys.has(k)) {
              merged.push(t)
              keys.add(k)
            }
          }
          if (merged.length > local.length) {
            chrome.storage?.local?.set({ 'optimando-tagged-triggers': merged }, () => {
              try {
                window.dispatchEvent(new CustomEvent('optimando-triggers-updated'))
              } catch {
                /* noop */
              }
              resolve(true)
            })
          } else {
            resolve(false)
          }
        })
      } catch {
        resolve(false)
      }
    })
  } catch {
    return false
  }
}
