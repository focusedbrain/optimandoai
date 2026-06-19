/**
 * @repo/ingestion-core
 *
 * Portable BEAP ingestion and validation. Zero dependencies on Electron, DB, or app state.
 * Can run in: Electron main, child_process, standalone Node.js, Docker.
 */

// Main pipeline
export { validateInput, prepareCoordinationRelayNativeBeapRawInput } from './pipeline.js';
export type { PipelineResult } from './pipeline.js';

// Individual steps
export {
  detectBeapCapsule,
  isMessagePackageStructure,
  isCoordinationRelayNativeBeap,
  normalizeCoordinationRelayNativeBeapWire,
  hasEncryptedMessagePackageBody,
  detectBeapMessagePackage,
} from './beapDetection.js';
export {
  SEALED_SERVICE_RPC_CAPSULE_TYPE,
} from './sealedServiceRpcConstants.js';
export type { SealedServiceRpcCapsuleType } from './sealedServiceRpcConstants.js';
export {
  SANDBOX_OUTBOUND_ALLOWED_TYPES,
  SANDBOX_CONTEXT_SYNC_MAX_BYTES,
  SANDBOX_CONTEXT_SYNC_RATE_WINDOW_MS,
  SANDBOX_CONTEXT_SYNC_MAX_PER_WINDOW,
  deriveCapsuleTypeForEgress,
  isSandboxAllowedOutboundType,
  classifySandboxOutboundCapsule,
  createSandboxContextSyncRateLimiter,
} from './sandboxEgressClassification.js';
export type {
  SandboxEgressCapsuleClass,
  SandboxContextSyncRateLimiter,
} from './sandboxEgressClassification.js';
export { ingestInput } from './ingestor.js';
export { validateCapsule, validateSessionImportArtefact } from './validator.js';
export { validateDecryptedBeapContent, CONTENT_VALIDATOR_VERSION } from './contentValidator.js';
export type { ContentValidationResult } from './contentValidator.js';
export { routeValidatedCapsule } from './distributionGate.js';
export { buildPlainDraftPayload } from './plainTransform.js';
export {
  computeRawInputHash,
  buildProvenanceMetadata,
  buildTransportMetadata,
} from './provenanceMetadata.js';

// Types
export type {
  RawInput,
  RawAttachment,
  SourceType,
  OriginClassification,
  InputClassification,
  TransportMetadata,
  ProvenanceMetadata,
  CandidateCapsuleEnvelope,
  ValidatedCapsule,
  ValidatedCapsulePayload,
  CapsuleType,
  ContentTypeDiscriminator,
  BeapDetectionResult,
  DetectionMethod,
  ValidationResult,
  ValidationReasonCode,
  ArtefactValidationResult,
  DistributionTarget,
  DistributionDecision,
} from './types.js';

export { INGESTION_CONSTANTS } from './types.js';

// Phase B — Sealed Validation IPC protocol
export type {
  ValidateRequest,
  SealedContent,
  SealedQuarantine,
  ValidateResponse,
  SubprocessControlMessage,
  SubprocessAckMessage,
  SubprocessOutboundMessage,
  SubprocessInboundMessage,
} from './sealedValidation.js';
