/**
 * Inbox row reads that enforce seal HMAC verification for all sealed content.
 * Placeholder rows (pending_reason_code) have no seal yet and pass through unchanged.
 * When the required key provider is unavailable, list reads return sanitized deferred rows
 * (metadata only + pending_reason_code) instead of silently omitting the message.
 */

import {
  sealedQuery,
  isKeyProviderUsable,
  SealVerificationError,
  type SealedRow,
} from '../sealed-storage'
import type { ReasonCode } from '../vault/capabilityBroker'

export type InboxPlaceholderRow = {
  pending_reason_code?: string | null
}

export function isInboxPlaceholderRow(row: InboxPlaceholderRow | null | undefined): boolean {
  return Boolean(String(row?.pending_reason_code ?? '').trim())
}

const VERIFY_SELECT = `SELECT * FROM inbox_messages WHERE id = ?`

const SENSITIVE_LIST_FIELDS = [
  'depackaged_json',
  'depackaged_metadata',
  'body_text',
  'body_html',
  'beap_package_json',
  'raw_capsule_json',
  'ai_analysis_json',
] as const

function rowSealKeySource(row: SealedRow): 'ledger' | 'vmk' {
  return row.seal_key_source === 'ledger' ? 'ledger' : 'vmk'
}

function providerSourceForRow(row: SealedRow): 'inner' | 'outer' {
  return rowSealKeySource(row) === 'ledger' ? 'outer' : 'inner'
}

function deferredReasonForRow(row: SealedRow): ReasonCode {
  const source = providerSourceForRow(row)
  if (source === 'outer' && !isKeyProviderUsable('outer')) {
    return 'outer_vault_inactive'
  }
  if (source === 'inner' && !isKeyProviderUsable('inner')) {
    return 'inner_vault_locked'
  }
  return 'key_provider_unbound'
}

/** Strip sealed plaintext from list rows that cannot be verified yet. */
export function toDeferredInboxListRow<T extends SealedRow & InboxPlaceholderRow>(
  row: T,
  reasonCode: ReasonCode,
): T {
  const out = { ...row } as T
  for (const field of SENSITIVE_LIST_FIELDS) {
    if (field in out) (out as Record<string, unknown>)[field] = null
  }
  out.pending_reason_code = reasonCode
  return out
}

/**
 * Return the row if it is a placeholder, passes sealedQuery verification, or can be
 * shown as a deferred list row when the seal key is temporarily unavailable.
 * Returns null only when verification fails with a bound key (tamper / invalid seal).
 */
export function verifyInboxMessageRowOrNull<T extends SealedRow & InboxPlaceholderRow>(
  db: any,
  row: T | null | undefined,
): T | null {
  if (!row?.id) return null
  if (isInboxPlaceholderRow(row)) return row

  const providerSource = providerSourceForRow(row)
  if (!isKeyProviderUsable(providerSource)) {
    const reason = deferredReasonForRow(row)
    console.log(
      `[INBOX_SEAL_READ] deferred_list row=${row.id} reason=${reason} seal_key_source=${rowSealKeySource(row)}`,
    )
    return toDeferredInboxListRow(row, reason)
  }

  try {
    const verified = sealedQuery<T>(db, VERIFY_SELECT, [row.id], 'depackaged_json')
    if (verified[0]) return verified[0]
  } catch (err: unknown) {
    if (err instanceof SealVerificationError) {
      const reason = deferredReasonForRow(row)
      console.log(
        `[INBOX_SEAL_READ] deferred_list row=${row.id} reason=${reason} (sealedQuery: ${err.message})`,
      )
      return toDeferredInboxListRow(row, reason)
    }
    throw err
  }

  console.warn(
    `[INBOX_SEAL_READ] seal_reject row=${row.id} seal_key_source=${rowSealKeySource(row)} provider=${providerSource}`,
  )
  return null
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
 * Filter a list from raw SQL: verified rows, placeholders, and deferred rows when keys
 * are unavailable. Tampered/invalid seals are omitted.
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
