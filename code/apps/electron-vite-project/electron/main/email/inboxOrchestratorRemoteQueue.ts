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

/** Optional push to renderer debug log (set from `ipc.registerInboxHandlers`). */
export type OrchestratorDrainProgressPayload = {
  processed: number
  pending: number
  failed: number
  deferred: number
}

let orchestratorDrainProgressReporter: ((p: OrchestratorDrainProgressPayload) => void) | null = null

export function setOrchestratorDrainProgressReporter(
  fn: ((p: OrchestratorDrainProgressPayload) => void) | null,
): void {
  orchestratorDrainProgressReporter = fn
}

const MAX_ATTEMPTS = 8
/** Default rows per drain batch (see `processOrchestratorRemoteQueueBatch`). */
export const BATCH = 50
/** Prevent a hung IMAP/socket from leaving queue rows stuck in `processing` indefinitely. */
const MOVE_TIMEOUT_MS = 30_000
/** After N successful IMAP moves on one account, pause so providers (e.g. web.de) do not drop the session. */
const IMAP_BREATHING_EVERY_N_OPS = 50
const IMAP_BREATHING_PAUSE_MS = 3000
/** After forcing reconnect, brief pause before the next command. */
const RECONNECT_SETTLE_MS = 2000

/** Never succeeds with retries — wrong account id, missing provider adapter, broken vault. */
function isPermanentOrchestratorTerminalError(message: string | undefined | null): boolean {
  if (!message || typeof message !== 'string') return false
  const m = message.toLowerCase()
  return (
    (m.includes('account not found') && m.includes('disconnected or removed')) ||
    m.includes('does not implement remote orchestrator') ||
    m.includes('failed to decrypt stored') ||
    m.includes('failed to decrypt imap') ||
    m.includes('failed to decrypt smtp')
  )
}

/**
 * Dropped IMAP socket, idle timeout, handshake timeout, etc.
 * Reconnect and re-queue **without** incrementing `attempts` (distinct from operational failures).
 */
function isTransientOrchestratorRemoteConnectionError(message: string | undefined | null): boolean {
  if (!message || typeof message !== 'string') return false
  if (isPermanentOrchestratorTerminalError(message)) return false
  const m = message.toLowerCase()
  return (
    /timeout|timed out|handshake timed out/i.test(m) ||
    /not connected|connection closed|connection lost|connection reset/i.test(m) ||
    /econnreset|epipe|etimedout|enotconn|socket|network|broken pipe|write econnreset|read econnreset/i.test(
      m,
    ) ||
    /not authenticated|session not connected/i.test(m) ||
    /reconnect required/i.test(m) ||
    /imap (client|connection)|no.*socket/i.test(m) ||
    /account authentication failed — reconnect required/i.test(m)
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
  console.log(`[DRAIN_BATCH] START: pendingCount=${pendingCount?.c ?? 0}`)

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
  /** Transient socket/session loss — back to pending **without** incrementing `attempts`. */
  const resetPendingTransient = db.prepare(
    `UPDATE remote_orchestrator_mutation_queue SET status = 'pending', last_error = ?, updated_at = ? WHERE id = ?`,
  )
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
  console.log(`[DRAIN_BATCH] Picked ${rows.length} rows (cap=${limit})`)

  const now = () => new Date().toISOString()
  /** Same-batch cache: fail remaining rows for an account without repeated connect attempts (permanent precheck only). */
  const precheckFailedByAccount = new Map<string, string>()
  /** Per-account successful IMAP applies in this batch — breathing pause every N ops. */
  const imapSuccessCountByAccount = new Map<string, number>()
  /** Once per account per batch: ensure canonical lifecycle IMAP folders exist before first MOVE. */
  const imapLifecyclePreflightDone = new Set<string>()

  async function ensureConnectedWithOptionalReconnect(
    accountId: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    let pre = await emailGateway.ensureConnectedForOrchestratorOperation(accountId)
    if (pre.ok) return pre
    if (!isTransientOrchestratorRemoteConnectionError(pre.error)) return pre
    console.warn('[OrchestratorRemote] Precheck transient, forceReconnect:', accountId, pre.error)
    try {
      await emailGateway.forceReconnect(accountId)
    } catch (e: any) {
      console.warn('[OrchestratorRemote] forceReconnect failed:', e?.message || e)
    }
    await sleepMs(RECONNECT_SETTLE_MS)
    pre = await emailGateway.ensureConnectedForOrchestratorOperation(accountId)
    if (pre.ok) {
      try {
        emailGateway.clearOrchestratorTransientAccountError(accountId)
      } catch {
        /* ignore */
      }
    }
    return pre
  }

  const workRows: OrchestratorQueueBatchRow[] = []
  for (const r of rows) {
    const pullActive = isPullActive(r.account_id)
    console.log(
      `[DRAIN_BATCH] Row ${r.id}: account=${r.account_id}, op=${r.operation}, pullActive=${pullActive}`,
    )
    if (pullActive) {
      result.deferredDueToPull = (result.deferredDueToPull ?? 0) + 1
      console.log(`[DRAIN_BATCH] DEFERRED: ${r.id} (pull active)`)
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

    const pre = await ensureConnectedWithOptionalReconnect(r.account_id)
    if (!pre.ok) {
      const errMsg = (pre.error || 'Account authentication failed — reconnect required.').slice(0, 2000)
      if (isTransientOrchestratorRemoteConnectionError(errMsg)) {
        console.warn('[DRAIN_BATCH] Precheck still transient after reconnect — leave row pending', r.id, errMsg)
        return
      }
      precheckFailedByAccount.set(r.account_id, errMsg)
      console.warn('[DRAIN_BATCH] Precheck failed (permanent) account=', r.account_id, errMsg)
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

    try {
      let prov: string | undefined
      try {
        prov = emailGateway.getProviderSync(r.account_id)
      } catch {
        prov = undefined
      }
      if (prov === 'imap' && !imapLifecyclePreflightDone.has(r.account_id)) {
        try {
          const life = await emailGateway.ensureImapLifecycleFoldersForDrain(r.account_id)
          imapLifecyclePreflightDone.add(r.account_id)
          if (!life.ok) {
            console.warn(
              '[DRAIN_BATCH] IMAP lifecycle folder preflight incomplete (drain continues):',
              r.account_id,
              life.entries?.filter((e) => !e.exists),
            )
          } else {
            console.log('[DRAIN_BATCH] IMAP lifecycle folders verified for account', r.account_id)
          }
        } catch (e: any) {
          imapLifecyclePreflightDone.add(r.account_id)
          console.warn(
            '[DRAIN_BATCH] IMAP lifecycle preflight error (drain continues):',
            r.account_id,
            e?.message || e,
          )
        }
      }
    } catch {
      /* ignore */
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
        if (String(r.provider_type ?? '').toLowerCase() === 'imap') {
          const n = (imapSuccessCountByAccount.get(r.account_id) ?? 0) + 1
          imapSuccessCountByAccount.set(r.account_id, n)
          if (n > 0 && n % IMAP_BREATHING_EVERY_N_OPS === 0) {
            console.log(
              `[OrchestratorRemote] IMAP breathing pause after ${n} successful op(s) on account`,
              r.account_id,
            )
            await sleepMs(IMAP_BREATHING_PAUSE_MS)
          }
        }
      } else {
        const err = (apply.error || 'Remote mutation failed').slice(0, 2000)
        console.log('[OrchestratorRemote] FAIL:', r.operation, r.message_id, apply.error)
        if (isPermanentOrchestratorTerminalError(err)) {
          markFailed.run(MAX_ATTEMPTS, err, now(), r.id)
          touchMessageError.run(`[${r.operation}] ${err}`, r.message_id)
          result.failed++
        } else if (isTransientOrchestratorRemoteConnectionError(err)) {
          console.warn('[OrchestratorRemote] Transient connection error — reconnect, re-queue without attempt bump:', err)
          try {
            await emailGateway.forceReconnect(r.account_id)
            emailGateway.clearOrchestratorTransientAccountError(r.account_id)
          } catch (reErr: any) {
            console.warn('[OrchestratorRemote] forceReconnect after apply failure:', reErr?.message || reErr)
          }
          resetPendingTransient.run(err, now(), r.id)
          touchMessageError.run(`[${r.operation}] ${err} (transient — will retry)`, r.message_id)
          await sleepMs(RECONNECT_SETTLE_MS)
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
          result.failed++
        }
      }
    } catch (e: any) {
      const err = (e?.message || String(e)).slice(0, 2000)
      console.log('[DRAIN_BATCH] Result:', r.id, 'FAIL', err, '')
      console.log('[OrchestratorRemote] FAIL:', r.operation, r.message_id, err)
      if (isPermanentOrchestratorTerminalError(err)) {
        markFailed.run(MAX_ATTEMPTS, err, now(), r.id)
        touchMessageError.run(`[${r.operation}] ${err}`, r.message_id)
        result.failed++
      } else if (isTransientOrchestratorRemoteConnectionError(err)) {
        console.warn('[OrchestratorRemote] Transient exception — reconnect, re-queue without attempt bump:', err)
        try {
          await emailGateway.forceReconnect(r.account_id)
          emailGateway.clearOrchestratorTransientAccountError(r.account_id)
        } catch (reErr: any) {
          console.warn('[OrchestratorRemote] forceReconnect after exception:', reErr?.message || reErr)
        }
        resetPendingTransient.run(err, now(), r.id)
        touchMessageError.run(`[${r.operation}] ${err} (transient — will retry)`, r.message_id)
        await sleepMs(RECONNECT_SETTLE_MS)
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
        result.failed++
      }
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

  console.log(
    `[DRAIN_BATCH] END: processed=${result.processed}, deferred=${result.deferredDueToPull ?? 0}, failed=${result.failed}, pendingRemaining=${result.pendingRemaining}`,
  )

  return result
}

/** Chunk size for {@link enqueueUnmirroredClassifiedLifecycleMessages} (each chunk calls lifecycle enqueue). */
const UNMIRRORED_CLASSIFIED_CHUNK = 400

export interface EnqueueUnmirroredClassifiedResult {
  idsFound: number
  enqueued: number
  skipped: number
}

/**
 * Classified inbox rows with **no** active queue row (`pending` / `processing` / `completed`) — e.g. missed after
 * reconnect or old classify skips. Idempotent: re-run is safe; lifecycle enqueue dedupes / supersedes.
 */
export function enqueueUnmirroredClassifiedLifecycleMessages(db: any): EnqueueUnmirroredClassifiedResult {
  if (!db) return { idsFound: 0, enqueued: 0, skipped: 0 }
  const rows = db
    .prepare(
      `SELECT m.id
       FROM inbox_messages m
       WHERE m.deleted = 0
         AND (m.source_type = 'email_plain' OR m.source_type = 'email_beap')
         AND m.sort_category IS NOT NULL AND TRIM(COALESCE(m.sort_category, '')) != ''
         AND NOT EXISTS (
           SELECT 1 FROM remote_orchestrator_mutation_queue q
           WHERE q.message_id = m.id
             AND q.status IN ('completed', 'pending', 'processing')
         )`,
    )
    .all() as Array<{ id: string }>

  const ids = rows.map((r) => r.id).filter((x) => typeof x === 'string' && x.trim() !== '')
  if (ids.length === 0) return { idsFound: 0, enqueued: 0, skipped: 0 }

  let enqueued = 0
  let skipped = 0
  for (let i = 0; i < ids.length; i += UNMIRRORED_CLASSIFIED_CHUNK) {
    const chunk = ids.slice(i, i + UNMIRRORED_CLASSIFIED_CHUNK)
    const r = enqueueRemoteOpsForLocalLifecycleState(db, chunk)
    enqueued += r.enqueued
    skipped += r.skipped
  }
  if (enqueued > 0) {
    console.log(
      '[OrchestratorRemote] enqueueUnmirroredClassifiedLifecycleMessages:',
      enqueued,
      'enqueued,',
      skipped,
      'skipped,',
      ids.length,
      'ids',
    )
  }
  return { idsFound: ids.length, enqueued, skipped }
}

/**
 * Mark `pending` / `processing` queue rows for unknown or NULL `account_id` as **failed** so they do not block drain.
 * When **no** accounts are connected, all such rows are failed.
 */
export function markOrphanPendingQueueRowsAsFailed(db: any, knownAccountIds: string[]): { cleared: number } {
  if (!db) return { cleared: 0 }
  const nowIso = new Date().toISOString()
  const err = 'Account removed (auto-cleanup)'
  const ids = [...new Set(knownAccountIds.map((x) => String(x ?? '').trim()).filter(Boolean))]

  if (ids.length === 0) {
    const info = db
      .prepare(
        `UPDATE remote_orchestrator_mutation_queue
         SET status = 'failed', last_error = ?, updated_at = ?
         WHERE status IN ('pending', 'processing')`,
      )
      .run(err, nowIso) as { changes?: number }
    const cleared = typeof info?.changes === 'number' ? info.changes : 0
    if (cleared > 0) {
      console.warn('[OrchestratorRemote] markOrphanPendingQueueRowsAsFailed: no connected accounts — failed', cleared, 'row(s)')
    }
    return { cleared }
  }

  const ph = ids.map(() => '?').join(',')
  const info = db
    .prepare(
      `UPDATE remote_orchestrator_mutation_queue
       SET status = 'failed', last_error = ?, updated_at = ?
       WHERE status IN ('pending', 'processing')
         AND (account_id IS NULL OR TRIM(COALESCE(account_id, '')) = '' OR account_id NOT IN (${ph}))`,
    )
    .run(err, nowIso, ...ids) as { changes?: number }
  const cleared = typeof info?.changes === 'number' ? info.changes : 0
  if (cleared > 0) {
    console.log('[OrchestratorRemote] markOrphanPendingQueueRowsAsFailed:', cleared, 'row(s) for disconnected/unknown account_id')
  }
  return { cleared }
}

let remoteDrainWatchdogStarted = false

/**
 * Production safety net: every 15s, reset stuck `processing` rows and restart the drain if any work remains.
 * Does not replace normal chaining — catches broken chains, stuck flags, and hung batches.
 */
export function ensureOrchestratorRemoteDrainWatchdog(getDb: () => Promise<any> | any): void {
  if (remoteDrainWatchdogStarted) return
  remoteDrainWatchdogStarted = true
  setInterval(() => {
    void (async () => {
      try {
        const db = typeof getDb === 'function' ? await getDb() : getDb
        if (!db) return

        const nowIso = new Date().toISOString()
        const twoMinAgo = new Date(Date.now() - 2 * 60_000).toISOString()
        try {
          const resetInfo = db
            .prepare(
              `UPDATE remote_orchestrator_mutation_queue
               SET status = 'pending', updated_at = ?
               WHERE status = 'processing' AND updated_at < ?`,
            )
            .run(nowIso, twoMinAgo) as { changes?: number }
          const n = typeof resetInfo?.changes === 'number' ? resetInfo.changes : 0
          if (n > 0) {
            console.warn('[OrchestratorRemote] Watchdog: reset', n, 'stuck processing row(s) (>2m) → pending')
          }
        } catch (e: any) {
          console.error('[OrchestratorRemote] Watchdog: stuck-processing reset failed:', e?.message || e)
        }

        const row = db
          .prepare(`SELECT COUNT(*) as c FROM remote_orchestrator_mutation_queue WHERE status = 'pending'`)
          .get() as { c?: number } | undefined
        const c = row?.c ?? 0
        if (c > 0) {
          forceDrainRestart()
          scheduleOrchestratorRemoteDrain(getDb)
        }
      } catch (e: any) {
        console.error('[OrchestratorRemote] Watchdog error (ignored):', e?.message || e)
      }
    })()
  }, 15_000)
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
 * Unstick the drain scheduler (e.g. watchdog) if flags were left true after an error or race.
 * Safe to call while idle; next `scheduleOrchestratorRemoteDrain` will start a fresh chain.
 */
export function forceDrainRestart(): void {
  drainChainScheduled = false
  drainRescheduleRequested = false
}

/**
 * Schedule asynchronous drain (non-blocking). Safe to call after every local transition.
 */
export function scheduleOrchestratorRemoteDrain(getDb: () => Promise<any> | any): void {
  console.log(`[DRAIN] schedule called, chainScheduled=${drainChainScheduled}`)
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
      try {
        orchestratorDrainProgressReporter?.({
          processed: batch.processed,
          pending: batch.pendingRemaining,
          failed: batch.failed,
          deferred: batch.deferredDueToPull ?? 0,
        })
      } catch {
        /* ignore renderer push errors */
      }
      /** Chain while batch reports pending work, this batch did something, or a parallel enqueue requested reschedule. */
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
      console.log(
        `[DRAIN] batch done: processed=${batch.processed}, pending=${batch.pendingRemaining}, deferred=${batch.deferredDueToPull ?? 0}, failed=${batch.failed}, continueChain=${continueChain}`,
      )
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

/** Normalize address for reconnect / duplicate-account cleanup (trim + lowercase). */
function normalizeAccountEmailForQueueCleanup(email: string | null | undefined): string {
  return String(email ?? '')
    .trim()
    .toLowerCase()
}

/**
 * Remove **failed** queue rows for one account (e.g. orphan “Account not found” after disconnect).
 * Does not touch pending/processing/completed.
 */
export function clearFailedOrchestratorRemoteQueueForAccount(db: any, accountId: string): { deletedCount: number } {
  if (!db) return { deletedCount: 0 }
  const id = typeof accountId === 'string' ? accountId.trim() : ''
  if (!id || id === '(no account_id)') return { deletedCount: 0 }
  const info = db
    .prepare(
      `DELETE FROM remote_orchestrator_mutation_queue
       WHERE status = 'failed' AND account_id = ?`,
    )
    .run(id) as { changes?: number }
  const deletedCount = typeof info?.changes === 'number' ? info.changes : 0
  console.log('[OrchestratorRemote] clearFailedOrchestratorRemoteQueueForAccount:', deletedCount, 'row(s)', `(account_id=${id})`)
  return { deletedCount }
}

/**
 * After a successful email connect (same mailbox, new `account_id`), drop stale **failed** rows that can never succeed:
 * - `account_id` not present in the current gateway account list (disconnected / replaced).
 * - Other connected accounts with the **same normalized email** but a different id (leftover duplicate row).
 */
export function cleanupStaleFailedRemoteQueueOnReconnect(
  db: any,
  knownAccounts: Array<{ id: string; email: string }>,
  newlyConnected: { id: string; email: string },
): { deletedCount: number } {
  if (!db) return { deletedCount: 0 }
  const knownIds = new Set(
    knownAccounts.map((a) => String(a.id ?? '').trim()).filter((x) => x.length > 0),
  )
  const newId = String(newlyConnected.id ?? '').trim()
  const newEmail = normalizeAccountEmailForQueueCleanup(newlyConnected.email)
  let deletedCount = 0

  // Orphan failed rows: gateway no longer has that account_id (e.g. web.de reconnect → new id).
  if (knownIds.size > 0) {
    const ids = [...knownIds]
    const ph = ids.map(() => '?').join(',')
    const r1 = db
      .prepare(
        `DELETE FROM remote_orchestrator_mutation_queue
         WHERE status = 'failed' AND account_id NOT IN (${ph})`,
      )
      .run(...ids) as { changes?: number }
    deletedCount += typeof r1?.changes === 'number' ? r1.changes : 0
  }

  // Same mailbox still listed under an older id: clear failed for those ids only (not the newly connected one).
  if (newEmail && newId) {
    const otherIds = knownAccounts
      .filter(
        (a) =>
          normalizeAccountEmailForQueueCleanup(a.email) === newEmail &&
          String(a.id ?? '').trim() !== '' &&
          String(a.id).trim() !== newId,
      )
      .map((a) => String(a.id).trim())
    for (const oid of otherIds) {
      const r2 = db
        .prepare(
          `DELETE FROM remote_orchestrator_mutation_queue
           WHERE status = 'failed' AND account_id = ?`,
        )
        .run(oid) as { changes?: number }
      deletedCount += typeof r2?.changes === 'number' ? r2.changes : 0
    }
  }

  if (deletedCount > 0) {
    console.log(
      '[OrchestratorRemote] cleanupStaleFailedRemoteQueueOnReconnect:',
      deletedCount,
      'stale failed row(s) removed (post-connect)',
    )
  }
  return { deletedCount }
}

/** Distinct `inbox_messages.account_id` values that are not in the current gateway account list. */
export function getDistinctOrphanInboxAccountIds(db: any, knownAccountIds: Set<string>): string[] {
  if (!db || knownAccountIds.size === 0) return []
  const ids = [...knownAccountIds]
  const ph = ids.map(() => '?').join(',')
  const rows = db
    .prepare(
      `SELECT DISTINCT account_id FROM inbox_messages
       WHERE account_id IS NOT NULL AND TRIM(account_id) != ''
         AND account_id NOT IN (${ph})`,
    )
    .all(...ids) as Array<{ account_id: string }>
  return rows.map((r) => String(r.account_id).trim()).filter((x) => x.length > 0)
}

/** True if any non-deleted inbox row for this orphan account lists the mailbox email in To/Cc (reconnect heuristic). */
export function orphanInboxHasRecipientHintForEmail(
  db: any,
  orphanAccountId: string,
  normalizedMailboxEmail: string,
): boolean {
  if (!db || !orphanAccountId?.trim() || !normalizedMailboxEmail?.trim()) return false
  const needle = normalizeAccountEmailForQueueCleanup(normalizedMailboxEmail)
  if (!needle) return false
  const row = db
    .prepare(
      `SELECT 1 AS x FROM inbox_messages
       WHERE account_id = ? AND deleted = 0
         AND (
           instr(lower(COALESCE(to_addresses, '')), ?) > 0
           OR instr(lower(COALESCE(cc_addresses, '')), ?) > 0
         )
       LIMIT 1`,
    )
    .get(orphanAccountId, needle, needle) as { x?: number } | undefined
  return !!row
}

export interface GatewayAccountInboxDiag {
  id: string
  email: string
  provider?: string
  status?: string
  inboxMessageCount: number
}

export interface OrphanInboxDiag {
  accountId: string
  inboxMessageCount: number
  queueRowCount: number
  /** Gateway account ids whose normalized email appears in To/Cc of this orphan’s messages */
  suggestedTargetAccountIds: string[]
}

/**
 * Debug / migrate UI: connected accounts vs inbox DB + orphan ids (stale account_id after reconnect).
 */
export function getInboxAccountMigrationDiagnostics(
  db: any,
  gatewayAccounts: Array<{ id: string; email: string; provider?: string; status?: string }>,
): { gatewayAccounts: GatewayAccountInboxDiag[]; orphans: OrphanInboxDiag[] } {
  if (!db) return { gatewayAccounts: [], orphans: [] }
  const knownIds = new Set(gatewayAccounts.map((a) => String(a.id ?? '').trim()).filter((x) => x.length > 0))
  const gwOut: GatewayAccountInboxDiag[] = []
  for (const a of gatewayAccounts) {
    const id = String(a.id ?? '').trim()
    if (!id) continue
    const c = db.prepare(`SELECT COUNT(*) as c FROM inbox_messages WHERE deleted = 0 AND account_id = ?`).get(id) as {
      c?: number
    }
    gwOut.push({
      id,
      email: a.email,
      provider: a.provider,
      status: a.status,
      inboxMessageCount: Number(c?.c) || 0,
    })
  }
  const orphanIds = getDistinctOrphanInboxAccountIds(db, knownIds)
  const orphans: OrphanInboxDiag[] = []
  for (const oid of orphanIds) {
    const mc = db.prepare(`SELECT COUNT(*) as c FROM inbox_messages WHERE deleted = 0 AND account_id = ?`).get(oid) as {
      c?: number
    }
    const qc = db
      .prepare(`SELECT COUNT(*) as c FROM remote_orchestrator_mutation_queue WHERE account_id = ?`)
      .get(oid) as { c?: number }
    const suggestedTargetAccountIds: string[] = []
    for (const a of gatewayAccounts) {
      const gid = String(a.id ?? '').trim()
      if (!gid) continue
      if (orphanInboxHasRecipientHintForEmail(db, oid, normalizeAccountEmailForQueueCleanup(a.email))) {
        suggestedTargetAccountIds.push(gid)
      }
    }
    orphans.push({
      accountId: oid,
      inboxMessageCount: Number(mc?.c) || 0,
      queueRowCount: Number(qc?.c) || 0,
      suggestedTargetAccountIds,
    })
  }
  return { gatewayAccounts: gwOut, orphans }
}

/**
 * Point all inbox rows + delete all remote queue rows from `fromAccountId` onto `toAccountId`.
 * Idempotent: second run updates 0 rows if already migrated. Does not delete inbox_messages.
 */
export function migrateInboxAccountIdAndClearQueue(
  db: any,
  fromAccountId: string,
  toAccountId: string,
): {
  didMigrate: boolean
  fromId: string
  toId: string
  messagesUpdated: number
  queueRowsDeleted: number
  reason?: string
} {
  const fromId = String(fromAccountId ?? '').trim()
  const toId = String(toAccountId ?? '').trim()
  if (!db || !fromId || !toId || fromId === toId) {
    return {
      didMigrate: false,
      fromId,
      toId,
      messagesUpdated: 0,
      queueRowsDeleted: 0,
      reason: 'invalid_args',
    }
  }
  const qDel = db.prepare(`DELETE FROM remote_orchestrator_mutation_queue WHERE account_id = ?`).run(fromId) as {
    changes?: number
  }
  const queueRowsDeleted = typeof qDel?.changes === 'number' ? qDel.changes : 0
  const mUp = db.prepare(`UPDATE inbox_messages SET account_id = ? WHERE account_id = ?`).run(toId, fromId) as {
    changes?: number
  }
  const messagesUpdated = typeof mUp?.changes === 'number' ? mUp.changes : 0
  console.log(
    '[OrchestratorRemote] migrateInboxAccountIdAndClearQueue:',
    fromId,
    '→',
    toId,
    'messages=',
    messagesUpdated,
    'queue_deleted=',
    queueRowsDeleted,
  )
  return { didMigrate: messagesUpdated > 0 || queueRowsDeleted > 0, fromId, toId, messagesUpdated, queueRowsDeleted }
}

/**
 * After reconnect: if there is exactly one orphan account_id whose messages To/Cc hint the same mailbox
 * as the newly connected account, and that mailbox is unique in the gateway, repoint inbox + wipe queue for the orphan.
 */
export function tryAutoMigrateInboxAccountOnReconnect(
  db: any,
  knownAccounts: Array<{ id: string; email: string }>,
  newlyConnected: { id: string; email: string },
): {
  didMigrate: boolean
  fromId?: string
  toId?: string
  messagesUpdated: number
  queueRowsDeleted: number
  reason?: string
} {
  const newEmail = normalizeAccountEmailForQueueCleanup(newlyConnected.email)
  const newId = String(newlyConnected.id ?? '').trim()
  if (!db || !newId || !newEmail) {
    return { didMigrate: false, messagesUpdated: 0, queueRowsDeleted: 0, reason: 'missing_db_or_account' }
  }
  const sameEmailAccounts = knownAccounts.filter(
    (a) => normalizeAccountEmailForQueueCleanup(a.email) === newEmail,
  )
  if (sameEmailAccounts.length !== 1 || String(sameEmailAccounts[0].id).trim() !== newId) {
    return { didMigrate: false, messagesUpdated: 0, queueRowsDeleted: 0, reason: 'email_not_unique_in_gateway' }
  }
  const knownIds = new Set(knownAccounts.map((a) => String(a.id ?? '').trim()).filter((x) => x.length > 0))
  const orphans = getDistinctOrphanInboxAccountIds(db, knownIds)
  const candidates = orphans.filter((oid) => orphanInboxHasRecipientHintForEmail(db, oid, newEmail))
  if (candidates.length !== 1) {
    return {
      didMigrate: false,
      messagesUpdated: 0,
      queueRowsDeleted: 0,
      reason:
        candidates.length === 0
          ? 'no_orphan_matching_email_hint'
          : 'ambiguous_orphan_candidates',
    }
  }
  const fromId = candidates[0]
  const r = migrateInboxAccountIdAndClearQueue(db, fromId, newId)
  return {
    didMigrate: r.didMigrate,
    fromId: r.fromId,
    toId: r.toId,
    messagesUpdated: r.messagesUpdated,
    queueRowsDeleted: r.queueRowsDeleted,
    reason: r.didMigrate ? undefined : r.reason,
  }
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
