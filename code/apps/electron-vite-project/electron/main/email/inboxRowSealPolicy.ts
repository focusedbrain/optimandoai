/**
 * Which vault/seal key applies to an inbox row (W4-P11 / W4-P12).
 *
 * Product rules:
 * - Depackaged email (`email_plain`, `email_beap`) is never confidential → outer (ledger) seal.
 * - Native BEAP (`direct_beap`) uses outer seal unless the handshake is confidential.
 * - The stored `seal_key_source` column may be stale on legacy rows; policy drives read/migrate.
 */

import { getHandshakeClassification } from '../vault/vaultCanon'
import type { KeySource } from '../sealed-storage'

export function isDepackagedEmailInboxSourceType(sourceType: string | null | undefined): boolean {
  const st = String(sourceType ?? '').trim()
  return st === 'email_plain' || st === 'email_beap'
}

export function inboxRowRequiresInnerVault(row: {
  source_type?: string | null
  handshake_id?: string | null
}): boolean {
  if (isDepackagedEmailInboxSourceType(row.source_type)) return false
  const hs = String(row.handshake_id ?? '').trim()
  if (!hs) return false
  return getHandshakeClassification(hs) === 'confidential'
}

export function effectiveInboxRowSealKeySource(row: {
  source_type?: string | null
  handshake_id?: string | null
}): 'ledger' | 'vmk' {
  return inboxRowRequiresInnerVault(row) ? 'vmk' : 'ledger'
}

/** Key providers to try when verifying (outer-policy rows may be legacy inner-sealed). */
export function verificationKeySourcesForInboxRow(row: {
  source_type?: string | null
  handshake_id?: string | null
}): KeySource[] {
  if (inboxRowRequiresInnerVault(row)) return ['inner']
  return ['outer', 'inner']
}

/** Legacy rows sealed before outer tagging — may be re-wrapped to ledger when SSO is active. */
export function allowsLegacyOuterReseal(row: {
  source_type?: string | null
  validation_reason?: string | null
}): boolean {
  if (isDepackagedEmailInboxSourceType(row.source_type)) return true
  if (row.validation_reason === 'plain_email_no_validation_required') return true
  if (!inboxRowRequiresInnerVault(row)) return true
  return false
}
