/**
 * Sandbox Stub Consumer
 *
 * Reads queued items from sandbox_queue, marks them as processed.
 * Does NOT execute host code, escalate trust, or produce real results.
 * This is a placeholder for the future sandbox sub-orchestrator.
 */

import {
  listSandboxQueueItems,
  updateSandboxQueueStatus,
} from './persistenceDb'

export interface SandboxStubResult {
  readonly processed: number;
  readonly failed: number;
}

export function processSandboxQueue(db: any, batchSize: number = 50): SandboxStubResult {
  const items = listSandboxQueueItems(db, 'queued', batchSize)
  let processed = 0
  let failed = 0

  for (const item of items) {
    try {
      updateSandboxQueueStatus(db, item.id, 'processed')
      processed++
    } catch {
      try {
        updateSandboxQueueStatus(db, item.id, 'failed')
      } catch { /* ignore */ }
      failed++
    }
  }

  return { processed, failed }
}
