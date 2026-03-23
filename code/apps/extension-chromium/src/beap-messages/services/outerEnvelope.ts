/**
 * Outer/Inner Envelope Architecture — A.3.055 Stage 4 (Normative)
 *
 * Implements the two-layer envelope model required by the canonical spec:
 *
 *   Outer Envelope (unencrypted, signed, AAD-bound):
 *     Structural and eligibility governance material — version, sizing, commitment
 *     hashes, KEM material, sender identity. Readable by any recipient for
 *     eligibility determination without decryption.
 *
 *   Inner Envelope (AEAD-encrypted, bound to outer via AAD):
 *     Sensitive governance and expectation metadata — processing event declarations,
 *     artefact topology, policy fingerprints, automation tag metadata, retention
 *     declarations. MUST NOT be accessible before Stage 4 decryption succeeds.
 *
 * Canonical constraints (A.3.055 Stage 4 — Normative):
 *   - Inner envelope MUST be cryptographically bound to outer envelope governance
 *     material (via AAD = canonical outer header bytes).
 *   - Inner envelope MUST be authenticated and validated; fail-closed on failure.
 *   - Inner envelope MUST be strictly size-limited and schema-fixed.
 *   - Inner envelope MUST NOT contain executable content, user data, or original artefacts.
 *   - Ingress/egress policy declarations in the inner envelope apply EXCLUSIVELY to
 *     post-depackaging automation.
 *   - All declared constraints MUST be enforced PRIOR to any Capsule decryption.
 *   - Decryption MUST be AEAD-authenticated; unauthenticated plaintext MUST NOT
 *     be exposed to parsing.
 */

import type { ProcessingEventOffer } from './processingEvents'
import { aeadEncrypt, aeadDecrypt, fromBase64, toBase64, stableCanonicalize } from './beapCrypto'

// =============================================================================
// Outer Envelope Header
// =============================================================================

/**
 * Outer Envelope Header — unencrypted, signed, AAD-bound.
 *
 * Contains ONLY structural, sizing, and eligibility governance material.
 * Safe to inspect without decryption. All fields are integrity-protected
 * via the package signature and the AEAD AAD for capsule/artefact encryption.
 *
 * v2.0 packages: this is the `header` field of `BeapPackage`.
 * v1.0 packages (legacy): the flat `BeapEnvelopeHeader` serves both roles.
 */
export interface OuterEnvelopeHeader {
  /** Envelope format version. '1.0' = legacy flat; '2.0' = dual-envelope. */
  version: '1.0' | '2.0'

  /** Package encoding mode. */
  encoding: 'qBEAP' | 'pBEAP'

  /** Encryption mode for the capsule payload. */
  encryption_mode: 'AES-256-GCM' | 'NONE'

  /** Unix timestamp (ms) of package creation. */
  timestamp: number

  /** Sender fingerprint (non-sensitive — safe in outer envelope). */
  sender_fingerprint: string

  /**
   * Receiver fingerprint (non-sensitive — used for eligibility determination
   * without full decryption).
   */
  receiver_fingerprint?: string

  /**
   * Receiver binding for eligibility and key agreement (qBEAP only).
   * handshake_id used for Stage 0 eligibility; display_name informational only.
   */
  receiver_binding?: {
    handshake_id: string
    display_name: string
    organization?: string
  }

  /**
   * Opaque recipient eligibility material (qBEAP only).
   *
   * Per A.3.054.3 + A.3.055 Stage 0 (Normative):
   *   - Derived exclusively from the selected handshake shared secret, sender/receiver
   *     endpoint fingerprints, and capsule context hash.
   *   - HMAC-SHA256(handshake_shared_secret, "BEAP v2 eligibility" || sender_fp || receiver_fp || content_hash)
   *   - Base64-encoded 32-byte opaque token. No plaintext identifiers.
   *   - Only a party holding the exact matching handshake material can evaluate.
   *   - Non-inferable: no globally inspectable identifiers included in the output.
   *   - Failure to verify yields constant-behavior "not-for-me" with no disclosure.
   *
   * Added in v2.0 outer envelope. Absent on v1.0 packages (legacy path falls back
   * to handshake_id string match).
   */
  receiver_eligibility?: string

  /** Commitment hash of the capsule template. AAD-bound. */
  template_hash: string

  /** Commitment hash of the policy state at build time. AAD-bound. */
  policy_hash: string

  /** Commitment hash of the capsule content. AAD-bound. */
  content_hash: string

  /**
   * Cryptographic suite metadata (qBEAP only).
   * KEM ciphertext, salt, and key derivation identifiers required for decryption.
   * Placed in outer envelope so the receiver can derive keys before Stage 4.
   */
  crypto?: {
    suiteId: 'HYBRID_MLKEM768_X25519_AES256GCM_HKDFSHA256_ED25519_v1' | 'BEAP-v1-X25519-AES256GCM-HKDF-Ed25519'
    aead: 'AES-256-GCM'
    kdf: 'HKDF-SHA256'
    hash: 'SHA-256'
    keyDerivation: 'HYBRID_MLKEM768_X25519' | 'X25519_ECDH'
    /** Base64-encoded 16-byte envelope salt. */
    salt: string
    handshake_id: string
    senderX25519PublicKeyB64: string
    pq: {
      required: boolean
      active: boolean
      kem?: 'ML-KEM-768'
      hybrid?: boolean
      kemCiphertextB64?: string
    } | false
  }

  /** Signing metadata (added after encryption; excluded from AAD). */
  signing?: {
    algorithm: 'Ed25519'
    keyId: string
    publicKey: string
  }

  /** Compliance level metadata (informational; excluded from AAD). */
  compliance?: {
    canon: 'FULL' | 'PARTIAL' | 'NONE'
    notes: string[]
  }

  /**
   * Size limits for this package (per canon A.3.054.9).
   * Declared in outer envelope and AAD-bound for tamper evidence.
   */
  sizeLimits?: {
    maxCapsuleBytes?: number
    maxArtefactBytes?: number
    maxTotalBytes?: number
    maxArtefactCount?: number
  }

  /**
   * Processing event declarations for pBEAP packages ONLY.
   *
   * pBEAP is public/auditable mode — no inner envelope exists.
   * For qBEAP, this field MUST be absent; declarations are in the inner envelope.
   *
   * Consumers MUST check `encoding === 'pBEAP'` before relying on this field.
   */
  processingEvents?: ProcessingEventOffer
}

// =============================================================================
// Artefact Topology
// =============================================================================

/**
 * A summary of artefact structure — no content, no user data.
 *
 * Contains ONLY governance-relevant topology: counts, refs, MIME types.
 * Used in Stage 4 to constrain subsequent Capsule decryption and artefact access.
 *
 * Per A.3.055 Stage 4: MUST NOT contain original artefacts or user data.
 */
export interface ArtefactTopology {
  /** Total number of artefacts in the package. */
  totalCount: number

  /** Total number of encrypted original artefacts (qBEAP). */
  encryptedOriginalCount: number

  /** Total number of raster page artefacts. */
  rasterPageCount: number

  /**
   * Per-attachment topology entries.
   * One entry per original attachment — no content, only governance metadata.
   */
  entries: ArtefactTopologyEntry[]
}

/** Governance-only metadata for a single attachment's artefact set. */
export interface ArtefactTopologyEntry {
  /** Attachment ID (stable ref, no filename). */
  attachmentId: string

  /** MIME type of the original file (needed for processing classification). */
  originalMime: string

  /** Original file size in bytes (for sizing constraint enforcement). */
  originalBytes: number

  /** Whether a semantic-content extraction is present (governs processing paths). */
  hasSemantic: boolean

  /** Whether raster pages are present (governs visual processing paths). */
  hasRasterPages: boolean

  /** Number of raster pages (0 if none). */
  rasterPageCount: number

  /** Artefact ref for the encrypted original (for cross-referencing only). */
  encryptedRef?: string

  /** Artefact ref for the raster preview (for cross-referencing only). */
  previewRef?: string | null
}

// =============================================================================
// Inner Envelope Metadata
// =============================================================================

/**
 * Inner Envelope Metadata — encrypted with AEAD, cryptographically bound to
 * the outer envelope via AAD.
 *
 * Contains ALL sensitive governance and expectation metadata. MUST be decrypted
 * and validated (Stage 4) BEFORE any Capsule access (Stage 6).
 *
 * Per A.3.055 Stage 4 (Normative):
 *   - MUST NOT contain executable content, user data, or original artefacts.
 *   - MUST be strictly size-limited and schema-fixed.
 *   - All declared constraints MUST be enforced PRIOR to Capsule decryption.
 *   - Ingress/egress policy declarations apply EXCLUSIVELY to post-depackaging automation.
 */
export interface InnerEnvelopeMetadata {
  /**
   * Schema version for forward compatibility.
   * Must be '1.0' for current implementations.
   */
  schemaVersion: '1.0'

  /**
   * Processing Event declarations (moved from outer envelope per Gap 2 plan).
   *
   * Per A.3.054.9.1 + A.3.054.10.1 + A.3.054.14.1 (Normative):
   * SENDER-REQUESTED INTENT ONLY. SHALL NOT override receiver-side policy.
   * Evaluated at Stage 6.1 gate AFTER Stage 4 decryption.
   */
  processingEvents: ProcessingEventOffer

  /**
   * Artefact topology — governance-only summary of the package's artefact structure.
   * Used to constrain subsequent decryption and processing access.
   * MUST NOT contain user data or artefact content.
   */
  artefactTopology: ArtefactTopology

  /**
   * Fingerprint of the sender's effective policy state at build time.
   * SHA-256 hex over stable-canonical JSON of policy governance fields.
   * Used for Stage 6.3 gating artefact linkage and audit.
   */
  policyFingerprint: string

  /**
   * Automation tag governance metadata.
   * Records count and source classification — NO tag values.
   * Tag values are capsule-bound and only accessible post-Stage-6 decryption.
   */
  automationTagMetadata?: {
    tagCount: number
    tagSource: 'encrypted' | 'plaintext' | 'both' | 'none'
    receiverHasFinalAuthority: true
  }

  /**
   * Retention declarations forwarded from processingEvents for early enforcement.
   * Allows Stage 4 to reject packages that exceed receiver retention policy
   * BEFORE the capsule is decrypted (early fail-closed).
   *
   * Keys are ProcessingEventClass ('semantic' | 'actuating').
   */
  retentionDeclarations?: Partial<Record<'semantic' | 'actuating', 'NONE' | 'SESSION' | 'PERSISTENT'>>

  /**
   * Build timestamp echoed from outer header for binding verification.
   * MUST match outer header timestamp; mismatch indicates tampering.
   */
  boundTimestamp: number
}

// =============================================================================
// Validation
// =============================================================================

/** Maximum permitted size of the serialized inner envelope metadata (bytes). */
const MAX_INNER_ENVELOPE_BYTES = 64 * 1024 // 64 KB

/**
 * Validate the schema and size of decrypted InnerEnvelopeMetadata.
 *
 * Called immediately after Stage 4 decryption, before any field is consumed.
 * Fail-closed: any schema violation → package rejected.
 *
 * @param metadata  - Parsed inner envelope metadata
 * @param outerTimestamp - Timestamp from the outer header (for binding check)
 * @param serializedBytes - Byte length of the raw decrypted JSON (for size check)
 * @returns Array of error strings; empty = valid
 */
export function validateInnerEnvelopeSchema(
  metadata: unknown,
  outerTimestamp: number,
  serializedBytes: number
): string[] {
  const errors: string[] = []

  // Size limit
  if (serializedBytes > MAX_INNER_ENVELOPE_BYTES) {
    errors.push(
      `STAGE_4 [SIZE]: Inner envelope exceeds maximum permitted size ` +
      `(${serializedBytes} bytes > ${MAX_INNER_ENVELOPE_BYTES} bytes). Package REJECTED.`
    )
    return errors // no further checks — likely malformed
  }

  if (metadata === null || typeof metadata !== 'object') {
    errors.push('STAGE_4 [SCHEMA]: Inner envelope is not an object. Package REJECTED.')
    return errors
  }

  const m = metadata as Record<string, unknown>

  // schemaVersion
  if (m.schemaVersion !== '1.0') {
    errors.push(
      `STAGE_4 [SCHEMA]: Unknown inner envelope schemaVersion '${m.schemaVersion}'. ` +
      `Expected '1.0'. Package REJECTED.`
    )
  }

  // processingEvents — must be present and an object
  if (!m.processingEvents || typeof m.processingEvents !== 'object') {
    errors.push(
      'STAGE_4 [SCHEMA]: Inner envelope missing required processingEvents field. Package REJECTED.'
    )
  }

  // artefactTopology — must be present and an object
  if (!m.artefactTopology || typeof m.artefactTopology !== 'object') {
    errors.push(
      'STAGE_4 [SCHEMA]: Inner envelope missing required artefactTopology field. Package REJECTED.'
    )
  } else {
    const topo = m.artefactTopology as Record<string, unknown>
    if (typeof topo.totalCount !== 'number' || topo.totalCount < 0) {
      errors.push(
        'STAGE_4 [SCHEMA]: artefactTopology.totalCount must be a non-negative number. Package REJECTED.'
      )
    }
    if (!Array.isArray(topo.entries)) {
      errors.push(
        'STAGE_4 [SCHEMA]: artefactTopology.entries must be an array. Package REJECTED.'
      )
    }
  }

  // policyFingerprint — must be a non-empty string
  if (typeof m.policyFingerprint !== 'string' || m.policyFingerprint.trim() === '') {
    errors.push(
      'STAGE_4 [SCHEMA]: Inner envelope missing or empty policyFingerprint. Package REJECTED.'
    )
  }

  // boundTimestamp — must match outer header
  if (typeof m.boundTimestamp !== 'number') {
    errors.push(
      'STAGE_4 [SCHEMA]: Inner envelope missing boundTimestamp. Package REJECTED.'
    )
  } else if (m.boundTimestamp !== outerTimestamp) {
    errors.push(
      `STAGE_4 [BINDING]: Inner envelope boundTimestamp (${m.boundTimestamp}) does not match ` +
      `outer header timestamp (${outerTimestamp}). Possible tampering. Package REJECTED.`
    )
  }

  // automationTagMetadata — optional but if present must have valid structure
  if (m.automationTagMetadata !== undefined) {
    const atm = m.automationTagMetadata as Record<string, unknown>
    if (typeof atm.tagCount !== 'number' || atm.tagCount < 0) {
      errors.push(
        'STAGE_4 [SCHEMA]: automationTagMetadata.tagCount must be a non-negative number.'
      )
    }
    if (!['encrypted', 'plaintext', 'both', 'none'].includes(atm.tagSource as string)) {
      errors.push(
        `STAGE_4 [SCHEMA]: automationTagMetadata.tagSource '${atm.tagSource}' is not valid.`
      )
    }
    if (atm.receiverHasFinalAuthority !== true) {
      errors.push(
        'STAGE_4 [SCHEMA]: automationTagMetadata.receiverHasFinalAuthority must be true.'
      )
    }
  }

  return errors
}

// =============================================================================
// Artefact Topology Builder
// =============================================================================

/**
 * Build an ArtefactTopology summary from capsule config attachments.
 *
 * Extracts ONLY governance-relevant topology — no content, no user data.
 * The resulting topology is placed in the inner envelope.
 *
 * @param attachments - CapsuleAttachment entries from the builder config
 * @returns ArtefactTopology with governance-only fields
 */
export function buildArtefactTopology(
  attachments: Array<{
    id: string
    originalType: string
    originalSize: number
    semanticContent?: string | null
    semanticExtracted?: boolean
    encryptedRef?: string
    previewRef?: string | null
    rasterProof?: { pages: Array<{ artefactRef: string }> } | null
  }>
): ArtefactTopology {
  let encryptedOriginalCount = 0
  let rasterPageCount = 0

  const entries: ArtefactTopologyEntry[] = (attachments ?? []).map(att => {
    const rasterPages = att.rasterProof?.pages ?? []
    const hasRaster = rasterPages.length > 0

    if (att.encryptedRef) encryptedOriginalCount++
    rasterPageCount += rasterPages.length

    return {
      attachmentId: att.id,
      originalMime: att.originalType,
      originalBytes: att.originalSize,
      hasSemantic: Boolean(att.semanticExtracted || (att.semanticContent && att.semanticContent.length > 0)),
      hasRasterPages: hasRaster,
      rasterPageCount: rasterPages.length,
      encryptedRef: att.encryptedRef,
      previewRef: att.previewRef ?? null,
    }
  })

  return {
    totalCount: encryptedOriginalCount + rasterPageCount,
    encryptedOriginalCount,
    rasterPageCount,
    entries,
  }
}

// =============================================================================
// Inner Envelope Encryption / Decryption (Stage 4)
// =============================================================================

/** Nonce size for inner envelope AES-256-GCM encryption (bytes). */
const INNER_ENVELOPE_NONCE_BYTES = 12

/**
 * Encode InnerEnvelopeMetadata as a wire blob: `<nonce_b64>.<ciphertext_b64>`.
 *
 * The wire format is a dot-separated base64 string to keep it JSON-serializable
 * as a single string field of `BeapPackage`.
 */
function encodeInnerEnvelopeBlob(nonce: string, ciphertext: string): string {
  return `${nonce}.${ciphertext}`
}

/**
 * Decode the wire blob back into nonce and ciphertext.
 * Returns null if the format is invalid.
 */
function decodeInnerEnvelopeBlob(blob: string): { nonce: string; ciphertext: string } | null {
  const dotIdx = blob.indexOf('.')
  if (dotIdx < 1) return null
  const nonce = blob.slice(0, dotIdx)
  const ciphertext = blob.slice(dotIdx + 1)
  if (!nonce || !ciphertext) return null
  return { nonce, ciphertext }
}

/**
 * Encrypt InnerEnvelopeMetadata using AES-256-GCM.
 *
 * The AAD is the canonical serialization of the outer envelope header fields,
 * cryptographically binding the inner envelope to the outer envelope.
 * Any modification of the outer header after build time will cause AEAD
 * authentication to fail at Stage 4 decryption.
 *
 * Per A.3.055 Stage 4 (Normative):
 *   - Encryption MUST be AEAD-authenticated.
 *   - AAD MUST include the outer envelope governance material.
 *
 * @param metadata        - Inner envelope metadata to encrypt
 * @param innerKey        - 32-byte key derived via HKDF ('beap-inner-envelope-key')
 * @param outerHeaderAAD  - Canonical outer header bytes (from buildEnvelopeAadFields)
 * @returns Base64 wire blob: `<nonce_b64>.<ciphertext_b64>`
 */
export async function encryptInnerEnvelope(
  metadata: InnerEnvelopeMetadata,
  innerKey: Uint8Array,
  outerHeaderAAD: Uint8Array
): Promise<string> {
  const plaintext = JSON.stringify(stableCanonicalize(metadata))
  const plaintextBytes = new TextEncoder().encode(plaintext)

  const encrypted = await aeadEncrypt(innerKey, plaintextBytes, outerHeaderAAD)
  return encodeInnerEnvelopeBlob(encrypted.nonce, encrypted.ciphertext)
}

/**
 * Decrypt and authenticate the inner envelope.
 *
 * Called at Stage 4 — AFTER outer envelope integrity verification (Stage 1)
 * and recipient eligibility determination (Stage 0), BEFORE Capsule decryption (Stage 6).
 *
 * Fail-closed semantics:
 *   - AEAD authentication failure → throws (do not expose any plaintext)
 *   - JSON parse failure → throws
 *   - Schema validation failure → throws with violation messages
 *
 * Per A.3.055 Stage 4 (Normative):
 *   - Unauthenticated plaintext MUST NOT be exposed to parsing.
 *   - This implementation parses only AFTER the AEAD auth tag is verified.
 *
 * @param blob            - Wire blob from `BeapPackage.innerEnvelopeCiphertext`
 * @param innerKey        - 32-byte inner envelope key
 * @param outerHeaderAAD  - Canonical outer header bytes (must match those used at build time)
 * @param outerTimestamp  - Outer header timestamp for binding verification
 * @returns Validated InnerEnvelopeMetadata
 * @throws Error with STAGE_4 prefix on any failure
 */
export async function decryptInnerEnvelope(
  blob: string,
  innerKey: Uint8Array,
  outerHeaderAAD: Uint8Array,
  outerTimestamp: number
): Promise<InnerEnvelopeMetadata> {
  const parts = decodeInnerEnvelopeBlob(blob)
  if (!parts) {
    throw new Error(
      'STAGE_4 [FORMAT]: Inner envelope wire blob is malformed (expected <nonce>.<ciphertext>). Package REJECTED.'
    )
  }

  // AEAD decryption — auth tag verified by WebCrypto before any plaintext is returned
  let plaintextBytes: Uint8Array
  try {
    plaintextBytes = await aeadDecrypt(innerKey, parts.nonce, parts.ciphertext, outerHeaderAAD)
  } catch {
    throw new Error(
      'STAGE_4 [AUTH]: Inner envelope AEAD authentication failed. ' +
      'Outer header may have been tampered with or the inner envelope key is incorrect. Package REJECTED.'
    )
  }

  // Parse JSON — only reached after successful AEAD authentication
  const plaintextStr = new TextDecoder().decode(plaintextBytes)
  let parsed: unknown
  try {
    parsed = JSON.parse(plaintextStr)
  } catch {
    throw new Error(
      'STAGE_4 [PARSE]: Inner envelope JSON is invalid after decryption. Package REJECTED.'
    )
  }

  // Schema + size-limit validation (fail-closed)
  const serializedBytes = plaintextBytes.byteLength
  const schemaErrors = validateInnerEnvelopeSchema(parsed, outerTimestamp, serializedBytes)
  if (schemaErrors.length > 0) {
    throw new Error(
      `STAGE_4 [SCHEMA]: Inner envelope validation failed:\n${schemaErrors.join('\n')}`
    )
  }

  return parsed as InnerEnvelopeMetadata
}

// =============================================================================
// Re-exports for convenience
// =============================================================================

export { toBase64, fromBase64 }
