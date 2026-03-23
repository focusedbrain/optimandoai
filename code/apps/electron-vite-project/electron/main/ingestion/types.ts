/**
 * BEAP™ Ingestion & Validation Layer — Type Definitions
 *
 * Two-stage pipeline: Ingestor → Validator → Distribution Gate
 * Type-system-enforced boundary between CandidateCapsule and ValidatedCapsule.
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

// ── Validated Capsule (Validator output — only constructable inside validator.ts) ──

export interface ValidatedCapsule {
  readonly __brand: 'ValidatedCapsule';
  readonly provenance: ProvenanceMetadata;
  readonly capsule: ValidatedCapsulePayload;
  readonly validated_at: string;
  readonly validator_version: string;
  readonly schema_version: number;
}

export interface ValidatedCapsulePayload {
  readonly capsule_type: CapsuleType;
  readonly handshake_id?: string;
  readonly schema_version: number;
  readonly [key: string]: unknown;
}

export type CapsuleType =
  | 'initiate'
  | 'accept'
  | 'refresh'
  | 'revoke'
  | 'context_sync'
  | 'internal_draft';

// ── BEAP Detection ──

export type DetectionMethod = 'mime_type' | 'header_marker' | 'json_structure' | 'attachment_metadata';

export type BeapDetectionResult =
  | { readonly detected: true; readonly raw_capsule_json: unknown; readonly detection_method: DetectionMethod }
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
  | 'INTERNAL_VALIDATION_ERROR';

// ── Distribution ──

export type DistributionTarget =
  | 'handshake_pipeline'
  | 'sandbox_sub_orchestrator'
  | 'quarantine';

export interface DistributionDecision {
  readonly target: DistributionTarget;
  readonly validated_capsule: ValidatedCapsule;
  readonly reason: string;
}

// ── Ingestion Result ──

export type IngestionResult =
  | { readonly success: true; readonly distribution: DistributionDecision; readonly audit: IngestionAuditRecord }
  | { readonly success: false; readonly reason: string; readonly validation_reason_code?: ValidationReasonCode; readonly audit: IngestionAuditRecord };

// ── Audit ──

export interface IngestionAuditRecord {
  readonly timestamp: string;
  readonly raw_input_hash: string;
  readonly source_type: SourceType;
  readonly origin_classification: OriginClassification;
  readonly input_classification: InputClassification;
  readonly validation_result: 'validated' | 'rejected' | 'error';
  readonly validation_reason_code?: ValidationReasonCode;
  readonly distribution_target?: DistributionTarget;
  readonly processing_duration_ms: number;
  readonly pipeline_version: string;
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

// ── Sandbox Queue Status ──

export type SandboxQueueStatus = 'queued' | 'processing' | 'processed' | 'failed';
