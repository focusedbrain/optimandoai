/**
 * Plain Email Ingestion — Processes plain_email_inbox into inbox_messages.
 *
 * Converts raw emails to BEAP-compatible depackaged format and updates
 * inbox_messages with depackaged_json and embedding_status.
 * Mirrors the usePendingP2PBeapIngestion pattern for plain emails.
 *
 * @version 1.0.0
 */

import { convertPlainToBeapFormat } from './plainEmailConverter'

const BATCH_SIZE = 100

/**
 * Process pending plain emails from plain_email_inbox.
 * Converts to BEAP-compatible format and updates corresponding inbox_messages.
 * Drains all `processed = 0` rows in batches of {@link BATCH_SIZE}.
 *
 * @returns Total count of rows successfully depackaged (inbox row updated)
 */
export function processPendingPlainEmails(db: any): number {
  if (!db) return 0

  let processed = 0

  try {
    for (;;) {
      const rows = db
        .prepare(
          `SELECT id, message_json, account_id, email_message_id FROM plain_email_inbox
           WHERE processed = 0 ORDER BY created_at ASC LIMIT ?`,
        )
        .all(BATCH_SIZE) as Array<{ id: number; message_json: string; account_id: string; email_message_id: string }>

      if (!rows.length) break

      for (const row of rows) {
        try {
          const rawMsg = JSON.parse(row.message_json)
          const depackaged = convertPlainToBeapFormat(rawMsg)
          const depackagedJson = JSON.stringify(depackaged)

          const updated = db
            .prepare(
              `UPDATE inbox_messages SET depackaged_json = ?, embedding_status = 'pending'
               WHERE account_id = ? AND email_message_id = ?`,
            )
            .run(depackagedJson, row.account_id, row.email_message_id)

          if (updated.changes > 0) {
            processed++
          }

          db.prepare('UPDATE plain_email_inbox SET processed = 1 WHERE id = ?').run(row.id)
        } catch (e: any) {
          console.error('[PlainEmailIngestion] Error processing row', row.id, e?.message)
          try {
            db.prepare('UPDATE plain_email_inbox SET processed = 1 WHERE id = ?').run(row.id)
          } catch {
            /* non-fatal */
          }
        }
      }
    }
  } catch (e: any) {
    console.error('[PlainEmailIngestion] Query error:', e?.message)
    return processed
  }

  return processed
}
