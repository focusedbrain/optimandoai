/**
 * Merge tags from Electron host (`tagged-triggers.json` via GET /api/wrchat/tagged-triggers)
 * into `chrome.storage.local` so popup, sidepanel, and dashboard WR Chat lists stay aligned.
 *
 * Deduplication key: normalised trigger tag name (lowercased, stripped of `#`).
 * Conflict resolution: if two triggers share a tag name, the one with the newer
 * `updatedAt` (or `at`) timestamp wins.
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

type TaggedTrigger = {
  name?: string
  command?: string
  at?: number
  updatedAt?: number
  [key: string]: unknown
}

/** Normalise a trigger's tag name to a dedup key: strip leading `#`, lowercase. */
function triggerKey(t: TaggedTrigger): string {
  return String(t?.name ?? '').replace(/^#/, '').toLowerCase().trim()
}

/** Timestamp to use for recency comparison — prefer `updatedAt`, fall back to `at`. */
function triggerTs(t: TaggedTrigger): number {
  return t?.updatedAt ?? t?.at ?? 0
}

/** Returns true if storage was updated with new or fresher triggers from the host. */
export async function mergeTaggedTriggersFromHost(): Promise<boolean> {
  try {
    const secret = await getLaunchSecret()
    const r = await fetch(`${BASE_URL}/api/wrchat/tagged-triggers`, {
      headers: { 'Content-Type': 'application/json', 'X-Launch-Secret': secret ?? '' },
    })
    if (!r.ok) return false
    const j = (await r.json()) as { triggers?: unknown[]; ok?: boolean }
    if (!Array.isArray(j.triggers) || j.triggers.length === 0) return false
    const hostTriggers = j.triggers as TaggedTrigger[]

    return await new Promise<boolean>((resolve) => {
      try {
        chrome.storage?.local?.get(['optimando-tagged-triggers'], (data: Record<string, unknown>) => {
          const local: TaggedTrigger[] = Array.isArray(data?.['optimando-tagged-triggers'])
            ? (data['optimando-tagged-triggers'] as TaggedTrigger[])
            : []

          // Build a map keyed by normalised tag name → keeps the freshest entry.
          const map = new Map<string, TaggedTrigger>()
          for (const t of local) {
            const k = triggerKey(t)
            if (k) map.set(k, t)
          }

          let newCount = 0
          let updatedCount = 0
          for (const ht of hostTriggers) {
            const k = triggerKey(ht)
            if (!k) continue
            const existing = map.get(k)
            if (!existing) {
              map.set(k, ht)
              newCount++
            } else if (triggerTs(ht) > triggerTs(existing)) {
              map.set(k, ht)
              updatedCount++
            }
          }

          if (newCount === 0 && updatedCount === 0) {
            resolve(false)
            return
          }

          // Preserve any unnamed/keyless local triggers (no tag name — kept as-is).
          const keyless = local.filter(t => !triggerKey(t))
          const merged: TaggedTrigger[] = [...map.values(), ...keyless]

          console.log(
            `[mergeTaggedTriggersFromHost] Merged ${hostTriggers.length} triggers from host — ${newCount} new, ${updatedCount} updated`,
          )

          chrome.storage?.local?.set({ 'optimando-tagged-triggers': merged }, () => {
            try {
              window.dispatchEvent(new CustomEvent('optimando-triggers-updated'))
            } catch {
              /* noop */
            }
            resolve(true)
          })
        })
      } catch {
        resolve(false)
      }
    })
  } catch {
    return false
  }
}
