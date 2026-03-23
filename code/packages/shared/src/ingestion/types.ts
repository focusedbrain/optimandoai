/**
 * Shared Ingestion IPC Types (read-only for extension)
 */

export type SourceType = 'email' | 'file_upload' | 'api' | 'extension' | 'internal';
export type OriginClassification = 'external' | 'internal';
export type InputClassification =
  | 'beap_capsule_present'
  | 'beap_capsule_malformed'
  | 'plain_external_content';

export type DistributionTarget =
  | 'handshake_pipeline'
  | 'sandbox_sub_orchestrator'
  | 'quarantine';

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

export interface IngestionIPCResult {
  readonly success: boolean;
  readonly distribution_target?: DistributionTarget;
  readonly validation_reason_code?: ValidationReasonCode;
  readonly error?: string;
}
