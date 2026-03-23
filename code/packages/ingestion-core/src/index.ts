/**
 * @repo/ingestion-core
 *
 * Portable BEAP ingestion and validation. Zero dependencies on Electron, DB, or app state.
 * Can run in: Electron main, child_process, standalone Node.js, Docker.
 */

// Main pipeline
export { validateInput } from './pipeline.js';
export type { PipelineResult } from './pipeline.js';

// Individual steps
export { detectBeapCapsule, isMessagePackageStructure, detectBeapMessagePackage } from './beapDetection.js';
export { ingestInput } from './ingestor.js';
export { validateCapsule } from './validator.js';
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
  DistributionTarget,
  DistributionDecision,
} from './types.js';

export { INGESTION_CONSTANTS } from './types.js';
