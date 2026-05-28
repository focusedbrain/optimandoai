/**
 * Host pod container replacement budget (Stream A — A5).
 */

import type { LocalPodContainerRole } from './containers.js'

export const LOCAL_POD_MAX_REPLACEMENTS = 5
export const LOCAL_POD_REPLACEMENT_WINDOW_MS = 10 * 60 * 1000

const _timestamps = new Map<string, number[]>()
const _exhausted = new Set<string>()

function key(podName: string, role: LocalPodContainerRole): string {
  return `${podName}:${role}`
}

export function clearReplacementBudgetForPod(podName: string): void {
  const prefix = `${podName}:`
  for (const k of [..._timestamps.keys()]) {
    if (k.startsWith(prefix)) _timestamps.delete(k)
  }
  for (const k of [..._exhausted]) {
    if (k.startsWith(prefix)) _exhausted.delete(k)
  }
}

export function checkReplacementAllowed(
  podName: string,
  role: LocalPodContainerRole,
  nowMs: number,
): { allowed: boolean; newlyExhausted?: boolean } {
  const k = key(podName, role)
  if (_exhausted.has(k)) return { allowed: false }

  const cutoff = nowMs - LOCAL_POD_REPLACEMENT_WINDOW_MS
  const prev = (_timestamps.get(k) ?? []).filter((t) => t > cutoff)
  if (prev.length >= LOCAL_POD_MAX_REPLACEMENTS) {
    _exhausted.add(k)
    return { allowed: false, newlyExhausted: true }
  }
  return { allowed: true }
}

export function recordReplacement(podName: string, role: LocalPodContainerRole, nowMs: number): void {
  const k = key(podName, role)
  const cutoff = nowMs - LOCAL_POD_REPLACEMENT_WINDOW_MS
  const next = [...(_timestamps.get(k) ?? []).filter((t) => t > cutoff), nowMs]
  _timestamps.set(k, next)
}

export function isReplacementExhausted(podName: string, role: LocalPodContainerRole): boolean {
  return _exhausted.has(key(podName, role))
}

export function _resetLocalReplacementBudgetForTest(): void {
  _timestamps.clear()
  _exhausted.clear()
}
