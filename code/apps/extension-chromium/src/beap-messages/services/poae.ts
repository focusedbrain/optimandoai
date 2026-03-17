/**
 * Proof of Authenticated Execution (PoAE™) Infrastructure
 * Per A.3.054.12 and A.3.055 Stages 2 & 7 (Normative where stated)
 *
 * PoAE provides cryptographically verifiable evidence that a BEAP package
 * was generated (sender-side) or executed (receiver-side) under a specific,
 * finalised capsule state and governing policy.
 *
 * Architecture:
 *
 *   Sender-Side PoAE (A.3.054.12 — Normative):
 *     Generated ONLY after normalization, reconstruction, chunking, encryption,
 *     and policy finalization. Binds to the FINALIZED capsule state.
 *     Precedes package emission. No modification permitted after PoAE binding.
 *
 *   Receiver-Side Stage 2 (A.3.055 Stage 2 — Optional, High-Assurance only):
 *     Verifies that the package was generated after a completed PoAE authorization
 *     event at a declared anchor (Solana, IOTA, or local). Must complete BEFORE
 *     any capsule opening, decryption, or execution-relevant parsing.
 *     Failure → fail-closed if policy declares anchor verification as required.
 *
 *   Receiver-Side Stage 7 (A.3.055 Stage 7 — Log Handling):
 *     If execution occurs AND the sender's policy requests a PoAE-R log AND
 *     the receiver's policy permits it → MAY generate and optionally return a
 *     PoAE-R log (in a response BEAP package). Absence/delay/non-return
 *     SHALL NOT be interpreted as a processing outcome.
 *
 * Anchor abstraction:
 *   The `PoAEAnchorProvider` interface is the single integration point for any
 *   blockchain or external anchor (Solana, IOTA, Arweave, etc.). The
 *   `LocalAnchorProvider` implements in-process/IndexedDB anchoring as the
 *   default non-blockchain implementation.
 */

import {
  sha256Hex,
  sha256String,
  toBase64,
  fromBase64,
  stableCanonicalize,
  stringToBytes,
  constantTimeEqual,
  ed25519Sign,
  ed25519Verify,
  getSigningKeyPair,
  type BeapSignature,
} from './beapCrypto'

// =============================================================================
// Core PoAE Record Types
// =============================================================================

/**
 * Anchor provider identifier.
 *
 * 'local'  — In-process/IndexedDB store (default, no blockchain).
 * 'solana' — Solana L1 transaction hash anchor.
 * 'iota'   — IOTA Tangle message ID anchor.
 * 'custom' — Any other provider declared by the `PoAEAnchorProvider`.
 */
export type PoAEAnchorType = 'local' | 'solana' | 'iota' | 'custom'

/**
 * Reference to an anchor event at an external (or local) ledger.
 *
 * The reference is opaque to consumers — interpretation depends on `anchorType`.
 * For 'local': `anchorRef` is a UUID or sequential ID in the local store.
 * For 'solana'/'iota': `anchorRef` is the transaction hash / message ID.
 */
export interface PoAEAnchorReference {
  /** Which anchor ledger/provider this reference belongs to. */
  anchorType: PoAEAnchorType

  /**
   * Opaque reference string. Format is anchor-type specific:
   *   local  → UUID (e.g. '3b1c8a0f-...')
   *   solana → Base58 transaction signature
   *   iota   → Message ID hex string
   *   custom → Provider-defined format
   */
  anchorRef: string

  /**
   * Timestamp (ms) when the anchor event was confirmed.
   * For local: time of write. For blockchain: block timestamp.
   */
  anchoredAt: number

  /**
   * Network or chain identifier for blockchain anchors.
   * E.g. 'mainnet-beta', 'devnet' for Solana; 'mainnet', 'devnet' for IOTA.
   */
  network?: string
}

/**
 * Sender-side PoAE Record (A.3.054.12 — Normative).
 *
 * Generated ONLY after the capsule is fully finalized (post-encryption, post-signing).
 * Commits to the final capsule state. No field may be modified after this record
 * is generated — the Ed25519 signature covers all fields.
 *
 * Included in the `BeapPackage.poae` field. Receivers MUST treat any package
 * with a missing/invalid PoAE as unverified (not fail-closed unless policy requires).
 */
export interface PoAERecord {
  /** Stable record identifier (UUID v4). */
  recordId: string

  /** Record type discriminator. */
  type: 'sender'

  /**
   * SHA-256 hex hash of the finalized capsule payload (plaintext, before encryption).
   * This is the `sha256Plain` from the `CapsulePayloadEnc`.
   * Binds the PoAE to the specific capsule content.
   */
  capsuleHash: string

  /**
   * SHA-256 hex hash of the finalized policy state at build time.
   * Matches `pkg.header.policy_hash`. Binds the PoAE to the governing policy.
   */
  policyFingerprint: string

  /**
   * SHA-256 hex hash of the outer envelope header fields (AAD bytes).
   * Binds the PoAE to the envelope governance material (version, crypto, hashes).
   */
  envelopeCommitment: string

  /**
   * SHA-256 hex hash of the Ed25519 signature bytes.
   * Binds the PoAE to the specific package signature — confirms PoAE was generated
   * after signing (finalized state).
   */
  signatureCommitment: string

  /**
   * Unix timestamp (ms) when this PoAE record was generated.
   * MUST be ≥ the package's `header.timestamp`.
   */
  generatedAt: number

  /**
   * Ed25519 public key (base64) of the signing identity used for this PoAE record.
   * May match `pkg.header.signing.publicKey` (same key) or be a dedicated PoAE key.
   */
  signerPublicKey: string

  /** Key ID of the signing key. */
  signerKeyId: string

  /**
   * Ed25519 signature over the canonical commitment of all fields above
   * (excluding this field itself). Base64-encoded.
   *
   * Commitment = SHA-256 of stableCanonical({ recordId, type, capsuleHash,
   *   policyFingerprint, envelopeCommitment, signatureCommitment, generatedAt,
   *   signerPublicKey, signerKeyId })
   */
  signature: string

  /**
   * Anchor reference (optional).
   *
   * Present when the PoAE record has been submitted to an anchor provider.
   * For pre-emission packages this may be absent (anchor happens async after build).
   * Receivers MUST NOT require anchor presence unless policy declares it.
   */
  anchorReference?: PoAEAnchorReference

  /**
   * Whether the anchor is required for this package per sender policy.
   *
   * When `true`, receivers implementing Stage 2 MUST verify the anchor before
   * capsule access. When `false` or absent, anchor verification is optional.
   */
  anchorRequired?: boolean
}

/**
 * Receiver-side PoAE-R Log entry (A.3.055 Stage 7).
 *
 * Generated on the receiver side ONLY IF:
 *   1. Execution occurred (capsule was processed).
 *   2. The sender's policy requested a PoAE-R log.
 *   3. The receiver's policy permits log generation and/or return.
 *
 * Absence or non-return of a PoAE-R SHALL NOT be interpreted as a
 * processing outcome by any party.
 */
export interface PoAERLog {
  /** Stable log entry identifier (UUID v4). */
  logId: string

  /** Record type discriminator. */
  type: 'receiver'

  /**
   * Reference to the sender's PoAE record that authorized this execution.
   * `null` if the original package had no PoAE record (unverified path).
   */
  senderPoAERecordId: string | null

  /**
   * SHA-256 hex of the capsule that was executed.
   * Binds the log to the specific capsule content processed.
   */
  capsuleHash: string

  /**
   * SHA-256 hex of the receiver's effective capability policy at execution time.
   * Computed by the Stage 6.1 gate (`policyFingerprint` from GatingArtefacts).
   */
  receiverPolicyFingerprint: string

  /**
   * Gate decision from Stage 6.1 gate.
   */
  gateDecision: 'AUTHORIZED' | 'BLOCKED'

  /**
   * Artefact IDs from Stage 6.3 GatingArtefacts that this log covers.
   * Empty if gate was BLOCKED.
   */
  gatingArtefactIds: string[]

  /** Unix timestamp (ms) when execution occurred. */
  executedAt: number

  /**
   * Unix timestamp (ms) when this PoAE-R log was generated.
   * MUST be ≥ `executedAt`.
   */
  generatedAt: number

  /**
   * Whether the sender's policy requested this log be returned.
   * Informational — does not mandate return.
   */
  returnRequested: boolean

  /**
   * Whether the receiver's policy permits returning this log.
   * Informational — does not mandate return.
   */
  returnPermitted: boolean

  /**
   * Ed25519 signature over the canonical commitment of all fields above.
   * Signed by the receiver's signing key.
   */
  signature: string

  /** Receiver's Ed25519 public key (base64) used for signing this log. */
  signerPublicKey: string

  /** Key ID of the receiver's signing key. */
  signerKeyId: string

  /**
   * Optional anchor reference, if the log was submitted to an anchor.
   * MAY be populated post-generation (async anchoring).
   */
  anchorReference?: PoAEAnchorReference
}

// =============================================================================
// Anchor Provider Interface
// =============================================================================

/**
 * Abstract anchor provider interface.
 *
 * Implementations submit PoAE records or PoAE-R logs to an immutable ledger
 * (blockchain, IOTA Tangle, or local IndexedDB) for tamper-evident time-ordering.
 *
 * The local default (`LocalAnchorProvider`) stores records in memory / IndexedDB.
 * Blockchain adapters (Solana, IOTA) implement this interface.
 *
 * Per canon: anchor submission is OPTIONAL on the sender side and MUST NOT
 * block package emission. Use async submission after emission.
 */
export interface PoAEAnchorProvider {
  /** Provider identifier for `anchorType` field. */
  readonly anchorType: PoAEAnchorType

  /**
   * Submit a PoAE or PoAE-R record for anchoring.
   *
   * @param record     - The PoAE or PoAE-R record to anchor
   * @param commitment - SHA-256 hex commitment over the record's canonical fields
   * @returns Anchor reference confirming submission
   * @throws Never — implementations MUST catch and re-throw as PoAEAnchorError
   */
  anchor(record: PoAERecord | PoAERLog, commitment: string): Promise<PoAEAnchorReference>

  /**
   * Verify that a previously anchored record matches the given commitment.
   *
   * Used at Stage 2 (receiver-side verification).
   *
   * @param anchorRef  - Anchor reference from the PoAE record
   * @param commitment - Expected commitment to verify against
   * @returns true if the anchored commitment matches; false otherwise
   */
  verify(anchorRef: PoAEAnchorReference, commitment: string): Promise<boolean>

  /**
   * Retrieve a record by anchor reference (optional — not all providers support lookup).
   *
   * @param anchorRef - Anchor reference to look up
   * @returns The stored record, or null if not found or not supported
   */
  retrieve?(anchorRef: PoAEAnchorReference): Promise<PoAERecord | PoAERLog | null>
}

/**
 * Error thrown by anchor providers.
 */
export class PoAEAnchorError extends Error {
  constructor(
    message: string,
    readonly anchorType: PoAEAnchorType,
    readonly cause?: unknown
  ) {
    super(message)
    this.name = 'PoAEAnchorError'
  }
}

// =============================================================================
// Local Anchor Provider (Default Implementation)
// =============================================================================

/**
 * A single in-memory anchored record entry.
 */
interface LocalAnchorEntry {
  anchorRef: string
  commitment: string
  anchoredAt: number
  record: PoAERecord | PoAERLog
}

/**
 * Local in-process anchor provider.
 *
 * Stores PoAE records in memory (with optional IndexedDB persistence via
 * a pluggable store callback). Suitable for development, testing, and
 * environments without blockchain access.
 *
 * Production deployments SHOULD replace this with a Solana or IOTA adapter.
 */
export class LocalAnchorProvider implements PoAEAnchorProvider {
  readonly anchorType: PoAEAnchorType = 'local'

  /** In-memory store: anchorRef → entry. */
  private readonly store = new Map<string, LocalAnchorEntry>()

  /**
   * Optional callback for durable persistence (e.g. IndexedDB).
   * Called after each successful anchor write.
   */
  private readonly persistCallback?: (entry: LocalAnchorEntry) => Promise<void>

  constructor(options?: {
    persistCallback?: (entry: LocalAnchorEntry) => Promise<void>
  }) {
    this.persistCallback = options?.persistCallback
  }

  async anchor(record: PoAERecord | PoAERLog, commitment: string): Promise<PoAEAnchorReference> {
    const anchorRef = generateUUID()
    const anchoredAt = Date.now()
    const entry: LocalAnchorEntry = { anchorRef, commitment, anchoredAt, record }
    this.store.set(anchorRef, entry)

    if (this.persistCallback) {
      try {
        await this.persistCallback(entry)
      } catch {
        // Persistence failures are logged but do not fail the anchor operation
        // (in-memory store succeeded)
      }
    }

    return { anchorType: 'local', anchorRef, anchoredAt }
  }

  async verify(anchorRef: PoAEAnchorReference, commitment: string): Promise<boolean> {
    if (anchorRef.anchorType !== 'local') return false
    const entry = this.store.get(anchorRef.anchorRef)
    if (!entry) return false
    return constantTimeEqual(
      stringToBytes(entry.commitment.toLowerCase()),
      stringToBytes(commitment.toLowerCase())
    )
  }

  async retrieve(anchorRef: PoAEAnchorReference): Promise<PoAERecord | PoAERLog | null> {
    if (anchorRef.anchorType !== 'local') return null
    return this.store.get(anchorRef.anchorRef)?.record ?? null
  }
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Generate a UUID v4 (random).
 * Uses WebCrypto for randomness — no dependency on external UUID libraries.
 */
export function generateUUID(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40 // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // variant 10
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * Compute the canonical commitment hash over a PoAE record's fields.
 *
 * The commitment is SHA-256 of the stable-canonical JSON serialization of the
 * record, EXCLUDING the `signature` and `anchorReference` fields (these are
 * derived after commitment).
 *
 * This is the same pattern as Stage 6.3 `GatingArtefact` commitment hashes.
 */
export async function computePoAECommitment(
  fields: Omit<PoAERecord, 'signature' | 'anchorReference'> | Omit<PoAERLog, 'signature' | 'anchorReference'>
): Promise<string> {
  const canonical = stableCanonicalize(fields)
  const json = JSON.stringify(canonical)
  return sha256String(json)
}

// =============================================================================
// Sender-Side PoAE Generation (A.3.054.12 — Normative)
// =============================================================================

/**
 * Generate a sender-side PoAERecord after capsule finalization.
 *
 * Per A.3.054.12 (Normative):
 *   - MUST be called ONLY after the package is fully finalized (encrypted,
 *     signed, inner envelope committed).
 *   - Binds to: capsule sha256Plain, policy_hash, envelope AAD commitment,
 *     and the Ed25519 signature bytes.
 *   - No modification to the package is permitted after this point.
 *
 * Fail-closed: if signing fails, this function throws — callers MUST propagate
 * failure and not emit the package without a valid PoAE record.
 *
 * @param params.capsuleHash        - sha256Plain of the capsule payload plaintext
 * @param params.policyFingerprint  - pkg.header.policy_hash
 * @param params.envelopeAADBytes   - Canonical outer header AAD bytes (same as used for AEAD)
 * @param params.packageSignature   - The finalized BeapSignature (post-signing)
 * @param params.anchorProvider     - Optional anchor provider (async submission)
 * @param params.anchorRequired     - Whether receiver should require anchor verification
 */
export async function generatePoAERecord(params: {
  capsuleHash: string
  policyFingerprint: string
  envelopeAADBytes: Uint8Array
  packageSignature: BeapSignature
  anchorProvider?: PoAEAnchorProvider
  anchorRequired?: boolean
}): Promise<PoAERecord> {
  const signingKeyPair = await getSigningKeyPair()

  const envelopeCommitment = await sha256Hex(params.envelopeAADBytes)
  const signatureCommitment = await sha256String(params.packageSignature.signature)
  const generatedAt = Date.now()
  const recordId = generateUUID()

  // Fields that are committed to (signature excluded)
  const fieldsToSign: Omit<PoAERecord, 'signature' | 'anchorReference'> = {
    recordId,
    type: 'sender',
    capsuleHash: params.capsuleHash,
    policyFingerprint: params.policyFingerprint,
    envelopeCommitment,
    signatureCommitment,
    generatedAt,
    signerPublicKey: signingKeyPair.publicKey,
    signerKeyId: signingKeyPair.keyId,
    anchorRequired: params.anchorRequired ?? false,
  }

  const commitment = await computePoAECommitment(fieldsToSign)
  const commitmentBytes = stringToBytes(commitment)

  // Ed25519 sign the commitment bytes
  const signatureBytes = await ed25519Sign(signingKeyPair.privateKey, commitmentBytes)
  const signature = toBase64(signatureBytes)

  const record: PoAERecord = {
    ...fieldsToSign,
    signature,
  }

  // Optionally anchor the record (async, non-blocking for package emission)
  if (params.anchorProvider) {
    try {
      const anchorReference = await params.anchorProvider.anchor(record, commitment)
      record.anchorReference = anchorReference
    } catch {
      // Anchor failures do not invalidate the PoAE record — anchoring is best-effort
      // unless anchorRequired is true (enforcement at receiver Stage 2).
    }
  }

  return record
}

// =============================================================================
// Sender-Side PoAE Verification (Receiver Stage 2)
// =============================================================================

/**
 * Result of PoAE record signature verification.
 */
export interface PoAEVerificationResult {
  /** Whether the PoAE record's signature is cryptographically valid. */
  signatureValid: boolean

  /** Whether the anchor was verified (only possible if anchorProvider supplied). */
  anchorVerified: boolean

  /** Whether anchor verification was required per record policy. */
  anchorRequired: boolean

  /**
   * Whether this package meets the high-assurance Stage 2 requirement.
   *
   * `true` when:
   *   - `signatureValid === true`, AND
   *   - if `anchorRequired === true`: `anchorVerified === true`
   *   - if `anchorRequired === false`: anchor verification is irrelevant
   *
   * `false` in all other cases.
   */
  meetsHighAssuranceRequirement: boolean

  /** Diagnostic (MUST NOT be surfaced externally per canon §10). */
  internalReason?: string
}

/**
 * Verify a sender-side PoAERecord.
 *
 * Used at A.3.055 Stage 2 (receiver-side, optional, high-assurance only).
 *
 * Per A.3.055 Stage 2:
 *   - MUST complete BEFORE any capsule opening, decryption, or execution-relevant parsing.
 *   - If anchor verification is required (`record.anchorRequired === true`):
 *     failure → fail-closed (caller MUST reject the package).
 *   - If anchor verification is not required: signature check only.
 *
 * @param record         - PoAERecord from pkg.poae
 * @param anchorProvider - Optional anchor provider for Stage 2 anchor verification
 */
export async function verifyPoAERecord(
  record: PoAERecord,
  anchorProvider?: PoAEAnchorProvider
): Promise<PoAEVerificationResult> {
  const anchorRequired = record.anchorRequired ?? false

  // Recompute commitment (excludes signature and anchorReference)
  const fieldsToVerify: Omit<PoAERecord, 'signature' | 'anchorReference'> = {
    recordId: record.recordId,
    type: record.type,
    capsuleHash: record.capsuleHash,
    policyFingerprint: record.policyFingerprint,
    envelopeCommitment: record.envelopeCommitment,
    signatureCommitment: record.signatureCommitment,
    generatedAt: record.generatedAt,
    signerPublicKey: record.signerPublicKey,
    signerKeyId: record.signerKeyId,
    anchorRequired: record.anchorRequired,
  }

  let commitment: string
  try {
    commitment = await computePoAECommitment(fieldsToVerify)
  } catch {
    return { signatureValid: false, anchorVerified: false, anchorRequired, meetsHighAssuranceRequirement: false, internalReason: 'STAGE2: Failed to compute PoAE commitment.' }
  }

  // Verify Ed25519 signature
  let signatureValid = false
  try {
    const sigBytes = fromBase64(record.signature)
    const commitmentBytes = stringToBytes(commitment)
    signatureValid = await ed25519Verify(record.signerPublicKey, sigBytes, commitmentBytes)
  } catch {
    return { signatureValid: false, anchorVerified: false, anchorRequired, meetsHighAssuranceRequirement: false, internalReason: 'STAGE2: Ed25519 signature verification failed.' }
  }

  if (!signatureValid) {
    return { signatureValid: false, anchorVerified: false, anchorRequired, meetsHighAssuranceRequirement: false, internalReason: 'STAGE2: PoAE record signature is invalid.' }
  }

  // Anchor verification (if required or provider available)
  let anchorVerified = false
  if (anchorProvider && record.anchorReference) {
    try {
      anchorVerified = await anchorProvider.verify(record.anchorReference, commitment)
    } catch {
      anchorVerified = false
    }
  }

  const meetsHighAssuranceRequirement = signatureValid && (!anchorRequired || anchorVerified)

  return { signatureValid, anchorVerified, anchorRequired, meetsHighAssuranceRequirement }
}

// =============================================================================
// Receiver-Side PoAE-R Log Generation (A.3.055 Stage 7)
// =============================================================================

/**
 * Parameters for PoAE-R log generation at Stage 7.
 */
export interface GeneratePoAERLogParams {
  /** Record ID of the sender's PoAE record (from `pkg.poae.recordId`). null if absent. */
  senderPoAERecordId: string | null

  /** SHA-256 hex of the capsule that was executed. */
  capsuleHash: string

  /** SHA-256 hex of the receiver's effective capability policy at execution time. */
  receiverPolicyFingerprint: string

  /** Stage 6.1 gate decision. */
  gateDecision: 'AUTHORIZED' | 'BLOCKED'

  /** GatingArtefact IDs from Stage 6.3. */
  gatingArtefactIds: string[]

  /** Whether the sender's policy requested a PoAE-R log. */
  returnRequested: boolean

  /** Whether the receiver's policy permits generating/returning this log. */
  returnPermitted: boolean

  /** Timestamp of execution (ms). */
  executedAt: number

  /** Optional anchor provider for log anchoring. */
  anchorProvider?: PoAEAnchorProvider
}

/**
 * Generate a receiver-side PoAE-R log entry.
 *
 * Per A.3.055 Stage 7:
 *   - MAY be generated if execution occurred + returnRequested + returnPermitted.
 *   - Callers MUST check `returnRequested && returnPermitted` before calling.
 *   - Absence/delay/non-return SHALL NOT be interpreted as a processing outcome.
 *
 * @param params - PoAE-R log generation parameters
 * @returns PoAERLog entry ready for storage and/or response inclusion
 */
export async function generatePoAERLog(params: GeneratePoAERLogParams): Promise<PoAERLog> {
  const signingKeyPair = await getSigningKeyPair()
  const generatedAt = Date.now()
  const logId = generateUUID()

  const fieldsToSign: Omit<PoAERLog, 'signature' | 'anchorReference'> = {
    logId,
    type: 'receiver',
    senderPoAERecordId: params.senderPoAERecordId,
    capsuleHash: params.capsuleHash,
    receiverPolicyFingerprint: params.receiverPolicyFingerprint,
    gateDecision: params.gateDecision,
    gatingArtefactIds: params.gatingArtefactIds,
    executedAt: params.executedAt,
    generatedAt,
    returnRequested: params.returnRequested,
    returnPermitted: params.returnPermitted,
    signerPublicKey: signingKeyPair.publicKey,
    signerKeyId: signingKeyPair.keyId,
  }

  const commitment = await computePoAECommitment(fieldsToSign)
  const commitmentBytes = stringToBytes(commitment)
  const signatureBytes = await ed25519Sign(signingKeyPair.privateKey, commitmentBytes)
  const signature = toBase64(signatureBytes)

  const log: PoAERLog = {
    ...fieldsToSign,
    signature,
  }

  // Optionally anchor the log
  if (params.anchorProvider) {
    try {
      const anchorReference = await params.anchorProvider.anchor(log, commitment)
      log.anchorReference = anchorReference
    } catch {
      // Anchor failure is non-fatal for log generation
    }
  }

  return log
}

// =============================================================================
// PoAE-R Log Store Interface
// =============================================================================

/**
 * Interface for storing PoAE-R logs on the receiver side.
 *
 * Implementations may use IndexedDB, a remote audit API, or in-memory storage.
 * The log store is the receiver's authoritative record of executed capsules.
 */
export interface PoAERLogStore {
  /**
   * Persist a PoAE-R log entry.
   * MUST NOT throw — errors must be absorbed and logged internally.
   */
  persistLog(log: PoAERLog): Promise<void>

  /**
   * Retrieve a log entry by logId (optional).
   */
  retrieveLog?(logId: string): Promise<PoAERLog | null>

  /**
   * List all log entries for a given capsule hash (optional).
   */
  listLogsForCapsule?(capsuleHash: string): Promise<PoAERLog[]>
}

// =============================================================================
// Capsule Hash Helper
// =============================================================================

/**
 * Compute the capsule hash from a decrypted plaintext string.
 * Used to bind PoAE-R logs to specific capsule content.
 *
 * @param capsulePlaintext - Decrypted capsule JSON string
 */
export async function computeCapsuleHash(capsulePlaintext: string): Promise<string> {
  return sha256String(capsulePlaintext)
}
