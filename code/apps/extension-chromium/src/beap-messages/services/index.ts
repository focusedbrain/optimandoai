/**
 * BEAP Messages Services
 */

export {
  // Types
  type BeapPackageConfig,
  type BeapEnvelopeHeader,
  type BeapPackage,
  type BeapArtefact,
  type BeapArtefactEncrypted,
  type PackageBuildResult,
  type DeliveryResult,
  type ValidationResult,
  type PQMetadata,
  type SizeLimits,
  
  // Errors
  BeapCanonViolationError,
  
  // Validation
  validatePackageConfig,
  canBuildPackage,
  
  // Package Building
  buildPackage,
  
  // Post-Quantum Availability Check
  isPostQuantumAvailable,
  isPostQuantumAvailableAsync,
  
  // Delivery Actions
  executeEmailAction,
  executeMessengerAction,
  executeDownloadAction,
  executeDeliveryAction
} from './BeapPackageBuilder'

// Inner/Outer Envelope (A.3.055 Stage 4)
export {
  // Types
  type OuterEnvelopeHeader,
  type InnerEnvelopeMetadata,
  type ArtefactTopology,
  type ArtefactTopologyEntry,

  // Functions
  buildArtefactTopology,
  encryptInnerEnvelope,
  decryptInnerEnvelope,
  validateInnerEnvelopeSchema,
} from './outerEnvelope'

// Package Decryption (per canon A.3.055 Pipeline)
export {
  // Types
  type DecryptedCapsulePayload,
  type DecryptedArtefact,
  type DecryptedPackage,
  type VerificationResult,
  type DecryptionResult,

  // Stage 0 eligibility types (re-exported from beapDecrypt for caller convenience)
  type LocalHandshake,
  type EligibilityCheckResult,
  
  // Policy types
  type ReceiverProcessingPolicy,
  type ProcessingGateResult,
  DEFAULT_RECEIVER_POLICY,
  
  // Pipeline Stages
  checkRecipientEligibility,
  verifyEnvelopeIntegrity,
  verifyPackageSignature,
  
  // Decryption
  decryptQBeapPackage,
  decodePBeapPackage,
  decryptBeapPackage,
  
  // Parsing
  parseBeapFile,
  
  // Utilities
  getArtefactByRef,
  getArtefactsForAttachment,
  getOriginalArtefact,
  getRasterArtefacts
} from './beapDecrypt'

// Stage 0 Eligibility Check (A.3.054.3 + A.3.055 Stage 0)
// Types LocalHandshake and EligibilityCheckResult already exported above from beapDecrypt.
export {
  // Additional types not re-exported from beapDecrypt
  type EligibilityOutcome,

  // Functions
  evaluateRecipientEligibility,
  evaluateLegacyEligibility,
  deriveEligibilityMaterial,
} from './eligibilityCheck'

// Canon §10 — 6-Gate Depackaging Verification Pipeline
export {
  // Types (not already re-exported from beapDecrypt above)
  type PipelineInput,
  type Gate1Context,
  type Gate2Context,
  type Gate3Context,
  type Gate4Context,
  type Gate5Context,

  // Gate functions
  gate1SenderIdentity,
  gate2ReceiverIdentity,
  gate3CiphertextIntegrity,
  gate4Decryption,
  gate5SignatureVerification,
  gate6TemplateHash,

  // Orchestrator
  runDepackagingPipeline,
} from './depackagingPipeline'

// Stage 6.1 Processing Event Gate (A.3.055 + A.3.054 Stage 6.1.1)
// Stage 6.2 Consent Resolution (A.3.055 Stage 6.2)
// Stage 6.3 Gating Artefacts (A.3.055 Stage 6.3)
export {
  // Types
  type DataClass,
  type AccessScope,
  type CapabilityToken,
  type ReceiverCapabilityPolicy,
  type ImpliedProcessingEvent,
  type GateDecision,
  type AuthorizedProcessingResult,

  // Stage 6.2 types
  type ConsentBindingContext,
  type ConsentRecord,
  type ClassConsentStatus,
  type ConsentResolutionResult,

  // Stage 6.3 types
  type GatingArtefact,
  type GatingAuditStore,
  type GateContext,

  // Constants
  DEFAULT_CAPABILITY_POLICY,

  // Stage 6.1 gate functions
  extractImpliedEvents,
  alignImpliedWithDeclarations,
  evaluateCapabilityTokens,
  runStage61Gate,

  // Stage 6.2 consent resolution
  resolveConsentRequirements,

  // Stage 6.3 artefact generation
  generateGatingArtefacts,
} from './processingEventGate'

// Crypto Types (from beapCrypto)
export {
  type BeapPQMetadata,
  type BeapCryptoMetadata,
  type EncryptedChunk,
  type ChunkingMetadata,
  type EncryptedArtefact,
  type CapsulePayloadEnc,
  // Chunking utilities
  chunkBytes,
  encryptChunks,
  decryptChunks,
  shouldChunk,
  computeMerkleRoot,
  // Capsule encryption (chunked for canon A.3.042)
  encryptCapsulePayloadChunked,
  // AAD-aware artefact encryption (per canon A.3.054.10)
  encryptArtefactWithAAD,
  encryptOriginalArtefactWithAAD,
  // Canonical AAD Serialization (per canon A.3.054.10)
  stableCanonicalize,
  canonicalSerializeAAD,
  buildEnvelopeAadFields,
  computeEnvelopeAAD,
  // Payload commitment for signing (per canon A.3.054.10)
  type PayloadCommitment,
  // Debug utilities (dev-only)
  getDebugAadStats,
  resetDebugAadStats,
  setDebugAadTrackingEnabled,
  getDebugLastSigningData,
  // Eligibility primitives (A.3.054.3 + A.3.055 Stage 0)
  hmacSha256,
  constantTimeEqual,
  // Post-Quantum KEM Interface
  type PQEncapsulationResult,
  type PQDecapsulationResult,
  PQNotAvailableError,
  setPqAuthHeadersProvider,
  pqKemSupported,
  pqKemSupportedAsync,
  invalidatePqAvailabilityCache,
  pqKemGenerateKeyPair,
  pqEncapsulate,
  pqDecapsulate,
  // Signing key vault integration
  detectAndMigrateEphemeralKey,
} from './beapCrypto'

// X25519 Key Agreement
export {
  // Types
  type X25519KeyPair,
  type X25519KeyAgreementResult,
  
  // Key operations (IPC-backed — private key lives in Electron main)
  getDeviceX25519PublicKey,
  
  // Key Agreement
  deriveSharedSecretX25519,
  x25519ECDH,
  
  // Validation
  hasValidX25519Key,
  validateX25519PublicKey
} from './x25519KeyAgreement'

// Proof of Authenticated Execution (PoAE™) — A.3.054.12 + A.3.055 Stages 2 & 7
export {
  // Core Types
  type PoAEAnchorType,
  type PoAEAnchorReference,
  type PoAERecord,
  type PoAERLog,

  // Anchor Provider Interface + Default Implementation
  type PoAEAnchorProvider,
  type PoAERLogStore,
  LocalAnchorProvider,
  PoAEAnchorError,

  // Generation Parameters
  type GeneratePoAERLogParams,

  // Verification Result
  type PoAEVerificationResult,

  // Functions
  generateUUID,
  computePoAECommitment,
  generatePoAERecord,
  verifyPoAERecord,
  generatePoAERLog,
  computeCapsuleHash,
} from './poae'

// Ed25519 Signing Key Vault — Persistent Identity (replaces ephemeral MVP)
export {
  // Types
  type PersistedEd25519KeyPair,
  type KeyRotationResult,
  type MigrationResult,

  // Lifecycle
  signingKeyExists,
  getOrCreateSigningKeyPair,
  loadSigningKeyPair,
  storeSigningKeyPair,
  touchSigningKeyLastUsed,

  // Rotation
  rotateSigningKeyPair,
  listArchivedSigningKeyIds,
  loadArchivedSigningKeyPair,

  // Migration (from MVP ephemeral key)
  migrateEphemeralSigningKey,

  // Cleanup (factory reset / testing)
  deleteSigningKeyVault,
} from './signingKeyVault'

// A.3.054.6 — URL Normalization
export {
  // Types
  type ExtractedUrl,
  type UrlNormalizationResult,
  type UrlNormalizationVerification,

  // Functions
  normalizeUrls,
  verifyUrlNormalization,
} from './urlNormalizer'

// AI Classification Engine — bulk inbox urgency classifier
export {
  // Types
  type ClassificationResult,
  type ProjectedContent,
  type AIProvider,
  type ClassificationContext,
  type AiClassificationResponse,
  type ClassificationProgressEvent,
  type ClassificationEngineConfig,

  // Core functions
  heuristicClassify,
  projectContent,
  classifyBatch,

  // Helpers
  selectMessagesForAutoDeletion,
  toStoreClassificationMap,
} from './beapClassificationEngine'