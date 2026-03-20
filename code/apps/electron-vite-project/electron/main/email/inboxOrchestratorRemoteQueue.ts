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
    SELECT q.id, q.message_id, q.account_id, q.email_message_id, q.operation, q.attempts,
           m.imap_remote_mailbox, m.imap_rfc_message_id
    FROM remote_orchestrator_mutation_queue q
    LEFT JOIN inbox_messages m ON m.id = q.message_id
    WHERE q.status = 'pending' AND q.attempts < ?
    ORDER BY q.updated_at ASC
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
    imap_remote_mailbox?: string | null
    imap_rfc_message_id?: string | null
  }>

  const now = () => new Date().toISOString()

  for (const r of rows) {
    markProcessing.run(now(), r.id)
    try {
      const apply = await emailGateway.applyOrchestratorRemoteOperation(
        r.account_id,
        r.email_message_id,
        r.operation,
        {
          imapRemoteMailbox: r.imap_remote_mailbox ?? null,
          imapRfcMessageId: r.imap_rfc_message_id ?? null,
        },
      )
      if (apply.ok) {
        markCompleted.run(now(), r.id)
        touchMessageError.run(null, r.message_id)
        if (apply.imapUidAfterMove != null && apply.imapMailboxAfterMove != null) {
          try {
            db.prepare(
              `UPDATE inbox_messages SET email_message_id = ?, imap_remote_mailbox = ? WHERE id = ?`,
            ).run(apply.imapUidAfterMove, apply.imapMailboxAfterMove, r.message_id)
          } catch (persistErr: any) {
            console.warn('[OrchestratorRemote] persist IMAP uid/mailbox failed:', persistErr?.message)
          }
        }
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

/**
 * Enqueue remote mirror ops from current local lifecycle columns (authoritative orchestrator state).
 * Priority per row: archived → pending_delete → pending_review (sort_category).
 */
export function enqueueRemoteOpsForLocalLifecycleState(db: any, messageIds: string[]): EnqueueOrchestratorRemoteResult {
  let enqueued = 0
  let skipped = 0
  if (!db || !messageIds?.length) return { enqueued, skipped }

  const select = db.prepare(
    `SELECT id, archived, pending_delete, sort_category FROM inbox_messages WHERE id = ?`,
  ) as { get: (id: string) => any }

  const archiveIds: string[] = []
  const pendingDeleteIds: string[] = []
  const pendingReviewIds: string[] = []

  for (const mid of messageIds) {
    const row = select.get(mid)
    if (!row) {
      skipped++
      continue
    }
    if (row.archived === 1) archiveIds.push(mid)
    else if (row.pending_delete === 1) pendingDeleteIds.push(mid)
    else if (row.sort_category === 'pending_review') pendingReviewIds.push(mid)
  }

  if (archiveIds.length) {
    const r = enqueueOrchestratorRemoteMutations(db, archiveIds, 'archive')
    enqueued += r.enqueued
    skipped += r.skipped
  }
  if (pendingDeleteIds.length) {
    const r = enqueueOrchestratorRemoteMutations(db, pendingDeleteIds, 'pending_delete')
    enqueued += r.enqueued
    skipped += r.skipped
  }
  if (pendingReviewIds.length) {
    const r = enqueueOrchestratorRemoteMutations(db, pendingReviewIds, 'pending_review')
    enqueued += r.enqueued
    skipped += r.skipped
  }

  return { enqueued, skipped }
}

export interface DrainOrchestratorRemoteBoundedResult {
  processedTotal: number
  pendingRemaining: number
  timedOut: boolean
}

/**
 * Process pending remote queue rows in batches until empty, or time/batch budget exhausted.
 * Use after Pull / auto-sync so mailbox moves run before IPC returns (bounded — does not hang forever).
 */
export async function drainOrchestratorRemoteQueueBounded(
  db: any,
  options?: { maxMs?: number; maxBatches?: number },
): Promise<DrainOrchestratorRemoteBoundedResult> {
  const maxMs = options?.maxMs ?? 28_000
  const maxBatches = options?.maxBatches ?? 150
  const start = Date.now()
  let processedTotal = 0
  let batches = 0
  let timedOut = false

  const countPending = (): number => {
    const row = db
      .prepare(`SELECT COUNT(*) as c FROM remote_orchestrator_mutation_queue WHERE status = 'pending'`)
      .get() as { c: number } | undefined
    return row?.c ?? 0
  }

  while (batches < maxBatches) {
    if (Date.now() - start > maxMs) {
      timedOut = true
      break
    }
    const pending = countPending()
    if (pending === 0) break

    const before = pending
    const r = await processOrchestratorRemoteQueueBatch(db, BATCH)
    processedTotal += r.processed
    batches++

    if (r.processed === 0 && r.pendingRemaining >= before) {
      /* Nothing dequeued (e.g. all stuck) — avoid spinning */
      break
    }
  }

  const pendingRemaining = countPending()
  if (timedOut && pendingRemaining > 0) {
    console.warn(
      `[OrchestratorRemote] Bounded drain stopped (timeout): ${pendingRemaining} pending — background drain will continue`,
    )
  }

  return { processedTotal, pendingRemaining, timedOut }
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
