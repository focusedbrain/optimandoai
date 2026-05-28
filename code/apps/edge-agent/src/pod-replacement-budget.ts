import type { RemoteEdgeContainerRole } from './pod-containers.js'
import { REMOTE_EDGE_POD_NAME } from './pod-deploy.js'

export const AGENT_MAX_REPLACEMENTS = 5
export const AGENT_REPLACEMENT_WINDOW_MS = 10 * 60 * 1000

const _timestamps = new Map<string, number[]>()
const _exhausted = new Set<string>()

function key(role: RemoteEdgeContainerRole): string {
  return `${REMOTE_EDGE_POD_NAME}:${role}`
}

export function clearReplacementBudget(): void {
  _timestamps.clear()
  _exhausted.clear()
}

export function checkReplacementAllowed(
  role: RemoteEdgeContainerRole,
  nowMs: number,
): { allowed: boolean; newlyExhausted?: boolean } {
  const k = key(role)
  if (_exhausted.has(k)) return { allowed: false }
  const cutoff = nowMs - AGENT_REPLACEMENT_WINDOW_MS
  const prev = (_timestamps.get(k) ?? []).filter((t) => t > cutoff)
  if (prev.length >= AGENT_MAX_REPLACEMENTS) {
    _exhausted.add(k)
    return { allowed: false, newlyExhausted: true }
  }
  return { allowed: true }
}

export function recordReplacement(role: RemoteEdgeContainerRole, nowMs: number): void {
  const k = key(role)
  const cutoff = nowMs - AGENT_REPLACEMENT_WINDOW_MS
  const next = [...(_timestamps.get(k) ?? []).filter((t) => t > cutoff), nowMs]
  _timestamps.set(k, next)
}

export function isReplacementExhausted(role: RemoteEdgeContainerRole): boolean {
  return _exhausted.has(key(role))
}

export function _resetReplacementBudgetForTest(): void {
  clearReplacementBudget()
}
