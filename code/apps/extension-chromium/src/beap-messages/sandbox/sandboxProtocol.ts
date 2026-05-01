/**
 * Sandbox IPC Protocol — Stage 5 Isolation Boundary
 * Per A.3.055 Stage 5 and Annex I §I.2 (Normative)
 *
 * This module defines the ONLY communication contract between the Host
 * Orchestrator (extension renderer/sidepanel) and the Sandbox Sub-Orchestrator
 * (Chrome Extension sandboxed page). All data crossing the boundary MUST
 * conform to one of these message types.
 *
 * Design invariants:
 *   - All fields are plain JSON-serialisable (no Uint8Array, no functions,
 *     no class instances). `postMessage` structured-clone would strip functions
 *     anyway — this enforces it at the type level.
 *   - The host NEVER receives derived key material, raw ciphertext, or internal
 *     pipeline error details. Outbound types are stripped of all secrets.
 *   - Every message carries a `requestId` (UUID v4) for correlation. Unmatched
 *     responses are silently discarded by the SandboxClient.
 *   - The host always supplies `timeoutMs`; the sandbox enforces it independently.
 *
 * Message flow:
 *
 *   Host                               Sandbox
 *    │── SandboxRequest ─────────────►  │
 *    │◄─ SandboxAck ──────────────────  │  (optional, sent on receipt)
 *    │◄─ SandboxSuccess / SandboxFailure │  (final response, exactly one)
 */

import type {
  DecryptedCapsulePayload,
  DecryptedArtefact,
  AuthorizedProcessingResult,
  InnerEnvelopeMetadata,
  PoAEVerificationResult,
  PoAERLog,
} from '../services'

// =============================================================================
// Resource Limits
// =============================================================================

/** Hard timeout for a single depackage operation (ms). */
export const SANDBOX_DEPACKAGE_TIMEOUT_MS = 15_000

/** Soft memory threshold (bytes) — logged as a warning, not a hard kill. */
export const SANDBOX_MEMORY_LIMIT_BYTES = 256 * 1024 * 1024 // 256 MB

/** Origin string used for same-page postMessage origin checks. */
export const SANDBOX_MESSAGE_ORIGIN = '*'

// =============================================================================
// Request Types (Host → Sandbox)
// =============================================================================

/**
 * Options that may be serialised and sent to the sandbox.
 *
 * This is a strict subset of `decryptBeapPackage` options — any field that
 * cannot be JSON-round-tripped (functions, class instances, Uint8Array) is
 * excluded. The sandbox constructs native types from these plain values.
 */
export interface SandboxDecryptOptions {
  /** Handshake ID for qBEAP legacy v1.0 path. */
  handshakeId?: string

  /**
   * Serialised local handshake records for v2.0 Stage 0 eligibility check.
   * `hybridSharedSecret` is a hex-encoded string (not Uint8Array) here.
   */
  handshakes?: SerializedLocalHandshake[]

  /** Sender's X25519 public key (base64). Fallback: package header.crypto.senderX25519PublicKeyB64 */
  senderX25519PublicKey?: string

  /** Receiver's ML-KEM-768 secret key (base64) for hybrid qBEAP decapsulation. Required when package has pq.kemCiphertextB64 */
  mlkemSecretKeyB64?: string

  /**
   * Pre-derived hybrid shared secret (64 bytes, base64) when host performs ML-KEM
   * decapsulation before sandbox. Sandbox has no network access; when present,
   * Gate 4 skips ECDH + pqDecapsulate and uses this directly for deriveBeapKeys.
   */
  hybridSharedSecretB64?: string

  /** Skip signature verification (NOT recommended; documented for test use only). */
  skipSignatureVerification?: boolean

  /** Known sender identities for Gate 1 verification. */
  knownSenders?: SerializedSenderIdentity[]

  /** Local receiver identity for Gate 2 verification. */
  knownReceiver?: SerializedKnownReceiver

  /**
   * Known template hash map encoded as an array of [templateId, hash] pairs
   * (since `Map` does not serialise via JSON.stringify).
   */
  knownTemplateHashEntries?: [string, string][]

  /** Expected content hash for Gate 6 content pinning. */
  expectedContentHash?: string

  /**
   * Whether to permit PoAE-R log generation at Stage 7.
   * Default: false.
   */
  permitPoAERLog?: boolean

  /**
   * Hard timeout for this specific request (ms).
   * Overrides `SANDBOX_DEPACKAGE_TIMEOUT_MS` if set.
   * The sandbox enforces this independently of the host-side timeout.
   */
  timeoutMs?: number
}

/**
 * Serialised form of `LocalHandshake` — Uint8Array fields encoded as hex strings.
 */
export interface SerializedLocalHandshake {
  handshakeId: string
  senderFingerprint: string
  receiverFingerprint: string
  /** Hex-encoded 64-byte hybrid shared secret. */
  hybridSharedSecretHex: string
  establishedAt?: number
}

/**
 * Serialised form of `SenderIdentity` from depackagingPipeline.
 */
export interface SerializedSenderIdentity {
  fingerprint: string
  publicKey?: string
  keyId?: string
  trusted?: boolean
}

/**
 * Serialised form of `KnownReceiver` from depackagingPipeline.
 */
export interface SerializedKnownReceiver {
  fingerprint: string
  fingerprintShort?: string
}

/**
 * A request sent from the host to the sandbox to depackage a raw .beap payload.
 */
export interface SandboxRequest {
  /** Unique request correlation ID (UUID v4). */
  requestId: string

  /**
   * Message type discriminator.
   * Currently only `'DEPACKAGE'` is defined; reserved for future extension.
   */
  type: 'DEPACKAGE'

  /**
   * Raw .beap package as a JSON string.
   * The sandbox calls `parseBeapFile(rawBeapJson)` as its first step.
   * The host MUST pass the exact bytes from the ingress store.
   */
  rawBeapJson: string

  /** Decryption options (serialised for structured-clone). */
  options: SandboxDecryptOptions

  /**
   * Hard timeout in milliseconds for this request.
   * The sandbox enforces this independently; the host also races a timeout.
   * Defaults to `SANDBOX_DEPACKAGE_TIMEOUT_MS` when absent.
   */
  timeoutMs: number
}

// =============================================================================
// Response Types (Sandbox → Host)
// =============================================================================

/**
 * Sanitised `DecryptedPackage` — the ONLY capsule data that crosses Stage 5.
 *
 * Deliberately excludes:
 *   - `pipelineResult.verifiedContext` (contains derived AEAD keys)
 *   - Any raw ciphertext fields
 *   - Internal pipeline error messages (only `nonDisclosingError` surfaces)
 *
 * Consumers MUST check `authorizedProcessing.decision === 'AUTHORIZED'` before
 * using capsule content for any processing.
 */
export interface SanitisedDecryptedPackage {
  /** Parsed outer envelope header (all governance metadata). */
  header: DecryptedPackageHeader

  /** Decrypted capsule payload (subject, body, attachments). */
  capsule: DecryptedCapsulePayload

  /** Decrypted artefacts. */
  artefacts: DecryptedArtefact[]

  /** Package metadata (created_at, delivery_method, filename). */
  metadata: {
    created_at: number
    delivery_method: string
    delivery_hint?: string
    filename: string
    inbox_response_path?: {
      sandbox_clone?: boolean
      original_source_type?: string
      original_response_path?: 'email' | 'native_beap'
      reply_transport?: 'email' | 'native_beap'
    }
  }

  /** Signature verification outcome. */
  verification: {
    signatureValid: boolean
    signatureAlgorithm: string
    signerKeyId: string
    verifiedAt: number
  }

  /**
   * Stage 6.1 processing event gate result.
   * Consumers MUST NOT process capsule content unless `decision === 'AUTHORIZED'`.
   */
  authorizedProcessing: AuthorizedProcessingResult

  /** Decrypted inner envelope metadata (v2.0 qBEAP only). */
  innerEnvelopeMetadata: InnerEnvelopeMetadata | null

  /** Stage 2 PoAE record verification result. */
  poaeVerification: PoAEVerificationResult | null

  /** Stage 7 PoAE-R log (receiver-side execution evidence). */
  poaeRLog: PoAERLog | null

  /**
   * High-level gate summary.
   * `allGatesPassed === true` means Gates 1–6 + Stages 0, 2, 4 all succeeded.
   * Consumers should treat `false` or absent as a verification failure.
   */
  allGatesPassed: boolean

  /**
   * Timestamp (ms) at which the sandbox completed verification.
   * Useful for audit logging and freshness checks.
   */
  verifiedAt: number
}

/**
 * Minimal header information surfaced through the sandbox boundary.
 * Excludes raw crypto bytes (encapsulated PQ ciphertext, etc.).
 */
export interface DecryptedPackageHeader {
  version: string
  encoding: 'qBEAP' | 'pBEAP'
  timestamp: number
  sender_fingerprint: string
  receiver_fingerprint?: string
  template_hash: string
  policy_hash: string
  content_hash: string
  signing: {
    algorithm: string
    keyId: string
    publicKey: string
  }
  compliance?: {
    canon: string
    notes?: string[]
  }
}

/**
 * Optional acknowledgement sent immediately on receipt of a `SandboxRequest`.
 * Allows the host to confirm the sandbox is alive before the timeout fires.
 */
export interface SandboxAck {
  requestId: string
  type: 'ACK'
  receivedAt: number
}

/**
 * Successful depackage result.
 */
export interface SandboxSuccess {
  requestId: string
  type: 'DEPACKAGE_RESULT'

  /** The sanitised, secrets-free verified package. */
  result: SanitisedDecryptedPackage
}

/**
 * Failed depackage — fail-closed response.
 *
 * Per Canon §10 and A.3.055: error details MUST NOT disclose internal
 * pipeline state, key material, or receiver-identifying information.
 * Only the non-disclosing error string crosses the boundary.
 */
export interface SandboxFailure {
  requestId: string
  type: 'DEPACKAGE_FAILURE'

  /**
   * Non-disclosing error string safe for display in the UI.
   * Does NOT contain key material, gate-specific details, or fingerprints.
   */
  nonDisclosingError: string

  /**
   * Which stage produced the failure (coarse-grained, non-disclosing).
   * Used for UI state (show "verification failed" vs "timeout" etc.).
   */
  failureStage: SandboxFailureStage
}

/**
 * Coarse-grained failure stage indicator.
 * These values are safe to surface externally — they contain no secrets.
 */
export type SandboxFailureStage =
  | 'PARSE'        // parseBeapFile failed (malformed JSON / not a BEAP package)
  | 'PIPELINE'     // One or more gates 1-6 failed
  | 'STAGE2_POAE'  // Stage 2 PoAE anchor required but verification failed
  | 'STAGE4'       // Inner envelope decryption failed
  | 'GATE'         // Stage 6.1 processing event gate blocked
  | 'TIMEOUT'      // Hard timeout exceeded
  | 'INTERNAL'     // Unhandled exception inside sandbox (fail-closed)

/** Tagged union of all sandbox response message types. */
export type SandboxResponse = SandboxAck | SandboxSuccess | SandboxFailure

// =============================================================================
// Type Guards
// =============================================================================

export function isSandboxAck(msg: SandboxResponse): msg is SandboxAck {
  return msg.type === 'ACK'
}

export function isSandboxSuccess(msg: SandboxResponse): msg is SandboxSuccess {
  return msg.type === 'DEPACKAGE_RESULT'
}

export function isSandboxFailure(msg: SandboxResponse): msg is SandboxFailure {
  return msg.type === 'DEPACKAGE_FAILURE'
}

/**
 * Runtime guard: checks that an unknown postMessage payload is a valid
 * SandboxResponse with the expected requestId.
 *
 * Discards any message that does not match the current request, preventing
 * confused-deputy attacks from other frames.
 */
export function isMatchingSandboxResponse(
  data: unknown,
  expectedRequestId: string
): data is SandboxResponse {
  if (typeof data !== 'object' || data === null) return false
  const d = data as Record<string, unknown>
  if (typeof d['requestId'] !== 'string') return false
  if (d['requestId'] !== expectedRequestId) return false
  if (typeof d['type'] !== 'string') return false
  return d['type'] === 'ACK' || d['type'] === 'DEPACKAGE_RESULT' || d['type'] === 'DEPACKAGE_FAILURE'
}

// =============================================================================
// Serialisation Helpers
// =============================================================================

/**
 * Encode a `Uint8Array` as a lowercase hex string for cross-boundary transport.
 */
export function uint8ArrayToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Decode a hex string back to `Uint8Array` inside the sandbox.
 */
export function hexToUint8Array(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('Invalid hex string length')
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}
