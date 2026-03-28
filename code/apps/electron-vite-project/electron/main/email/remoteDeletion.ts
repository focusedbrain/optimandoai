/**
 * Remote Deletion — Soft-delete inbox messages with grace period before remote mailbox deletion.
 *
 * Native BEAP (`direct_beap`, sentinel account `__p2p_beap__`) has no remote mailbox; those rows
 * are purged locally (attachments on disk, embeddings, pending queue match).
 *
 * @version 1.0.0
 */

import { randomUUID } from 'crypto'
import { existsSync, unlinkSync } from 'fs'
import { emailGateway } from './gateway'

const P2P_BEAP_ACCOUNT_ID = '__p2p_beap__'

function isDirectBeapRow(row: {
  source_type?: string | null
  account_id?: string | null
}): boolean {
  return row.source_type === 'direct_beap' || row.account_id === P2P_BEAP_ACCOUNT_ID
}

/**
 * Hard-delete a native BEAP inbox row and related rows/files. No remote API.
 */
export function purgeDirectBeapMessageLocal(
  db: any,
  messageId: string,
): QueueRemoteDeletionResult {
  if (!db) return { ok: false, error: 'No database' }
  try {
    const row = db
      .prepare(
        `SELECT id, source_type, account_id, beap_package_json FROM inbox_messages WHERE id = ?`,
      )
      .get(messageId) as
      | {
          id: string
          source_type?: string | null
          account_id?: string | null
          beap_package_json?: string | null
        }
      | undefined

    if (!row) return { ok: false, error: 'Message not found' }
    if (!isDirectBeapRow(row)) return { ok: false, error: 'Not a native BEAP message' }

    const tx = db.transaction(() => {
      const attRows = db
        .prepare('SELECT storage_path FROM inbox_attachments WHERE message_id = ?')
        .all(messageId) as Array<{ storage_path?: string | null }>
      for (const a of attRows) {
        const p = a.storage_path
        if (p && typeof p === 'string' && existsSync(p)) {
          try {
            unlinkSync(p)
          } catch {
            /* ignore */
          }
        }
      }
      try {
        db.prepare('DELETE FROM inbox_embeddings WHERE message_id = ?').run(messageId)
      } catch {
        /* older DBs */
      }
      db.prepare('DELETE FROM inbox_attachments WHERE message_id = ?').run(messageId)
      db.prepare('DELETE FROM deletion_queue WHERE message_id = ?').run(messageId)
      const pkg = row.beap_package_json
      if (pkg != null && String(pkg).trim()) {
        db.prepare('DELETE FROM p2p_pending_beap WHERE package_json = ?').run(String(pkg))
      }
      db.prepare('DELETE FROM inbox_messages WHERE id = ?').run(messageId)
    })
    tx()
    return { ok: true }
  } catch (e: any) {
    console.error('[RemoteDeletion] purgeDirectBeapMessageLocal error:', e?.message)
    return { ok: false, error: e?.message ?? 'Failed to delete native BEAP message' }
  }
}

/** Dev helper: remove all `direct_beap` rows (same cleanup as single purge per message). */
export function deleteAllDirectBeapMessages(db: any): { deleted: number; failed: number } {
  const out = { deleted: 0, failed: 0 }
  if (!db) return out
  try {
    const ids = db
      .prepare(`SELECT id FROM inbox_messages WHERE source_type = 'direct_beap'`)
      .all() as Array<{ id: string }>
    for (const { id } of ids) {
      const r = purgeDirectBeapMessageLocal(db, id)
      if (r.ok) out.deleted++
      else out.failed++
    }
  } catch (e: any) {
    console.error('[RemoteDeletion] deleteAllDirectBeapMessages error:', e?.message)
  }
  return out
}

// ── Types ──

export interface QueueRemoteDeletionResult {
  ok: boolean
  gracePeriodEnds?: string
  error?: string
}

export interface BulkQueueDeletionResult {
  queued: number
  failed: number
}

export interface ExecutePendingDeletionsResult {
  executed: number
  failed: number
}

// ── Exports ──

/**
 * Queue a message for remote deletion after grace period.
 */
export function queueRemoteDeletion(
  db: any,
  messageId: string,
  gracePeriodHours: number = 72,
): QueueRemoteDeletionResult {
  if (!db) return { ok: false, error: 'No database' }
  try {
    const row = db
      .prepare(
        'SELECT account_id, email_message_id, source_type FROM inbox_messages WHERE id = ?',
      )
      .get(messageId) as
      | { account_id: string; email_message_id: string; source_type?: string | null }
      | undefined

    if (!row) {
      return { ok: false, error: 'Message not found' }
    }

    if (isDirectBeapRow(row)) {
      return purgeDirectBeapMessageLocal(db, messageId)
    }

    if (!row.account_id || !row.email_message_id) {
      return { ok: false, error: 'Message not found or not from email' }
    }

    let providerType: string
    try {
      providerType = emailGateway.getProviderSync(row.account_id)
    } catch (e: any) {
      const msg = e?.message ?? 'Account not available'
      console.warn('[RemoteDeletion] queueRemoteDeletion: skip —', msg)
      return { ok: false, error: msg }
    }

    const now = new Date()
    const graceEnd = new Date(now.getTime() + gracePeriodHours * 60 * 60 * 1000)
    const gracePeriodEnds = graceEnd.toISOString()
    const nowStr = now.toISOString()

    db.prepare(
      `UPDATE inbox_messages SET deleted = 1, deleted_at = ?, purge_after = ? WHERE id = ?`
    ).run(nowStr, gracePeriodEnds, messageId)
    const queueId = randomUUID()

    db.prepare(
      `INSERT INTO deletion_queue (id, message_id, account_id, email_message_id, provider_type, queued_at, grace_period_ends, executed, cancelled)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0)`
    ).run(queueId, messageId, row.account_id, row.email_message_id, providerType, nowStr, gracePeriodEnds)

    return { ok: true, gracePeriodEnds }
  } catch (e: any) {
    console.error('[RemoteDeletion] queueRemoteDeletion error:', e?.message)
    return { ok: false, error: e?.message ?? 'Failed to queue deletion' }
  }
}

/**
 * Cancel a queued remote deletion and restore the message.
 */
export function cancelRemoteDeletion(db: any, messageId: string): boolean {
  if (!db) return false
  try {
    const row = db.prepare(
      'SELECT id FROM deletion_queue WHERE message_id = ? AND executed = 0 AND cancelled = 0'
    ).get(messageId) as { id: string } | undefined

    if (!row) return false

    db.prepare('UPDATE deletion_queue SET cancelled = 1 WHERE id = ?').run(row.id)
    db.prepare(
      'UPDATE inbox_messages SET deleted = 0, deleted_at = NULL, purge_after = NULL WHERE id = ?'
    ).run(messageId)

    return true
  } catch (e: any) {
    console.error('[RemoteDeletion] cancelRemoteDeletion error:', e?.message)
    return false
  }
}

/**
 * Execute pending deletions whose grace period has ended.
 */
export async function executePendingDeletions(db: any): Promise<ExecutePendingDeletionsResult> {
  const result: ExecutePendingDeletionsResult = { executed: 0, failed: 0 }
  if (!db) return result

  try {
    const now = new Date().toISOString()
    const rows = db.prepare(
      `SELECT dq.id, dq.message_id, dq.account_id, dq.email_message_id,
              m.imap_remote_mailbox, m.imap_rfc_message_id
       FROM deletion_queue dq
       JOIN inbox_messages m ON m.id = dq.message_id
       WHERE dq.executed = 0 AND dq.cancelled = 0 AND dq.grace_period_ends <= ?
       ORDER BY dq.grace_period_ends ASC LIMIT 10`,
    ).all(now) as Array<{
      id: string
      message_id: string
      account_id: string
      email_message_id: string
      imap_remote_mailbox?: string | null
      imap_rfc_message_id?: string | null
    }>

    for (const r of rows) {
      try {
        await emailGateway.deleteMessage(r.account_id, r.email_message_id, {
          imapRemoteMailbox: r.imap_remote_mailbox ?? null,
          imapRfcMessageId: r.imap_rfc_message_id ?? null,
        })
        db.prepare(
          'UPDATE deletion_queue SET executed = 1, executed_at = ?, execution_error = NULL WHERE id = ?'
        ).run(now, r.id)
        db.prepare(
          'UPDATE inbox_messages SET remote_deleted = 1, remote_deleted_at = ? WHERE id = ?'
        ).run(now, r.message_id)
        result.executed++
      } catch (err: any) {
        const errMsg = err?.message ?? 'Unknown error'
        db.prepare(
          'UPDATE deletion_queue SET execution_error = ? WHERE id = ?'
        ).run(errMsg, r.id)
        result.failed++
        console.error('[RemoteDeletion] Execute failed:', r.message_id, errMsg)
      }
    }

    // Purge inbox_messages where remote_deleted=1 and remote_deleted_at > 30 days ago
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 30)
    const cutoffStr = cutoff.toISOString()
    try {
      db.prepare(
        'DELETE FROM inbox_messages WHERE remote_deleted = 1 AND remote_deleted_at < ?'
      ).run(cutoffStr)
    } catch (purgeErr: any) {
      console.error('[RemoteDeletion] Purge cleanup error:', purgeErr?.message)
    }
  } catch (e: any) {
    console.error('[RemoteDeletion] executePendingDeletions error:', e?.message)
  }

  return result
}

/**
 * Bulk queue multiple messages for remote deletion.
 */
export function bulkQueueDeletion(
  db: any,
  messageIds: string[],
  gracePeriodHours: number = 72,
): BulkQueueDeletionResult {
  const result: BulkQueueDeletionResult = { queued: 0, failed: 0 }
  if (!db || !messageIds.length) return result

  const tx = db.transaction(() => {
    for (const messageId of messageIds) {
      const r = queueRemoteDeletion(db, messageId, gracePeriodHours)
      if (r.ok) result.queued++
      else result.failed++
    }
  })
  tx()

  return result
}
