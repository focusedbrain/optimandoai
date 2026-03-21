/**
 * Remote orchestrator mutation queue — separates **local** SQLite writes from **remote** execution.
 *
 * - Enqueue after successful local transitions (IPC handlers).
 * - Drain asynchronously in small batches; failures stay visible with retry backoff.
 * - Idempotency: UNIQUE(message_id, operation) collapses duplicate pending work for the **same** op;
 *   enqueueing a **new** op for a message first marks other pending/processing rows for that message
 *   as completed with `Superseded by newer classification` so reclassification does not double-move.
 * - Batch drain prefers **newest** queue rows first (`ORDER BY created_at DESC`) as a second line of defense.
 * - While a **Pull** is listing/fetching for an account (`syncPullLock`), rows for that `account_id` are left
 *   pending so the remote mirror cannot move messages out of INBOX between list and fetch.
 * - **`enqueueRemoteOpsForLocalLifecycleState`** compares `imap_remote_mailbox` to local lifecycle (configured
 *   names); skips enqueue when they already match; clears stale pending ops on reclassify / inbox reset.
 * - **`enqueueFullRemoteSync` / `enqueueFullRemoteSyncForAccountsTouchingMessages`** scan account(s) and
 *   enqueue any lifecycle mismatch (see IPC `inbox:fullRemoteSync*`).
 * - ON CONFLICT(message_id, operation): refreshes payload, resets to pending (unless row is mid-flight
 *   `processing`), clears attempts/last_error — compatible with supersede (other ops are already closed).
 */

import { randomUUID } from 'crypto'
import type { OrchestratorRemoteOperation } from './domain/orchestratorRemoteTypes'
import type { ResolvedOrchestratorRemoteNames } from './domain/mailboxLifecycleMapping'
import { resolveOrchestratorRemoteNames } from './domain/mailboxLifecycleMapping'
import { emailGateway } from './gateway'
import { isPullActive } from './syncPullLock'

const MAX_ATTEMPTS = 8
const BATCH = 20
/** Light throttle between remote moves (Graph mail ~4 rps for delegated tokens). */
const INTER_REMOTE_OP_DELAY_MS = 220

/** Coarse bucket for comparing `imap_remote_mailbox` to local lifecycle columns. */
type RemoteLifecycleBucket = 'inbox' | 'archive' | 'pending_delete' | 'pending_review' | 'unknown'

function localRowToExpectedBucket(row: {
  archived?: number | null
  pending_delete?: number | null
  sort_category?: string | null
  pending_review_at?: unknown
}): RemoteLifecycleBucket {
  if (row.archived === 1) return 'archive'
  if (row.pending_delete === 1) return 'pending_delete'
  if (
    row.sort_category === 'pending_review' ||
    (row.pending_review_at != null && String(row.pending_review_at).trim() !== '')
  ) {
    return 'pending_review'
  }
  return 'inbox'
}

/**
 * Map persisted `imap_remote_mailbox` (IMAP path or label-ish string) to a lifecycle bucket using
 * configured names — avoids enqueueing when remote already matches local.
 */
function observedRemoteBucketFromImapColumn(
  path: string | null | undefined,
  names: ResolvedOrchestratorRemoteNames,
): RemoteLifecycleBucket {
  const s = (path || '').trim().toLowerCase()
  if (!s || s === 'inbox') return 'inbox'

  const a = names.imap.archiveMailbox.trim().toLowerCase()
  const pd = names.imap.pendingDeleteMailbox.trim().toLowerCase()
  const pr = names.imap.pendingReviewMailbox.trim().toLowerCase()
  const gPd = names.gmail.pendingDeleteLabel.trim().toLowerCase()
  const gPr = names.gmail.pendingReviewLabel.trim().toLowerCase()
  const oPd = names.outlook.pendingDeleteFolder.trim().toLowerCase()
  const oPr = names.outlook.pendingReviewFolder.trim().toLowerCase()

  if (a && s.includes(a)) return 'archive'
  if (pd && s.includes(pd)) return 'pending_delete'
  if (pr && s.includes(pr)) return 'pending_review'
  if (gPd && s.includes(gPd)) return 'pending_delete'
  if (gPr && s.includes(gPr)) return 'pending_review'
  if (oPd && s.includes(oPd)) return 'pending_delete'
  if (oPr && s.includes(oPr)) return 'pending_review'

  return 'unknown'
}

function bucketToTargetOp(b: RemoteLifecycleBucket): OrchestratorRemoteOperation | null {
  if (b === 'archive') return 'archive'
  if (b === 'pending_delete') return 'pending_delete'
  if (b === 'pending_review') return 'pending_review'
  return null
}

type ClearStaleStmts = {
  withKeep: { run: (lastError: string, nowIso: string, messageId: string, keepOperation: OrchestratorRemoteOperation) => void }
  allLifecycle: { run: (lastError: string, nowIso: string, messageId: string) => void }
}

/** Prepared clears for pending/processing rows that no longer apply (reclassify or remote already correct). */
function prepareClearStaleLifecycleQueueOps(db: any): ClearStaleStmts {
  return {
    withKeep: db.prepare(
      `UPDATE remote_orchestrator_mutation_queue
       SET status = 'completed', last_error = ?, updated_at = ?
       WHERE message_id = ? AND operation != ? AND status IN ('pending', 'processing')`,
    ),
    allLifecycle: db.prepare(
      `UPDATE remote_orchestrator_mutation_queue
       SET status = 'completed', last_error = ?, updated_at = ?
       WHERE message_id = ? AND operation IN ('archive', 'pending_delete', 'pending_review')
         AND status IN ('pending', 'processing')`,
    ),
  }
}

function clearStaleLifecycleQueueOpsExcept(
  stmts: ClearStaleStmts,
  messageId: string,
  keepOperation: OrchestratorRemoteOperation | null,
  lastError: string,
  nowIso: string,
): void {
  if (keepOperation) {
    stmts.withKeep.run(lastError, nowIso, messageId, keepOperation)
  } else {
    stmts.allLifecycle.run(lastError, nowIso, messageId)
  }
}

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

  const supersedeOtherPendingOps = db.prepare(`
    UPDATE remote_orchestrator_mutation_queue
    SET status = 'completed',
        last_error = 'Superseded by newer classification',
        updated_at = ?
    WHERE message_id = ? AND operation != ? AND status IN ('pending', 'processing')
  `)

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
      supersedeOtherPendingOps.run(now, mid, operation)
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
  /** Rows not touched because a Pull was active for that account (remain `pending` for a later batch). */
  deferredDueToPull?: number
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
    deferredDueToPull: 0,
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
    ORDER BY q.created_at DESC
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

  for (let idx = 0; idx < rows.length; idx++) {
    const r = rows[idx]
    if (isPullActive(r.account_id)) {
      result.deferredDueToPull += 1
      continue
    }
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
    if (idx < rows.length - 1 && INTER_REMOTE_OP_DELAY_MS > 0) {
      await new Promise((res) => setTimeout(res, INTER_REMOTE_OP_DELAY_MS))
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
 *
 * Skips enqueue when `imap_remote_mailbox` already matches the expected bucket (configured names).
 * Cancels other pending/processing queue rows for that message when remote already matches or local is inbox.
 */
export function enqueueRemoteOpsForLocalLifecycleState(db: any, messageIds: string[]): EnqueueOrchestratorRemoteResult {
  let enqueued = 0
  let skipped = 0
  if (!db || !messageIds?.length) return { enqueued, skipped }

  const select = db.prepare(
    `SELECT id, account_id, email_message_id, archived, pending_delete, sort_category, pending_review_at,
            imap_remote_mailbox, source_type
     FROM inbox_messages WHERE id = ?`,
  ) as { get: (id: string) => any }

  const nowIso = new Date().toISOString()
  const clearStmts = prepareClearStaleLifecycleQueueOps(db)
  const archiveIds: string[] = []
  const pendingDeleteIds: string[] = []
  const pendingReviewIds: string[] = []

  for (const mid of messageIds) {
    const row = select.get(mid)
    if (!row) {
      skipped++
      continue
    }
    if (row.source_type !== 'email_plain' && row.source_type !== 'email_beap') {
      skipped++
      continue
    }
    if (!row.email_message_id || !row.account_id) {
      skipped++
      continue
    }

    let names: ResolvedOrchestratorRemoteNames
    try {
      const cfg = emailGateway.getAccountConfig(row.account_id)
      if (!cfg) {
        skipped++
        continue
      }
      names = resolveOrchestratorRemoteNames(cfg)
    } catch {
      skipped++
      continue
    }

    const expected = localRowToExpectedBucket(row)
    const observed = observedRemoteBucketFromImapColumn(row.imap_remote_mailbox, names)

    if (expected === 'inbox') {
      clearStaleLifecycleQueueOpsExcept(
        clearStmts,
        mid,
        null,
        'Superseded: local state is inbox — clearing lifecycle queue rows',
        nowIso,
      )
      skipped++
      continue
    }

    const targetOp = bucketToTargetOp(expected)
    if (!targetOp) {
      skipped++
      continue
    }

    if (observed === expected) {
      clearStaleLifecycleQueueOpsExcept(
        clearStmts,
        mid,
        targetOp,
        'Superseded: remote mailbox already matches local lifecycle',
        nowIso,
      )
      skipped++
      continue
    }

    if (expected === 'archive') archiveIds.push(mid)
    else if (expected === 'pending_delete') pendingDeleteIds.push(mid)
    else pendingReviewIds.push(mid)
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

export interface EnqueueFullRemoteSyncResult {
  enqueued: number
  skipped: number
  /** Local inbox but `imap_remote_mailbox` looks like a lifecycle folder — no `restore_inbox` op yet. */
  inboxRestoreNeeded: number
}

/**
 * For one account: enqueue lifecycle mirror ops for every email row where local lifecycle ≠ observed `imap_remote_mailbox`.
 */
export function enqueueFullRemoteSync(db: any, accountId: string): EnqueueFullRemoteSyncResult {
  const out: EnqueueFullRemoteSyncResult = { enqueued: 0, skipped: 0, inboxRestoreNeeded: 0 }
  if (!db || !accountId?.trim()) return out

  let names: ResolvedOrchestratorRemoteNames
  try {
    const cfg = emailGateway.getAccountConfig(accountId.trim())
    if (!cfg) return out
    names = resolveOrchestratorRemoteNames(cfg)
  } catch {
    return out
  }

  const rows = db
    .prepare(
      `SELECT id, archived, pending_delete, sort_category, pending_review_at, imap_remote_mailbox, source_type, email_message_id
       FROM inbox_messages WHERE account_id = ?`,
    )
    .all(accountId.trim()) as Array<Record<string, unknown>>

  const lifecycleIds: string[] = []
  for (const row of rows) {
    if (row.source_type !== 'email_plain' && row.source_type !== 'email_beap') continue
    if (!row.email_message_id) continue
    const id = String(row.id)
    const expected = localRowToExpectedBucket(row as any)
    const observed = observedRemoteBucketFromImapColumn((row.imap_remote_mailbox as string) ?? null, names)

    if (expected === observed) continue
    if (expected === 'inbox' && (observed === 'inbox' || observed === 'unknown')) continue

    if (expected === 'inbox' && observed !== 'inbox' && observed !== 'unknown') {
      out.inboxRestoreNeeded += 1
      continue
    }

    if (expected !== 'inbox') {
      lifecycleIds.push(id)
    }
  }

  if (lifecycleIds.length === 0) return out
  const r = enqueueRemoteOpsForLocalLifecycleState(db, [...new Set(lifecycleIds)])
  out.enqueued += r.enqueued
  out.skipped += r.skipped
  return out
}

/** Run {@link enqueueFullRemoteSync} once per distinct `account_id` among the given message rows. */
export function enqueueFullRemoteSyncForAccountsTouchingMessages(
  db: any,
  messageIds: string[],
): EnqueueFullRemoteSyncResult {
  const agg: EnqueueFullRemoteSyncResult = { enqueued: 0, skipped: 0, inboxRestoreNeeded: 0 }
  if (!db || !messageIds?.length) return agg
  const uniq = [...new Set(messageIds.filter((x) => typeof x === 'string' && x.trim()))]
  if (uniq.length === 0) return agg

  const placeholders = uniq.map(() => '?').join(',')
  const rows = db
    .prepare(`SELECT DISTINCT account_id FROM inbox_messages WHERE id IN (${placeholders})`)
    .all(...uniq) as Array<{ account_id: string | null }>

  for (const r of rows) {
    if (!r.account_id) continue
    const part = enqueueFullRemoteSync(db, r.account_id)
    agg.enqueued += part.enqueued
    agg.skipped += part.skipped
    agg.inboxRestoreNeeded += part.inboxRestoreNeeded
  }
  return agg
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

    if (r.processed === 0 && r.pendingRemaining >= before && (r.deferredDueToPull ?? 0) === 0) {
      /* Nothing dequeued (e.g. all stuck) — avoid spinning */
      break
    }

    /* Pull lock: batch had no remote work but rows remain — avoid tight loop while sync holds the lock */
    if ((r.deferredDueToPull ?? 0) > 0 && r.processed === 0 && r.failed === 0) {
      await new Promise((res) => setTimeout(res, 250))
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
 * When many parallel IPC handlers call `scheduleOrchestratorRemoteDrain` while a chain is already
 * queued, we must not drop the request — otherwise the first drain can run on an empty queue (race
 * with parallel `aiClassifySingle`) and never reschedule after later enqueues.
 */
let drainRescheduleRequested = false

/**
 * Schedule asynchronous drain (non-blocking). Safe to call after every local transition.
 */
export function scheduleOrchestratorRemoteDrain(getDb: () => Promise<any> | any): void {
  if (drainChainScheduled) {
    drainRescheduleRequested = true
    return
  }
  drainChainScheduled = true
  setImmediate(async () => {
    drainChainScheduled = false
    try {
      const db = await getDb()
      if (!db) {
        if (drainRescheduleRequested) {
          drainRescheduleRequested = false
          scheduleOrchestratorRemoteDrain(getDb)
        }
        return
      }
      const batch = await processOrchestratorRemoteQueueBatch(db, BATCH)
      const continueChain = batch.pendingRemaining > 0 || batch.processed > 0 || drainRescheduleRequested
      if (continueChain) {
        drainRescheduleRequested = false
        const deferOnly =
          batch.processed === 0 &&
          batch.failed === 0 &&
          (batch.deferredDueToPull ?? 0) > 0 &&
          batch.pendingRemaining > 0
        if (deferOnly) {
          setTimeout(() => scheduleOrchestratorRemoteDrain(getDb), 250)
        } else {
          scheduleOrchestratorRemoteDrain(getDb)
        }
      }
    } catch (e) {
      console.error('[OrchestratorRemote] drain error:', e)
      drainRescheduleRequested = false
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
