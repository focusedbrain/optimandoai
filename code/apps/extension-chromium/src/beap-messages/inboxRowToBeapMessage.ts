/**
 * inboxRowToBeapMessage
 *
 * Converts a sealed `inbox_messages` row (returned by main's
 * `handshake.beapInbox.list` VAULT_RPC) into the renderer-side `BeapMessage`
 * domain model.
 *
 * Design rules (Phase B, PR B-8):
 *   - This is the ONLY entry point for inbox data into the store.
 *   - Every field is derived from main's gate-verified row — no inline
 *     construction from renderer-side sources.
 *   - `aiClassification` and `urgency` are mapped from `ai_analysis_json` /
 *     `urgency_score` as written by the sealed pipeline.
 *
 * @version 1.0.0
 */

import type { BeapMessage, BeapAttachment, AiClassification, UrgencyLevel } from './beapInboxTypes'
import type { BeapInboxRow } from '../handshake/handshakeRpc'
import type { ProcessingEventOffer } from './services/processingEvents'

// =============================================================================
// Urgency mapping
// =============================================================================

/**
 * Map a numeric urgency_score (0–100) stored in main to the renderer's
 * UrgencyLevel enum.  Thresholds mirror the autosort pipeline convention.
 */
function scoreToUrgency(score: number | null | undefined): UrgencyLevel {
  if (score == null) return 'normal'
  if (score >= 75) return 'urgent'
  if (score >= 50) return 'action-required'
  if (score <= 10) return 'irrelevant'
  return 'normal'
}

// =============================================================================
// AI classification mapping
// =============================================================================

function parseAiClassification(
  json: string | null | undefined,
  urgencyScore: number | null | undefined,
): AiClassification | undefined {
  if (!json) return undefined
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>
    const urgency: UrgencyLevel =
      (parsed.urgency as UrgencyLevel | undefined) ?? scoreToUrgency(urgencyScore)
    return {
      urgency,
      confidence: (parsed.confidence as number | undefined) ?? 0,
      summary: (parsed.summary as string | undefined) ?? '',
      suggestedAction: (parsed.suggestedAction as string | undefined) ?? '',
    }
  } catch {
    return undefined
  }
}

// =============================================================================
// Attachment mapping
// =============================================================================

function mapAttachmentsFromRow(
  rowAtts: BeapInboxRow['attachments'],
): BeapAttachment[] {
  return rowAtts.map((a) => ({
    attachmentId: a.attachment_id,
    filename: a.filename ?? '',
    mimeType: a.mime_type ?? 'application/octet-stream',
    sizeBytes: a.size_bytes ?? 0,
    selected: false,
  }))
}

// =============================================================================
// Processing events default
// =============================================================================

/**
 * Default offer for messages without a sender-declared processing offer.
 * Matches the logic in sanitisedPackageToBeapMessage for depackaged rows.
 */
const DEFAULT_PROCESSING_EVENTS_LOCAL: ProcessingEventOffer = {
  schemaVersion: '1.0',
  senderIntentOnly: true,
  declarations: [
    { class: 'semantic', boundary: 'LOCAL', scope: 'FULL', providers: [], retention: 'NONE' },
    { class: 'actuating', boundary: 'NONE', scope: 'MINIMAL', providers: [], retention: 'NONE' },
  ],
}

// =============================================================================
// Canonical content extraction
// =============================================================================

function extractCanonicalContent(depackagedJson: string | null): {
  canonicalContent: string
  messageBody: string
  processingEvents: ProcessingEventOffer | null
  sessionImportArtefact: unknown
} {
  if (!depackagedJson) {
    return { canonicalContent: '', messageBody: '', processingEvents: null, sessionImportArtefact: null }
  }
  try {
    const parsed = JSON.parse(depackagedJson) as Record<string, unknown>
    const body = String(parsed.body ?? '')
    const transport = String(parsed.transport_plaintext ?? '')
    const canonicalContent = body || transport
    const messageBody = transport || body
    const offer = parsed.processing_events as ProcessingEventOffer | null | undefined
    const sessionImportArtefact = parsed.session_import_artefact ?? null
    return {
      canonicalContent,
      messageBody,
      processingEvents: offer ?? null,
      sessionImportArtefact,
    }
  } catch {
    return { canonicalContent: '', messageBody: '', processingEvents: null, sessionImportArtefact: null }
  }
}

// =============================================================================
// Public mapper
// =============================================================================

/**
 * Convert a sealed `inbox_messages` row into a renderer-side `BeapMessage`.
 *
 * @param row - A row returned by `handshake.beapInbox.list` (after sealedQuery
 *              verification on the main side).
 */
export function inboxRowToBeapMessage(row: BeapInboxRow): BeapMessage {
  const { canonicalContent, messageBody, processingEvents, sessionImportArtefact } =
    extractCanonicalContent(row.depackaged_json)

  const aiClassification = parseAiClassification(row.ai_analysis_json, row.urgency_score)
  const urgency: UrgencyLevel = aiClassification?.urgency ?? scoreToUrgency(row.urgency_score)

  const defaultOffer =
    processingEvents == null ? DEFAULT_PROCESSING_EVENTS_LOCAL : processingEvents

  return {
    messageId: row.id,
    senderFingerprint: row.from_address ?? '',
    senderEmail: row.from_address ?? '',
    senderDisplayName: row.from_name ?? undefined,
    handshakeId: row.handshake_id ?? null,
    encoding: row.source_type === 'plain_email' ? 'none' : 'qBEAP',
    trustLevel: row.source_type === 'plain_email' ? 'depackaged' : 'standard',
    messageBody: messageBody || row.body_text || '',
    canonicalContent: canonicalContent || row.body_text || '',
    attachments: mapAttachmentsFromRow(row.attachments),
    automationTags: [],
    processingEvents: defaultOffer,
    timestamp: row.received_at,
    receivedAt: row.received_at,
    isRead: row.read_status === 1,
    urgency,
    archived: row.archived === 1,
    aiClassification,
    validated_at: row.validated_at ?? null,
    validation_reason: row.validation_reason ?? null,
    session_import_artefact: sessionImportArtefact ?? null,
  }
}
