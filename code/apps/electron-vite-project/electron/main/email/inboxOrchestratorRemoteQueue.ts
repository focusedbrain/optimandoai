/**
 * Remote orchestrator mutation queue — separates **local** SQLite writes from **remote** execution.
 *
 * - Enqueue after successful local transitions (IPC handlers).
 * - Drain asynchronously in batches (default **50** rows); **parallel per `account_id`** with per-provider
 *   spacing (IMAP **50ms**, Gmail/Graph **200ms** between ops on the same account). Failures stay visible with retry backoff.
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
import type {
  OrchestratorRemoteApplyResult,
  OrchestratorRemoteOperation,
} from './domain/orchestratorRemoteTypes'
import type { ResolvedOrchestratorRemoteNames } from './domain/mailboxLifecycleMapping'
import { resolveOrchestratorRemoteNames } from './domain/mailboxLifecycleMapping'
import { emailGateway } from './gateway'
import { isPullActive } from './syncPullLock'

const MAX_ATTEMPTS = 8
/** Default rows per drain batch (see `processOrchestratorRemoteQueueBatch`). */
export const BATCH = 50
/** Prevent a hung IMAP/socket from leaving queue rows stuck in `processing` indefinitely. */
const MOVE_TIMEOUT_MS = 30_000

/** Immediate terminal failure — do not burn retries on dead sessions / bad credentials. */
function isNonRetryableOrchestratorAuthOrConnectionError(message: string): boolean {
  const m = message.toLowerCase()
  return (
    m.includes('not connected') ||
    m.includes('not authenticated') ||
    m.includes('authentication failed') ||
    m.includes('auth failed') ||
    m.includes('invalid credentials') ||
    m.includes('login failed') ||
    m.includes('bad credentials') ||
    m.includes('unauthorized') ||
    m.includes('reconnect required') ||
    m.includes('session not connected') ||
    m.includes('account not found') ||
    m.includes('handshake timed out') ||
    m.includes('disconnected or removed')
  )
}
/** Throttle between remote moves on the **same** account (parallel across different accounts). */
function interRemoteOpDelayMs(providerType: string | null | undefined): number {
  const p = String(providerType ?? '').toLowerCase()
  if (p === 'imap') return 50
  if (p === 'microsoft365') return 200
  if (p === 'gmail') return 200
  return 100
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Coarse bucket for comparing `imap_remote_mailbox` to local lifecycle columns. */
type RemoteLifecycleBucket = 'inbox' | 'archive' | 'pending_delete' | 'pending_review' | 'urgent'

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
  const cat = (row.sort_category ?? '').trim()
  if (cat === 'urgent') return 'urgent'
  if (cat === 'important') return 'pending_review'
  if (cat === 'newsletter' || cat === 'normal') return 'archive'
  if (cat !== '') return 'archive'
  return 'inbox'
}

/** Human-readable skip line for debug UI / IPC (lifecycle enqueue). */
function formatLifecycleSkipReason(
  mid: string,
  reason: string,
  row: { imap_remote_mailbox?: unknown } | null | undefined,
  expected?: RemoteLifecycleBucket,
  observed?: RemoteLifecycleBucket,
): string {
  const exp = expected ?? 'n/a'
  const obs = observed ?? 'n/a'
  const mb =
    row == null
      ? 'no_row'
      : row.imap_remote_mailbox != null && String(row.imap_remote_mailbox).trim() !== ''
        ? String(row.imap_remote_mailbox)
        : 'null'
  return `${mid}: ${reason} (expected=${exp}, observed=${obs}, imap_remote_mailbox=${mb})`
}

/**
 * Map persisted `imap_remote_mailbox` (IMAP mailbox path or label/folder display string) to a lifecycle bucket.
 * Uses **case-insensitive exact equality** only (no substring / includes) so values like `INBOX` never falsely
 * match configured names such as `Archive`. Unrecognized paths → `inbox` (treat as not yet in a lifecycle folder).
 */
function observedRemoteBucketFromImapColumn(
  path: string | null | undefined,
  names: ResolvedOrchestratorRemoteNames,
): RemoteLifecycleBucket {
  const raw = (path ?? '').trim()
  if (!raw) return 'inbox'
  const s = raw.toLowerCase()
  if (s === 'inbox') return 'inbox'

  const norm = (x: string) => x.trim().toLowerCase()
  const a = norm(names.imap.archiveMailbox)
  const pd = norm(names.imap.pendingDeleteMailbox)
  const pr = norm(names.imap.pendingReviewMailbox)
  const u = norm(names.imap.urgentMailbox)
  const gPd = norm(names.gmail.pendingDeleteLabel)
  const gPr = norm(names.gmail.pendingReviewLabel)
  const gU = norm(names.gmail.urgentLabel)
  const oPd = norm(names.outlook.pendingDeleteFolder)
  const oPr = norm(names.outlook.pendingReviewFolder)
  const oU = norm(names.outlook.urgentFolder)

  if (a && s === a) return 'archive'
  if (pd && s === pd) return 'pending_delete'
  if (pr && s === pr) return 'pending_review'
  if (u && s === u) return 'urgent'
  if (gPd && s === gPd) return 'pending_delete'
  if (gPr && s === gPr) return 'pending_review'
  if (gU && s === gU) return 'urgent'
  if (oPd && s === oPd) return 'pending_delete'
  if (oPr && s === oPr) return 'pending_review'
  if (oU && s === oU) return 'urgent'

  return 'inbox'
}

function bucketToTargetOp(b: RemoteLifecycleBucket): OrchestratorRemoteOperation | null {
  if (b === 'archive') return 'archive'
  if (b === 'pending_delete') return 'pending_delete'
  if (b === 'pending_review') return 'pending_review'
  if (b === 'urgent') return 'urgent'
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
       WHERE message_id = ? AND operation IN ('archive', 'pending_delete', 'pending_review', 'urgent')
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
  /** One entry per skipped message (lifecycle rules or mutation pre-checks). */
  skipReasons: string[]
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
  const skipReasons: string[] = []
  if (!db || !messageIds?.length) return { enqueued, skipped, skipReasons }

  console.log('[ENQUEUE_MUT] Called:', messageIds.length, 'ids, op=', operation)

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
    if (!row) {
      console.log('[ENQUEUE_MUT] SKIP:', mid, 'reason=no_row')
      skipReasons.push(`${mid}: no_row (op=${operation})`)
      skipped++
      continue
    }
    if (!row.account_id) {
      console.log('[ENQUEUE_MUT] SKIP:', mid, 'reason=no_account_id')
      skipReasons.push(`${mid}: no_account_id (op=${operation}, source_type=${row.source_type ?? 'n/a'})`)
      skipped++
      continue
    }
    if (!row.email_message_id) {
      console.log('[ENQUEUE_MUT] SKIP:', mid, 'reason=no_email_message_id')
      skipReasons.push(`${mid}: no_email_message_id (op=${operation})`)
      skipped++
      continue
    }
    if (row.source_type !== 'email_plain' && row.source_type !== 'email_beap') {
      console.log('[ENQUEUE_MUT] SKIP:', mid, 'reason=wrong_source_type')
      skipReasons.push(`${mid}: wrong_source_type (op=${operation}, source_type=${row.source_type ?? 'n/a'})`)
      skipped++
      continue
    }

    let providerType: string
    try {
      providerType = emailGateway.getProviderSync(row.account_id)
    } catch {
      console.log('[ENQUEUE_MUT] SKIP:', mid, 'reason=no_provider')
      skipReasons.push(`${mid}: no_provider (op=${operation}, account_id=${row.account_id})`)
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
      console.log(
        '[ENQUEUE_MUT] INSERTED:',
        mid,
        'provider=',
        providerType,
        'email_id=',
        row.email_message_id,
      )
      enqueued++
    } catch (e: any) {
      console.error('[OrchestratorRemote] enqueue upsert failed:', e?.message)
      console.log('[ENQUEUE_MUT] SKIP:', mid, 'reason=upsert_failed', 'err=', e?.message ?? e)
      skipReasons.push(`${mid}: upsert_failed (op=${operation}, err=${(e?.message || String(e)).slice(0, 200)})`)
      skipped++
    }
  }

  return { enqueued, skipped, skipReasons }
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

  /* Unstick rows left in processing (e.g. crash mid-flight, hung IMAP). Compare ISO timestamps in JS for reliability. */
  const stuckCutoffIso = new Date(Date.now() - 5 * 60 * 1000).toISOString()
  const resetStuckAt = new Date().toISOString()
  db.prepare(
    `UPDATE remote_orchestrator_mutation_queue SET status = 'pending', updated_at = ?
     WHERE status = 'processing' AND updated_at < ?`,
  ).run(resetStuckAt, stuckCutoffIso)

  const pick = db.prepare(`
    SELECT q.id, q.message_id, q.account_id, q.email_message_id, q.operation, q.attempts, q.provider_type,
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

  type OrchestratorQueueBatchRow = {
    id: string
    message_id: string
    account_id: string
    email_message_id: string
    operation: OrchestratorRemoteOperation
    attempts: number
    provider_type?: string | null
    imap_remote_mailbox?: string | null
    imap_rfc_message_id?: string | null
  }

  const rows = pick.all(MAX_ATTEMPTS, limit) as OrchestratorQueueBatchRow[]

  console.log(
    '[DRAIN_BATCH] Picked',
    rows.length,
    'rows from queue, pendingCount=',
    pendingCount?.c ?? 0,
  )

  const now = () => new Date().toISOString()
  /** Same-batch cache: fail remaining rows for an account without repeated connect attempts. */
  const precheckFailedByAccount = new Map<string, string>()

  const workRows: OrchestratorQueueBatchRow[] = []
  for (const r of rows) {
    const pullActive = isPullActive(r.account_id)
    console.log(
      '[DRAIN_BATCH] Row:',
      r.id,
      'account=',
      r.account_id,
      'op=',
      r.operation,
      'pullActive=',
      pullActive,
    )
    if (pullActive) {
      result.deferredDueToPull += 1
      console.log('[DRAIN_BATCH] DEFERRED (pull active):', r.id)
      continue
    }
    workRows.push(r)
  }

  const byAccount = new Map<string, OrchestratorQueueBatchRow[]>()
  for (const r of workRows) {
    const list = byAccount.get(r.account_id) ?? []
    list.push(r)
    byAccount.set(r.account_id, list)
  }

  console.log(
    '[DRAIN_BATCH] Parallel drain:',
    byAccount.size,
    'account(s),',
    workRows.length,
    'row(s) after pull deferral',
  )

  const processOneRow = async (r: OrchestratorQueueBatchRow): Promise<void> => {
    const cachedPrecheckErr = precheckFailedByAccount.get(r.account_id)
    if (cachedPrecheckErr) {
      console.warn('[DRAIN_BATCH] Same-batch precheck failure — failing row', r.id, 'account=', r.account_id)
      markFailed.run(MAX_ATTEMPTS, cachedPrecheckErr, now(), r.id)
      touchMessageError.run(`[${r.operation}] ${cachedPrecheckErr}`, r.message_id)
      result.failed++
      return
    }

    const pre = await emailGateway.ensureConnectedForOrchestratorOperation(r.account_id)
    if (!pre.ok) {
      const errMsg = (pre.error || 'Account authentication failed — reconnect required.').slice(0, 2000)
      precheckFailedByAccount.set(r.account_id, errMsg)
      console.warn('[DRAIN_BATCH] Precheck failed account=', r.account_id, errMsg)
      markFailed.run(MAX_ATTEMPTS, errMsg, now(), r.id)
      touchMessageError.run(`[${r.operation}] ${errMsg}`, r.message_id)
      try {
        const prov = emailGateway.getProviderSync(r.account_id)
        if (prov === 'imap') {
          await emailGateway.updateAccount(r.account_id, {
            status: 'error',
            lastError: errMsg.slice(0, 500) || 'IMAP session failed. Reconnect in Email settings.',
          })
        }
      } catch (persistErr: any) {
        console.warn('[OrchestratorRemote] Could not persist account error state:', persistErr?.message)
      }
      result.failed++
      return
    }

    markProcessing.run(now(), r.id)
    try {
      console.log(
        '[OrchestratorRemote] Execute:',
        r.operation,
        'msg=',
        r.message_id,
        'email_id=',
        r.email_message_id,
        'account=',
        r.account_id,
      )
      console.log(
        '[DRAIN_BATCH] Calling gateway.applyOrchestratorRemoteOperation:',
        r.account_id,
        r.email_message_id,
        r.operation,
      )
      const applyWithTimeout = Promise.race([
        emailGateway.applyOrchestratorRemoteOperation(
          r.account_id,
          r.email_message_id,
          r.operation,
          {
            imapRemoteMailbox: r.imap_remote_mailbox ?? null,
            imapRfcMessageId: r.imap_rfc_message_id ?? null,
          },
        ),
        new Promise<OrchestratorRemoteApplyResult>((_, reject) =>
          setTimeout(
            () => reject(new Error(`IMAP operation timed out after ${MOVE_TIMEOUT_MS / 1000}s`)),
            MOVE_TIMEOUT_MS,
          ),
        ),
      ])
      const apply = await applyWithTimeout
      const skippedPart = (apply as { skipped?: boolean }).skipped ? '(already there)' : ''
      console.log(
        '[DRAIN_BATCH] Result:',
        r.id,
        apply.ok ? 'OK' : 'FAIL',
        apply.error ?? '',
        skippedPart,
      )
      if (apply.ok) {
        console.log('[OrchestratorRemote] OK:', r.operation, r.message_id)
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
        console.log('[OrchestratorRemote] FAIL:', r.operation, r.message_id, apply.error)
        const authOrConnFail = isNonRetryableOrchestratorAuthOrConnectionError(err)
        if (authOrConnFail) {
          markFailed.run(MAX_ATTEMPTS, err, now(), r.id)
          touchMessageError.run(`[${r.operation}] ${err}`, r.message_id)
          console.warn('[OrchestratorRemote] Auth/connection failure for account', r.account_id, '— not retrying')
          try {
            if (emailGateway.getProviderSync(r.account_id) === 'imap') {
              await emailGateway.updateAccount(r.account_id, {
                status: 'error',
                lastError: err.slice(0, 500) || 'IMAP session failed. Reconnect in Email settings.',
              })
            }
          } catch (persistErr: any) {
            console.warn('[OrchestratorRemote] Could not persist account error state:', persistErr?.message)
          }
        } else {
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
        }
        result.failed++
      }
    } catch (e: any) {
      const err = (e?.message || String(e)).slice(0, 2000)
      console.log('[DRAIN_BATCH] Result:', r.id, 'FAIL', err, '')
      console.log('[OrchestratorRemote] FAIL:', r.operation, r.message_id, err)
      if (isNonRetryableOrchestratorAuthOrConnectionError(err)) {
        markFailed.run(MAX_ATTEMPTS, err, now(), r.id)
        touchMessageError.run(`[${r.operation}] ${err}`, r.message_id)
        console.warn('[OrchestratorRemote] Auth/connection failure for account', r.account_id, '— not retrying')
        try {
          if (emailGateway.getProviderSync(r.account_id) === 'imap') {
            await emailGateway.updateAccount(r.account_id, {
              status: 'error',
              lastError: err.slice(0, 500) || 'IMAP session failed. Reconnect in Email settings.',
            })
          }
        } catch (persistErr: any) {
          console.warn('[OrchestratorRemote] Could not persist account error state:', persistErr?.message)
        }
      } else {
        const nextAttempts = (r.attempts ?? 0) + 1
        if (nextAttempts >= MAX_ATTEMPTS) {
          markFailed.run(nextAttempts, err, now(), r.id)
          touchMessageError.run(`[${r.operation}] ${err}`, r.message_id)
        } else {
          db.prepare(
            `UPDATE remote_orchestrator_mutation_queue SET status = 'pending', attempts = ?, last_error = ?, updated_at = ? WHERE id = ?`,
          ).run(nextAttempts, err, now(), r.id)
          touchMessageError.run(`[${r.operation}] ${err} (retry ${nextAttempts}/${MAX_ATTEMPTS})`, r.message_id)
        }
      }
      result.failed++
    }
  }

  await Promise.allSettled(
    [...byAccount.entries()].map(async ([_accountId, accountRows]) => {
      for (let i = 0; i < accountRows.length; i++) {
        await processOneRow(accountRows[i])
        if (i < accountRows.length - 1) {
          const delayMs = interRemoteOpDelayMs(accountRows[i].provider_type)
          if (delayMs > 0) await sleepMs(delayMs)
        }
      }
    }),
  )

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
 * Priority per row: archived → pending_delete → pending_review (sort_category / pending_review_at) → urgent → other classified → archive.
 *
 * Skips enqueue when `imap_remote_mailbox` already matches the expected bucket (configured names).
 * Cancels other pending/processing queue rows for that message when remote already matches or local is inbox.
 */
export function enqueueRemoteOpsForLocalLifecycleState(db: any, messageIds: string[]): EnqueueOrchestratorRemoteResult {
  let enqueued = 0
  let skipped = 0
  const skipReasons: string[] = []
  if (!db || !messageIds?.length) return { enqueued, skipped, skipReasons }

  console.log('[ENQUEUE] Called with', messageIds.length, 'message ids')

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
  const urgentIds: string[] = []

  for (const mid of messageIds) {
    const row = select.get(mid)
    if (!row) {
      console.log('[ENQUEUE] SKIP:', mid, 'reason=no_row')
      skipReasons.push(formatLifecycleSkipReason(mid, 'no_row', undefined))
      skipped++
      continue
    }
    if (row.source_type !== 'email_plain' && row.source_type !== 'email_beap') {
      console.log('[ENQUEUE] SKIP:', mid, 'reason=wrong_source_type')
      skipReasons.push(
        `${mid}: wrong_source_type (expected=n/a, observed=n/a, imap_remote_mailbox=${row.imap_remote_mailbox ?? 'null'}, source_type=${row.source_type ?? 'null'})`,
      )
      skipped++
      continue
    }
    if (!row.account_id) {
      console.log('[ENQUEUE] SKIP:', mid, 'reason=no_account_id')
      skipReasons.push(formatLifecycleSkipReason(mid, 'no_account_id', row))
      skipped++
      continue
    }
    if (!row.email_message_id) {
      console.log('[ENQUEUE] SKIP:', mid, 'reason=no_email_message_id')
      skipReasons.push(formatLifecycleSkipReason(mid, 'no_email_message_id', row))
      skipped++
      continue
    }

    let names: ResolvedOrchestratorRemoteNames
    try {
      const cfg = emailGateway.getAccountConfig(row.account_id)
      if (!cfg) {
        console.log('[ENQUEUE] SKIP:', mid, 'reason=no_account_config')
        skipReasons.push(formatLifecycleSkipReason(mid, 'no_account_config', row))
        skipped++
        continue
      }
      names = resolveOrchestratorRemoteNames(cfg)
    } catch {
      console.log('[ENQUEUE] SKIP:', mid, 'reason=account_config_error')
      skipReasons.push(formatLifecycleSkipReason(mid, 'account_config_error', row))
      skipped++
      continue
    }

    const expected = localRowToExpectedBucket(row)
    const observed = observedRemoteBucketFromImapColumn(row.imap_remote_mailbox, names)

    if (expected === 'inbox') {
      console.log(
        '[ENQUEUE] SKIP:',
        mid,
        'reason=inbox_state',
        'expected=',
        expected,
        'observed=',
        observed,
        'imap_remote_mailbox=',
        row.imap_remote_mailbox,
      )
      skipReasons.push(formatLifecycleSkipReason(mid, 'inbox_state_local_not_lifecycle', row, expected, observed))
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
      console.log(
        '[ENQUEUE] SKIP:',
        mid,
        'reason=no_target_op',
        'expected=',
        expected,
        'observed=',
        observed,
        'imap_remote_mailbox=',
        row.imap_remote_mailbox,
      )
      skipReasons.push(formatLifecycleSkipReason(mid, 'no_target_op', row, expected, observed))
      skipped++
      continue
    }

    if (observed === expected) {
      console.log(
        '[ENQUEUE] SKIP:',
        mid,
        'reason=already_matches',
        'expected=',
        expected,
        'observed=',
        observed,
        'imap_remote_mailbox=',
        row.imap_remote_mailbox,
      )
      skipReasons.push(formatLifecycleSkipReason(mid, 'already_matches_remote', row, expected, observed))
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

    console.log('[ENQUEUE] QUEUE:', mid, 'op=', targetOp, 'email_message_id=', row.email_message_id)
    if (expected === 'archive') archiveIds.push(mid)
    else if (expected === 'pending_delete') pendingDeleteIds.push(mid)
    else if (expected === 'urgent') urgentIds.push(mid)
    else pendingReviewIds.push(mid)
  }

  if (archiveIds.length) {
    const r = enqueueOrchestratorRemoteMutations(db, archiveIds, 'archive')
    enqueued += r.enqueued
    skipped += r.skipped
    skipReasons.push(...r.skipReasons)
  }
  if (pendingDeleteIds.length) {
    const r = enqueueOrchestratorRemoteMutations(db, pendingDeleteIds, 'pending_delete')
    enqueued += r.enqueued
    skipped += r.skipped
    skipReasons.push(...r.skipReasons)
  }
  if (pendingReviewIds.length) {
    const r = enqueueOrchestratorRemoteMutations(db, pendingReviewIds, 'pending_review')
    enqueued += r.enqueued
    skipped += r.skipped
    skipReasons.push(...r.skipReasons)
  }
  if (urgentIds.length) {
    const r = enqueueOrchestratorRemoteMutations(db, urgentIds, 'urgent')
    enqueued += r.enqueued
    skipped += r.skipped
    skipReasons.push(...r.skipReasons)
  }

  return { enqueued, skipped, skipReasons }
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

    /** Local inbox but persisted mailbox column is a lifecycle folder (exact name match) — no restore op yet. */
    if (expected === 'inbox' && observed !== 'inbox') {
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
  /** Rows that ended in failed state this drain (incremented per batch `failed`). */
  failedTotal: number
  pendingRemaining: number
  timedOut: boolean
}

export interface DrainOrchestratorRemoteBoundedOptions {
  maxMs?: number
  maxBatches?: number
  /**
   * When the bounded drain stops with pending rows left (timeout / batch cap) or times out,
   * schedule background drain so the queue does not stall until the next IPC tick.
   */
  getDbForDrainContinue?: () => Promise<any> | any
}

/**
 * Process pending remote queue rows in batches until empty, or time/batch budget exhausted.
 * Use after Pull / auto-sync so mailbox moves run before IPC returns (bounded — does not hang forever).
 */
export async function drainOrchestratorRemoteQueueBounded(
  db: any,
  options?: DrainOrchestratorRemoteBoundedOptions,
): Promise<DrainOrchestratorRemoteBoundedResult> {
  const maxMs = options?.maxMs ?? 28_000
  const maxBatches = options?.maxBatches ?? 150
  const start = Date.now()
  let processedTotal = 0
  let failedTotal = 0
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
    failedTotal += r.failed
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
      `[OrchestratorRemote] Bounded drain stopped (timeout): ${pendingRemaining} pending — scheduling background drain`,
    )
  }

  const getDbCont = options?.getDbForDrainContinue
  if (getDbCont && pendingRemaining > 0) {
    setTimeout(() => {
      try {
        scheduleOrchestratorRemoteDrain(getDbCont)
      } catch (e: any) {
        console.warn('[OrchestratorRemote] scheduleOrchestratorRemoteDrain after bounded drain failed:', e?.message)
      }
    }, 450)
  }

  return { processedTotal, failedTotal, pendingRemaining, timedOut }
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
  console.log('[DRAIN] scheduleOrchestratorRemoteDrain called, chainScheduled=', drainChainScheduled)
  if (drainChainScheduled) {
    console.log('[DRAIN] Already scheduled, setting reschedule flag')
    drainRescheduleRequested = true
    return
  }
  drainChainScheduled = true
  console.log('[DRAIN] Scheduling via setImmediate')
  setImmediate(async () => {
    console.log('[DRAIN] setImmediate fired, calling processOrchestratorRemoteQueueBatch')
    drainChainScheduled = false
    try {
      const db = await getDb()
      if (!db) {
        console.log('[DRAIN] No db from getDb(), bail')
        if (drainRescheduleRequested) {
          drainRescheduleRequested = false
          scheduleOrchestratorRemoteDrain(getDb)
        }
        return
      }
      const batch = await processOrchestratorRemoteQueueBatch(db, BATCH)
      let continueChain =
        batch.pendingRemaining > 0 || batch.processed > 0 || drainRescheduleRequested
      if (!continueChain) {
        const snap = db
          .prepare(`SELECT COUNT(*) as c FROM remote_orchestrator_mutation_queue WHERE status = 'pending'`)
          .get() as { c: number } | undefined
        const pc = snap?.c ?? 0
        if (pc > 0) {
          console.warn(
            '[OrchestratorRemote] Drain would stop but',
            pc,
            'pending row(s) still in queue — rescheduling background drain',
          )
          continueChain = true
        }
      }
      if (continueChain) {
        drainRescheduleRequested = false
        const deferOnly =
          batch.processed === 0 &&
          batch.failed === 0 &&
          (batch.deferredDueToPull ?? 0) > 0 &&
          batch.pendingRemaining > 0
        /** Throttle while backlog remains; no extra delay when this batch emptied the queue (fast finish). */
        const delayMs = deferOnly ? 400 : batch.pendingRemaining > 0 ? 300 : 0
        setTimeout(() => {
          try {
            scheduleOrchestratorRemoteDrain(getDb)
          } catch (e: any) {
            console.warn('[OrchestratorRemote] drain continuation schedule failed:', e?.message)
          }
        }, delayMs)
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
 * Reset **failed** remote orchestrator rows so the drain can retry (e.g. after fixing provider bugs).
 * Does not change `completed` or `pending` rows.
 * @param accountId — when set, only rows for that account are reset (e.g. Outlook-only retry from debug UI).
 */
export function resetFailedOrchestratorRemoteQueueRows(db: any, accountId?: string): { resetCount: number } {
  if (!db) return { resetCount: 0 }
  const nowIso = new Date().toISOString()
  const id = typeof accountId === 'string' ? accountId.trim() : ''
  const info = id
    ? (db
        .prepare(
          `UPDATE remote_orchestrator_mutation_queue
           SET status = 'pending', attempts = 0, last_error = NULL, updated_at = ?
           WHERE status = 'failed' AND account_id = ?`,
        )
        .run(nowIso, id) as { changes: number })
    : (db
        .prepare(
          `UPDATE remote_orchestrator_mutation_queue
           SET status = 'pending', attempts = 0, last_error = NULL, updated_at = ?
           WHERE status = 'failed'`,
        )
        .run(nowIso) as { changes: number })
  const resetCount = typeof info?.changes === 'number' ? info.changes : 0
  console.log(
    '[OrchestratorRemote] resetFailedOrchestratorRemoteQueueRows:',
    resetCount,
    'row(s)',
    id ? `(account_id=${id})` : '(all accounts)',
  )
  return { resetCount }
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
