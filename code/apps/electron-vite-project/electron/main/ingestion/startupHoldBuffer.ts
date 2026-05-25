/**
 * Brief in-memory hold while local pod is starting (edge disabled, Podman available).
 * Promotes to persistent hold queue after STARTUP_HOLD_MS if still not ready.
 */

import type { QueuedMessage } from './holdQueue.js'

export const STARTUP_HOLD_MS = 30_000

interface StartupItem {
  msg: QueuedMessage
  enqueuedAt: number
}

const _pending: StartupItem[] = []

export function enqueueStartupHold(msg: QueuedMessage): void {
  _pending.push({ msg, enqueuedAt: Date.now() })
}

export function getStartupHoldItems(now = Date.now()): { ready: QueuedMessage[]; expired: QueuedMessage[] } {
  const ready: QueuedMessage[] = []
  const expired: QueuedMessage[] = []
  const keep: StartupItem[] = []
  for (const item of _pending) {
    if (now - item.enqueuedAt >= STARTUP_HOLD_MS) {
      expired.push(item.msg)
    } else {
      keep.push(item)
    }
  }
  _pending.length = 0
  _pending.push(...keep)
  return { ready: [], expired }
}

export function drainStartupHoldIfReady(hostPodReady: boolean): QueuedMessage[] {
  if (!hostPodReady) return []
  const all = _pending.splice(0).map((i) => i.msg)
  return all
}

export function flushExpiredStartupHold(now = Date.now()): QueuedMessage[] {
  const expired: QueuedMessage[] = []
  const keep: StartupItem[] = []
  for (const item of _pending) {
    if (now - item.enqueuedAt >= STARTUP_HOLD_MS) expired.push(item.msg)
    else keep.push(item)
  }
  _pending.length = 0
  _pending.push(...keep)
  return expired
}

export function startupHoldCount(): number {
  return _pending.length
}

export function _resetStartupHoldForTest(): void {
  _pending.length = 0
}
