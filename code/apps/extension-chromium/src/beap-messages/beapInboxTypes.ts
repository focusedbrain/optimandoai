/**
 * BEAP Inbox Domain Model
 *
 * Canonical data model for all received BEAP messages. Used by the inbox,
 * handshake message panel, and bulk-inbox views — a single source of truth
 * with derived views computed in useBeapInboxStore.
 *
 * Design notes:
 *  - `canonicalContent` is the capsule-bound authoritative body (decrypted).
 *  - `messageBody` is the transport plaintext (non-authoritative; shown when
 *    the capsule has not yet been verified or for pBEAP public messages).
 *  - A null `handshakeId` means the message arrived as a depackaged email
 *    (no established handshake). Reply mode is derived from this field.
 *  - `urgency` defaults to 'normal'; overwritten by AI classification or
 *    manual assignment.
 *
 * @version 1.0.0
 */

import type { ProcessingEventOffer } from './services/processingEvents'

// =============================================================================
// Primitive Types
// =============================================================================

/** Trust level assigned at depackaging; maps to BEAP canonical trust classes. */
export type TrustLevel = 'enterprise' | 'pro' | 'standard' | 'depackaged'

/**
 * Urgency assigned by AI classification or manual override.
 * Used for sorting and visual priority in all three views.
 */
export type UrgencyLevel = 'urgent' | 'action-required' | 'normal' | 'irrelevant'

/** Reply mode derived from handshakeId presence. */
export type ReplyMode = 'beap' | 'email'

/** Distribution encoding of the original message. Used for reply mode matching. */
export type BeapEncoding = 'qBEAP' | 'pBEAP' | 'none' | 'unknown'

// =============================================================================
// BeapAttachment
// =============================================================================

/**
 * A single message attachment in the BEAP inbox store.
 *
 * Values are mapped from the verified package / capsule when a message is
 * ingested (see sanitisedPackageToBeapMessage). They are not produced by
 * running parserService on the receiver for inbox rows.
 * `selected` drives bulk-view checkbox state.
 */
export interface BeapAttachment {
  /** Stable identifier matching the capsule artefact ref. */
  attachmentId: string

  /** Original filename as declared by the sender. */
  filename: string

  /** MIME type declared in the capsule. */
  mimeType: string

  /** Declared size in bytes (from capsule metadata). */
  sizeBytes: number

  /**
   * Semantic / extracted text from the sender's capsule (semanticContent).
   * Mapped from the verified sanitised package for inbox messages, not
   * re-extracted locally by parserService.
   */
  semanticContent?: string

  /**
   * SHA-256 hash of the rasterized representation produced by rasterService.
   * Used to attest rendering fidelity without storing the full image.
   */
  rasterProof?: string

  /** Selection state used exclusively by the bulk-inbox view. */
  selected: boolean
}

// =============================================================================
// AiClassification
// =============================================================================

/**
 * AI-derived content classification for a message.
 * Produced by the AI classification pipeline; absent until classificationran.
 */
export interface AiClassification {
  /** AI-assigned urgency for this message. */
  urgency: UrgencyLevel

  /** One-sentence human-readable summary of the message. */
  summary: string

  /** Suggested next action for the receiver (plain text). */
  suggestedAction: string

  /** Model confidence score [0, 1]. */
  confidence: number
}

// =============================================================================
// DraftReply
// =============================================================================

/**
 * A draft reply associated with this message.
 *
 * `mode` determines the send path: BEAP capsule (requires handshake) or
 * plain email with signature. Derived from `handshakeId` by default, but
 * can be overridden for depackaged-email replies with a manual email draft.
 */
export interface DraftReply {
  /** Draft body text. */
  content: string

  /** Reply delivery mode. */
  mode: ReplyMode

  /** Draft lifecycle state. */
  status: 'draft' | 'ready' | 'sent'
}

// =============================================================================
// DeletionSchedule
// =============================================================================

/**
 * Pending deletion schedule for a message.
 * The message is not deleted until `scheduledAt + gracePeriodMs` has elapsed.
 * A cancelled deletion removes this field entirely.
 */
export interface DeletionSchedule {
  /** Timestamp (ms) when deletion was scheduled. */
  scheduledAt: number

  /** Grace period in milliseconds before final deletion. */
  gracePeriodMs: number
}

// =============================================================================
// BeapMessage — canonical domain model
// =============================================================================

/**
 * Canonical domain model for a received BEAP message.
 *
 * This is the single source of truth consumed by:
 *  - Inbox view  (all non-archived, sorted by timestamp)
 *  - Handshake panel  (filtered by handshakeId)
 *  - Bulk inbox  (paginated batches)
 *
 * Populated from a `SanitisedDecryptedPackage` via `sanitisedPackageToBeapMessage`.
 * Sensitive fields (key material, raw ciphertext) are never present here —
 * they are stripped at the Stage 5 sandbox boundary.
 */
export interface BeapMessage {
  // -------------------------------------------------------------------------
  // Identity & routing
  // -------------------------------------------------------------------------

  /** Unique, stable message identifier. Matches `header.content_hash` prefix. */
  messageId: string

  /**
   * Hex-encoded sender fingerprint from the verified capsule header.
   * Same value used for BEAP identity display and handshake matching.
   */
  senderFingerprint: string

  /**
   * Sender email address.
   * Extracted from capsule metadata; may be empty for anonymous senders.
   */
  senderEmail: string

  /** Sender display name if available in the capsule or handshake record. */
  senderDisplayName?: string

  /**
   * Associated handshake relationship ID.
   * `null` means the message arrived as a depackaged email (no handshake).
   * Used to derive reply mode and shown as a mail/handshake icon in the UI.
   */
  handshakeId: string | null

  /**
   * Distribution encoding of the original package.
   * qBEAP = private/encrypted; pBEAP = public. Used to match reply encoding.
   */
  encoding?: BeapEncoding

  /**
   * Trust level assigned at depackaging.
   * Derived from the capsule's compliance metadata and handshake trust class.
   */
  trustLevel: TrustLevel

  // -------------------------------------------------------------------------
  // Content
  // -------------------------------------------------------------------------

  /**
   * Transport plaintext body (non-authoritative).
   * Present on all messages. For qBEAP, this is the outer preamble.
   * For pBEAP, this is the full public body.
   */
  messageBody: string

  /**
   * Decrypted capsule-bound body (authoritative).
   * For qBEAP: the inner encrypted `body` field after Stage 5 verification.
   * For pBEAP: same as `messageBody` (no inner encryption).
   * Empty string until verified; never null after successful depackaging.
   */
  canonicalContent: string

  /** Attachments declared in the capsule. */
  attachments: BeapAttachment[]

  /** Automation routing tags from the capsule's automation metadata. */
  automationTags: string[]

  /**
   * Processing event offer from the sender (governance metadata).
   * Present only when the capsule includes a processing event declaration.
   */
  processingEvents: ProcessingEventOffer | null

  // -------------------------------------------------------------------------
  // Timestamps
  // -------------------------------------------------------------------------

  /** Unix timestamp (ms) of the capsule's declared creation time. */
  timestamp: number

  /** Unix timestamp (ms) at which this message was received locally. */
  receivedAt: number

  // -------------------------------------------------------------------------
  // Read / urgency state
  // -------------------------------------------------------------------------

  /** Whether the receiver has opened/read this message. */
  isRead: boolean

  /**
   * Urgency level.
   * Defaults to 'normal'. Overwritten by `batchClassify` or manual assignment.
   */
  urgency: UrgencyLevel

  // -------------------------------------------------------------------------
  // AI output
  // -------------------------------------------------------------------------

  /**
   * AI classification result.
   * Absent until the AI pipeline has processed this message.
   */
  aiClassification?: AiClassification

  // -------------------------------------------------------------------------
  // Draft reply
  // -------------------------------------------------------------------------

  /**
   * Current draft reply for this message.
   * Set via `setDraftReply`; absent when no draft has been started.
   */
  draftReply?: DraftReply

  // -------------------------------------------------------------------------
  // Deletion scheduling
  // -------------------------------------------------------------------------

  /**
   * Scheduled deletion metadata.
   * Present when deletion has been scheduled but grace period not yet elapsed.
   * Absent (or undefined) when no deletion is scheduled.
   */
  deletionScheduled?: DeletionSchedule

  // -------------------------------------------------------------------------
  // Archive flag
  // -------------------------------------------------------------------------

  /**
   * Whether this message has been archived.
   * Archived messages are excluded from `inboxView` but accessible via
   * explicit archive queries.
   */
  archived: boolean

  // -------------------------------------------------------------------------
  // Validation mark (PR 2 / 2.2 — receive-side gate; PR 5 — UI gate)
  // -------------------------------------------------------------------------

  /**
   * ISO-8601 UTC timestamp set when the receive-side validation gate cleared
   * this message. For extension inbox messages, set to the depackaging
   * timestamp when all pipeline gates pass (`allGatesPassed === true`).
   * Null when validation was not performed or skipped.
   *
   * Per Canon I.3.4 and Decision B (PR 5): artefact-related UI MUST NOT
   * render unless this is non-null and `validation_reason` is null.
   */
  validated_at?: string | null

  /**
   * Validation rejection reason code. Null when validation passed.
   * Any non-null value renders a rejection banner (Decision C — PR 5).
   */
  validation_reason?: string | null

  // -------------------------------------------------------------------------
  // Canonical session import artefact (PR 3 / Decision A — PR 5)
  // -------------------------------------------------------------------------

  /**
   * Canonical session import artefact from the capsule plaintext (PR 3).
   * Present when the sender included one via the PR 4 / 4.1 sender UI.
   * Absent for pre-canon messages (those use the legacy attachment resolver).
   *
   * Mapped from the decrypted capsule by `sanitisedPackageToBeapMessage`.
   * The legacy resolver (`attachment.semanticContent`) remains as fallback —
   * see `sessionImportPayloadResolver.ts` for the resolution chain.
   *
   * NOTE (Step E gap): `depackaged_json` stored in the Electron inbox DB
   * does not yet include `session_import_artefact` at its root. The
   * extension's in-memory `BeapMessage` carries it via this field. Electron's
   * `EmailMessageDetail` will activate the canonical read path once the
   * qBEAP/pBEAP depackager wrappers are updated to hoist this field.
   */
  session_import_artefact?: import('../beap-builder/canonical-types').SessionImportArtefact | null
}

// =============================================================================
// Derived View Descriptors
// =============================================================================

/**
 * A single paginated page of messages for the bulk-inbox view.
 */
export interface BulkViewPage {
  /** Messages in this page, sorted by timestamp descending. */
  messages: BeapMessage[]

  /** 0-based page index. */
  pageIndex: number

  /** Total number of pages based on rows currently loaded in the store. */
  totalPages: number

  /** Total message count (unarchived) among loaded rows. */
  totalCount: number

  /**
   * Phase B, PR B-8.1: true if there are more rows available from main
   * beyond what is currently loaded in the store.
   * When true and the user is on the last loaded page, the UI should
   * trigger loadMoreFromMain() rather than disabling the Next button.
   */
  hasMore: boolean
}
