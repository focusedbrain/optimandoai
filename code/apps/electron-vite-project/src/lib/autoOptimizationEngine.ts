/**
 * WR Desk™ — Auto-Optimization Engine (V1 stub).
 *
 * Sets up an interval that triggers the orchestration session when
 * auto-optimization is enabled on a project.
 *
 * V1: logs to console only. The actual DOM capture, context assembly,
 * and orchestrator IPC call will be wired in V2.
 *
 * DO NOT import in the main process.
 */

import type { Project } from '../types/projectTypes'

// ── Interval handle ───────────────────────────────────────────────────────────

let intervalHandle: ReturnType<typeof setInterval> | null = null

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Starts the auto-optimization interval for the given project.
 * Clears any previously running interval first.
 * No-ops if the project has auto-optimization disabled or no linked session.
 */
export function startAutoOptimization(project: Project): void {
  stopAutoOptimization()

  if (!project.autoOptimizationEnabled || !project.linkedSessionId) {
    console.log(
      `[AutoOpt] Not starting: ${!project.autoOptimizationEnabled ? 'disabled' : 'no linked session'}`,
    )
    return
  }

  const intervalMs = project.autoOptimizationIntervalMs || 300_000

  console.log(
    `[AutoOpt] Starting for project "${project.title}" every ${intervalMs}ms`,
    `(session: ${project.linkedSessionId})`,
  )

  // Trigger once immediately, then on each interval tick.
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
 * Called when the user clicks "Snapshot-Optimization".
 */
export function triggerSnapshotOptimization(project: Project): void {
  console.log('[AutoOpt] Snapshot optimization triggered')
  triggerOptimizationRun(project)
}

// ── Internal ──────────────────────────────────────────────────────────────────

function triggerOptimizationRun(project: Project): void {
  // TODO: Implement the actual orchestration trigger.
  // Steps when ready:
  //   1. Gather project context: title, description, goals, active milestone,
  //      attachment contents (project.attachments)
  //   2. Gather captured input: DOM state, command chat entries, top chat history
  //      (from the capture mechanism — not yet implemented)
  //   3. Send context + captured input to the orchestration session
  //      (project.linkedSessionId) via IPC:
  //      window.orchestrator?.triggerSession(project.linkedSessionId, context)
  //   4. The session runs the configured AI agents and writes output back
  //      to the agent grid in the dashboard.

  const activeMilestone = project.milestones.find((m) => !m.completed)

  const context = {
    projectTitle:    project.title,
    description:     project.description,
    goals:           project.goals,
    activeMilestone: activeMilestone?.title ?? null,
    attachmentCount: project.attachments.length,
    sessionId:       project.linkedSessionId,
    timestamp:       new Date().toISOString(),
  }

  console.log('[AutoOpt] Trigger optimization run:', context)
  // TODO: window.orchestrator?.triggerSession(project.linkedSessionId, context)
}
