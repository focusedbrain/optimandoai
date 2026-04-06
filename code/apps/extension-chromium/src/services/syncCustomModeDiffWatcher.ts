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

function modeDiffWatcherIdPrefix(modeId: string): string {
  const uuid = modeId.startsWith('custom:') ? modeId.slice('custom:'.length) : modeId
  return `cmdiff-${uuid}`
}

/** Stable id for the nth folder watcher (`0` = first path). Legacy single-folder id `cmdiff-<uuid>` is removed on sync. */
export function customModeDiffWatcherId(modeId: string, index: number): string {
  return `${modeDiffWatcherIdPrefix(modeId)}-${index}`
}

function isModeOwnedDiffWatcherId(modeId: string, watcherId: string): boolean {
  const prefix = modeDiffWatcherIdPrefix(modeId)
  return watcherId === prefix || watcherId.startsWith(`${prefix}-`)
}

/**
 * Upsert or remove folder diff watchers for this mode. Safe to call when the desktop app is offline (no-op).
 */
export async function syncCustomModeDiffWatcher(
  modeId: string,
  modeName: string,
  diffWatchFolders: string[] | null | undefined,
): Promise<void> {
  const raw = Array.isArray(diffWatchFolders) ? diffWatchFolders : []
  const seen = new Set<string>()
  const folders = raw
    .map((f) => (typeof f === 'string' ? f.trim() : ''))
    .filter(Boolean)
    .filter((f) => (seen.has(f) ? false : (seen.add(f), true)))

  try {
    const secret = await getLaunchSecret()
    const r = await fetch(`${BASE_URL}/api/wrchat/diff-watchers`, {
      headers: { 'Content-Type': 'application/json', 'X-Launch-Secret': secret ?? '' },
      signal: AbortSignal.timeout(15000),
    })
    if (!r.ok) return

    const j = (await r.json().catch(() => ({}))) as { watchers?: unknown }
    if (!Array.isArray(j.watchers)) return

    let list = (j.watchers as DiffTrigger[]).filter((w) => !isModeOwnedDiffWatcherId(modeId, w.id))

    if (folders.length > 0) {
      const uuidShort = modeId.replace(/^custom:/, '').slice(0, 8)
      const tag = normaliseTriggerTag(`#cm-${uuidShort}`) || '#cmdiff'
      const safeNameBase = `Mode: ${(modeName || 'Untitled').trim()}`.slice(0, 100)
      const triggers: DiffTrigger[] = folders.map((folder, index) => ({
        type: 'diff',
        id: customModeDiffWatcherId(modeId, index),
        name: folders.length > 1 ? `${safeNameBase} (${index + 1})`.slice(0, 120) : `${safeNameBase}`.slice(0, 120),
        tag,
        watchPath: folder,
        enabled: true,
        updatedAt: Date.now(),
      }))
      list = [...list, ...triggers]
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
