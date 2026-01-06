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

// Package Decryption (per canon A.3.055 Pipeline)
export {
  // Types
  type DecryptedCapsulePayload,
  type DecryptedArtefact,
  type DecryptedPackage,
  type VerificationResult,
  type DecryptionResult,
  
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
  // Post-Quantum KEM Interface
  type PQEncapsulationResult,
  type PQDecapsulationResult,
  PQNotAvailableError,
  pqKemSupported,
  pqKemSupportedAsync,
  pqKemGenerateKeyPair,
  pqEncapsulate,
  pqDecapsulate
} from './beapCrypto'

// X25519 Key Agreement
export {
  // Types
  type X25519KeyPair,
  type X25519KeyAgreementResult,
  
  // Key Generation & Storage
  generateX25519KeyPair,
  getOrCreateDeviceKeypair,
  getDeviceX25519PublicKey,
  
  // Key Agreement
  deriveSharedSecretX25519,
  x25519ECDH,
  
  // Validation
  hasValidX25519Key,
  validateX25519PublicKey
} from './x25519KeyAgreement'

