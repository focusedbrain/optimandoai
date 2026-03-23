/**
 * IMAP lifecycle mirror repair — re-enqueues remote mutations from current local orchestrator state.
 *
 * Use after folder renames, failed moves, or upgrades. Idempotent via UNIQUE(message_id, operation)
 * on `remote_orchestrator_mutation_queue`.
 */

import { emailGateway } from './gateway'
import { enqueueOrchestratorRemoteMutations, scheduleOrchestratorRemoteDrain } from './inboxOrchestratorRemoteQueue'

export interface ImapLifecycleReconcileResult {
  ok: boolean
  enqueued: number
  skipped: number
  error?: string
}

/**
 * Re-queue remote lifecycle ops for all email-sourced rows whose local state implies a mailbox bucket.
 * Does not change local rows; drain runs async via `scheduleOrchestratorRemoteDrain`.
 */
export function reconcileImapLifecycleFromLocalState(
  db: any,
  accountId: string,
  getDb: () => Promise<any> | any,
): ImapLifecycleReconcileResult {
  const out: ImapLifecycleReconcileResult = { ok: true, enqueued: 0, skipped: 0 }
  if (!db) {
    return { ok: false, enqueued: 0, skipped: 0, error: 'no_database' }
  }
  let provider: string
  try {
    provider = emailGateway.getProviderSync(accountId)
  } catch (e: any) {
    return { ok: false, enqueued: 0, skipped: 0, error: e?.message ?? 'account_unavailable' }
  }
  if (provider !== 'imap') {
    return { ok: false, enqueued: 0, skipped: 0, error: 'not_imap_account' }
  }

  const collectIds = (sql: string, ...params: unknown[]) => {
    try {
      return (db.prepare(sql).all(...params) as Array<{ id: string }>).map((r) => r.id)
    } catch {
      return []
    }
  }

  const run = (ids: string[], op: 'archive' | 'pending_review' | 'pending_delete') => {
    if (!ids.length) return
    const r = enqueueOrchestratorRemoteMutations(db, ids, op)
    out.enqueued += r.enqueued
    out.skipped += r.skipped
  }

  /* Archived (not pending delete / not in review bucket) */
  const archived = collectIds(
    `SELECT id FROM inbox_messages
     WHERE account_id = ? AND deleted = 0 AND archived = 1
       AND (pending_delete = 0 OR pending_delete IS NULL)
       AND (sort_category IS NULL OR sort_category != 'pending_review')
       AND source_type IN ('email_plain','email_beap')`,
    accountId,
  )
  run(archived, 'archive')

  const review = collectIds(
    `SELECT id FROM inbox_messages
     WHERE account_id = ? AND deleted = 0 AND archived = 0
       AND sort_category = 'pending_review'
       AND (pending_delete = 0 OR pending_delete IS NULL)
       AND source_type IN ('email_plain','email_beap')`,
    accountId,
  )
  run(review, 'pending_review')

  const pendingDel = collectIds(
    `SELECT id FROM inbox_messages
     WHERE account_id = ? AND deleted = 0 AND pending_delete = 1
       AND source_type IN ('email_plain','email_beap')`,
    accountId,
  )
  run(pendingDel, 'pending_delete')

  try {
    scheduleOrchestratorRemoteDrain(getDb)
  } catch (e: any) {
    console.warn('[ImapReconcile] scheduleOrchestratorRemoteDrain failed:', e?.message)
  }

  return out
}
