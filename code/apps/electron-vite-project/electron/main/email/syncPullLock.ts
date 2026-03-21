/**
 * Per-account Pull lock: while list+fetch runs for a provider mailbox, remote orchestrator
 * queue processing must not move messages for that account (avoids INBOX list → mirror move → fetch miss).
 *
 * Locks store acquisition time so stale locks (crash / timeout without markPullInactive) expire after
 * {@link PULL_LOCK_TIMEOUT_MS}. Use {@link clearAllPullActiveLocks} on Sync Remote to force-clear.
 */

const PULL_LOCK_TIMEOUT_MS = 5 * 60 * 1000

/** accountId → lock start time (epoch ms) */
const pullActiveSince = new Map<string, number>()

export function isPullActive(accountId: string): boolean {
  const id = String(accountId ?? '').trim()
  if (!id) return false
  const lockTime = pullActiveSince.get(id)
  if (lockTime == null) return false
  if (Date.now() - lockTime > PULL_LOCK_TIMEOUT_MS) {
    pullActiveSince.delete(id)
    console.log(`[SyncPullLock] Pull lock expired for ${id} (held > ${PULL_LOCK_TIMEOUT_MS / 1000}s)`)
    return false
  }
  return true
}

export function markPullActive(accountId: string): void {
  const id = String(accountId ?? '').trim()
  if (!id) return
  pullActiveSince.set(id, Date.now())
}

export function markPullInactive(accountId: string): void {
  const id = String(accountId ?? '').trim()
  if (!id) return
  pullActiveSince.delete(id)
}

/** Clears every pull lock (e.g. Sync Remote — stale locks block drain deferral forever). */
export function clearAllPullActiveLocks(): void {
  pullActiveSince.clear()
  console.log('[SyncPullLock] Cleared all pull-active locks')
}
