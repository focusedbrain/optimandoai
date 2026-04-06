/**
 * WR Desk™ — Auto-Optimization Engine (V1 stub).
 *
 * Sets up an interval that triggers the orchestration session when
 * auto-optimization is enabled on a project.
 *
 * V1: logs to console; dispatches WRDESK_AUTO_OPTIM_ACTIVATE_SESSIONS so the app
 * can open WR Chat and activate each linked orchestrator session.
 */

import type { Project } from '../types/projectTypes'
import { WRDESK_AUTO_OPTIM_ACTIVATE_SESSIONS } from './wrdeskUiEvents'

let intervalHandle: ReturnType<typeof setInterval> | null = null

function dispatchSessionActivation(sessionIds: string[]): void {
  if (sessionIds.length === 0) return
  try {
    window.dispatchEvent(
      new CustomEvent(WRDESK_AUTO_OPTIM_ACTIVATE_SESSIONS, {
        detail: { sessionIds: [...sessionIds] },
      }),
    )
  } catch {
    /* noop */
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
  if (!project.autoOptimizationEnabled || ids.length === 0) {
    console.log(
      `[AutoOpt] Not starting: ${!project.autoOptimizationEnabled ? 'disabled' : 'no linked sessions'}`,
    )
    return
  }

  const intervalMs = project.autoOptimizationIntervalMs || 300_000

  console.log(
    `[AutoOpt] Starting for project "${project.title}" every ${intervalMs}ms`,
    `(sessions: ${ids.length})`,
    ids,
  )

  triggerOptimizationRun(project)

  intervalHandle = setInterval(() => {
    triggerOptimizationRun(project)
  }, intervalMs)
}

/** Clears the running auto-optimization interval, if any. */
export function stopAutoOptimization(): void {
  if (intervalHandle !== null) {
    clearInterval(intervalHandle)
    intervalHandle = null
    console.log('[AutoOpt] Stopped')
  }
}

/**
 * One-shot snapshot optimization — same run logic as the interval tick,
 * but without starting a recurring interval.
 */
export function triggerSnapshotOptimization(project: Project): void {
  console.log('[AutoOpt] Snapshot optimization triggered')
  triggerOptimizationRun(project)
}

function triggerOptimizationRun(project: Project): void {
  const ids = project.linkedSessionIds ?? []
  if (ids.length === 0) {
    console.warn('[AutoOpt] No linked sessions; skip run')
    return
  }

  dispatchSessionActivation(ids)

  const activeMilestone = project.milestones.find((m) => !m.completed)

  for (const sessionId of ids) {
    const context = {
      projectTitle: project.title,
      description: project.description,
      goals: project.goals,
      activeMilestone: activeMilestone?.title ?? null,
      attachmentCount: project.attachments.length,
      sessionId,
      timestamp: new Date().toISOString(),
    }
    console.log('[AutoOpt] Trigger optimization run:', context)
  }
}
