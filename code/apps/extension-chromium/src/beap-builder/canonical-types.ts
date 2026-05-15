/**
 * BEAP™ Capsule Builder Canonical Types
 * 
 * This module defines the canonical model for BEAP Packages:
 * - Envelope: Authoritative, immutable consent boundary
 * - Capsule: Task payload (message, attachments, sessions, data requests)
 * 
 * CRITICAL INVARIANT:
 * Capsule content may NEVER expand envelope-declared capabilities.
 * The envelope is authoritative. The capsule only operates within bounds.
 * 
 * @version 2.0.0
 */

import type { Handshake } from '../handshake/types'
import type { CanonicalAgentConfig } from '../types/CanonicalAgentConfig'
import type { CanonicalAgentBoxConfig } from '../types/CanonicalAgentBoxConfig'
import type { CanonicalDisplayGridConfig } from '../types/CanonicalDisplayGridConfig'

// =============================================================================
// Capability Classes (Envelope-Declared)
// =============================================================================

/**
 * Capability classes that MUST be declared in the envelope
 * The capsule cannot request capabilities beyond these declarations
 */
export type CapabilityClass =
  | 'critical_automation'   // Automation that affects external systems
  | 'monetary'              // Financial transactions
  | 'ui_actions'            // UI manipulation on receiver side
  | 'data_access'           // Access to receiver's data
  | 'session_control'       // Control over automation sessions
  | 'network_egress'        // External network communication
  | 'network_ingress'       // Receiving external data

/**
 * Ingress/Egress constraint declarations
 */
export interface NetworkConstraints {
  /** Explicitly allowed ingress sources */
  allowedIngress: string[]
  
  /** Explicitly allowed egress destinations */
  allowedEgress: string[]
  
  /** Whether offline-only execution is required */
  offlineOnly: boolean
}

// =============================================================================
// Envelope (Authoritative, Immutable)
// =============================================================================

/**
 * BEAP Envelope - The authoritative consent boundary
 * 
 * INVARIANTS:
 * - Never encrypted (must be verifiable before decryption)
 * - Immutable once created (modifications = new envelope)
 * - Contains all capability declarations
 * - Cryptographically binds capsule
 */
export interface BeapEnvelope {
  /** Envelope version */
  version: '1.0'
  
  /** Unique envelope ID */
  envelopeId: string
  
  /** Sender fingerprint */
  senderFingerprint: string
  
  /** Recipient fingerprint (if known) */
  recipientFingerprint: string | null
  
  /** Associated handshake ID (if exists) */
  handshakeId: string | null
  
  /** Hardware attestation status */
  hardwareAttestation: 'verified' | 'pending' | 'unavailable'
  
  /** Creation timestamp */
  createdAt: number
  
  /** Time scope (validity period) */
  validUntil: number | null
  
  /** Replay protection nonce */
  nonce: string
  
  /** Declared capability classes */
  capabilities: CapabilityClass[]
  
  /** Network constraints (ingress/egress) */
  networkConstraints: NetworkConstraints
  
  /** Hash of bound capsule (for integrity) */
  capsuleHash: string | null
  
  /** Envelope signature (cryptographic consent) */
  signature: string | null
}

/**
 * Summary of envelope for UI display
 */
export interface EnvelopeSummary {
  /** Short form of sender fingerprint */
  senderShort: string
  
  /** Full sender fingerprint */
  senderFull: string
  
  /** Handshake name (if available) */
  handshakeName: string | null
  
  /** Hardware attestation status display */
  attestationStatus: string
  
  /** Capability summary (human-readable) */
  capabilitySummary: string
  
  /** Whether envelope needs regeneration */
  requiresRegeneration: boolean
}

// =============================================================================
// Raster Proof (for PDF previews)
// =============================================================================

/**
 * Proof metadata for rasterized PDF pages
 * Contains hashes and refs but NEVER actual image bytes
 */
export interface RasterProof {
  /** Rasterization engine used */
  engine: string
  
  /** Engine version */
  version: string
  
  /** DPI used for rasterization */
  dpi: number
  
  /** Total pages in original PDF */
  pageCount: number
  
  /** Number of pages rasterized */
  pagesRasterized: number
  
  /** Per-page proof data */
  pages: Array<{
    page: number
    width: number
    height: number
    bytes: number  // PNG file size in bytes
    sha256: string
    artefactRef: string
  }>
  
  /** When rasterization was performed */
  rasterizedAt: number
}

// =============================================================================
// Capsule (Task Payload)
// =============================================================================

/**
 * Capsule attachment - parsed/rasterized representation
 * 
 * CRITICAL:
 * - Original artefacts are NEVER embedded directly
 * - Only semantic content (parsed text) goes in capsule
 * - Originals are encrypted + integrity-bound to envelope
 */
export interface CapsuleAttachment {
  /** Unique attachment ID */
  id: string
  
  /** Original filename */
  originalName: string
  
  /** Original file size */
  originalSize: number
  
  /** Original MIME type */
  originalType: string
  
  /** Parsed semantic content (text extracted by Tika) */
  semanticContent: string | null
  
  /** Whether semantic extraction succeeded */
  semanticExtracted: boolean
  
  /** Reference to encrypted original */
  encryptedRef: string
  
  /** Hash of encrypted original (for integrity) */
  encryptedHash: string
  
  /** Rasterized preview reference (if applicable) */
  previewRef: string | null
  
  /** Raster proof metadata (for PDF previews) */
  rasterProof: RasterProof | null
  
  /** Is this a media file (audio/video/image)? */
  isMedia: boolean
  
  /** For media: transcript available? */
  hasTranscript: boolean
}

// CapsuleSessionRef removed in PR 5.3.1 — dead type; canonical artefact path
// (session_import_artefact) supersedes it. No live code constructed an instance.

/**
 * BEAP Capsule - Task payload
 * 
 * INVARIANTS:
 * - Cannot expand envelope capabilities
 * - Only contains semantic content (no raw artefacts)
 */
export interface BeapCapsule {
  /** Capsule version */
  version: '1.0'
  
  /** Unique capsule ID */
  capsuleId: string
  
  /** Message text content */
  text: string
  
  /** Parsed attachments (semantic content only) */
  attachments: CapsuleAttachment[]
  
  /** Data/automation request text */
  dataRequest: string
  
  /** Creation timestamp */
  createdAt: number
  
  /** Hash for envelope binding */
  hash: string | null

  /**
   * Optional session import artefact (Canon A.3.054.8).
   * Exactly one may appear per Capsule; absence is conformant.
   * Reconstructed only after envelope verification, eligibility check,
   * integrity validation, and authenticated decryption.
   *
   * Validated by validateSessionImportArtefact in the Validator stage.
   * The builder serializes this field in PR 3. This declaration enables
   * TypeScript consumers to reference the field before PR 3 lands.
   */
  session_import_artefact?: SessionImportArtefact
}

// =============================================================================
// Builder Context
// =============================================================================

/**
 * Source context for the builder
 */
export type BuilderSource =
  | 'wr-chat-direct'
  | 'wr-chat-group'
  | 'beap-drafts'
  | 'content-script'

/**
 * Context passed to the BEAP Capsule Builder
 */
export interface CapsuleBuilderContext {
  /** Where the builder was invoked from */
  source: BuilderSource
  
  /** Preselected handshake (if available) */
  handshake?: Handshake | null
  
  /** Subject line (if applicable) */
  subject?: string
  
  /** Initial body content */
  body?: string
  
  /** Reply-to package ID */
  replyToPackageId?: string
}

// =============================================================================
// Builder State
// =============================================================================

/**
 * Envelope state in builder (read-only display)
 */
export interface EnvelopeState {
  /** Current envelope (auto-generated) */
  envelope: BeapEnvelope | null
  
  /** Summary for UI display */
  summary: EnvelopeSummary | null
  
  /** Whether envelope requires regeneration */
  requiresRegeneration: boolean
  
  /** Pending capability changes */
  pendingCapabilities: CapabilityClass[]
  
  /** Pending network constraint changes */
  pendingNetworkConstraints: Partial<NetworkConstraints> | null
}

/**
 * Capsule state in builder (editable)
 */
export interface CapsuleState {
  /** Message text */
  text: string
  
  /** Attachments being processed */
  attachments: CapsuleAttachment[]
  
  /** Data/automation request */
  dataRequest: string
  
  /** Attachments currently uploading */
  uploadingAttachments: string[]
  
  /** Processing errors */
  errors: string[]
}

/**
 * Full builder UI state
 */
export interface CapsuleBuilderState {
  /** Is builder open? */
  isOpen: boolean
  
  /** Current context */
  context: CapsuleBuilderContext | null
  
  /** Envelope state (read-only in UI) */
  envelope: EnvelopeState
  
  /** Capsule state (editable in UI) */
  capsule: CapsuleState
  
  /** Is currently building? */
  isBuilding: boolean
  
  /** Validation errors */
  validationErrors: string[]
}

// =============================================================================
// requiresBeapBuilder Helper Result
// =============================================================================

/**
 * Reasons why the BEAP Builder must open
 */
export type BuilderRequiredReason =
  | 'has_attachments'
  | 'has_sessions'
  | 'has_data_request'
  | 'has_ingress_constraints'
  | 'has_egress_constraints'
  | 'user_invoked'

/**
 * Result of requiresBeapBuilder() check
 */
export interface BuilderRequiredResult {
  /** Whether builder must open */
  required: boolean
  
  /** Reasons (empty if not required) */
  reasons: BuilderRequiredReason[]
  
  /** Can proceed silently? */
  canBeSilent: boolean
}

// =============================================================================
// Build Actions
// =============================================================================

/**
 * Result of applying capsule changes
 */
export interface ApplyResult {
  /** Whether apply succeeded */
  success: boolean
  
  /** Generated capsule (if success) */
  capsule: BeapCapsule | null
  
  /** Whether envelope regeneration is needed */
  envelopeRequiresRegeneration: boolean
  
  /** Error message (if failed) */
  error: string | null
}

// =============================================================================
// Quarantine Clone Transport — Phase B PR B-3
// Canon: Phase B Architecture, Amendment 2 to B-3, Decision B
// =============================================================================

/**
 * Metadata marker for a quarantine-clone package sent via the clone-messages
 * transport from host to sandbox.
 *
 * When `sandbox_clone_quarantine` is `true`, the `encryptedMessage` field of
 * the wrapping `BeapPackageConfig` carries an opaque quarantine blob (the
 * original BEAP-bearing email bytes encrypted with X25519 + HKDF + AES-256-GCM
 * using the sandbox's `peer_x25519_public_key_b64` as the encryption target).
 * The sandbox receiver detects this flag and routes to the quarantine-decrypt
 * path instead of normal qBEAP depackaging.
 *
 * ## Transport shape
 *
 * ```
 * BeapPackageConfig {
 *   encryptedMessage: "<base64 quarantine ciphertext>",
 *   inboxResponsePathMetadata: {
 *     sandbox_clone_quarantine: true,
 *     // plus original transport metadata (sender, received_at, rejection_reason)
 *   }
 * }
 * ```
 *
 * ## Security properties
 *
 * - The encrypted blob is independently bound to the sandbox's X25519 private key.
 * - Tampering with `sandbox_clone_quarantine` in transit does not grant access to
 *   the plaintext; the encryption is bound to the receiver's key regardless of flag.
 * - The validator runs over the incoming package on the sandbox side regardless of
 *   the flag value.
 *
 * ## Sandbox-side handling
 *
 * The sandbox receive path detects this flag *before* attempting qBEAP depackaging:
 *
 * ```typescript
 * if (incoming.metadata?.sandbox_clone_quarantine === true) {
 *   const originalBeapBytes = await decryptQuarantineBlob(incoming.encryptedMessage, vault)
 *   return processBeapBytesAsRegularEmail(originalBeapBytes, ...)
 * }
 * ```
 *
 * If the sandbox also cannot depackage the original bytes, the sandbox UI shows a
 * final-state notice and offers [ Delete from Sandbox ] / [ Keep for Audit ] actions.
 *
 * per Phase B Architecture, Amendment 2 to Prompt B-3, Decision B.
 */
export interface QuarantineCloneTransportMetadata {
  /**
   * Discriminator flag. Must be exactly `true` when present.
   * Signals that `encryptedMessage` is a quarantine blob, not a qBEAP payload.
   */
  sandbox_clone_quarantine: true
  /** Original transport sender (IMAP From: address or equivalent). */
  transport_sender?: string
  /** ISO-8601 timestamp when the host first received the original message. */
  transport_received_at?: string
  /** Size of the original quarantine blob in bytes. */
  blob_size_bytes?: number
  /**
   * Plain-language rejection reason from the host's validator.
   * The sandbox renders this verbatim in its final-state UI if it also fails.
   */
  rejection_reason?: string
}

// =============================================================================
// Session Import Artefact Types
// Canon A.3.054.8, Annex I v10 — PR 1/7
// =============================================================================

/**
 * Canonical purpose identifier for a session import artefact.
 *
 * Decision A (PR 4/8): v1.0.0 has exactly one value: 'session_share'.
 * The only purpose a session import artefact has in Phase A is "the sender
 * shares a session so the receiver can import and possibly run it."
 * Future purposes are added in v1.1.0 when those features exist.
 *
 * The validator enforces enum membership: any other value is rejected with
 * 'ARTEFACT_PURPOSE_INVALID'. per A.3.054.8, I.11.5.
 */
export type PurposeIdentifier = 'session_share'

/**
 * Scope constraints for the declared purpose.
 *
 * TODO (canon-owner decision): Only `max_sessions` is defined for v1.0.0
 * as a minimal placeholder. The full scope constraint shape (e.g., allowed
 * page domains, execution environments, data categories) requires a
 * canon-owner decision before additional fields can be added.
 *
 * The validator enforces closed-world checking on this type: unknown keys
 * beyond `max_sessions` are rejected.
 *
 * per A.3.054.8
 */
export interface ScopeConstraints {
  /** Maximum number of sessions that may be imported in one artefact. */
  max_sessions?: number
}

/**
 * Cryptographic binding to a BEAP handshake.
 * Declares that this artefact is valid only within the context of the
 * named handshake. Null when unbound.
 *
 * per A.3.054.8
 */
export interface HandshakeBinding {
  /** Handshake ID matching BeapEnvelope.handshakeId. */
  handshake_id: string
  /** RFC 3339 UTC timestamp when binding was established. */
  bound_at: string
}

/**
 * Declared purpose and scope constraints for the artefact.
 * per A.3.054.8
 */
export interface ArtefactPurpose {
  /** Canonical purpose identifier. 'session_share' in v1.0.0. per A.3.054.8. */
  declared_purpose: PurposeIdentifier
  /** Scope constraints qualifying the declared purpose. */
  scope_constraints: ScopeConstraints
}

/**
 * Orchestrator session content — the only valid session_kind in v1.0.0.
 *
 * Resolution 2: 'workflow_graph' and 'composite' session_kinds are reserved
 * for future protocol versions. A v1.0.0 receiver MUST reject them.
 * The validator rejects any session_kind !== 'orchestrator_session'.
 *
 * per A.3.054.8
 */
export interface OrchestratorSessionContent {
  /** Session kind discriminator. Must be 'orchestrator_session' in v1.0.0. */
  session_kind: 'orchestrator_session'
  /** Unique identifier for this session (matches orchestrator session key). */
  session_id: string
  /** Human-readable session display name. */
  session_name: string
  /**
   * Agent configurations for this session.
   * Canonical format (CanonicalAgentConfig schema v2.1.0).
   */
  agents: CanonicalAgentConfig[]
  /**
   * Agent box configurations for this session.
   * Canonical format (CanonicalAgentBoxConfig schema v1.0.0).
   * Each box carries gridSessionId + slotId linkage back to display_grids[].
   */
  agent_boxes: CanonicalAgentBoxConfig[]
  /**
   * Display grid configurations for this session.
   * Canonical format (CanonicalDisplayGridConfig schema v1.0.0).
   * MUST NOT contain agentBoxes[] — boxes are declared in agent_boxes[] only.
   */
  display_grids: CanonicalDisplayGridConfig[]
  /**
   * Capabilities required to run this session.
   * Must be non-empty when requested_action === 'import_and_offer_run'.
   *
   * Decision B (PR 4/8): typed as CapabilityClass[] per canon. Vocabulary is
   * closed; seven values defined. per A.3.054.8.
   */
  capabilities_required: CapabilityClass[]
}

/**
 * Artefact session.
 *
 * In v1.0.0, exactly equal to OrchestratorSessionContent (not a discriminated
 * union). Future protocol versions may add 'workflow_graph' and 'composite'
 * session_kinds as discriminated branches; a v1.0.0 receiver MUST reject them.
 *
 * per A.3.054.8
 */
export type ArtefactSession = OrchestratorSessionContent

/**
 * One processing event in the artefact policy.
 * per A.3.054.9.1
 */
export interface ProcessingEvent {
  /** Whether this event is semantic (read-only analysis) or actuating (side-effecting). */
  event_class: 'semantic_processing' | 'actuating_processing'
  /** Execution boundary: NONE = in-process only, LOCAL = on-device, REMOTE = network. */
  boundary: 'NONE' | 'LOCAL' | 'REMOTE'
  /** Data scope: MINIMAL = minimal required data, SELECTED = user-selected, FULL = all data. */
  scope: 'MINIMAL' | 'SELECTED' | 'FULL'
}

/**
 * Policy governing how the artefact's sessions may be processed.
 * per A.3.054.9.1
 */
export interface ArtefactPolicy {
  /** Ordered list of processing events declared by the sender. */
  processing_events: ProcessingEvent[]
}

/**
 * Requested action by the sender.
 *
 * import_only: recipient imports but does not offer to run agents.
 * import_and_offer_run: recipient imports and presents a 'Run Automation'
 * option to the user.
 *
 * per A.3.054.8
 */
export type RequestedAction = 'import_only' | 'import_and_offer_run'

/**
 * Reference to a sensitive sub-capsule (ciphertext pointer only).
 *
 * ciphertext_ref references existing BEAP cryptographic primitives (the same
 * primitives used for artefactsEnc). This PR does not introduce new
 * cryptographic primitives. The key derivation and decryption path is PR 3's
 * responsibility.
 *
 * Non-null implies requested_action === 'import_and_offer_run'.
 *
 * per A.3.054.8
 */
export interface SensitiveSubcapsuleRef {
  /** Reference into the BEAP encrypted artefacts store. No key material here. */
  ciphertext_ref: string
  /** Purpose identifier gating access to this sub-capsule. per A.3.054.8. */
  gate_purpose: PurposeIdentifier
}

/**
 * Session import artefact — declarative, schema-versioned, logical JSON.
 *
 * INVARIANTS (Canon A.3.054.8):
 * - Exactly one may appear per Capsule.
 * - Non-executable: the Validator structurally validates it; it does not
 *   execute, render, or interpret the content.
 * - Reconstructed only after envelope verification, eligibility check,
 *   integrity validation, and authenticated decryption.
 * - schema_version '1.0.0' receivers MUST reject any other value.
 *
 * per Canon A.3.054.8, Annex I v10
 */
export interface SessionImportArtefact {
  /** Schema version. Must be exactly '1.0.0' for this receiver. */
  schema_version: '1.0.0'
  /** UUID v4 uniquely identifying this artefact instance. */
  artefact_id: string
  /** RFC 3339 UTC creation timestamp. */
  created_at: string
  /**
   * Cryptographic binding to a BEAP handshake, or null if unbound.
   * per A.3.054.8
   */
  handshake_binding: HandshakeBinding | null
  /**
   * Declared purpose and scope constraints.
   * per A.3.054.8
   */
  purpose: ArtefactPurpose
  /**
   * Session content array. Must contain at least one session.
   * In v1.0.0, all entries must have session_kind === 'orchestrator_session'.
   * per A.3.054.8
   */
  sessions: ArtefactSession[]
  /**
   * Processing policy declared by the sender.
   * per A.3.054.9.1
   */
  policy: ArtefactPolicy
  /**
   * Requested action for the recipient.
   * per A.3.054.8
   */
  requested_action: RequestedAction
  /**
   * Reference to a sensitive sub-capsule, or null.
   * Non-null MUST imply requested_action === 'import_and_offer_run'.
   * per A.3.054.8
   */
  sensitive_subcapsule: SensitiveSubcapsuleRef | null
}

