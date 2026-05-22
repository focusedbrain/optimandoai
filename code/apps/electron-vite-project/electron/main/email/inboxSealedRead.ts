/**
 * Inbox row reads that enforce seal HMAC verification for all sealed content.
 * Placeholder rows (pending_reason_code) have no seal yet and pass through unchanged.
 */

import { sealedQuery, type SealedRow } from '../sealed-storage'

export type InboxPlaceholderRow = {
  pending_reason_code?: string | null
}

export function isInboxPlaceholderRow(row: InboxPlaceholderRow | null | undefined): boolean {
  return Boolean(String(row?.pending_reason_code ?? '').trim())
}

const VERIFY_SELECT = `SELECT * FROM inbox_messages WHERE id = ?`

/**
 * Return the row if it is a placeholder or passes sealedQuery verification; otherwise null.
 */
export function verifyInboxMessageRowOrNull<T extends SealedRow & InboxPlaceholderRow>(
  db: any,
  row: T | null | undefined,
): T | null {
  if (!row?.id) return null
  if (isInboxPlaceholderRow(row)) return row
  const verified = sealedQuery<T>(db, VERIFY_SELECT, [row.id], 'depackaged_json')
  return verified[0] ?? null
}

/**
 * Load a single inbox row by id with seal verification (placeholders exempt).
 */
export function loadVerifiedInboxMessageById<T extends SealedRow & InboxPlaceholderRow>(
  db: any,
  messageId: string,
): T | null {
  const id = String(messageId ?? '').trim()
  if (!id) return null
  const raw = db.prepare('SELECT * FROM inbox_messages WHERE id = ?').get(id) as T | undefined
  if (!raw) return null
  return verifyInboxMessageRowOrNull(db, raw)
}

/**
 * Filter a list from raw SQL: drop sealed rows that fail verification; keep placeholders.
 */
export function filterInboxRowsWithVerifiedSeals<T extends SealedRow & InboxPlaceholderRow>(
  db: any,
  rows: T[],
): T[] {
  const out: T[] = []
  for (const row of rows) {
    const verified = verifyInboxMessageRowOrNull(db, row)
    if (verified) out.push(verified)
  }
  return out
}
