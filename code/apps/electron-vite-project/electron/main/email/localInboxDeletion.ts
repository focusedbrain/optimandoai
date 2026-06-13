/**
 * Local WRDesk inbox deletion — removes messages from the local store/view only.
 *
 * Reuses the existing `deleted` / `deleted_at` soft-delete columns (same family as
 * the remote-deletion grace path in `remoteDeletion.ts`) but does NOT enqueue
 * `deletion_queue` and never calls provider APIs. `lifecycle_remote_delete_skip_reason`
 * is set to `local_wrdesk_only` so Prompt-2 remote purge cannot pick these rows up.
 *
 * Re-pull behavior: the row remains in `inbox_messages` with `deleted = 1`, so
 * `getExistingEmailMessageIds` still dedupes the provider message id — sync will not
 * insert a second row and the message stays hidden from list queries (`deleted = 0`).
 */

import { prepareSealedOperationalUpdate } from '../sealed-storage/index'

export const LOCAL_WRDESK_DELETE_SKIP_REASON = 'local_wrdesk_only'

export interface LocalDeleteResult {
  ok: boolean
  error?: string
}

export interface BulkLocalDeleteResult {
  deleted: number
  failed: number
}

export function deleteMessageLocal(db: any, messageId: string): LocalDeleteResult {
  if (!db) return { ok: false, error: 'No database' }
  try {
    const row = db
      .prepare('SELECT id FROM inbox_messages WHERE id = ?')
      .get(messageId) as { id: string } | undefined
    if (!row) return { ok: false, error: 'Message not found' }

    const now = new Date().toISOString()
    prepareSealedOperationalUpdate(
      db,
      `UPDATE inbox_messages SET deleted = 1, deleted_at = ?, purge_after = NULL,
        lifecycle_remote_delete_skip_reason = ? WHERE id = ?`,
    ).run(now, LOCAL_WRDESK_DELETE_SKIP_REASON, messageId)

    try {
      db.prepare('DELETE FROM deletion_queue WHERE message_id = ?').run(messageId)
    } catch {
      /* deletion_queue may be absent on very old DBs */
    }

    return { ok: true }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[LocalInboxDeletion] deleteMessageLocal error:', msg)
    return { ok: false, error: msg }
  }
}

export function bulkDeleteMessagesLocal(db: any, messageIds: string[]): BulkLocalDeleteResult {
  const result: BulkLocalDeleteResult = { deleted: 0, failed: 0 }
  if (!db || !messageIds.length) return result

  const tx = db.transaction(() => {
    for (const messageId of messageIds) {
      const r = deleteMessageLocal(db, messageId)
      if (r.ok) result.deleted++
      else result.failed++
    }
  })
  tx()
  return result
}

/** True when a row was locally removed from WRDesk (not queued for origin delete). */
export function isLocallyDeletedRow(row: {
  deleted?: number | null
  lifecycle_remote_delete_skip_reason?: string | null
}): boolean {
  return (
    row.deleted === 1 &&
    String(row.lifecycle_remote_delete_skip_reason ?? '').trim() === LOCAL_WRDESK_DELETE_SKIP_REASON
  )
}
