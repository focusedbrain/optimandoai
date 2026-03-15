/**
 * BEAP Sandbox — Public API
 * Stage 5 Isolation Boundary per A.3.055 Stage 5 and Annex I §I.2
 */

// IPC Protocol types (used by both host and sandbox sides)
export {
  // Request
  type SandboxRequest,
  type SandboxDecryptOptions,
  type SerializedLocalHandshake,
  type SerializedSenderIdentity,
  type SerializedKnownReceiver,

  // Response types
  type SandboxResponse,
  type SandboxAck,
  type SandboxSuccess,
  type SandboxFailure,
  type SandboxFailureStage,

  // Sanitised output (the ONLY capsule data that crosses Stage 5)
  type SanitisedDecryptedPackage,
  type DecryptedPackageHeader,

  // Constants
  SANDBOX_DEPACKAGE_TIMEOUT_MS,
  SANDBOX_MEMORY_LIMIT_BYTES,

  // Type guards
  isSandboxAck,
  isSandboxSuccess,
  isSandboxFailure,
  isMatchingSandboxResponse,

  // Serialisation helpers
  uint8ArrayToHex,
  hexToUint8Array,
} from './sandboxProtocol'

// Host-side client
export {
  SandboxClient,
  sandboxDepackage,
} from './sandboxClient'
