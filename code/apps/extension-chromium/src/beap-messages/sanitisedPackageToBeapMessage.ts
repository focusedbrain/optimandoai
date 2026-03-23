/**
 * SanitisedDecryptedPackage → BeapMessage mapper
 *
 * Converts the output of the Stage 5 sandbox boundary into the canonical
 * BeapMessage domain model. This is the only entry point for package data
 * into the BeapInbox store — all fields are derived strictly from the
 * sanitised package, ensuring no key material or internal pipeline state
 * ever enters the store.
 *
 * @version 1.0.0
 */

import type { SanitisedDecryptedPackage } from './sandbox/sandboxProtocol'
import type {
  BeapMessage,
  BeapAttachment,
  TrustLevel,
  BeapEncoding,
} from './beapInboxTypes'
import type { ProcessingEventOffer } from './services/processingEvents'

// =============================================================================
// Default Processing Events (receiver-side for depackaged / pBEAP)
// =============================================================================

/**
 * Default ProcessingEventOffer when the sender did not include declarations.
 * Used for depackaged (plain emails) and standard (pBEAP) trust levels.
 *
 * Rationale: plain emails and pBEAP are the user's own mail or public mode —
 * local AI analysis should be unrestricted. No automation (actuating NONE)
 * without explicit consent.
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
// Trust Level Derivation
// =============================================================================

/**
 * Map a package's compliance metadata and encoding to a TrustLevel.
 *
 * Rules:
 *  - pBEAP public messages are always 'depackaged' (no inner encryption).
 *  - qBEAP compliance tag 'enterprise' → 'enterprise'.
 *  - qBEAP compliance tag 'pro' → 'pro'.
 *  - qBEAP with allGatesPassed but no explicit tag → 'standard'.
 *  - Anything else → 'depackaged'.
 */
function deriveTrustLevel(pkg: SanitisedDecryptedPackage): TrustLevel {
  if (pkg.header.encoding === 'pBEAP') return 'depackaged'
  if (!pkg.allGatesPassed) return 'depackaged'

  const tag = pkg.header.compliance?.canon?.toLowerCase() ?? ''
  if (tag.includes('enterprise')) return 'enterprise'
  if (tag.includes('pro')) return 'pro'
  return 'standard'
}

// =============================================================================
// Attachment Mapping
// =============================================================================

function mapAttachments(pkg: SanitisedDecryptedPackage): BeapAttachment[] {
  return pkg.capsule.attachments.map((att) => ({
    attachmentId: att.id,
    filename: att.originalName,
    mimeType: att.originalType,
    sizeBytes: att.originalSize,
    semanticContent: att.semanticContent,
    rasterProof: att.rasterProof?.pages[0]?.sha256,
    selected: false,
  }))
}

// =============================================================================
// Message ID Derivation
// =============================================================================

/**
 * Produce a stable message ID from the content hash.
 * Takes the first 16 hex chars of the content hash for brevity;
 * full hash is preserved in the header for audit.
 */
function deriveMessageId(pkg: SanitisedDecryptedPackage): string {
  const hash = pkg.header.content_hash
  // Use full hash if it's short (e.g. test fixtures), else first 16 chars.
  return hash.length <= 16 ? hash : hash.slice(0, 16)
}

// =============================================================================
// Sender Email Extraction
// =============================================================================

/**
 * Extract a best-effort sender email from capsule or header metadata.
 * The capsule body is not scanned for PII — only declared structured fields
 * are checked. Returns empty string when not present.
 */
function deriveSenderEmail(pkg: SanitisedDecryptedPackage): string {
  // Inner envelope may carry a declared sender email (v2.0 qBEAP).
  const inner = pkg.innerEnvelopeMetadata as Record<string, unknown> | null
  if (inner && typeof inner['senderEmail'] === 'string') {
    return inner['senderEmail']
  }
  // Fall back to sender fingerprint as a display identifier.
  return pkg.header.sender_fingerprint
}

// =============================================================================
// Public Mapper
// =============================================================================

/**
 * Convert a `SanitisedDecryptedPackage` into a `BeapMessage`.
 *
 * @param pkg     - The sanitised package from the Stage 5 sandbox boundary.
 * @param handshakeId - Handshake relationship ID if known; null for depackaged emails.
 * @returns A fully-populated BeapMessage ready to insert into the store.
 */
export function sanitisedPackageToBeapMessage(
  pkg: SanitisedDecryptedPackage,
  handshakeId: string | null,
): BeapMessage {
  const now = Date.now()

  // Authoritative content: inner body for qBEAP, outer body for pBEAP.
  const canonicalContent =
    pkg.capsule.body ??
    pkg.capsule.transport_plaintext ??
    ''

  // Transport plaintext: outer body field (non-authoritative for qBEAP).
  const messageBody =
    pkg.capsule.transport_plaintext ??
    pkg.capsule.body ??
    ''

  // Automation tags: capsule-declared; receiver has final authority.
  const automationTags: string[] = pkg.capsule.automation?.tags ?? []

  // Processing events: surfaced from authorized processing result.
  // When null: set defaults for depackaged/pBEAP so AI classification can run.
  // For pro/enterprise (qBEAP): keep null — sender's explicit declaration is respected.
  const trustLevel = deriveTrustLevel(pkg)
  let processingEvents =
    (pkg.authorizedProcessing as { offer?: ProcessingEventOffer })?.offer ?? null
  if (processingEvents == null && (trustLevel === 'depackaged' || trustLevel === 'standard')) {
    processingEvents = DEFAULT_PROCESSING_EVENTS_LOCAL
  }

  const encoding: BeapEncoding =
    pkg.header.encoding === 'qBEAP' || pkg.header.encoding === 'pBEAP'
      ? pkg.header.encoding
      : 'unknown'

  return {
    messageId: deriveMessageId(pkg),
    senderFingerprint: pkg.header.sender_fingerprint,
    senderEmail: deriveSenderEmail(pkg),
    senderDisplayName: undefined,
    handshakeId,
    encoding,
    trustLevel,
    messageBody,
    canonicalContent,
    attachments: mapAttachments(pkg),
    automationTags,
    processingEvents,
    timestamp: pkg.metadata.created_at,
    receivedAt: now,
    isRead: false,
    urgency: 'normal',
    archived: false,
  }
}
