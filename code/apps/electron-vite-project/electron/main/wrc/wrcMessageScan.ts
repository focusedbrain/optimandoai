/**
 * `wrc.scanMessage` — the explicit "find WR Codes in this message" trigger
 * (§XVI.3, §XVI.7.4a), decided in main rather than by the surface.
 *
 * A message is scanned only when its sealed row verifies and its Channel
 * Provenance Record decodes with `channel_pass` (DKIM or SPF aligned pass).
 * An unauthenticated sender, a missing or tampered record, or a row whose seal
 * cannot be verified is never scanned: the surface gets `scanAllowed: false`
 * and offers manual entry only (HC2, HC3). The scan itself is the pure local
 * detector; every candidate still goes through `wrc.submitReference`.
 */

import { readChannelProvenanceMetadata } from '@repo/ingestion-core'
import { loadVerifiedInboxMessageById } from '../email/inboxSealedRead'
import { detectWrCodeReferencesInEmailBody, type WrCodeEmailDetection } from '../email/wrCodeEmailDetection'

export interface WrcMessageScanResult {
  scanAllowed: boolean
  /** Empty unless the caller asked to scan and scanning is allowed. */
  detections: WrCodeEmailDetection[]
}

export function handleWrcScanMessage(
  db: unknown,
  params: { messageId?: unknown; scan?: unknown },
): { success: true; result: WrcMessageScanResult } | { success: false; error: string } {
  const messageId = typeof params?.messageId === 'string' ? params.messageId.trim() : ''
  if (!messageId) return { success: false, error: 'messageId is required' }
  if (!db) return { success: false, error: 'Database unavailable' }
  try {
    const row = loadVerifiedInboxMessageById<{
      id: string
      depackaged_metadata?: string | null
      body_text?: string | null
    }>(db, messageId)
    const record = row ? readChannelProvenanceMetadata(row.depackaged_metadata ?? null) : null
    const scanAllowed = record?.channel_pass === true
    const detections =
      scanAllowed && params?.scan === true ? detectWrCodeReferencesInEmailBody(String(row?.body_text ?? '')) : []
    return { success: true, result: { scanAllowed, detections } }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}
