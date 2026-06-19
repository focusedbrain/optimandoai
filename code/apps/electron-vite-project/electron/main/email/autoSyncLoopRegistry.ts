/**
 * Per-account inbox auto-sync timers (`startAutoSync` handles).
 * Extracted from ipc.ts so `deleteAccount` can stop loops without importing the full IPC module.
 */
const activeAutoSyncLoops = new Map<string, { stop: () => void }>()

export function registerAutoSyncLoop(accountId: string, loop: { stop: () => void }): void {
  activeAutoSyncLoops.set(accountId, loop)
}

export function stopAutoSyncLoopForAccount(accountId: string): boolean {
  const id = accountId.trim()
  const existing = activeAutoSyncLoops.get(id)
  if (!existing) return false
  existing.stop()
  activeAutoSyncLoops.delete(id)
  return true
}

export function hasAutoSyncLoop(accountId: string): boolean {
  return activeAutoSyncLoops.has(accountId.trim())
}

/** Test-only: tear down all registered loops. */
export function __clearAutoSyncLoopsForTests(): void {
  for (const loop of activeAutoSyncLoops.values()) {
    loop.stop()
  }
  activeAutoSyncLoops.clear()
}
