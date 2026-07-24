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
export {
  ALL_IDENTITY_CLAIMS,
  fullClaimIdentityMatch,
  isPartialIdentityCollision,
  samePrincipalFullClaim,
} from './identityGuard.js';
export type {
  IdentityClaimName,
  IdentityClaimSet,
  FullClaimGuardResult,
  FullClaimGuardOk,
  FullClaimGuardFail,
  FullClaimGuardFailReason,
  SamePrincipalResult,
} from './identityGuard.js';
// Phase 2 — canonical core (A8, A1–A7, V3) [VII.3, VII.6.1.3]
export {
  canonicalJsonString,
  canonicalJsonBytes,
  domainTag,
  signingBytes,
  CanonicalizationError,
} from './canonical.js';
export type { CanonicalJsonValue } from './canonical.js';
export {
  parseContainer,
  evaluateContainerCriticality,
  isReservedNamespace,
  isImplementedNamespace,
  IMPLEMENTED_NAMESPACES,
  RESERVED_NAMESPACES,
} from './containers.js';
export type { ContainerEntry, ContainerParseResult, CriticalityVerdict } from './containers.js';
export {
  parseCanonicalEnvelope,
  coreSigningValue,
  WR_CORE_OBJECT_TYPE,
  WR_CANONICAL_SCHEMA_VERSION,
} from './coreRecord.js';
export type {
  WrHandshakeCore,
  WrCanonicalEnvelope,
  CorePartyId,
  CoreProfileRef,
  CoreSignature,
  CoreSignatureMode,
  EnvelopeParseResult,
} from './coreRecord.js';
// Phase 3 — profile registry with fail-closed dispatch (B1–B4, B7) [VII.4.1–4.2]
export {
  resolveProfile,
  listProfileRecords,
  checkProfileContainerRules,
  PUBLISHER_ATTESTATION_NS,
  RETIRED_FORMATION_DIALECTS,
} from './profileRegistry.js';
export type { WrProfileRecord, ProfileResolution, ProfileContainerVerdict } from './profileRegistry.js';
// Phase 3 — ingress_path registry (Q4 groundwork) [VII.4.6]
export {
  INGRESS_PATH_REGISTRY,
  isRegisteredIngressPath,
  isRecordableIngressPath,
} from './ingressRegistry.js';
export type { IngressPathEntry } from './ingressRegistry.js';
// Phase 4 — capture methods + invitation classes (V2, C1–C3) [IX.3.1, IX.3.2]
export {
  CAPTURE_METHOD_REGISTRY,
  INVITATION_CLASS_REGISTRY,
  resolveCaptureMethodForFormation,
  resolveInvitationClassForFormation,
  captureMethodPermitsIngressPath,
} from './captureMethods.js';
export type {
  CaptureMethodId,
  CaptureMethodEntry,
  InvitationClassId,
  InvitationClassEntry,
  CaptureMethodResolution,
  InvitationClassResolution,
} from './captureMethods.js';
// Phase 5 — capability-token schema (T4, Q13) [XII.12.6 annex-number-provisional]
export {
  parseCapabilityToken,
  serializeCapabilityToken,
  buildCapabilityTokenWire,
  CAPABILITY_TOKEN_TYPES,
  UNDERSTOOD_LIMIT_EXTENSIONS,
} from './capabilityToken.js';
export type {
  CapabilityToken,
  CapabilityTokenType,
  CapabilityLimitExtension,
  CapabilityTokenParseResult,
} from './capabilityToken.js';
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
