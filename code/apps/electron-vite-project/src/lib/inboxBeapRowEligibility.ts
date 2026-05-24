/**
 * Which inbox rows are “received BEAP-capable” for Redirect + Sandbox clone UI.
 * Aligns with `electron/main/email/beapRedirectSource.ts` (`inboxRowIsReceivedBeapForRedirectOrClone`).
 *
 * Includes:
 * - `direct_beap` / `email_beap` (P2P or email-carried BEAP)
 * - `email_plain` rows that still hold BEAP payloads: non-empty `beap_package_json` and/or depackaged BEAP formats
 *   (e.g. qBEAP decrypted/pending) after email ingress / depackaging.
 *
 * Does not test Host mode — inbox Redirect/Sandbox use `inboxMessageActionable` + `beapInboxSandboxVisibility`.
 */

import type { InboxMessage } from '../stores/useEmailInboxStore'

/**
 * Read the format identifier from `depackaged_metadata` (PR 5.1 primary) with a
 * fallback to `depackaged_json` for rows that pre-date the v63 migration.
 */
export function depackagedFormatFromJson(
  depackaged_json: string | null | undefined,
  depackaged_metadata?: string | null,
): string | null {
  for (const src of [depackaged_metadata, depackaged_json]) {
    if (!src?.trim()) continue
    try {
      const d = JSON.parse(src) as { format?: unknown }
      if (typeof d.format === 'string') return d.format
    } catch {
      /* continue */
    }
  }
  return null
}

/**
 * `email_plain` row that still represents received BEAP content (capsule on disk and/or depackaged BEAP JSON).
 */
export function isEmailPlainRowWithBeapPayload(
  m: Pick<InboxMessage, 'source_type' | 'beap_package_json' | 'depackaged_json' | 'depackaged_metadata'>,
): boolean {
  if (m.source_type !== 'email_plain') return false
  if (m.beap_package_json && String(m.beap_package_json).trim().length > 0) return true
  const fmt = depackagedFormatFromJson(m.depackaged_json, m.depackaged_metadata)
  if (!fmt) return false
  if (fmt === 'beap_qbeap_outbound') return false
  if (fmt.startsWith('beap_')) return true
  if (fmt === 'pbeap') return true
  return false
}

/**
 * Received BEAP-capable message: native/email BEAP types, or depackaged BEAP stored as `email_plain` with signals.
 */
export function isReceivedBeapInboxMessage(
  m: Pick<InboxMessage, 'source_type' | 'beap_package_json' | 'depackaged_json' | 'depackaged_metadata'> | null | undefined,
): boolean {
  if (!m) return false
  const t = m.source_type
  if (t === 'direct_beap' || t === 'email_beap') return true
  if (t === 'email_plain') return isEmailPlainRowWithBeapPayload(m)
  return false
}
