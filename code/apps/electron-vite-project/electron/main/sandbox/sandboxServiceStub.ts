/**
 * Sandbox Service Stub
 *
 * Deterministic placeholder implementation of the sandbox sub-orchestrator.
 * Consumes tasks from sandbox_queue, marks them processed, and produces
 * placeholder SandboxResult objects.
 *
 * SHALL NOT:
 *   - Execute host code
 *   - Attempt tool invocations
 *   - Access the network or filesystem
 *   - Produce non-deterministic output
 *
 * Later replacement with a real sandbox requires only swapping this file
 * for a real implementation behind the same interface.
 */

import type { SandboxTask, SandboxResult } from './types'

export function processTask(task: SandboxTask): SandboxResult {
  return {
    task_id: task.task_id,
    completed_at: new Date().toISOString(),
    status: 'verified',
    findings: [],
    output_summary: `Stub processed task ${task.task_id} — no execution performed`,
  }
}
