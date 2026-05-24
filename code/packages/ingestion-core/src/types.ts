/**
 * BEAP™ Ingestion Core — Type Definitions
 *
 * Zero dependencies on Electron, DB, or app-specific state.
 */

// ── Source Classification ──

export type SourceType = 'email' | 'file_upload' | 'api' | 'extension' | 'internal' | 'p2p' | 'p2p_relay' | 'relay_pull' | 'coordination_service' | 'coordination_ws';

export type OriginClassification = 'external' | 'internal';

export type InputClassification =
  | 'beap_capsule_present'
  | 'beap_capsule_malformed'
  | 'plain_external_content';

// ── Provenance Metadata ──

export interface ProvenanceMetadata {
  readonly source_type: SourceType;
  readonly origin_classification: OriginClassification;
  readonly ingested_at: string;
  readonly transport_metadata: TransportMetadata;
  readonly input_classification: InputClassification;
  readonly raw_input_hash: string;
  readonly ingestor_version: string;
}

export interface TransportMetadata {
  readonly channel_id?: string;
  readonly message_id?: string;
  readonly sender_address?: string;
  readonly recipient_address?: string;
  readonly received_headers?: ReadonlyArray<string>;
  readonly mime_type?: string;
  readonly content_length?: number;
  readonly source_ip?: string;
}

// ── Raw Input ──

export interface RawInput {
  readonly body: string | Buffer;
  readonly headers?: Record<string, string>;
  readonly mime_type?: string;
  readonly filename?: string;
  readonly attachments?: ReadonlyArray<RawAttachment>;
}

export interface RawAttachment {
  readonly filename: string;
  readonly mime_type: string;
  readonly content: string | Buffer;
}

// ── Candidate Capsule (Ingestor output) ──

export interface CandidateCapsuleEnvelope {
  readonly __brand: 'CandidateCapsule';
  readonly provenance: ProvenanceMetadata;
  readonly raw_payload: unknown;
  readonly ingestion_error_flag: boolean;
  readonly ingestion_error_details?: string;
}

// ── Validated Capsule (Validator output) ──

export interface ValidatedCapsule {
  readonly __brand: 'ValidatedCapsule';
  readonly provenance: ProvenanceMetadata;
  readonly capsule: ValidatedCapsulePayload;
  readonly validated_at: string;
  readonly validator_version: string;
  readonly schema_version: number;
}

export type ContentTypeDiscriminator = 'handshake_capsule' | 'beap_message_package';

export type CapsuleType =
  | 'initiate'
  | 'accept'
  | 'refresh'
  | 'revoke'
  | 'context_sync'
  | 'internal_draft'
  | 'message_package';

/**
 * Validated session import artefact carried inside certain capsule payloads.
 * Structurally verified by validateSessionImportArtefact in the Validator.
 * per Canon A.3.054.8, Annex I v10.
 */
export interface SessionImportArtefact {
  readonly schema_version: '1.0.0';
  readonly artefact_id: string;
  readonly created_at: string;
  readonly handshake_binding: null | Readonly<Record<string, unknown>>;
  readonly purpose: Readonly<Record<string, unknown>>;
  readonly sessions: ReadonlyArray<Readonly<Record<string, unknown>>>;
  readonly policy: Readonly<Record<string, unknown>>;
  readonly requested_action: 'import_only' | 'import_and_offer_run';
  readonly sensitive_subcapsule: null | Readonly<Record<string, unknown>>;
}

/**
 * Common fields shared by every capsule payload variant.
 * Consumers that need the full wire representation cast to `Record<string, any>`.
 * per Canon A.3.054.8, Annex I.3.3 (adversarial closure principle).
 */
interface CapsulePayloadBase {
  readonly content_type?: ContentTypeDiscriminator;
  readonly handshake_id?: string;
  readonly schema_version: number;
  readonly sender_public_key?: string;
  readonly sender_signature?: string;
  readonly countersigned_hash?: string;
  readonly capsule_hash?: string;
  readonly prev_hash?: string;
  readonly sender_id?: string;
  readonly timestamp?: string;
  readonly seq?: number;
  readonly sharing_mode?: string;
  readonly external_processing?: string;
  readonly cloud_payload_mode?: string;
}

/** Handshake initiation capsule. */
export interface InitiateCapsulePayload extends CapsulePayloadBase {
  readonly capsule_type: 'initiate';
  readonly content_type?: 'handshake_capsule';
}

/** Handshake acceptance capsule. */
export interface AcceptCapsulePayload extends CapsulePayloadBase {
  readonly capsule_type: 'accept';
  readonly content_type?: 'handshake_capsule';
}

/** Session refresh capsule. */
export interface RefreshCapsulePayload extends CapsulePayloadBase {
  readonly capsule_type: 'refresh';
  readonly content_type?: 'handshake_capsule';
}

/** Session revocation capsule. */
export interface RevokeCapsulePayload extends CapsulePayloadBase {
  readonly capsule_type: 'revoke';
  readonly content_type?: 'handshake_capsule';
}

/** Context synchronisation capsule. */
export interface ContextSyncCapsulePayload extends CapsulePayloadBase {
  readonly capsule_type: 'context_sync';
  readonly content_type?: 'handshake_capsule';
  readonly context_blocks?: ReadonlyArray<unknown>;
}

/** Internal draft capsule (sender-side, carries session artefact). */
export interface InternalDraftCapsulePayload extends CapsulePayloadBase {
  readonly capsule_type: 'internal_draft';
  readonly content_type?: 'handshake_capsule';
  readonly session_import_artefact?: SessionImportArtefact;
}

/** BEAP message package capsule (qBEAP / pBEAP plaintext). */
export interface MessagePackageCapsulePayload extends CapsulePayloadBase {
  readonly capsule_type: 'message_package';
  readonly content_type?: 'beap_message_package';
  readonly session_import_artefact?: SessionImportArtefact;
}

/**
 * Closed-world discriminated union produced by the Validator after full structural
 * verification.  Each variant is discriminated by `capsule_type`.
 *
 * Consumers that need capsule-type-specific wire fields not enumerated here
 * (e.g. `senderIdentity`, `tierSignals`) cast to `Record<string, any>` deliberately —
 * that cast is the explicit dynamic-access boundary.
 *
 * per Canon A.3.054.8, Annex I.3.3 (adversarial closure principle).
 */
export type ValidatedCapsulePayload =
  | InitiateCapsulePayload
  | AcceptCapsulePayload
  | RefreshCapsulePayload
  | RevokeCapsulePayload
  | ContextSyncCapsulePayload
  | InternalDraftCapsulePayload
  | MessagePackageCapsulePayload;

// ── BEAP Detection ──

export type DetectionMethod = 'mime_type' | 'header_marker' | 'json_structure' | 'attachment_metadata';

export type BeapDetectionResult =
  | { readonly detected: true; readonly raw_capsule_json: unknown; readonly detection_method: DetectionMethod; readonly is_message_package?: true }
  | { readonly detected: false; readonly malformed: boolean; readonly detection_error?: string };

// ── Validation Result ──

export type ValidationResult =
  | { readonly success: true; readonly validated: ValidatedCapsule }
  | { readonly success: false; readonly reason: ValidationReasonCode; readonly details: string };

export type ValidationReasonCode =
  | 'SCHEMA_VERSION_UNSUPPORTED'
  | 'MISSING_REQUIRED_FIELD'
  | 'INVALID_ENUM_VALUE'
  | 'STRUCTURAL_INTEGRITY_FAILURE'
  | 'HASH_BINDING_MISMATCH'
  | 'CRYPTOGRAPHIC_FIELD_MISSING'
  | 'PAYLOAD_SIZE_EXCEEDED'
  | 'MALFORMED_JSON'
  | 'INGESTION_ERROR_PROPAGATED'
  | 'INTERNAL_VALIDATION_ERROR'
  | 'HASH_INTEGRITY_FAILURE'
  | 'CONTEXT_INTEGRITY_FAILURE'
  // Session import artefact validation (Canon A.3.054.8, Annex I v10 PR 1)
  | 'ARTEFACT_UNKNOWN_KEY'
  | 'ARTEFACT_SESSION_KIND_INVALID'
  | 'ARTEFACT_ACTION_POLICY_INCONSISTENT'
  | 'ARTEFACT_CAPABILITY_DECLARATION_MISSING'
  | 'ARTEFACT_SENSITIVE_SUBCAPSULE_REQUIRES_RUN'
  | 'ARTEFACT_FORMAT_INVALID'
  // Closed vocabulary enforcement (PR 4/8) — purpose identifier not in the pinned vocabulary
  | 'ARTEFACT_PURPOSE_INVALID'
  // Plain email rows carry no BEAP capsule; the row is conformant but validation is not applicable.
  | 'plain_email_no_validation_required'
  /** P2P non-confidential path: outer (ledger) seal without validator subprocess (W4-P11). */
  | 'non_confidential_ledger_sealed'
  /** A string field in the candidate payload exceeds MAX_STRING_LENGTH (validator role, P1.4). */
  | 'PAYLOAD_STRING_TOO_LONG'
  /** MIME type carried in transport metadata is not in the ALLOWED_CONTENT_TYPES list (validator role, P1.4). */
  | 'CONTENT_TYPE_NOT_ALLOWED';

/**
 * Discriminated result type for validateSessionImportArtefact.
 * Mirrors the failure branch of ValidationResult without requiring a ValidatedCapsule
 * (artefact validation is a sub-step, not a full capsule validation).
 * per Annex I.3.3
 */
export type ArtefactValidationResult =
  | { readonly success: true }
  | { readonly success: false; readonly reason: ValidationReasonCode; readonly details: string };

// ── Distribution ──

export type DistributionTarget =
  | 'handshake_pipeline'
  | 'sandbox_sub_orchestrator'
  | 'quarantine'
  | 'message_relay';

export interface DistributionDecision {
  readonly target: DistributionTarget;
  readonly validated_capsule: ValidatedCapsule;
  readonly reason: string;
}

// ── Constants ──

export const INGESTION_CONSTANTS = {
  INGESTOR_VERSION: '1.0.0',
  VALIDATOR_VERSION: '1.0.0',
  PIPELINE_VERSION: '1.0.0',
  SUPPORTED_SCHEMA_VERSIONS: [1, 2] as readonly number[],
  MAX_PAYLOAD_BYTES: 10 * 1024 * 1024,
  MAX_RAW_INPUT_BYTES: 15 * 1024 * 1024,
  MAX_JSON_DEPTH: 50,
  MAX_FIELDS: 500,
  MAX_STRING_LENGTH: 5 * 1024 * 1024,
  PIPELINE_TIMEOUT_MS: 10_000,
  ALLOWED_CONTENT_TYPES: [
    'application/json',
    'application/vnd.beap+json',
    'application/beap',
    'text/plain',
    'message/rfc822',
    'multipart/mixed',
    'application/octet-stream',
  ] as readonly string[],
} as const;
