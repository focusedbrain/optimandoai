/**
 * Keeps Electron diff watchers in sync with a custom WR Chat mode folder scope.
 */

import type { DiffTrigger } from '@shared/wrChat/diffTrigger'
import { normaliseTriggerTag } from '../utils/normaliseTriggerTag'

const BASE_URL = 'http://127.0.0.1:51248'

function getLaunchSecret(): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: 'GET_LAUNCH_SECRET' }, (resp: { secret?: string | null } | undefined) => {
        if (chrome.runtime.lastError) resolve(null)
        else resolve(resp?.secret?.trim() ? resp.secret : null)
      })
    } catch {
      resolve(null)
    }
  })
}

export function customModeDiffWatcherId(modeId: string): string {
  const uuid = modeId.startsWith('custom:') ? modeId.slice('custom:'.length) : modeId
  return `cmdiff-${uuid}`
}

/**
 * Upsert or remove the folder diff watcher for this mode. Safe to call when the desktop app is offline (no-op).
 */
export async function syncCustomModeDiffWatcher(
  modeId: string,
  modeName: string,
  diffWatchFolder: string | null | undefined,
): Promise<void> {
  const triggerId = customModeDiffWatcherId(modeId)
  const folder = typeof diffWatchFolder === 'string' ? diffWatchFolder.trim() : ''

  try {
    const secret = await getLaunchSecret()
    const r = await fetch(`${BASE_URL}/api/wrchat/diff-watchers`, {
      headers: { 'Content-Type': 'application/json', 'X-Launch-Secret': secret ?? '' },
      signal: AbortSignal.timeout(15000),
    })
    if (!r.ok) return

    const j = (await r.json().catch(() => ({}))) as { watchers?: unknown }
    if (!Array.isArray(j.watchers)) return

    let list = (j.watchers as DiffTrigger[]).filter((w) => w.id !== triggerId)

    if (folder) {
      const uuidShort = modeId.replace(/^custom:/, '').slice(0, 8)
      const tag = normaliseTriggerTag(`#cm-${uuidShort}`) || '#cmdiff'
      const safeName = `Mode: ${(modeName || 'Untitled').trim()}`.slice(0, 120)
      const trigger: DiffTrigger = {
        type: 'diff',
        id: triggerId,
        name: safeName,
        tag,
        watchPath: folder,
        enabled: true,
        updatedAt: Date.now(),
      }
      list = [...list, trigger]
    }

    const post = await fetch(`${BASE_URL}/api/wrchat/diff-watchers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Launch-Secret': secret ?? '' },
      body: JSON.stringify({ watchers: list }),
      signal: AbortSignal.timeout(30000),
    })
    if (!post.ok) {
      console.warn('[syncCustomModeDiffWatcher] POST failed', post.status)
    }
  } catch {
    /* desktop offline or unreachable */
  }
}
