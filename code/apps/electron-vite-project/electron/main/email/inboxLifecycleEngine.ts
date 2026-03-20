/**
 * Inbox retention lifecycle — local SQLite is the source of truth for **desired** stage timing.
 *
 * Stages (business rules, UTC ISO-8601 timestamps in DB):
 * 1. Pending Review — `sort_category = 'pending_review'`, `pending_review_at` = entered review.
 *    After **14 days**, promote to Pending Delete (local + remote `pending_delete` mutation).
 * 2. Pending Delete — `pending_delete = 1`, `pending_delete_at` = entered this bucket (including promotions).
 *    After **7 days**, queue **final deletion** (`deletion_queue` + existing remote executor).
 * 3. Final delete — handled by `executePendingDeletions` / `queueRemoteDeletion` (remote may lag; local `deleted=1` on queue).
 *
 * Idempotency: promotions use SQL predicates so repeated ticks are safe. Remote failures do not roll back local
 * promotions; remote sync uses the existing orchestrator queue (retries). Final remote delete failures keep the
 * deletion_queue row for retry — messages are not purged from SQLite until `remote_deleted` path succeeds (existing).
 */

import { executePendingDeletions, queueRemoteDeletion } from './remoteDeletion'
import {
  enqueueOrchestratorRemoteMutations,
  scheduleOrchestratorRemoteDrain,
} from './inboxOrchestratorRemoteQueue'

const LOG = '[InboxLifecycle]'

/** Wall-clock retention windows (fixed ms, equivalent to full UTC days). */
export const PENDING_REVIEW_RETENTION_MS = 14 * 24 * 60 * 60 * 1000
export const PENDING_DELETE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

export interface LifecycleTickResult {
  /** First pass: drain deletion_queue where grace elapsed */
  executedPendingDeletionsPass1: { executed: number; failed: number }
  /** Messages moved from Pending Review → Pending Delete (local) */
  promotedReviewToPendingDelete: number
  /** Remote mutation rows enqueued for that promotion */
  remoteEnqueuedAfterReviewPromotion: number
  /** Messages moved from Pending Delete → deletion_queue (grace 0 = execute ASAP) */
  promotedPendingDeleteToFinalQueue: number
  /** Second pass: run new grace-0 items */
  executedPendingDeletionsPass2: { executed: number; failed: number }
  errors: string[]
}

function utcNowIso(): string {
  return new Date().toISOString()
}

function reviewExpiryCutoffIso(nowMs: number): string {
  return new Date(nowMs - PENDING_REVIEW_RETENTION_MS).toISOString()
}

function pendingDeleteExpiryCutoffIso(nowMs: number): string {
  return new Date(nowMs - PENDING_DELETE_RETENTION_MS).toISOString()
}

/**
 * Single scheduler tick: execute remote deletes, promote lifecycles, enqueue remote mirrors, queue final deletes, execute again.
 */
export async function runInboxLifecycleTick(
  db: any,
  options?: { getDb?: () => Promise<any> | any },
): Promise<LifecycleTickResult> {
  const result: LifecycleTickResult = {
    executedPendingDeletionsPass1: { executed: 0, failed: 0 },
    promotedReviewToPendingDelete: 0,
    remoteEnqueuedAfterReviewPromotion: 0,
    promotedPendingDeleteToFinalQueue: 0,
    executedPendingDeletionsPass2: { executed: 0, failed: 0 },
    errors: [],
  }

  if (!db) {
    result.errors.push('no_database')
    return result
  }

  const nowMs = Date.now()
  const nowIso = utcNowIso()
  const reviewCutoff = reviewExpiryCutoffIso(nowMs)
  const deleteCutoff = pendingDeleteExpiryCutoffIso(nowMs)

  const getDb = options?.getDb ?? (() => db)

  try {
    result.executedPendingDeletionsPass1 = await executePendingDeletions(db)
    if (result.executedPendingDeletionsPass1.executed || result.executedPendingDeletionsPass1.failed) {
      console.log(
        `${LOG} executePendingDeletions (pass1) executed=${result.executedPendingDeletionsPass1.executed} failed=${result.executedPendingDeletionsPass1.failed}`,
      )
    }
  } catch (e: any) {
    const msg = e?.message ?? String(e)
    result.errors.push(`executePendingDeletions_pass1:${msg}`)
    console.error(`${LOG} executePendingDeletions pass1 error:`, msg)
  }

  // ── Pending Review (≥14d in review) → Pending Delete (local). NOT final deletion. ──
  try {
    const reviewIds = db
      .prepare(
        `SELECT id FROM inbox_messages
         WHERE deleted = 0
           AND archived = 0
           AND sort_category = 'pending_review'
           AND pending_review_at IS NOT NULL
           AND pending_review_at <= ?
           AND (pending_delete = 0 OR pending_delete IS NULL)
         ORDER BY pending_review_at ASC`,
      )
      .all(reviewCutoff) as Array<{ id: string }>

    const updatePromotion = db.prepare(
      `UPDATE inbox_messages SET
         pending_delete = 1,
         pending_delete_at = ?,
         sort_category = NULL,
         sort_reason = NULL,
         lifecycle_exited_review_utc = ?
       WHERE id = ?`,
    )

    const promoted: string[] = []
    const tx = db.transaction(() => {
      for (const r of reviewIds) {
        updatePromotion.run(nowIso, nowIso, r.id)
        promoted.push(r.id)
      }
    })
    tx()

    result.promotedReviewToPendingDelete = promoted.length
    if (promoted.length) {
      console.log(
        `${LOG} promoted ${promoted.length} message(s) from Pending Review → Pending Delete (cutoff <= ${reviewCutoff} UTC)`,
      )
      try {
        const enq = enqueueOrchestratorRemoteMutations(db, promoted, 'pending_delete')
        result.remoteEnqueuedAfterReviewPromotion = enq.enqueued
        scheduleOrchestratorRemoteDrain(getDb)
        if (enq.enqueued || enq.skipped) {
          console.log(
            `${LOG} remote orchestrator enqueue after review promotion: enqueued=${enq.enqueued} skipped=${enq.skipped}`,
          )
        }
      } catch (e: any) {
        const msg = e?.message ?? String(e)
        result.errors.push(`remote_enqueue_review_promotion:${msg}`)
        console.error(`${LOG} remote enqueue after review promotion failed:`, msg)
      }
    }
  } catch (e: any) {
    const msg = e?.message ?? String(e)
    result.errors.push(`promote_review:${msg}`)
    console.error(`${LOG} promote Pending Review → Pending Delete error:`, msg)
  }

  // ── Pending Delete (≥7d in bucket) → deletion_queue (final path). Local deleted=1 on queue (existing contract). ──
  try {
    const deleteIds = db
      .prepare(
        `SELECT m.id FROM inbox_messages m
         WHERE m.pending_delete = 1
           AND m.deleted = 0
           AND m.pending_delete_at IS NOT NULL
           AND m.pending_delete_at <= ?
           AND NOT EXISTS (
             SELECT 1 FROM deletion_queue dq
             WHERE dq.message_id = m.id AND dq.executed = 0 AND dq.cancelled = 0
           )
         ORDER BY m.pending_delete_at ASC`,
      )
      .all(deleteCutoff) as Array<{ id: string }>

    const markQueued = db.prepare(
      `UPDATE inbox_messages SET lifecycle_final_delete_queued_utc = ? WHERE id = ?`,
    )

    for (const r of deleteIds) {
      const q = queueRemoteDeletion(db, r.id, 0)
      if (q.ok) {
        try {
          markQueued.run(nowIso, r.id)
        } catch (markErr: any) {
          console.warn(`${LOG} lifecycle_final_delete_queued_utc update failed for ${r.id}:`, markErr?.message)
        }
        result.promotedPendingDeleteToFinalQueue++
      } else {
        const err = q.error || 'queueRemoteDeletion failed'
        result.errors.push(`queue_final:${r.id}:${err}`)
        console.warn(`${LOG} queue final deletion failed id=${r.id}:`, err)
      }
    }
    if (deleteIds.length) {
      console.log(
        `${LOG} pending-delete final queue: attempted=${deleteIds.length} ok=${result.promotedPendingDeleteToFinalQueue} cutoff<=${deleteCutoff} UTC`,
      )
    }
  } catch (e: any) {
    const msg = e?.message ?? String(e)
    result.errors.push(`promote_pending_delete:${msg}`)
    console.error(`${LOG} promote Pending Delete → final queue error:`, msg)
  }

  try {
    result.executedPendingDeletionsPass2 = await executePendingDeletions(db)
    if (result.executedPendingDeletionsPass2.executed || result.executedPendingDeletionsPass2.failed) {
      console.log(
        `${LOG} executePendingDeletions (pass2) executed=${result.executedPendingDeletionsPass2.executed} failed=${result.executedPendingDeletionsPass2.failed}`,
      )
    }
  } catch (e: any) {
    const msg = e?.message ?? String(e)
    result.errors.push(`executePendingDeletions_pass2:${msg}`)
    console.error(`${LOG} executePendingDeletions pass2 error:`, msg)
  }

  return result
}
