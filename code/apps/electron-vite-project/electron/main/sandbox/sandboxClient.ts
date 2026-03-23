/**
 * Sandbox Client
 *
 * Host-side interface to the Sandbox Sub-Orchestrator.
 *
 * Host code SHALL:
 *   - Enqueue tasks only via sandboxClient.enqueueTask(task)
 *   - Accept results only via sandboxClient.consumeResults()
 *   - Never call stub internals directly
 *
 * This module is the ONLY caller of the sandbox process bridge.
 * The processor can be overridden for testing via setTaskProcessor().
 */

import type { SandboxTask, SandboxResult } from './types'
import { SANDBOX_CONSTANTS } from './types'
import { processTaskViaWorker } from './sandboxProcessBridge'
import {
  insertSandboxQueueItem,
  listSandboxQueueItems,
  updateSandboxQueueStatus,
} from '../ingestion/persistenceDb'

export type TaskProcessor = (task: SandboxTask) => Promise<SandboxResult>

let activeProcessor: TaskProcessor = processTaskViaWorker

export function setTaskProcessor(processor: TaskProcessor): void {
  activeProcessor = processor
}

export function _resetProcessor(): void {
  activeProcessor = processTaskViaWorker
}

// ── Validation ──

function validateTask(task: unknown): task is SandboxTask {
  if (!task || typeof task !== 'object') return false
  const t = task as Record<string, unknown>
  if (typeof t.task_id !== 'string' || t.task_id.length === 0) return false
  if (typeof t.created_at !== 'string') return false
  if (typeof t.raw_input_hash !== 'string' || t.raw_input_hash.length === 0) return false
  const validReasons = new Set(['external_draft', 'unresolved_governance', 'policy_requires_sandbox'])
  if (!validReasons.has(t.reason as string)) return false
  if (!t.constraints || typeof t.constraints !== 'object') return false
  const c = t.constraints as Record<string, unknown>
  if (!['denied', 'restricted'].includes(c.network as string)) return false
  if (!['denied', 'ephemeral'].includes(c.filesystem as string)) return false
  if (typeof c.time_limit_ms !== 'number' || c.time_limit_ms <= 0) return false
  return true
}

function validateResult(result: unknown): result is SandboxResult {
  if (!result || typeof result !== 'object') return false
  const r = result as Record<string, unknown>
  if (typeof r.task_id !== 'string') return false
  if (typeof r.completed_at !== 'string') return false
  if (!['verified', 'rejected', 'error'].includes(r.status as string)) return false
  if (!Array.isArray(r.findings)) return false
  for (const f of r.findings) {
    if (!f || typeof f !== 'object') return false
    if (typeof f.code !== 'string') return false
    if (!['low', 'medium', 'high'].includes(f.severity)) return false
    if (typeof f.message !== 'string') return false
  }
  return true
}

// ── Public Interface ──

export interface EnqueueResult {
  readonly success: boolean;
  readonly task_id: string;
  readonly error?: string;
}

export function enqueueTask(db: any, task: SandboxTask): EnqueueResult {
  if (!validateTask(task)) {
    return { success: false, task_id: (task as any)?.task_id ?? '', error: 'Invalid task schema' }
  }

  const persisted = insertSandboxQueueItem(db, {
    raw_input_hash: task.raw_input_hash,
    validated_capsule_json: JSON.stringify(task.validated_capsule),
    routing_reason: task.reason,
  })

  if (!persisted) {
    return { success: false, task_id: task.task_id, error: 'Failed to persist task (possible duplicate)' }
  }

  return { success: true, task_id: task.task_id }
}

export interface ConsumeResult {
  readonly processed: number;
  readonly results: readonly SandboxResult[];
  readonly rejected: number;
}

export async function consumeResults(db: any, batchSize: number = 50): Promise<ConsumeResult> {
  const items = listSandboxQueueItems(db, 'queued', batchSize)
  const results: SandboxResult[] = []
  let rejected = 0

  for (const item of items) {
    const task: SandboxTask = {
      task_id: `sandbox-${item.id}`,
      created_at: item.created_at,
      raw_input_hash: item.raw_input_hash,
      validated_capsule: JSON.parse(item.validated_capsule_json),
      reason: item.routing_reason as SandboxTask['reason'],
      constraints: {
        network: SANDBOX_CONSTANTS.DEFAULT_NETWORK,
        filesystem: SANDBOX_CONSTANTS.DEFAULT_FILESYSTEM,
        time_limit_ms: SANDBOX_CONSTANTS.DEFAULT_TIME_LIMIT_MS,
      },
    }

    let result: SandboxResult
    try {
      result = await activeProcessor(task)
    } catch {
      rejected++
      try { updateSandboxQueueStatus(db, item.id, 'failed') } catch { /* non-fatal */ }
      continue
    }

    if (!validateResult(result)) {
      rejected++
      try { updateSandboxQueueStatus(db, item.id, 'failed') } catch { /* non-fatal */ }
      continue
    }

    try {
      updateSandboxQueueStatus(db, item.id, 'processed')
      results.push(result)
    } catch {
      try { updateSandboxQueueStatus(db, item.id, 'failed') } catch { /* non-fatal */ }
      rejected++
    }
  }

  return { processed: results.length, results, rejected }
}
