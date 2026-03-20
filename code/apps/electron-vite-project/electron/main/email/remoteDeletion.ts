/**
 * Remote Deletion — Soft-delete inbox messages with grace period before remote mailbox deletion.
 *
 * @version 1.0.0
 */

import { randomUUID } from 'crypto'
import { emailGateway } from './gateway'

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
    const row = db.prepare(
      'SELECT account_id, email_message_id FROM inbox_messages WHERE id = ?'
    ).get(messageId) as { account_id: string; email_message_id: string } | undefined

    if (!row?.account_id || !row?.email_message_id) {
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
