/**
 * Replacement budget circuit breaker (P5.7).
 *
 * Prevents runaway container replacement loops on REMOTE_EDGE replicas.
 *
 * Tunables:
 * - MAX_REPLACEMENTS / WINDOW_SECONDS — raise if users report false-positive exhaustion;
 *   lower if attackers find ways to trigger non-budget-bounded loops.
 * - HEALTHY_PERIOD_SECONDS — after a successful replacement, the sliding window resets once
 *   the container has been continuously healthy for this duration.
 */

import type { RemoteEdgeContainerRole } from './containers.js'
import { findContainerSpec } from './containers.js'

/** Maximum replacements allowed within WINDOW_SECONDS before exhaustion. */
export const MAX_REPLACEMENTS = 3

/** Sliding window for replacement counting (seconds). */
export const WINDOW_SECONDS = 60

/** Healthy uptime required after success before the budget window resets (seconds). */
export const HEALTHY_PERIOD_SECONDS = 60

export interface ReplacementBudgetNotification {
  replica_id: string
  container_role: RemoteEdgeContainerRole
  container_name: string
  message: string
  created_at: string
}

interface ContainerBudgetState {
  replacementTimestampsMs: number[]
  exhausted: boolean
  lastSuccessfulReplacementMs: number | null
  healthySinceMs: number | null
}

const _budgets = new Map<string, ContainerBudgetState>()
const _notifications = new Map<string, ReplacementBudgetNotification>()

function budgetKey(replicaId: string, role: RemoteEdgeContainerRole): string {
  return `${replicaId.toLowerCase()}:${role}`
}

function getState(replicaId: string, role: RemoteEdgeContainerRole): ContainerBudgetState {
  const key = budgetKey(replicaId, role)
  let state = _budgets.get(key)
  if (!state) {
    state = {
      replacementTimestampsMs: [],
      exhausted: false,
      lastSuccessfulReplacementMs: null,
      healthySinceMs: null,
    }
    _budgets.set(key, state)
  }
  return state
}

function pruneTimestamps(state: ContainerBudgetState, nowMs: number): void {
  const cutoff = nowMs - WINDOW_SECONDS * 1000
  state.replacementTimestampsMs = state.replacementTimestampsMs.filter((t) => t > cutoff)
}

function resetBudgetState(state: ContainerBudgetState): void {
  state.replacementTimestampsMs = []
  state.exhausted = false
  state.lastSuccessfulReplacementMs = null
  state.healthySinceMs = null
}

export function buildReplacementExhaustedMessage(
  containerName: string,
  replicaId: string,
): string {
  return (
    `Container ${containerName} on replica ${replicaId} has failed repeatedly. ` +
    'Automatic recovery is paused for this container. View the diagnostic reports to investigate, ' +
    "or use 'Nuclear reset' to redeploy this replica from scratch."
  )
}

export type ReplacementAllowance =
  | { allowed: true }
  | { allowed: false; reason: 'already_exhausted' }
  | { allowed: false; reason: 'budget_exhausted'; newly_exhausted: true }

export function checkReplacementAllowed(
  replicaId: string,
  role: RemoteEdgeContainerRole,
  nowMs: number,
): ReplacementAllowance {
  const state = getState(replicaId, role)
  if (state.exhausted) {
    return { allowed: false, reason: 'already_exhausted' }
  }

  pruneTimestamps(state, nowMs)
  if (state.replacementTimestampsMs.length >= MAX_REPLACEMENTS) {
    state.exhausted = true
    return { allowed: false, reason: 'budget_exhausted', newly_exhausted: true }
  }
  return { allowed: true }
}

export function isReplacementExhausted(
  replicaId: string,
  role: RemoteEdgeContainerRole,
): boolean {
  return getState(replicaId, role).exhausted
}

export function recordReplacementCompleted(
  replicaId: string,
  role: RemoteEdgeContainerRole,
  nowMs: number,
  success: boolean,
): void {
  const state = getState(replicaId, role)
  pruneTimestamps(state, nowMs)
  state.replacementTimestampsMs.push(nowMs)
  if (success) {
    state.lastSuccessfulReplacementMs = nowMs
    state.healthySinceMs = null
  }
}

export function observeContainerRunning(
  replicaId: string,
  role: RemoteEdgeContainerRole,
  nowMs: number,
): boolean {
  const state = getState(replicaId, role)
  if (state.lastSuccessfulReplacementMs == null) {
    return false
  }

  if (state.healthySinceMs == null) {
    state.healthySinceMs = nowMs
    return false
  }

  const healthyMs = nowMs - state.healthySinceMs
  if (healthyMs >= HEALTHY_PERIOD_SECONDS * 1000) {
    resetBudgetState(state)
    return true
  }
  return false
}

export function observeContainerNotRunning(
  replicaId: string,
  role: RemoteEdgeContainerRole,
): void {
  const state = getState(replicaId, role)
  state.healthySinceMs = null
}

export function storeReplacementBudgetNotification(
  replicaId: string,
  role: RemoteEdgeContainerRole,
  nowMs: number,
): ReplacementBudgetNotification {
  const containerName = findContainerSpec(role).containerName
  const notification: ReplacementBudgetNotification = {
    replica_id: replicaId,
    container_role: role,
    container_name: containerName,
    message: buildReplacementExhaustedMessage(containerName, replicaId),
    created_at: new Date(nowMs).toISOString(),
  }
  _notifications.set(budgetKey(replicaId, role), notification)
  return notification
}

export function getReplacementBudgetNotifications(): ReplacementBudgetNotification[] {
  return [..._notifications.values()]
}

export function clearReplacementBudgetNotification(
  replicaId: string,
  role: RemoteEdgeContainerRole,
): void {
  _notifications.delete(budgetKey(replicaId, role))
}

export function resumeAutomaticRecovery(
  replicaId: string,
  role: RemoteEdgeContainerRole,
): void {
  const state = getState(replicaId, role)
  resetBudgetState(state)
  clearReplacementBudgetNotification(replicaId, role)
}

export function clearReplacementBudgetOnNuclearReset(replicaId: string): void {
  for (const role of [
    'ingestor',
    'validator',
    'depackager',
    'certifier',
    'mail-fetcher',
  ] as RemoteEdgeContainerRole[]) {
    resumeAutomaticRecovery(replicaId, role)
  }
}

/** Test seam */
export function _resetReplacementBudgetForTest(): void {
  _budgets.clear()
  _notifications.clear()
}

/** Test seam — count replacements currently in window after prune. */
export function _replacementCountInWindowForTest(
  replicaId: string,
  role: RemoteEdgeContainerRole,
  nowMs: number,
): number {
  const state = getState(replicaId, role)
  pruneTimestamps(state, nowMs)
  return state.replacementTimestampsMs.length
}
