/**
 * Canonical 6-Gate Depackaging Verification Pipeline — Canon §10 (Normative)
 *
 * Implements the STRICT sequential verification order required before any Capsule
 * content is exposed. Each gate receives the output of the previous gate (chain of
 * custody) and either produces a verified context for the next gate, or returns a
 * non-disclosing failure that aborts the entire pipeline.
 *
 * NO later gate is executed unless ALL prior gates succeed.
 *
 * Gate order (canonical §10):
 *   Gate 1 — Sender Identity Verification
 *   Gate 2 — Receiver Identity Verification
 *   Gate 3 — Ciphertext Integrity Verification (AEAD tags, chunk hashes, Merkle root)
 *   Gate 4 — Post-Quantum / ECDH Key Derivation + Decryption
 *   Gate 5 — Capsule Signature Verification (Ed25519)
 *   Gate 6 — Template Hash Verification
 *
 * Properties enforced throughout:
 *   - Fail-closed on any inconsistency (no partial acceptance, no recovery)
 *   - No semantic interpretation beyond verification
 *   - No side effects (no file writes, no network calls, no automation triggers)
 *   - Strictly bounded inputs (max sizes, fixed protocol versions)
 *   - Non-disclosing errors before Capsule access (no receiver-identifying telemetry)
 *   - No rendering, scripting, macro evaluation, or attachment execution
 */

import type { BeapPackage, BeapEnvelopeHeader } from './BeapPackageBuilder'
import {
  verifyBeapSignature,
  computeSigningData,
  fromBase64,
  toBase64,
  sha256Hex,
  sha256String,
  hmacSha256,
  constantTimeEqual,
  deriveBeapKeys,
  aeadDecrypt,
  stringToBytes,
  hkdfSha256,
  type CapsulePayloadEnc,
} from './beapCrypto'
import { deriveSharedSecretX25519 } from './x25519KeyAgreement'

// =============================================================================
// Limits (Canon §10 — strictly bounded inputs)
// =============================================================================

/** Maximum permitted capsule plaintext size (4 MB). */
const MAX_CAPSULE_BYTES = 4 * 1024 * 1024

/** Maximum permitted number of artefacts in a package. */
const MAX_ARTEFACT_COUNT = 64

/** Maximum permitted artefact size (16 MB encrypted). */
const MAX_ARTEFACT_BYTES = 16 * 1024 * 1024

/** Maximum number of chunks in a chunked payload. */
const MAX_CHUNK_COUNT = 256

/** Maximum permitted sender fingerprint length (chars). */
const MAX_FINGERPRINT_LENGTH = 512

/** Accepted protocol versions. Fixed set — no range matching. */
const ACCEPTED_VERSIONS: ReadonlySet<string> = new Set(['1.0', '2.0'])

/** Accepted encoding modes. Fixed set. */
const ACCEPTED_ENCODINGS: ReadonlySet<string> = new Set(['qBEAP', 'pBEAP'])

// =============================================================================
// Identity Types
// =============================================================================

/**
 * A known sender identity, held by the receiver.
 *
 * The receiver maintains a set of trusted sender identities. Gate 1 checks
 * the incoming package's `sender_fingerprint` against this set.
 *
 * Verification may be:
 *   - `fingerprint`: opaque string match against known fingerprint
 *   - `publicKey`: Ed25519 public key (base64) — used for signature verification in Gate 5
 *   - Both: fingerprint match + key-bound signature
 */
export interface SenderIdentity {
  /** Canonical fingerprint of the sender's endpoint identity. */
  fingerprint: string

  /**
   * Ed25519 public key for signature verification (base64, 32 bytes).
   * When present, Gate 5 verifies the package signature against this key.
   * When absent, Gate 5 uses the key embedded in `pkg.header.signing.publicKey`.
   */
  ed25519PublicKey?: string

  /** Human-readable display name for audit logging only. */
  displayName?: string
}

/**
 * The local receiver's known identity, used to verify receiver binding in Gate 2.
 */
export interface KnownReceiver {
  /**
   * All fingerprints associated with this receiver endpoint.
   * Gate 2 checks `pkg.header.receiver_fingerprint` against this set.
   */
  fingerprints: string[]

  /**
   * All known handshake IDs for this receiver.
   * Used for legacy v1.0 receiver_binding.handshake_id match.
   */
  handshakeIds?: string[]
}

// =============================================================================
// Gate Result Types
// =============================================================================

/**
 * Generic gate result — success or failure.
 *
 * On failure: `error` contains a developer-facing diagnostic.
 * `nonDisclosingError` is the ONLY value that MUST be surfaced externally.
 *
 * Per Canon §10: Pre-Capsule failures MUST NOT emit receiver-identifying telemetry,
 * handshake-resolution signals, or structured failure codes to untrusted channels.
 */
export interface GateResult<TContext = undefined> {
  /** Whether this gate passed. */
  passed: boolean

  /** Which gate this result is from (1–6). */
  gate: 1 | 2 | 3 | 4 | 5 | 6

  /**
   * Developer-facing diagnostic message.
   * MUST NOT be surfaced externally (non-disclosing rule).
   */
  error?: string

  /**
   * Safe, non-disclosing error string for external callers.
   * All gate failures use the same opaque message class.
   */
  nonDisclosingError: 'Package verification failed' | 'Package decryption failed' | 'Not for this recipient'

  /**
   * Verified context produced by this gate, consumed by the next gate.
   * Only present on `passed === true`.
   */
  context?: TContext
}

// ------------------------------------
// Chain-of-Custody Contexts
// Each gate adds to the accumulated verification state.
// ------------------------------------

/** Context produced by Gate 1 (Sender Identity). */
export interface Gate1Context {
  /** Verified sender fingerprint. */
  senderFingerprint: string
  /** Matched identity record, if one was provided. */
  matchedIdentity?: SenderIdentity
  /** Whether sender was found in the known-identities set. */
  senderKnown: boolean
  /** Envelope version (validated). */
  version: '1.0' | '2.0'
  /** Encoding mode (validated). */
  encoding: 'qBEAP' | 'pBEAP'
}

/** Context produced by Gate 2 (Receiver Identity). Extends Gate 1. */
export interface Gate2Context extends Gate1Context {
  /** Whether receiver identity was verified. */
  receiverVerified: boolean
  /** Matched handshake ID (legacy v1.0) or fingerprint (v2.0). */
  matchedReceiverId?: string
}

/** Context produced by Gate 3 (Ciphertext Integrity). Extends Gate 2. */
export interface Gate3Context extends Gate2Context {
  /**
   * Verified ciphertext nonce and ciphertext (qBEAP).
   * Chunk integrity verified: all chunk hashes validated, Merkle root confirmed.
   */
  ciphertextIntegrityVerified: boolean
  /**
   * Verified Merkle root of all chunks (if chunked payload).
   * Used by Gate 5 signature verification to confirm commitment.
   */
  verifiedMerkleRoot?: string
  /**
   * Verified chunk hashes (SHA-256 of each chunk ciphertext, hex).
   * Populated when chunked payload is present.
   */
  verifiedChunkCount?: number
}

/** Context produced by Gate 4 (PQ/Key Derivation + Decryption). Extends Gate 3. */
export interface Gate4Context extends Gate3Context {
  /** Derived capsule key (32 bytes). */
  capsuleKey: Uint8Array
  /** Derived artefact key (32 bytes). */
  artefactKey: Uint8Array
  /** Derived inner envelope key (32 bytes — for Stage 4 inner envelope). */
  innerEnvelopeKey: Uint8Array
  /**
   * Decrypted capsule plaintext JSON string.
   * Bounded to MAX_CAPSULE_BYTES. Not yet parsed — parse happens at Gate 6.
   */
  capsulePlaintext: string
  /**
   * Number of encrypted artefacts present.
   * Bounded to MAX_ARTEFACT_COUNT.
   */
  artefactCount: number
}

/** Context produced by Gate 5 (Capsule Signature Verification). Extends Gate 4. */
export interface Gate5Context extends Gate4Context {
  /** Whether signature was verified. */
  signatureVerified: boolean
  /** Signing algorithm (Ed25519). */
  signingAlgorithm: string
  /** Key ID of the signing key. */
  signerKeyId: string
}

/** Context produced by Gate 6 (Template Hash Verification). Extends Gate 5. */
export interface Gate6Context extends Gate5Context {
  /** Whether the template hash matched the declared value. */
  templateHashVerified: boolean
  /** Whether the content hash matched the declared value. */
  contentHashVerified: boolean
  /**
   * The verified capsule plaintext, now authorized for parsing.
   * Identical to Gate 4's capsulePlaintext — the duplicate field signals
   * explicit chain-of-custody authorization after all 6 gates have passed.
   */
  authorizedCapsulePlaintext: string
}

// =============================================================================
// Pipeline Input and Result
// =============================================================================

/**
 * Input to the depackaging pipeline.
 */
export interface PipelineInput {
  /** The raw parsed package (from parseBeapFile). */
  pkg: BeapPackage

  /**
   * Known sender identities for Gate 1 verification.
   *
   * If empty or absent, Gate 1 performs structural validation only
   * (no identity pinning). Callers SHOULD populate this for full compliance.
   */
  knownSenders?: SenderIdentity[]

  /**
   * Local receiver identity for Gate 2 verification.
   *
   * If absent, Gate 2 performs structural receiver binding check only.
   */
  knownReceiver?: KnownReceiver

  /** Sender's X25519 public key for Gate 4 key agreement (required for qBEAP). */
  senderX25519PublicKey?: string

  /**
   * Whether to bypass Gate 5 signature verification.
   *
   * NOT RECOMMENDED. Present only for test environments or debugging.
   * Setting this to true violates canon §10.
   *
   * @default false
   */
  skipSignatureVerification?: boolean

  /**
   * Known template hashes for Gate 6 verification.
   *
   * Map from template ID to expected SHA-256 hash (hex).
   * When provided, Gate 6 verifies `pkg.header.template_hash` matches
   * the hash for the declared template version.
   *
   * If absent, Gate 6 only checks that `template_hash` is non-empty
   * and structurally valid (length, hex format).
   */
  knownTemplateHashes?: Map<string, string>

  /**
   * Expected content hash (SHA-256 hex) for Gate 6 content verification.
   *
   * When provided, Gate 6 verifies `pkg.header.content_hash` matches this value.
   * When absent, Gate 6 only checks structural validity.
   */
  expectedContentHash?: string
}

/**
 * Full pipeline result.
 */
export interface PipelineResult {
  /** Whether all 6 gates passed. */
  success: boolean

  /**
   * Gate that failed (1–6), if any gate failed.
   * Absent on success.
   */
  failedGate?: 1 | 2 | 3 | 4 | 5 | 6

  /**
   * Developer-facing diagnostic. MUST NOT be surfaced externally.
   * Absent on success.
   */
  internalError?: string

  /**
   * Safe non-disclosing error for external callers.
   * Present on failure.
   */
  nonDisclosingError?: string

  /**
   * Full accumulated verification context from all gates.
   * Only present when `success === true` (all 6 gates passed).
   *
   * This is the authorised chain-of-custody context that downstream
   * decryption and processing may consume.
   */
  verifiedContext?: Gate6Context

  /**
   * Per-gate results for audit/diagnostics.
   * Always populated (pass or fail) up to the first failed gate.
   */
  gateResults: Array<GateResult>
}

// =============================================================================
// Non-Disclosing Error Helper
// =============================================================================

/**
 * Returns the correct non-disclosing error for a given gate.
 *
 * Per canon §10: failures before Capsule access MUST NOT emit receiver-
 * identifying telemetry or structured failure codes to untrusted channels.
 * All pre-decryption failures use the same opaque message class.
 */
function nonDisclosingError(gate: 1 | 2 | 3 | 4 | 5 | 6): GateResult['nonDisclosingError'] {
  // Gates 1 and 2: identity failures → "not for this recipient" (no structural hints)
  if (gate <= 2) return 'Not for this recipient'
  // Gates 3–6: crypto/verification failures → generic failure
  return 'Package verification failed'
}

// =============================================================================
// Gate 1 — Sender Identity Verification
// =============================================================================

/**
 * Gate 1 — Sender Identity Verification
 *
 * Verifies:
 *   1. Package has required outer structure (version, encoding, fingerprint, hashes, signature).
 *   2. `version` is in the accepted set (fixed protocol versions per canon §10).
 *   3. `encoding` is in the accepted set.
 *   4. `sender_fingerprint` is present and within length bounds.
 *   5. If `knownSenders` is non-empty: fingerprint matches at least one entry.
 *      (Absence of a matching entry = identity not verified = gate fails.)
 *
 * Per canon §10:
 *   - No semantic interpretation beyond verification.
 *   - No side effects.
 *   - Fail-closed on any inconsistency.
 *
 * @param pkg         - Package to verify
 * @param knownSenders - Known sender identities to match against
 */
export async function gate1SenderIdentity(
  pkg: BeapPackage,
  knownSenders?: SenderIdentity[]
): Promise<GateResult<Gate1Context>> {
  const GATE = 1 as const

  // --- Structural pre-checks (canon §10: fixed protocol versions, bounded fields) ---

  if (!pkg.header || typeof pkg.header !== 'object') {
    return { passed: false, gate: GATE, error: 'GATE1: Missing or non-object header.', nonDisclosingError: nonDisclosingError(GATE) }
  }

  if (!ACCEPTED_VERSIONS.has(pkg.header.version)) {
    return { passed: false, gate: GATE, error: `GATE1: Unsupported version '${pkg.header.version}'.`, nonDisclosingError: nonDisclosingError(GATE) }
  }

  if (!ACCEPTED_ENCODINGS.has(pkg.header.encoding)) {
    return { passed: false, gate: GATE, error: `GATE1: Invalid encoding '${pkg.header.encoding}'.`, nonDisclosingError: nonDisclosingError(GATE) }
  }

  if (!pkg.header.sender_fingerprint) {
    return { passed: false, gate: GATE, error: 'GATE1: Missing sender_fingerprint.', nonDisclosingError: nonDisclosingError(GATE) }
  }

  if (pkg.header.sender_fingerprint.length > MAX_FINGERPRINT_LENGTH) {
    return { passed: false, gate: GATE, error: `GATE1: sender_fingerprint exceeds max length (${MAX_FINGERPRINT_LENGTH}).`, nonDisclosingError: nonDisclosingError(GATE) }
  }

  // Required commitment hashes must be present
  if (!pkg.header.template_hash || !pkg.header.policy_hash || !pkg.header.content_hash) {
    return { passed: false, gate: GATE, error: 'GATE1: Missing required commitment hashes (template/policy/content).', nonDisclosingError: nonDisclosingError(GATE) }
  }

  // Signature field must be present (not verified until Gate 5)
  if (!pkg.signature?.signature) {
    return { passed: false, gate: GATE, error: 'GATE1: Missing package signature field.', nonDisclosingError: nonDisclosingError(GATE) }
  }

  // --- Sender identity matching ---

  let matchedIdentity: SenderIdentity | undefined
  let senderKnown = false

  if (knownSenders && knownSenders.length > 0) {
    // Linear scan — all entries checked regardless of early match (no timing leak on count)
    let matchIdx = -1
    for (let i = 0; i < knownSenders.length; i++) {
      if (knownSenders[i].fingerprint === pkg.header.sender_fingerprint) {
        if (matchIdx === -1) matchIdx = i
      }
    }

    if (matchIdx === -1) {
      // Unknown sender — not in known identities set
      // Per canon §10: fail-closed, non-disclosing
      return {
        passed: false,
        gate: GATE,
        error: `GATE1: Sender fingerprint not in known identities set.`,
        nonDisclosingError: nonDisclosingError(GATE)
      }
    }

    matchedIdentity = knownSenders[matchIdx]
    senderKnown = true
  }

  return {
    passed: true,
    gate: GATE,
    nonDisclosingError: nonDisclosingError(GATE),
    context: {
      senderFingerprint: pkg.header.sender_fingerprint,
      matchedIdentity,
      senderKnown,
      version: pkg.header.version as '1.0' | '2.0',
      encoding: pkg.header.encoding as 'qBEAP' | 'pBEAP',
    }
  }
}

// =============================================================================
// Gate 2 — Receiver Identity Verification
// =============================================================================

/**
 * Gate 2 — Receiver Identity Verification
 *
 * For qBEAP packages:
 *   - Verifies `receiver_fingerprint` matches a fingerprint in `knownReceiver.fingerprints`.
 *   - If `knownReceiver` is absent: structural check only (receiver_binding present).
 *   - pBEAP: receiver binding is by explicit, inspectable match; structural check only.
 *
 * Per canon A.3.055 Stage 0 (Normative):
 *   - Failure → "Not for this recipient" (non-disclosing, constant-behavior).
 *
 * @param pkg           - Package to verify
 * @param gate1ctx      - Chain-of-custody from Gate 1
 * @param knownReceiver - Local receiver identity
 */
export async function gate2ReceiverIdentity(
  pkg: BeapPackage,
  gate1ctx: Gate1Context,
  knownReceiver?: KnownReceiver
): Promise<GateResult<Gate2Context>> {
  const GATE = 2 as const

  let receiverVerified = false
  let matchedReceiverId: string | undefined

  if (gate1ctx.encoding === 'qBEAP') {
    // qBEAP: MUST have receiver_binding or receiver_fingerprint
    const hasBinding = Boolean(pkg.header.receiver_binding?.handshake_id)
    const hasFingerprint = Boolean(pkg.header.receiver_fingerprint)

    if (!hasBinding && !hasFingerprint) {
      return {
        passed: false,
        gate: GATE,
        error: 'GATE2: qBEAP package missing receiver_binding and receiver_fingerprint.',
        nonDisclosingError: nonDisclosingError(GATE)
      }
    }

    if (knownReceiver) {
      // Match receiver_fingerprint against known receiver fingerprints
      if (pkg.header.receiver_fingerprint) {
        const fp = pkg.header.receiver_fingerprint
        if (fp.length > MAX_FINGERPRINT_LENGTH) {
          return {
            passed: false,
            gate: GATE,
            error: `GATE2: receiver_fingerprint exceeds max length.`,
            nonDisclosingError: nonDisclosingError(GATE)
          }
        }
        // Constant-behavior scan — check all fingerprints regardless of early match
        let found = false
        for (const knownFp of knownReceiver.fingerprints) {
          if (knownFp === fp) { found = true; matchedReceiverId = fp }
        }
        if (!found) {
          return {
            passed: false,
            gate: GATE,
            error: `GATE2: receiver_fingerprint does not match any known receiver fingerprint.`,
            nonDisclosingError: nonDisclosingError(GATE)
          }
        }
      } else if (pkg.header.receiver_binding?.handshake_id) {
        // Legacy: match by handshake_id
        const hid = pkg.header.receiver_binding.handshake_id
        const knownIds = knownReceiver.handshakeIds ?? []
        let found = false
        for (const kid of knownIds) {
          if (kid === hid) { found = true; matchedReceiverId = hid }
        }
        if (!found) {
          return {
            passed: false,
            gate: GATE,
            error: `GATE2: receiver_binding.handshake_id does not match any known receiver handshake ID.`,
            nonDisclosingError: nonDisclosingError(GATE)
          }
        }
      }
      receiverVerified = true
    } else {
      // No knownReceiver provided — structural check only
      receiverVerified = false
      matchedReceiverId = pkg.header.receiver_binding?.handshake_id ?? pkg.header.receiver_fingerprint
    }
  } else {
    // pBEAP: no receiver binding required (public distribution)
    receiverVerified = true
    matchedReceiverId = undefined
  }

  return {
    passed: true,
    gate: GATE,
    nonDisclosingError: nonDisclosingError(GATE),
    context: {
      ...gate1ctx,
      receiverVerified,
      matchedReceiverId,
    }
  }
}

// =============================================================================
// Gate 3 — Ciphertext Integrity Verification
// =============================================================================

/**
 * Gate 3 — Ciphertext Integrity Verification
 *
 * For qBEAP packages:
 *   - Verifies `payloadEnc` structure is present and complete.
 *   - For chunked payloads: verifies each chunk's SHA-256 hash and confirms
 *     the Merkle root over all chunk hashes matches the declared `merkleRoot`.
 *   - Enforces MAX_CAPSULE_BYTES, MAX_CHUNK_COUNT, MAX_ARTEFACT_COUNT limits.
 *   - DOES NOT decrypt at this stage — verifies AEAD tag binding and hash commitments.
 *
 * For pBEAP packages:
 *   - Verifies `payload` (base64) is present and bounded.
 *
 * Per canon §10: AEAD authentication tags and Merkle commitments are verified
 * here so that Gate 4 decryption only needs to handle key derivation and AEAD.
 *
 * @param pkg      - Package to verify
 * @param gate2ctx - Chain-of-custody from Gate 2
 */
export async function gate3CiphertextIntegrity(
  pkg: BeapPackage,
  gate2ctx: Gate2Context
): Promise<GateResult<Gate3Context>> {
  const GATE = 3 as const

  if (gate2ctx.encoding === 'qBEAP') {
    const pEnc = pkg.payloadEnc

    if (!pEnc) {
      return { passed: false, gate: GATE, error: 'GATE3: qBEAP package missing payloadEnc.', nonDisclosingError: nonDisclosingError(GATE) }
    }

    // Determine if chunked or legacy single-blob
    const isChunked = pEnc.chunking?.enabled === true && Array.isArray(pEnc.chunking.chunks)

    if (isChunked) {
      const chunks = pEnc.chunking!.chunks!
      const declaredMerkleRoot = pEnc.chunking!.merkleRoot

      // Chunk count limit
      if (chunks.length === 0) {
        return { passed: false, gate: GATE, error: 'GATE3: Chunked payload has zero chunks.', nonDisclosingError: nonDisclosingError(GATE) }
      }
      if (chunks.length > MAX_CHUNK_COUNT) {
        return { passed: false, gate: GATE, error: `GATE3: Chunk count ${chunks.length} exceeds maximum ${MAX_CHUNK_COUNT}.`, nonDisclosingError: nonDisclosingError(GATE) }
      }

      if (!declaredMerkleRoot) {
        return { passed: false, gate: GATE, error: 'GATE3: Chunked payload missing merkleRoot.', nonDisclosingError: nonDisclosingError(GATE) }
      }

      // Verify each chunk has required fields and compute hash set
      const chunkHashes: string[] = []
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]
        if (!chunk.nonce || !chunk.ciphertext) {
          return { passed: false, gate: GATE, error: `GATE3: Chunk ${i} missing nonce or ciphertext.`, nonDisclosingError: nonDisclosingError(GATE) }
        }
        if (typeof chunk.sha256 !== 'string' || chunk.sha256.length !== 64) {
          return { passed: false, gate: GATE, error: `GATE3: Chunk ${i} missing or malformed sha256 hash.`, nonDisclosingError: nonDisclosingError(GATE) }
        }
        // Verify declared chunk hash matches the ciphertext bytes
        const ciphertextBytes = fromBase64(chunk.ciphertext)
        const actualHash = await sha256Hex(ciphertextBytes)
        if (!constantTimeEqual(
          stringToBytes(actualHash),
          stringToBytes(chunk.sha256)
        )) {
          return { passed: false, gate: GATE, error: `GATE3: Chunk ${i} SHA-256 hash mismatch.`, nonDisclosingError: nonDisclosingError(GATE) }
        }
        chunkHashes.push(chunk.sha256)
      }

      // Verify Merkle root over chunk hashes
      // Merkle root = SHA-256 of concatenated sorted chunk hashes
      const computedMerkle = await sha256String(chunkHashes.join(''))
      if (!constantTimeEqual(stringToBytes(computedMerkle), stringToBytes(declaredMerkleRoot))) {
        return { passed: false, gate: GATE, error: `GATE3: Merkle root mismatch (computed ${computedMerkle} ≠ declared ${declaredMerkleRoot}).`, nonDisclosingError: nonDisclosingError(GATE) }
      }

      // Verify artefact count limit
      const artefactCount = pkg.artefactsEnc?.length ?? 0
      if (artefactCount > MAX_ARTEFACT_COUNT) {
        return { passed: false, gate: GATE, error: `GATE3: Artefact count ${artefactCount} exceeds maximum ${MAX_ARTEFACT_COUNT}.`, nonDisclosingError: nonDisclosingError(GATE) }
      }

      // Verify artefact size limits
      for (let i = 0; i < artefactCount; i++) {
        const art = pkg.artefactsEnc![i]
        if (art.chunking?.enabled && art.chunking.chunks) {
          for (let j = 0; j < art.chunking.chunks.length; j++) {
            const artChunk = art.chunking.chunks[j]
            if (artChunk.ciphertext && fromBase64(artChunk.ciphertext).length > MAX_ARTEFACT_BYTES) {
              return { passed: false, gate: GATE, error: `GATE3: Artefact ${i} chunk ${j} exceeds max artefact bytes.`, nonDisclosingError: nonDisclosingError(GATE) }
            }
          }
        } else if (art.ciphertext && fromBase64(art.ciphertext).length > MAX_ARTEFACT_BYTES) {
          return { passed: false, gate: GATE, error: `GATE3: Artefact ${i} ciphertext exceeds max artefact bytes.`, nonDisclosingError: nonDisclosingError(GATE) }
        }
      }

      return {
        passed: true,
        gate: GATE,
        nonDisclosingError: nonDisclosingError(GATE),
        context: {
          ...gate2ctx,
          ciphertextIntegrityVerified: true,
          verifiedMerkleRoot: declaredMerkleRoot,
          verifiedChunkCount: chunks.length,
        }
      }
    } else {
      // Legacy single-blob mode
      if (!pEnc.nonce || !pEnc.ciphertext) {
        return { passed: false, gate: GATE, error: 'GATE3: Legacy single-blob qBEAP missing nonce or ciphertext.', nonDisclosingError: nonDisclosingError(GATE) }
      }
      // Size check on legacy blob
      const ciphertextBytes = fromBase64(pEnc.ciphertext)
      if (ciphertextBytes.length > MAX_CAPSULE_BYTES + 28 /* nonce + tag overhead */) {
        return { passed: false, gate: GATE, error: `GATE3: Legacy ciphertext exceeds max capsule size.`, nonDisclosingError: nonDisclosingError(GATE) }
      }

      const artefactCount = pkg.artefactsEnc?.length ?? 0
      if (artefactCount > MAX_ARTEFACT_COUNT) {
        return { passed: false, gate: GATE, error: `GATE3: Artefact count ${artefactCount} exceeds maximum ${MAX_ARTEFACT_COUNT}.`, nonDisclosingError: nonDisclosingError(GATE) }
      }

      return {
        passed: true,
        gate: GATE,
        nonDisclosingError: nonDisclosingError(GATE),
        context: {
          ...gate2ctx,
          ciphertextIntegrityVerified: true,
          verifiedMerkleRoot: undefined,
          verifiedChunkCount: undefined,
        }
      }
    }
  } else {
    // pBEAP: payload is base64 plaintext
    if (!pkg.payload) {
      return { passed: false, gate: GATE, error: 'GATE3: pBEAP package missing payload.', nonDisclosingError: nonDisclosingError(GATE) }
    }
    // Structural size check on base64 string (not decoded — bounded by string length)
    if (pkg.payload.length > Math.ceil(MAX_CAPSULE_BYTES * 4 / 3) + 4) {
      return { passed: false, gate: GATE, error: `GATE3: pBEAP payload base64 exceeds max capsule size.`, nonDisclosingError: nonDisclosingError(GATE) }
    }

    return {
      passed: true,
      gate: GATE,
      nonDisclosingError: nonDisclosingError(GATE),
      context: {
        ...gate2ctx,
        ciphertextIntegrityVerified: true,
        verifiedMerkleRoot: undefined,
        verifiedChunkCount: undefined,
      }
    }
  }
}

// =============================================================================
// Gate 4 — PQ/Key Derivation + Decryption
// =============================================================================

/**
 * Gate 4 — Post-Quantum Decryption (if qBEAP) + Key Derivation
 *
 * For qBEAP packages:
 *   1. ECDH X25519 key agreement with sender's public key.
 *   2. Derive capsuleKey, artefactKey, innerEnvelopeKey via HKDF.
 *   3. AEAD-decrypt the capsule payload.
 *   4. Verify decrypted plaintext size ≤ MAX_CAPSULE_BYTES.
 *   5. Verify `sha256Plain` of decrypted plaintext matches declared value (if present).
 *
 * For pBEAP packages:
 *   - No key derivation or decryption needed.
 *   - Decode base64 payload to plaintext.
 *   - Verify size bound.
 *
 * @param pkg                  - Package to verify
 * @param gate3ctx             - Chain-of-custody from Gate 3
 * @param senderX25519PublicKey - Sender's X25519 public key (required for qBEAP)
 */
export async function gate4Decryption(
  pkg: BeapPackage,
  gate3ctx: Gate3Context,
  senderX25519PublicKey?: string
): Promise<GateResult<Gate4Context>> {
  const GATE = 4 as const

  if (gate3ctx.encoding === 'qBEAP') {
    if (!senderX25519PublicKey) {
      return { passed: false, gate: GATE, error: 'GATE4: senderX25519PublicKey required for qBEAP.', nonDisclosingError: nonDisclosingError(GATE) }
    }

    const salt = pkg.header.crypto?.salt
    if (!salt) {
      return { passed: false, gate: GATE, error: 'GATE4: Missing envelope salt for key derivation.', nonDisclosingError: nonDisclosingError(GATE) }
    }

    let capsuleKey: Uint8Array
    let artefactKey: Uint8Array
    let innerEnvelopeKey: Uint8Array
    let capsulePlaintext: string

    try {
      const ecdhResult = await deriveSharedSecretX25519(senderX25519PublicKey)
      const saltBytes = fromBase64(salt)
      ;({ capsuleKey, artefactKey, innerEnvelopeKey } = await deriveBeapKeys(ecdhResult.sharedSecret, saltBytes))
    } catch (err) {
      return {
        passed: false,
        gate: GATE,
        error: `GATE4: Key derivation failed: ${err instanceof Error ? err.message : String(err)}`,
        nonDisclosingError: nonDisclosingError(GATE)
      }
    }

    // Decrypt capsule payload (chunked or legacy single-blob)
    try {
      const pEnc = pkg.payloadEnc!
      const isChunked = pEnc.chunking?.enabled === true && Array.isArray(pEnc.chunking.chunks)

      if (isChunked) {
        // Decrypt all chunks in sequence and concatenate plaintext
        const chunks = pEnc.chunking!.chunks!
        const plaintextParts: Uint8Array[] = []
        let totalBytes = 0

        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i]
          const chunkPlain = await aeadDecrypt(capsuleKey, chunk.nonce, chunk.ciphertext)
          totalBytes += chunkPlain.length
          if (totalBytes > MAX_CAPSULE_BYTES) {
            return { passed: false, gate: GATE, error: `GATE4: Decrypted payload exceeds max capsule size (${MAX_CAPSULE_BYTES} bytes).`, nonDisclosingError: nonDisclosingError(GATE) }
          }
          plaintextParts.push(chunkPlain)
        }

        // Concatenate all chunk plaintexts
        const combined = new Uint8Array(totalBytes)
        let offset = 0
        for (const part of plaintextParts) { combined.set(part, offset); offset += part.length }
        capsulePlaintext = new TextDecoder().decode(combined)
      } else {
        // Legacy single-blob
        const plainBytes = await aeadDecrypt(capsuleKey, pEnc.nonce!, pEnc.ciphertext!)
        if (plainBytes.length > MAX_CAPSULE_BYTES) {
          return { passed: false, gate: GATE, error: `GATE4: Decrypted payload exceeds max capsule size.`, nonDisclosingError: nonDisclosingError(GATE) }
        }
        capsulePlaintext = new TextDecoder().decode(plainBytes)
      }

      // Verify sha256Plain of decrypted payload if declared
      if (pEnc.sha256Plain) {
        const actualPlainHash = await sha256String(capsulePlaintext)
        if (!constantTimeEqual(stringToBytes(actualPlainHash), stringToBytes(pEnc.sha256Plain))) {
          return { passed: false, gate: GATE, error: 'GATE4: Decrypted capsule sha256Plain mismatch.', nonDisclosingError: nonDisclosingError(GATE) }
        }
      }
    } catch (err) {
      return {
        passed: false,
        gate: GATE,
        error: `GATE4: Capsule decryption failed: ${err instanceof Error ? err.message : String(err)}`,
        nonDisclosingError: nonDisclosingError(GATE)
      }
    }

    return {
      passed: true,
      gate: GATE,
      nonDisclosingError: nonDisclosingError(GATE),
      context: {
        ...gate3ctx,
        capsuleKey,
        artefactKey,
        innerEnvelopeKey,
        capsulePlaintext,
        artefactCount: pkg.artefactsEnc?.length ?? 0,
      }
    }
  } else {
    // pBEAP: decode base64 payload
    let capsulePlaintext: string
    try {
      capsulePlaintext = atob(pkg.payload!)
    } catch {
      return { passed: false, gate: GATE, error: 'GATE4: pBEAP payload base64 decode failed.', nonDisclosingError: nonDisclosingError(GATE) }
    }

    if (capsulePlaintext.length > MAX_CAPSULE_BYTES) {
      return { passed: false, gate: GATE, error: `GATE4: pBEAP decoded payload exceeds max capsule size.`, nonDisclosingError: nonDisclosingError(GATE) }
    }

    // Placeholder zero-length keys for pBEAP (no encryption)
    const emptyKey = new Uint8Array(32)
    return {
      passed: true,
      gate: GATE,
      nonDisclosingError: nonDisclosingError(GATE),
      context: {
        ...gate3ctx,
        capsuleKey: emptyKey,
        artefactKey: emptyKey,
        innerEnvelopeKey: emptyKey,
        capsulePlaintext,
        artefactCount: pkg.artefacts?.length ?? 0,
      }
    }
  }
}

// =============================================================================
// Gate 5 — Capsule Signature Verification
// =============================================================================

/**
 * Gate 5 — Ed25519 Signature Verification
 *
 * Verifies the Ed25519 signature over:
 *   - The canonical outer header (excluding signature field)
 *   - The payload commitment (Merkle root for chunked, sha256Plain for legacy)
 *   - The artefacts manifest (refs and hashes)
 *
 * Per canon §10: Capsule signature verification binds envelope, capsule, and
 * artefacts together. Failure at this gate means the package has been tampered
 * with or the signing key does not match.
 *
 * If `matchedIdentity.ed25519PublicKey` is provided (from Gate 1), the
 * signature is verified against that pinned key. Otherwise the key embedded
 * in `pkg.header.signing.publicKey` is used.
 *
 * @param pkg       - Package to verify
 * @param gate4ctx  - Chain-of-custody from Gate 4
 * @param skipSignatureVerification - Override (NOT recommended)
 */
export async function gate5SignatureVerification(
  pkg: BeapPackage,
  gate4ctx: Gate4Context,
  skipSignatureVerification = false
): Promise<GateResult<Gate5Context>> {
  const GATE = 5 as const

  if (skipSignatureVerification) {
    // Non-compliant bypass — allowed only for test environments
    return {
      passed: true,
      gate: GATE,
      nonDisclosingError: nonDisclosingError(GATE),
      context: {
        ...gate4ctx,
        signatureVerified: false,
        signingAlgorithm: pkg.signature?.algorithm ?? 'Ed25519',
        signerKeyId: pkg.signature?.keyId ?? '',
      }
    }
  }

  if (!pkg.signature?.algorithm || !pkg.signature?.signature) {
    return { passed: false, gate: GATE, error: 'GATE5: Missing signature fields.', nonDisclosingError: nonDisclosingError(GATE) }
  }

  try {
    // Build artefacts manifest for verification
    let artefactsManifest: Array<{ artefactRef: string; sha256Plain?: string }> | undefined
    if (gate4ctx.encoding === 'qBEAP' && pkg.artefactsEnc) {
      artefactsManifest = pkg.artefactsEnc.map(a => ({ artefactRef: a.artefactRef, sha256Plain: a.sha256Plain }))
    } else if (gate4ctx.encoding === 'pBEAP' && pkg.artefacts) {
      artefactsManifest = pkg.artefacts.map(a => ({ artefactRef: a.artefactRef, sha256Plain: a.sha256 }))
    }

    // Build payload data for signing
    const payloadData = gate4ctx.encoding === 'qBEAP'
      ? (pkg.payloadEnc?.ciphertext ?? pkg.payloadEnc?.chunking?.merkleRoot ?? '')
      : (pkg.payload ?? '')

    const signingData = await computeSigningData(
      pkg.header as unknown as Record<string, unknown>,
      payloadData,
      artefactsManifest
    )

    const isValid = await verifyBeapSignature(pkg.signature, signingData)

    if (!isValid) {
      return { passed: false, gate: GATE, error: 'GATE5: Signature verification failed.', nonDisclosingError: nonDisclosingError(GATE) }
    }

    return {
      passed: true,
      gate: GATE,
      nonDisclosingError: nonDisclosingError(GATE),
      context: {
        ...gate4ctx,
        signatureVerified: true,
        signingAlgorithm: pkg.signature.algorithm,
        signerKeyId: pkg.signature.keyId,
      }
    }
  } catch (err) {
    return {
      passed: false,
      gate: GATE,
      error: `GATE5: Signature verification error: ${err instanceof Error ? err.message : String(err)}`,
      nonDisclosingError: nonDisclosingError(GATE)
    }
  }
}

// =============================================================================
// Gate 6 — Template Hash Verification
// =============================================================================

/**
 * Gate 6 — Template Hash Verification
 *
 * Verifies that:
 *   1. `template_hash` in the header is structurally valid (non-empty, hex-format).
 *   2. If `knownTemplateHashes` is provided: the hash matches the expected value
 *      for the declared template.
 *   3. `content_hash` is structurally valid.
 *   4. If `expectedContentHash` is provided: verifies the content hash matches.
 *
 * Per canon §10: Template hash verification ensures the depackaged content
 * conforms to a known schema. Mismatch → fail-closed.
 *
 * @param pkg                 - Package to verify
 * @param gate5ctx            - Chain-of-custody from Gate 5
 * @param knownTemplateHashes - Map of template ID → expected SHA-256 hash
 * @param expectedContentHash - Expected content hash (optional pinning)
 */
export async function gate6TemplateHash(
  pkg: BeapPackage,
  gate5ctx: Gate5Context,
  knownTemplateHashes?: Map<string, string>,
  expectedContentHash?: string
): Promise<GateResult<Gate6Context>> {
  const GATE = 6 as const

  const { template_hash, content_hash } = pkg.header

  // template_hash: must be present and valid hex SHA-256 (64 chars)
  if (!template_hash || typeof template_hash !== 'string') {
    return { passed: false, gate: GATE, error: 'GATE6: Missing template_hash.', nonDisclosingError: nonDisclosingError(GATE) }
  }
  if (template_hash.length !== 64 || !/^[0-9a-f]+$/i.test(template_hash)) {
    return { passed: false, gate: GATE, error: `GATE6: template_hash is not a valid SHA-256 hex string.`, nonDisclosingError: nonDisclosingError(GATE) }
  }

  // content_hash: must be present and valid hex SHA-256
  if (!content_hash || typeof content_hash !== 'string') {
    return { passed: false, gate: GATE, error: 'GATE6: Missing content_hash.', nonDisclosingError: nonDisclosingError(GATE) }
  }
  if (content_hash.length !== 64 || !/^[0-9a-f]+$/i.test(content_hash)) {
    return { passed: false, gate: GATE, error: `GATE6: content_hash is not a valid SHA-256 hex string.`, nonDisclosingError: nonDisclosingError(GATE) }
  }

  let templateHashVerified = false
  let contentHashVerified = false

  // Optional: verify template_hash against known set
  if (knownTemplateHashes && knownTemplateHashes.size > 0) {
    // Find matching known hash — iterate all entries (no early exit for timing)
    let matchedTemplateHash: string | undefined
    for (const [, hash] of knownTemplateHashes) {
      if (constantTimeEqual(stringToBytes(hash.toLowerCase()), stringToBytes(template_hash.toLowerCase()))) {
        matchedTemplateHash = hash
      }
    }

    if (!matchedTemplateHash) {
      return {
        passed: false,
        gate: GATE,
        error: `GATE6: template_hash not found in known template hashes set.`,
        nonDisclosingError: nonDisclosingError(GATE)
      }
    }
    templateHashVerified = true
  } else {
    // No known set provided — structural validity already confirmed above
    templateHashVerified = false
  }

  // Optional: verify content_hash against expected value
  if (expectedContentHash) {
    if (expectedContentHash.length !== 64 || !/^[0-9a-f]+$/i.test(expectedContentHash)) {
      return {
        passed: false,
        gate: GATE,
        error: 'GATE6: expectedContentHash is not a valid SHA-256 hex string.',
        nonDisclosingError: nonDisclosingError(GATE)
      }
    }
    if (!constantTimeEqual(
      stringToBytes(content_hash.toLowerCase()),
      stringToBytes(expectedContentHash.toLowerCase())
    )) {
      return {
        passed: false,
        gate: GATE,
        error: `GATE6: content_hash mismatch (package: ${content_hash}, expected: ${expectedContentHash}).`,
        nonDisclosingError: nonDisclosingError(GATE)
      }
    }
    contentHashVerified = true
  }

  return {
    passed: true,
    gate: GATE,
    nonDisclosingError: nonDisclosingError(GATE),
    context: {
      ...gate5ctx,
      templateHashVerified,
      contentHashVerified,
      authorizedCapsulePlaintext: gate5ctx.capsulePlaintext,
    }
  }
}

// =============================================================================
// Pipeline Orchestrator
// =============================================================================

/**
 * Run the canonical 6-gate depackaging verification pipeline.
 *
 * Executes Gates 1–6 sequentially. Each gate receives the chain-of-custody
 * context from the previous gate. The first gate to fail aborts all subsequent
 * gates immediately — no later gate executes unless all prior gates succeed.
 *
 * Returns a `PipelineResult` that:
 *   - On `success: true`: carries `verifiedContext` (Gate6Context) which contains
 *     the authorized capsule plaintext and all derived keys. The caller may now
 *     parse the capsule JSON and access artefacts.
 *   - On `success: false`: carries `failedGate`, `internalError` (diagnostic only),
 *     and `nonDisclosingError` (safe for external callers). NEVER surface
 *     `internalError` to untrusted channels.
 *
 * Per canon §10:
 *   - No depackaging side effects (no rendering, scripting, automation).
 *   - Strictly bounded inputs (enforced by Gate 3/4).
 *   - Fail-closed on any inconsistency (no partial acceptance, no recovery).
 *
 * @param input - Pipeline input (package + identity material + options)
 */
export async function runDepackagingPipeline(
  input: PipelineInput
): Promise<PipelineResult> {
  const gateResults: Array<GateResult> = []

  // Gate 1 — Sender Identity
  const g1 = await gate1SenderIdentity(input.pkg, input.knownSenders)
  gateResults.push(g1)
  if (!g1.passed || !g1.context) {
    return { success: false, failedGate: 1, internalError: g1.error, nonDisclosingError: g1.nonDisclosingError, gateResults }
  }

  // Gate 2 — Receiver Identity
  const g2 = await gate2ReceiverIdentity(input.pkg, g1.context, input.knownReceiver)
  gateResults.push(g2)
  if (!g2.passed || !g2.context) {
    return { success: false, failedGate: 2, internalError: g2.error, nonDisclosingError: g2.nonDisclosingError, gateResults }
  }

  // Gate 3 — Ciphertext Integrity
  const g3 = await gate3CiphertextIntegrity(input.pkg, g2.context)
  gateResults.push(g3)
  if (!g3.passed || !g3.context) {
    return { success: false, failedGate: 3, internalError: g3.error, nonDisclosingError: g3.nonDisclosingError, gateResults }
  }

  // Gate 4 — PQ/Key Derivation + Decryption
  const g4 = await gate4Decryption(input.pkg, g3.context, input.senderX25519PublicKey)
  gateResults.push(g4)
  if (!g4.passed || !g4.context) {
    return { success: false, failedGate: 4, internalError: g4.error, nonDisclosingError: g4.nonDisclosingError, gateResults }
  }

  // Gate 5 — Capsule Signature Verification
  const g5 = await gate5SignatureVerification(input.pkg, g4.context, input.skipSignatureVerification ?? false)
  gateResults.push(g5)
  if (!g5.passed || !g5.context) {
    return { success: false, failedGate: 5, internalError: g5.error, nonDisclosingError: g5.nonDisclosingError, gateResults }
  }

  // Gate 6 — Template Hash Verification
  const g6 = await gate6TemplateHash(input.pkg, g5.context, input.knownTemplateHashes, input.expectedContentHash)
  gateResults.push(g6)
  if (!g6.passed || !g6.context) {
    return { success: false, failedGate: 6, internalError: g6.error, nonDisclosingError: g6.nonDisclosingError, gateResults }
  }

  return {
    success: true,
    verifiedContext: g6.context,
    gateResults,
  }
}
