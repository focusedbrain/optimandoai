/**
 * WR Chat folder diff watcher — shared between Electron (`diffWatcher`) and the extension UI.
 * Keep fields in sync with `electron/diffWatcher.ts` usage.
 */
export type DiffTrigger = {
  type: 'diff'
  id: string
  name: string
  /** Normalized `#tag` for routing. */
  tag: string
  command?: string
  watchPath: string
  enabled: boolean
  updatedAt: number
  debounceMs?: number
  maxBytes?: number
  /** Max tracked files before path-only mode (default 500 in Electron). */
  maxFiles?: number
}
