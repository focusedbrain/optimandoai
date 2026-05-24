/**
 * BEAP Sandbox — Public API
 * Stage 5 Isolation Boundary per A.3.055 Stage 5 and Annex I §I.2
 *
 * P2.8 audit (phase-1/pod-becomes-hot-path):
 * All call sites that reach sandboxDepackage() were audited against the
 * Phase 1 pod-ingestion migration. Both active callers are category (b):
 *   - pendingP2PBeapQueue.processPendingP2PBeapQueue — P2P BEAP received
 *     by the extension (background.ts); the pod handles the same messages
 *     on the Electron side, but the extension path has no pod routing yet.
 *   - importFromFile — .beap file import via the extension UI; this path
 *     has NO pod alternative and is the only depackaging path for offline
 *     / historical BEAP files.
 *
 * TODO(phase-1.5): Route extension depackaging through the pod.
 *   1. Add a pod-client call in the extension background/service-worker
 *      so the extension sends raw BEAP to the pod for validation/depackaging.
 *   2. Remove the iframe sandbox path from importPipeline.verifyImportedMessage.
 *   3. Delete this module (sandbox/), manifest.config.ts sandbox.pages entry,
 *      and apps/electron-vite-project/electron/main/email/mergeExtensionDepackaged.ts.
 *   Until then this module must not be modified; it is the sole depackager for
 *   extension-received BEAP messages.
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
