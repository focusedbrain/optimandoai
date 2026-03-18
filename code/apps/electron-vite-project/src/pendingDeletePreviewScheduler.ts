/**
 * Pending-delete and archive preview scheduler — runs outside component lifecycle.
 * Survives view switch (Normal ↔ Bulk) so the 5s preview continues.
 */

import { useEmailInboxStore } from './stores/useEmailInboxStore'

const TICK_MS = 1000

let intervalId: ReturnType<typeof setInterval> | null = null

function tick() {
  const state = useEmailInboxStore.getState()
  const hasPending = Object.keys(state.pendingDeletePreviewExpiries).length > 0
  const hasArchive = Object.keys(state.archivePreviewExpiries).length > 0
  if (!hasPending && !hasArchive) return
  state.incrementCountdownTick()
  if (hasPending) void state.processExpiredPendingDeletes()
  if (hasArchive) void state.processExpiredArchivePreviews()
}

function start() {
  if (intervalId) return
  intervalId = setInterval(tick, TICK_MS)
}

function stop() {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
}

/** Start the scheduler. Call once when app mounts. */
export function startPendingDeletePreviewScheduler() {
  start()
}

/** Stop the scheduler. Call on app unmount if needed. */
export function stopPendingDeletePreviewScheduler() {
  stop()
}
