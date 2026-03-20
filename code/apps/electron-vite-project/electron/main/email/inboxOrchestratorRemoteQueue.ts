/**
 * Remote orchestrator mutation queue — separates **local** SQLite writes from **remote** execution.
 *
 * - Enqueue after successful local transitions (IPC handlers).
 * - Drain asynchronously in small batches; failures stay visible with retry backoff.
 * - Idempotency: UNIQUE(message_id, operation) collapses duplicate pending work;
 *   providers implement additional server-side idempotency where APIs allow.
 */

import { randomUUID } from 'crypto'
import type { OrchestratorRemoteOperation } from './domain/orchestratorRemoteTypes'
import { emailGateway } from './gateway'

const MAX_ATTEMPTS = 8
const BATCH = 20

export interface EnqueueOrchestratorRemoteResult {
  enqueued: number
  skipped: number
}

/**
 * Enqueue remote mutations for email-backed inbox rows only.
 */
export function enqueueOrchestratorRemoteMutations(
  db: any,
  messageIds: string[],
  operation: OrchestratorRemoteOperation,
): EnqueueOrchestratorRemoteResult {
  let enqueued = 0
  let skipped = 0
  if (!db || !messageIds?.length) return { enqueued, skipped }

  const select = db.prepare(
    `SELECT id, account_id, email_message_id, source_type FROM inbox_messages WHERE id = ?`,
  ) as { get: (id: string) => any }

  const upsert = db.prepare(`
    INSERT INTO remote_orchestrator_mutation_queue (
      id, message_id, account_id, email_message_id, provider_type, operation,
      status, attempts, last_error, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, NULL, ?, ?)
    ON CONFLICT(message_id, operation) DO UPDATE SET
      account_id = excluded.account_id,
      email_message_id = excluded.email_message_id,
      provider_type = excluded.provider_type,
      status = CASE
        WHEN remote_orchestrator_mutation_queue.status = 'processing'
        THEN remote_orchestrator_mutation_queue.status
        ELSE 'pending'
      END,
      attempts = CASE
        WHEN remote_orchestrator_mutation_queue.status = 'processing'
        THEN remote_orchestrator_mutation_queue.attempts
        ELSE 0
      END,
      last_error = CASE
        WHEN remote_orchestrator_mutation_queue.status = 'processing'
        THEN remote_orchestrator_mutation_queue.last_error
        ELSE NULL
      END,
      updated_at = excluded.updated_at
  `)

  const now = new Date().toISOString()

  for (const mid of messageIds) {
    const row = select.get(mid)
    if (!row?.account_id || !row?.email_message_id) {
      skipped++
      continue
    }
    if (row.source_type !== 'email_plain' && row.source_type !== 'email_beap') {
      skipped++
      continue
    }

    let providerType: string
    try {
      providerType = emailGateway.getProviderSync(row.account_id)
    } catch {
      skipped++
      continue
    }

    try {
      upsert.run(
        randomUUID(),
        mid,
        row.account_id,
        row.email_message_id,
        providerType,
        operation,
        now,
        now,
      )
      enqueued++
    } catch (e: any) {
      console.error('[OrchestratorRemote] enqueue upsert failed:', e?.message)
      skipped++
    }
  }

  return { enqueued, skipped }
}

export interface ProcessOrchestratorRemoteBatchResult {
  processed: number
  failed: number
  pendingRemaining: number
}

/**
 * Process up to `limit` queue rows (pending or retryable failed).
 */
export async function processOrchestratorRemoteQueueBatch(
  db: any,
  limit: number = BATCH,
): Promise<ProcessOrchestratorRemoteBatchResult> {
  const result: ProcessOrchestratorRemoteBatchResult = {
    processed: 0,
    failed: 0,
    pendingRemaining: 0,
  }
  if (!db) return result

  const pendingCount = db
    .prepare(
      `SELECT COUNT(*) as c FROM remote_orchestrator_mutation_queue WHERE status = 'pending'`,
    )
    .get() as { c: number }
  result.pendingRemaining = pendingCount?.c ?? 0

  /* Unstick rows left in processing (e.g. crash mid-flight). Compare ISO timestamps in JS for reliability. */
  const stuckCutoffIso = new Date(Date.now() - 20 * 60 * 1000).toISOString()
  const resetStuckAt = new Date().toISOString()
  db.prepare(
    `UPDATE remote_orchestrator_mutation_queue SET status = 'pending', updated_at = ?
     WHERE status = 'processing' AND updated_at < ?`,
  ).run(resetStuckAt, stuckCutoffIso)

  const pick = db.prepare(`
    SELECT id, message_id, account_id, email_message_id, operation, attempts
    FROM remote_orchestrator_mutation_queue
    WHERE status = 'pending' AND attempts < ?
    ORDER BY updated_at ASC
    LIMIT ?
  `)

  const markProcessing = db.prepare(
    `UPDATE remote_orchestrator_mutation_queue SET status = 'processing', updated_at = ? WHERE id = ?`,
  )
  const markCompleted = db.prepare(`
    UPDATE remote_orchestrator_mutation_queue SET status = 'completed', last_error = NULL, updated_at = ? WHERE id = ?
  `)
  const markFailed = db.prepare(`
    UPDATE remote_orchestrator_mutation_queue SET status = 'failed', attempts = ?, last_error = ?, updated_at = ? WHERE id = ?
  `)
  const touchMessageError = db.prepare(
    `UPDATE inbox_messages SET remote_orchestrator_last_error = ? WHERE id = ?`,
  )

  const rows = pick.all(MAX_ATTEMPTS, limit) as Array<{
    id: string
    message_id: string
    account_id: string
    email_message_id: string
    operation: OrchestratorRemoteOperation
    attempts: number
  }>

  const now = () => new Date().toISOString()

  for (const r of rows) {
    markProcessing.run(now(), r.id)
    try {
      const apply = await emailGateway.applyOrchestratorRemoteOperation(
        r.account_id,
        r.email_message_id,
        r.operation,
      )
      if (apply.ok) {
        markCompleted.run(now(), r.id)
        touchMessageError.run(null, r.message_id)
        result.processed++
      } else {
        const err = (apply.error || 'Remote mutation failed').slice(0, 2000)
        /* Permanent local state: do not burn MAX_ATTEMPTS on removed accounts. */
        const terminal =
          /account not found/i.test(err) || /does not implement remote orchestrator/i.test(err)
        const nextAttempts = terminal ? MAX_ATTEMPTS : (r.attempts ?? 0) + 1
        if (nextAttempts >= MAX_ATTEMPTS) {
          markFailed.run(nextAttempts, err, now(), r.id)
          touchMessageError.run(`[${r.operation}] ${err}`, r.message_id)
        } else {
          db.prepare(
            `UPDATE remote_orchestrator_mutation_queue SET status = 'pending', attempts = ?, last_error = ?, updated_at = ? WHERE id = ?`,
          ).run(nextAttempts, err, now(), r.id)
          touchMessageError.run(`[${r.operation}] ${err} (retry ${nextAttempts}/${MAX_ATTEMPTS})`, r.message_id)
        }
        result.failed++
      }
    } catch (e: any) {
      const nextAttempts = (r.attempts ?? 0) + 1
      const err = (e?.message || String(e)).slice(0, 2000)
      if (nextAttempts >= MAX_ATTEMPTS) {
        markFailed.run(nextAttempts, err, now(), r.id)
        touchMessageError.run(`[${r.operation}] ${err}`, r.message_id)
      } else {
        db.prepare(
          `UPDATE remote_orchestrator_mutation_queue SET status = 'pending', attempts = ?, last_error = ?, updated_at = ? WHERE id = ?`,
        ).run(nextAttempts, err, now(), r.id)
        touchMessageError.run(`[${r.operation}] ${err} (retry ${nextAttempts}/${MAX_ATTEMPTS})`, r.message_id)
      }
      result.failed++
    }
  }

  const after = db
    .prepare(
      `SELECT COUNT(*) as c FROM remote_orchestrator_mutation_queue WHERE status = 'pending'`,
    )
    .get() as { c: number }
  result.pendingRemaining = after?.c ?? 0

  return result
}

let drainChainScheduled = false

/**
 * Schedule asynchronous drain (non-blocking). Safe to call after every local transition.
 */
export function scheduleOrchestratorRemoteDrain(getDb: () => Promise<any> | any): void {
  if (drainChainScheduled) return
  drainChainScheduled = true
  setImmediate(async () => {
    drainChainScheduled = false
    try {
      const db = await getDb()
      if (!db) return
      const batch = await processOrchestratorRemoteQueueBatch(db, BATCH)
      if (batch.pendingRemaining > 0 || batch.processed > 0) {
        scheduleOrchestratorRemoteDrain(getDb)
      }
    } catch (e) {
      console.error('[OrchestratorRemote] drain error:', e)
      /* Best-effort: retry later so a transient DB/gateway failure does not strand the queue until the next lifecycle tick. */
      setTimeout(() => {
        try {
          scheduleOrchestratorRemoteDrain(getDb)
        } catch {
          /* ignore */
        }
      }, 15_000)
    }
  })
}

/**
 * Diagnostics for settings / support UI (optional).
 */
export function listRemoteOrchestratorQueueRows(db: any, limit: number = 50): any[] {
  if (!db) return []
  return db
    .prepare(
      `SELECT id, message_id, operation, status, attempts, last_error, created_at, updated_at
       FROM remote_orchestrator_mutation_queue
       ORDER BY updated_at DESC
       LIMIT ?`,
    )
    .all(limit)
}
