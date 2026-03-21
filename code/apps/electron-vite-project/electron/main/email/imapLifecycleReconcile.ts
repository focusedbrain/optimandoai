/**
 * IMAP lifecycle mirror repair — re-enqueues remote mutations from current local orchestrator state.
 *
 * Use after folder renames, failed moves, or upgrades. Idempotent via UNIQUE(message_id, operation)
 * on `remote_orchestrator_mutation_queue`.
 */

import { emailGateway } from './gateway'
import { enqueueRemoteOpsForLocalLifecycleState, scheduleOrchestratorRemoteDrain } from './inboxOrchestratorRemoteQueue'

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

  let ids: string[] = []
  try {
    ids = (
      db
        .prepare(
          `SELECT id FROM inbox_messages
           WHERE account_id = ? AND deleted = 0
             AND source_type IN ('email_plain','email_beap')
             AND email_message_id IS NOT NULL AND TRIM(email_message_id) != ''`,
        )
        .all(accountId) as Array<{ id: string }>
    ).map((r) => r.id)
  } catch {
    ids = []
  }

  const r = ids.length ? enqueueRemoteOpsForLocalLifecycleState(db, ids) : { enqueued: 0, skipped: 0, skipReasons: [] }
  out.enqueued += r.enqueued
  out.skipped += r.skipped

  try {
    scheduleOrchestratorRemoteDrain(getDb)
  } catch (e: any) {
    console.warn('[ImapReconcile] scheduleOrchestratorRemoteDrain failed:', e?.message)
  }

  return out
}
