/**
 * WR Desk™ — Auto-Optimization Engine.
 *
 * Interval and snapshot triggers delegate to `optimizationRunCoordinator.executeOptimizationRun`.
 */

import type { Project } from '../types/projectTypes'
import type { TriggerSource } from '../types/optimizationTypes'

let intervalHandle: ReturnType<typeof setInterval> | null = null
/** Prevents overlapping interval ticks when a run is still executing. */
let optimizationRunInProgress = false

function newRunId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `run-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
  }
}

/**
 * Starts the auto-optimization interval for the given project.
 * Clears any previously running interval first.
 * No-ops if the project has auto-optimization disabled or no linked sessions.
 */
export function startAutoOptimization(project: Project): void {
  stopAutoOptimization()

  const ids = project.linkedSessionIds ?? []
  if (!project.autoOptimizationEnabled) {
    console.log('[AutoOpt] Not starting: disabled')
    return
  }
  if (ids.length === 0) {
    console.log('[AutoOpt] Not starting: no linked sessions')
    return
  }

  const intervalMs = project.autoOptimizationIntervalMs || 300_000

  console.log(
    `[AutoOpt] Starting for project "${project.title}" every ${intervalMs}ms`,
    `(sessions: ${ids.length})`,
    ids,
  )

  void runTrigger(project, 'dashboard_interval')

  intervalHandle = setInterval(() => {
    void runTrigger(project, 'dashboard_interval')
  }, intervalMs)
}

/** Clears the running auto-optimization interval, if any. */
export function stopAutoOptimization(): void {
  if (intervalHandle !== null) {
    clearInterval(intervalHandle)
    intervalHandle = null
    console.log('[AutoOpt] Stopped')
  }
  optimizationRunInProgress = false
}

/**
 * One-shot snapshot optimization — same run logic as the interval tick,
 * but without starting a recurring interval.
 */
export function triggerSnapshotOptimization(
  project: Project,
  trigger: TriggerSource = 'dashboard_snapshot',
): void {
  console.log('[AutoOpt] Snapshot optimization triggered')
  void runTrigger(project, trigger)
}

async function runTrigger(project: Project, trigger: TriggerSource): Promise<void> {
  if (optimizationRunInProgress) {
    console.log('[AutoOpt] Skipping run — already in progress', { trigger })
    return
  }
  const ids = project.linkedSessionIds ?? []
  if (ids.length === 0) {
    console.warn('[AutoOpt] No linked sessions; skip run')
    return
  }

  const runId = newRunId()
  optimizationRunInProgress = true
  try {
    const { executeOptimizationRun } = await import('./optimizationRunCoordinator')
    await executeOptimizationRun(project, runId, trigger)
  } catch (e) {
    console.warn('[AutoOpt] executeOptimizationRun failed:', e)
  } finally {
    optimizationRunInProgress = false
  }
}

/** Same execution path as snapshot/interval; kept for callers that use this name. */
export function triggerOptimizationRun(project: Project, trigger: TriggerSource): void {
  void runTrigger(project, trigger)
}
