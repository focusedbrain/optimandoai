/**
 * Inbox row reads that enforce seal HMAC verification for all sealed content.
 * Placeholder rows (pending_reason_code) have no seal yet and pass through unchanged.
 *
 * Vault policy (not the stale seal_key_source column alone):
 * - Depackaged email + non-confidential BEAP → outer (ledger / SSO) seal.
 * - Confidential handshake BEAP → inner (VMK) seal.
 */

import {
  sealedQuery,
  isKeyProviderUsable,
  SealVerificationError,
  computeSeal,
  type SealedRow,
  type KeySource,
} from '../sealed-storage'
import type { ReasonCode } from '../vault/capabilityBroker'
import {
  allowsLegacyOuterReseal,
  inboxRowRequiresInnerVault,
  verificationKeySourcesForInboxRow,
} from './inboxRowSealPolicy'

export type InboxPlaceholderRow = {
  pending_reason_code?: string | null
  validation_reason?: string | null
  source_type?: string | null
  handshake_id?: string | null
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

function deferredReasonForRow(row: SealedRow & InboxPlaceholderRow): ReasonCode {
  if (inboxRowRequiresInnerVault(row)) {
    if (!isKeyProviderUsable('inner')) return 'inner_vault_locked'
    return 'key_provider_unbound'
  }
  if (!isKeyProviderUsable('outer')) return 'outer_vault_inactive'
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

function tryVerifyWithKeySource<T extends SealedRow>(
  db: any,
  rowId: string,
  source: KeySource,
): T | null {
  const verified = sealedQuery<T>(db, VERIFY_SELECT, [rowId], 'depackaged_json', {
    forceKeySource: source,
  })
  return verified[0] ?? null
}

function resealInboxRowToLedger(db: any, rowId: string, canonicalJson: string): boolean {
  if (!isKeyProviderUsable('outer')) return false
  try {
    const { seal, seal_input_json } = computeSeal(canonicalJson, rowId, 'outer')
    db.prepare(
      `UPDATE inbox_messages SET seal = ?, seal_input_json = ?, seal_key_source = 'ledger' WHERE id = ?`,
    ).run(seal, seal_input_json, rowId)
    console.log(`[INBOX_SEAL_READ] migrated_row_to_ledger id=${rowId}`)
    return true
  } catch (err: unknown) {
    console.warn(
      `[INBOX_SEAL_READ] migrate_row_to_ledger_failed id=${rowId}:`,
      err instanceof Error ? err.message : err,
    )
    return false
  }
}

function tryLegacyOuterReseal<T extends SealedRow & InboxPlaceholderRow>(
  db: any,
  row: T,
): T | null {
  if (!allowsLegacyOuterReseal(row) || inboxRowRequiresInnerVault(row)) return null
  if (!isKeyProviderUsable('outer')) return null
  const canonical = row.depackaged_json
  if (typeof canonical !== 'string' || !canonical.trim()) return null
  const id = String(row.id)
  if (!resealInboxRowToLedger(db, id, canonical)) return null
  return tryVerifyWithKeySource<T>(db, id, 'outer')
}

/**
 * Return the row if it is a placeholder, passes seal verification, was migrated to
 * ledger, or can be shown as a deferred list row when keys are temporarily unavailable.
 */
export function verifyInboxMessageRowOrNull<T extends SealedRow & InboxPlaceholderRow>(
  db: any,
  row: T | null | undefined,
): T | null {
  if (!row?.id) return null
  if (isInboxPlaceholderRow(row)) return row

  const rowId = String(row.id)
  const sources = verificationKeySourcesForInboxRow(row)

  for (const source of sources) {
    if (!isKeyProviderUsable(source)) continue
    try {
      const verified = tryVerifyWithKeySource<T>(db, rowId, source)
      if (!verified) continue
      if (source === 'inner' && !inboxRowRequiresInnerVault(row) && isKeyProviderUsable('outer')) {
        const canonical = verified.depackaged_json
        if (typeof canonical === 'string' && canonical.trim()) {
          resealInboxRowToLedger(db, rowId, canonical)
          const outerVerified = tryVerifyWithKeySource<T>(db, rowId, 'outer')
          if (outerVerified) return outerVerified
        }
      }
      return verified
    } catch (err: unknown) {
      if (!(err instanceof SealVerificationError)) throw err
    }
  }

  const legacy = tryLegacyOuterReseal(db, row)
  if (legacy) return legacy

  const anyProvider =
    isKeyProviderUsable('outer') ||
    isKeyProviderUsable('inner') ||
    sources.some((s) => isKeyProviderUsable(s))
  if (!anyProvider) {
    const reason = deferredReasonForRow(row)
    console.log(
      `[INBOX_SEAL_READ] deferred_list row=${rowId} reason=${reason} policy=${inboxRowRequiresInnerVault(row) ? 'inner' : 'outer'}`,
    )
    return toDeferredInboxListRow(row, reason)
  }

  console.warn(`[INBOX_SEAL_READ] seal_reject row=${rowId} policy=${inboxRowRequiresInnerVault(row) ? 'inner' : 'outer'}`)
  return null
}

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
