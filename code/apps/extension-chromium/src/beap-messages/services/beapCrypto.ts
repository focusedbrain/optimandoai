/**
 * BEAP Cryptographic Primitives
 * 
 * AEAD encryption using WebCrypto AES-256-GCM.
 * Key derivation using HKDF-SHA256.
 * 
 * SECURITY: This module is security-critical. All AEAD operations
 * use authenticated encryption. Nonces are randomly generated.
 * 
 * @version 1.0.0
 */

// =============================================================================
// Types
// =============================================================================

export interface AeadCiphertext {
  /** Base64-encoded 12-byte nonce (IV) */
  nonce: string
  /** Base64-encoded ciphertext (includes auth tag for AES-GCM) */
  ciphertext: string
}

/**
 * Post-quantum cryptography status metadata.
 * Per canon A.3.054.10: "uses post-quantum encryption as the default for qBEAP"
 */
export interface BeapPQMetadata {
  /** Whether PQ is required by policy (fail-closed if true and not available) */
  required: boolean
  /** Whether PQ is currently active in this package */
  active: boolean
  /** KEM algorithm when PQ is active (future) */
  kem?: 'ML-KEM-768'
  /** Whether hybrid mode is used (X25519 + ML-KEM) */
  hybrid?: boolean
}

export interface BeapCryptoMetadata {
  /** Full cryptographic suite identifier */
  suiteId: string
  /** AEAD algorithm identifier */
  aead: 'AES-256-GCM'
  /** Key derivation function */
  kdf: 'HKDF-SHA256'
  /** Hash algorithm */
  hash: 'SHA-256'
  /** Key derivation method */
  keyDerivation: 'HYBRID_MLKEM768_X25519' | 'X25519_ECDH'
  /** Base64-encoded envelope salt (16 bytes) */
  salt: string
  /** Handshake ID used for key binding */
  handshake_id: string
  /** Post-quantum cryptography metadata */
  pq: BeapPQMetadata
}

/**
 * A single encrypted chunk within a chunked artefact.
 * Per canon A.3.054.11: "Deterministic byte-level chunking is applied where required.
 * Chunks are ordered canonically, size-bounded, topology-declared, and cryptographically committed."
 */
export interface EncryptedChunk {
  /** Chunk index (0-based, canonical ordering) */
  index: number
  /** Unique nonce for this chunk's encryption */
  nonce: string
  /** Encrypted chunk bytes (base64) */
  ciphertext: string
  /** SHA-256 of this chunk's ciphertext (for integrity verification) */
  sha256Cipher: string
  /** Size of this chunk's plaintext bytes */
  bytesPlain: number
}

/**
 * Chunking metadata for artefacts.
 */
export interface ChunkingMetadata {
  /** Whether this artefact is chunked */
  enabled: boolean
  /** Total number of chunks */
  count: number
  /** Maximum chunk size in bytes */
  maxChunkBytes: number
  /** Merkle root of all chunk sha256Cipher values (for commitment verification) */
  merkleRoot: string
}

export interface EncryptedArtefact {
  /** Artefact class: "raster" for reconstructed page images, "original" for source files */
  class: 'raster' | 'original'
  artefactRef: string
  attachmentId: string
  /** Page number (for raster artefacts only) */
  page?: number
  /** Original filename (for original artefacts only) */
  filename?: string
  mime: string
  /** SHA-256 of plaintext (for verification after decrypt) */
  sha256Plain: string
  /** Size of plaintext bytes */
  bytesPlain: number
  /** Dimensions (for raster artefacts only) */
  width?: number
  height?: number
  
  // --- Legacy single-blob encryption (for small artefacts) ---
  /** Nonce for this artefact's encryption (legacy/small artefacts) */
  nonce?: string
  /** Encrypted artefact bytes (base64) - legacy/small artefacts */
  ciphertext?: string
  /** SHA-256 of ciphertext (for integrity verification) - legacy */
  sha256Cipher?: string
  
  // --- Chunked encryption (for large artefacts) ---
  /** Chunking metadata (present when artefact is chunked) */
  chunking?: ChunkingMetadata
  /** Array of encrypted chunks (present when artefact is chunked) */
  chunks?: EncryptedChunk[]
}

/**
 * Encrypted capsule payload structure.
 * 
 * Per canon A.3.042: "The Capsule MUST be chunked."
 * 
 * For qBEAP, the capsule payload is ALWAYS chunked for canon compliance.
 * Legacy single-blob fields are retained for backward compatibility when reading old packages.
 */
export interface CapsulePayloadEnc {
  /** SHA-256 of plaintext payload JSON (for verification after decrypt) */
  sha256Plain: string
  /** Size of plaintext payload in bytes */
  bytesPlain: number
  
  // --- Legacy single-blob encryption (for backward compatibility reading old packages) ---
  /** Nonce for legacy single-blob encryption */
  nonce?: string
  /** Ciphertext for legacy single-blob encryption (base64) */
  ciphertext?: string
  /** SHA-256 of ciphertext for legacy mode */
  sha256Cipher?: string
  
  // --- Chunked encryption (canon A.3.042 compliant, default for new packages) ---
  /** Chunking metadata (present when capsule is chunked) */
  chunking?: ChunkingMetadata
  /** Array of encrypted chunks (present when capsule is chunked) */
  chunks?: EncryptedChunk[]
}

// =============================================================================
// Constants
// =============================================================================

const NONCE_LENGTH = 12 // 96 bits for AES-GCM
const SALT_LENGTH = 16 // 128 bits
const KEY_LENGTH = 32 // 256 bits

// =============================================================================
// Debug AAD Tracking (Dev-Only)
// =============================================================================
// Tracks AAD usage for validation. Only active when explicitly enabled.
// Production builds have zero overhead beyond a single boolean check.

let __debugAadEnabled = false
let __debugAadUsedCount = 0
let __debugAadLastLen = 0

/**
 * Enable or disable debug AAD tracking (dev-only).
 * 
 * When disabled (default), trackAadUsage() is a no-op with minimal overhead.
 * Enable before building a package and disable after validation.
 * 
 * @param enabled - Whether to enable AAD tracking
 */
export function setDebugAadTrackingEnabled(enabled: boolean): void {
  __debugAadEnabled = enabled
}

/**
 * Get debug AAD statistics (dev-only).
 * Used by beapBuildValidation.ts to verify AAD was actually used.
 */
export function getDebugAadStats(): { usedCount: number; lastLen: number } {
  return {
    usedCount: __debugAadUsedCount,
    lastLen: __debugAadLastLen
  }
}

/**
 * Reset debug AAD statistics (dev-only).
 * Call before building a package to get fresh stats.
 * Also resets signing data capture.
 */
export function resetDebugAadStats(): void {
  __debugAadUsedCount = 0
  __debugAadLastLen = 0
  resetDebugSigningData()
}

/**
 * Track AAD usage (dev-only).
 * Called internally by aeadEncrypt when AAD is provided.
 * 
 * Early-returns if tracking is disabled (zero overhead in production).
 */
function trackAadUsage(aadLength: number): void {
  // Fast path: skip if tracking is disabled (production)
  if (!__debugAadEnabled) return
  
  if (aadLength > 0) {
    __debugAadUsedCount++
    __debugAadLastLen = aadLength
  }
}

// =============================================================================
// Debug Signing Data Capture (Dev-Only)
// =============================================================================
// Captures the last computed signing data for validation.
// Only active when debug tracking is enabled.

let __debugLastSigningData: unknown = null

/**
 * Get the last computed signing data object (dev-only).
 * Used by beapBuildValidation.ts to verify signing binds to payload merkle root.
 * 
 * @returns The last signing data object, or null if not captured
 */
export function getDebugLastSigningData(): unknown {
  return __debugLastSigningData
}

/**
 * Reset debug signing data (dev-only).
 * Called by resetDebugAadStats() to reset all debug state.
 */
function resetDebugSigningData(): void {
  __debugLastSigningData = null
}

/**
 * Capture signing data for debug validation (dev-only).
 * Called by computeSigningData when debug tracking is enabled.
 */
function captureDebugSigningData(signingData: unknown): void {
  if (!__debugAadEnabled) return
  __debugLastSigningData = signingData
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Generate cryptographically secure random bytes
 */
export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

/**
 * Convert Uint8Array to base64 string
 */
export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

/**
 * Convert base64 string to Uint8Array
 */
export function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/**
 * Convert string to UTF-8 bytes
 */
export function stringToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str)
}

/**
 * Convert UTF-8 bytes to string
 */
export function bytesToString(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

/**
 * Compute SHA-256 hash of bytes
 */
export async function sha256(data: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = new Uint8Array(hashBuffer)
  return Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('')
}

// =============================================================================
// Canonical AAD Serialization (Per Canon A.3.054.10)
// =============================================================================

/**
 * Recursively sort object keys for deterministic serialization.
 * 
 * Per canon A.3.054.10: "The AEAD additional authenticated data (AAD) SHALL include
 * the canonical, non-encrypted Envelope header fields."
 * 
 * Rules:
 * - Object keys are sorted lexicographically
 * - Arrays preserve their order (elements are recursively processed)
 * - undefined values are removed
 * - null is preserved
 * - Numbers remain numbers (no string conversion)
 * - Primitives (string, number, boolean, null) pass through unchanged
 * 
 * @param value - Any JSON-compatible value
 * @returns Canonicalized value with sorted object keys
 */
export function stableCanonicalize(value: unknown): unknown {
  // Handle null explicitly (typeof null === 'object')
  if (value === null) {
    return null
  }
  
  // Handle undefined - remove from output
  if (value === undefined) {
    return undefined
  }
  
  // Handle arrays - preserve order, recursively process elements
  if (Array.isArray(value)) {
    return value
      .map(item => stableCanonicalize(item))
      .filter(item => item !== undefined)
  }
  
  // Handle objects - sort keys, recursively process values
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const sortedKeys = Object.keys(obj).sort()
    const result: Record<string, unknown> = {}
    
    for (const key of sortedKeys) {
      const canonicalizedValue = stableCanonicalize(obj[key])
      // Skip undefined values (remove them from output)
      if (canonicalizedValue !== undefined) {
        result[key] = canonicalizedValue
      }
    }
    
    return result
  }
  
  // Primitives (string, number, boolean) pass through unchanged
  return value
}

/**
 * Serialize AAD fields to deterministic bytes for AEAD encryption.
 * 
 * Per canon A.3.054.10: AAD must be canonical and deterministic.
 * 
 * @param aadFields - Fields to include as AAD
 * @returns UTF-8 encoded bytes of canonical JSON
 */
export function canonicalSerializeAAD(aadFields: Record<string, unknown>): Uint8Array {
  const canonicalized = stableCanonicalize(aadFields)
  const json = JSON.stringify(canonicalized)
  return stringToBytes(json)
}

/**
 * Header structure for AAD field extraction.
 * Structural type to avoid circular import with BeapPackageBuilder.
 */
interface EnvelopeHeaderForAAD {
  version: string
  encoding: string
  encryption_mode: string
  timestamp: number
  sender_fingerprint: string
  receiver_fingerprint?: string
  template_hash: string
  policy_hash: string
  content_hash: string
  crypto?: {
    suiteId: string
    salt: string
    handshake_id: string
    senderX25519PublicKeyB64: string
    pq: {
      required: boolean
      kem?: string
      kemCiphertextB64?: string
    } | false
  }
  sizeLimits?: Record<string, unknown>
  // Excluded from AAD:
  // - receiver_binding (contains mutable display_name)
  // - signing (added after encryption, not available for AAD)
  // - compliance (informational, not security-critical)
}

/**
 * Extract the canonical AAD field subset from a BEAP envelope header.
 * 
 * Per canon A.3.054.10: "The AEAD additional authenticated data (AAD) SHALL include
 * the canonical, non-encrypted Envelope header fields required for integrity and sizing."
 * 
 * INCLUDED fields (non-encrypted, canonical):
 * - version, encoding, encryption_mode, timestamp
 * - sender_fingerprint, receiver_fingerprint
 * - template_hash, policy_hash, content_hash
 * - crypto.suiteId, crypto.salt, crypto.handshake_id, crypto.senderX25519PublicKeyB64
 * - crypto.pq.required, crypto.pq.kem, crypto.pq.kemCiphertextB64
 * - sizeLimits (if present)
 * 
 * EXCLUDED fields:
 * - receiver_binding.display_name (mutable, not security-critical)
 * - signing.* (added after encryption, not available for AAD binding)
 * - compliance.* (informational, not security-critical)
 * 
 * @param header - BEAP envelope header
 * @returns AAD fields subset for canonical serialization
 */
export function buildEnvelopeAadFields(header: EnvelopeHeaderForAAD): Record<string, unknown> {
  const aadFields: Record<string, unknown> = {
    // Core envelope fields
    version: header.version,
    encoding: header.encoding,
    encryption_mode: header.encryption_mode,
    timestamp: header.timestamp,
    sender_fingerprint: header.sender_fingerprint,
    
    // Commitment hashes
    template_hash: header.template_hash,
    policy_hash: header.policy_hash,
    content_hash: header.content_hash
  }
  
  // Optional receiver fingerprint (present for qBEAP, not for pBEAP)
  if (header.receiver_fingerprint !== undefined) {
    aadFields.receiver_fingerprint = header.receiver_fingerprint
  }
  
  // Crypto binding fields (for qBEAP)
  if (header.crypto) {
    aadFields.crypto = {
      suiteId: header.crypto.suiteId,
      salt: header.crypto.salt,
      handshake_id: header.crypto.handshake_id,
      senderX25519PublicKeyB64: header.crypto.senderX25519PublicKeyB64
    }
    
    // PQ metadata (if active)
    if (header.crypto.pq && header.crypto.pq !== false) {
      (aadFields.crypto as Record<string, unknown>).pq = {
        required: header.crypto.pq.required,
        kem: header.crypto.pq.kem,
        kemCiphertextB64: header.crypto.pq.kemCiphertextB64
      }
    }
  }
  
  // Size limits (if present, for bounded processing)
  if (header.sizeLimits !== undefined) {
    aadFields.sizeLimits = header.sizeLimits
  }
  
  return aadFields
}

/**
 * Compute AAD bytes from a BEAP envelope header.
 * Convenience function combining buildEnvelopeAadFields and canonicalSerializeAAD.
 * 
 * @param header - BEAP envelope header
 * @returns Canonical AAD bytes for AEAD encryption
 */
export function computeEnvelopeAAD(header: EnvelopeHeaderForAAD): Uint8Array {
  const aadFields = buildEnvelopeAadFields(header)
  return canonicalSerializeAAD(aadFields)
}

// =============================================================================
// Key Derivation
// =============================================================================

/**
 * Derive a key using HKDF-SHA256
 * 
 * @param ikm - Input key material (bytes)
 * @param salt - Salt (bytes, should be random)
 * @param info - Context info string
 * @param length - Output key length in bytes
 * @returns Derived key material
 */
export async function hkdfSha256(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: string,
  length: number = KEY_LENGTH
): Promise<Uint8Array> {
  // Import IKM as raw key material
  const ikmKey = await crypto.subtle.importKey(
    'raw',
    ikm,
    { name: 'HKDF' },
    false,
    ['deriveBits']
  )

  // Derive bits using HKDF
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: salt,
      info: stringToBytes(info)
    },
    ikmKey,
    length * 8 // bits
  )

  return new Uint8Array(derivedBits)
}

/**
 * Key derivation method for qBEAP.
 * 
 * qBEAP requires post-quantum key agreement (per canon A.3.054.10 / A.3.13):
 * - 'HYBRID_MLKEM768_X25519': Current implementation (post-quantum hybrid)
 * - 'X25519_ECDH': Deprecated for qBEAP (classical only)
 * 
 * Note: No fallback to deterministic derivation is allowed for qBEAP.
 */
export type KeyDerivationMethod = 
  | 'HYBRID_MLKEM768_X25519'  // Post-quantum hybrid (current for qBEAP)
  | 'X25519_ECDH'             // Classical X25519 only (deprecated for qBEAP)

/**
 * Result of handshake secret derivation
 */
export interface HandshakeSecretResult {
  /** 32-byte shared secret */
  sharedSecret: Uint8Array
  /** Method used for derivation */
  method: KeyDerivationMethod
}

/**
 * Derive handshake secret using X25519 ECDH (PREFERRED)
 * 
 * This is the production-grade key derivation using real ECDH.
 * 
 * @param peerPublicKeyBase64 - Peer's X25519 public key (base64, 32 bytes)
 * @returns HandshakeSecretResult with shared secret and method
 * @throws Error if peer public key is missing or invalid
 */
export async function deriveHandshakeSecretX25519(
  peerPublicKeyBase64: string
): Promise<HandshakeSecretResult> {
  // Import X25519 key agreement module
  const { deriveSharedSecretX25519 } = await import('./x25519KeyAgreement')
  
  const result = await deriveSharedSecretX25519(peerPublicKeyBase64)
  
  return {
    sharedSecret: result.sharedSecret,
    method: 'X25519_ECDH'
  }
}

/**
 * @internal
 * @deprecated DO NOT USE - Kept only for reference/testing
 * 
 * qBEAP requires real key agreement (X25519 minimum, PQ hybrid target).
 * This function is NOT used in production qBEAP builds.
 */
async function deriveHandshakeSecret_DEPRECATED(
  handshakeId: string,
  senderFingerprint: string
): Promise<Uint8Array> {
  console.error(
    '[BEAP Crypto] DEPRECATED: MVP_DETERMINISTIC key derivation called. ' +
    'This should not be used for qBEAP. Use deriveHandshakeSecretX25519().'
  )
  
  const combined = `BEAP-MVP:${handshakeId}:${senderFingerprint}`
  const combinedBytes = stringToBytes(combined)
  const hashBuffer = await crypto.subtle.digest('SHA-256', combinedBytes)
  return new Uint8Array(hashBuffer)
}

/**
 * Derive capsule and artefact keys from shared secret
 * 
 * @param sharedSecret - Shared secret from handshake
 * @param envelopeSalt - Random salt for this envelope
 * @returns { capsuleKey, artefactKey }
 */
export async function deriveBeapKeys(
  sharedSecret: Uint8Array,
  envelopeSalt: Uint8Array
): Promise<{ capsuleKey: Uint8Array; artefactKey: Uint8Array }> {
  const capsuleKey = await hkdfSha256(
    sharedSecret,
    envelopeSalt,
    'BEAP v1 capsule',
    KEY_LENGTH
  )
  
  const artefactKey = await hkdfSha256(
    sharedSecret,
    envelopeSalt,
    'BEAP v1 artefact',
    KEY_LENGTH
  )
  
  return { capsuleKey, artefactKey }
}

// =============================================================================
// AEAD Encryption (AES-256-GCM)
// =============================================================================

/**
 * Encrypt plaintext using AES-256-GCM
 * 
 * @param key - 32-byte key
 * @param plaintext - Plaintext bytes
 * @param aad - Additional authenticated data (optional)
 * @returns { nonce, ciphertext } as base64 strings
 */
export async function aeadEncrypt(
  key: Uint8Array,
  plaintext: Uint8Array,
  aad?: Uint8Array
): Promise<AeadCiphertext> {
  // Track AAD usage for dev-only validation
  if (aad) {
    trackAadUsage(aad.length)
  }
  
  // Generate random nonce
  const nonce = randomBytes(NONCE_LENGTH)
  
  // Import key
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  )
  
  // Encrypt with AES-GCM
  const ciphertextBuffer = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: nonce,
      additionalData: aad
    },
    cryptoKey,
    plaintext
  )
  
  return {
    nonce: toBase64(nonce),
    ciphertext: toBase64(new Uint8Array(ciphertextBuffer))
  }
}

/**
 * Decrypt ciphertext using AES-256-GCM
 * 
 * @param key - 32-byte key
 * @param nonce - Base64-encoded nonce
 * @param ciphertext - Base64-encoded ciphertext
 * @param aad - Additional authenticated data (optional)
 * @returns Decrypted plaintext bytes
 * @throws Error if authentication fails
 */
export async function aeadDecrypt(
  key: Uint8Array,
  nonce: string,
  ciphertext: string,
  aad?: Uint8Array
): Promise<Uint8Array> {
  // Decode inputs
  const nonceBytes = fromBase64(nonce)
  const ciphertextBytes = fromBase64(ciphertext)
  
  // Import key
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  )
  
  // Decrypt with AES-GCM
  const plaintextBuffer = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: nonceBytes,
      additionalData: aad
    },
    cryptoKey,
    ciphertextBytes
  )
  
  return new Uint8Array(plaintextBuffer)
}

// =============================================================================
// High-Level BEAP Encryption
// =============================================================================

/**
 * Generate a new envelope salt
 */
export function generateEnvelopeSalt(): Uint8Array {
  return randomBytes(SALT_LENGTH)
}

// =============================================================================
// Chunking Support (Per Canon A.3.054.11)
// =============================================================================

/** Default chunk size: 1MB */
const DEFAULT_MAX_CHUNK_BYTES = 1024 * 1024

/** Threshold for chunking: artefacts larger than this will be chunked */
const CHUNKING_THRESHOLD_BYTES = 1024 * 1024 // 1MB

/**
 * Split bytes into chunks of specified maximum size.
 * 
 * Per canon A.3.054.11: "Deterministic byte-level chunking is applied where required.
 * Chunks are ordered canonically, size-bounded, topology-declared."
 * 
 * @param data - Data to chunk
 * @param maxChunkBytes - Maximum size of each chunk (default 1MB)
 * @returns Array of byte chunks
 */
export function chunkBytes(data: Uint8Array, maxChunkBytes: number = DEFAULT_MAX_CHUNK_BYTES): Uint8Array[] {
  const chunks: Uint8Array[] = []
  let offset = 0
  
  while (offset < data.length) {
    const end = Math.min(offset + maxChunkBytes, data.length)
    chunks.push(data.slice(offset, end))
    offset = end
  }
  
  return chunks
}

/**
 * Compute Merkle root from chunk hashes.
 * Simple concatenation-based root for now (can be upgraded to proper Merkle tree).
 * 
 * @param chunkHashes - Array of SHA-256 hex hashes
 * @returns Merkle root as SHA-256 hex string
 */
export async function computeMerkleRoot(chunkHashes: string[]): Promise<string> {
  // Simple approach: hash concatenation of all chunk hashes
  // For a more robust solution, implement proper binary Merkle tree
  const concatenated = chunkHashes.join('')
  const bytes = stringToBytes(concatenated)
  return sha256(bytes)
}

/**
 * Encrypt a data blob into chunks with per-chunk nonces.
 * 
 * Per canon A.3.054.11: "Assembly occurs prior to decryption and without partial plaintext exposure."
 * Each chunk is encrypted independently with a unique nonce.
 * 
 * @param key - Encryption key
 * @param data - Data to encrypt
 * @param maxChunkBytes - Maximum plaintext chunk size (default 1MB)
 * @param aad - Optional additional authenticated data (per canon A.3.054.10)
 * @returns Chunking result with encrypted chunks and metadata
 */
export async function encryptChunks(
  key: Uint8Array,
  data: Uint8Array,
  maxChunkBytes: number = DEFAULT_MAX_CHUNK_BYTES,
  aad?: Uint8Array
): Promise<{
  chunks: EncryptedChunk[]
  chunking: ChunkingMetadata
}> {
  const plaintextChunks = chunkBytes(data, maxChunkBytes)
  const encryptedChunks: EncryptedChunk[] = []
  const chunkHashes: string[] = []
  
  for (let i = 0; i < plaintextChunks.length; i++) {
    const chunk = plaintextChunks[i]
    // Pass AAD to AEAD if provided (per canon A.3.054.10)
    const encrypted = await aeadEncrypt(key, chunk, aad)
    const ciphertextBytes = fromBase64(encrypted.ciphertext)
    const chunkHash = await sha256(ciphertextBytes)
    
    encryptedChunks.push({
      index: i,
      nonce: encrypted.nonce,
      ciphertext: encrypted.ciphertext,
      sha256Cipher: chunkHash,
      bytesPlain: chunk.length
    })
    
    chunkHashes.push(chunkHash)
  }
  
  const merkleRoot = await computeMerkleRoot(chunkHashes)
  
  return {
    chunks: encryptedChunks,
    chunking: {
      enabled: true,
      count: encryptedChunks.length,
      maxChunkBytes,
      merkleRoot
    }
  }
}

/**
 * Decrypt chunked artefact back to original bytes.
 * 
 * @param key - Decryption key
 * @param chunks - Encrypted chunks in canonical order
 * @returns Reassembled plaintext
 */
export async function decryptChunks(
  key: Uint8Array,
  chunks: EncryptedChunk[]
): Promise<Uint8Array> {
  // Sort by index to ensure canonical ordering
  const sortedChunks = [...chunks].sort((a, b) => a.index - b.index)
  
  // Decrypt each chunk
  const decryptedChunks: Uint8Array[] = []
  for (const chunk of sortedChunks) {
    const plaintext = await aeadDecrypt(key, chunk.nonce, chunk.ciphertext)
    decryptedChunks.push(plaintext)
  }
  
  // Reassemble
  const totalLength = decryptedChunks.reduce((sum, c) => sum + c.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of decryptedChunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  
  return result
}

/**
 * Check if data should be chunked based on size threshold.
 */
export function shouldChunk(dataLength: number): boolean {
  return dataLength > CHUNKING_THRESHOLD_BYTES
}

/**
 * Encrypt capsule payload JSON (legacy single-blob mode)
 * 
 * @deprecated Use encryptCapsulePayloadChunked() for canon A.3.042 compliance.
 * @param capsuleKey - Derived capsule key
 * @param payloadJson - Capsule payload as JSON string
 * @returns Encrypted payload
 */
export async function encryptCapsulePayload(
  capsuleKey: Uint8Array,
  payloadJson: string
): Promise<AeadCiphertext> {
  const plaintext = stringToBytes(payloadJson)
  return aeadEncrypt(capsuleKey, plaintext)
}

/** Default chunk size for capsule payload: 256KB */
const CAPSULE_CHUNK_SIZE = 256 * 1024

/**
 * Encrypt capsule payload JSON with chunking.
 * 
 * Per canon A.3.042: "The Capsule MUST be chunked."
 * 
 * This function ALWAYS chunks the capsule payload, regardless of size,
 * to ensure canon compliance. Each chunk is encrypted with a unique nonce.
 * 
 * @param capsuleKey - Derived capsule key (from HKDF)
 * @param payloadJson - Capsule payload as JSON string
 * @param aad - Additional authenticated data (canonical envelope fields)
 * @param maxChunkBytes - Maximum chunk size (default 256KB)
 * @returns CapsulePayloadEnc with chunking metadata and encrypted chunks
 */
export async function encryptCapsulePayloadChunked(
  capsuleKey: Uint8Array,
  payloadJson: string,
  aad: Uint8Array,
  maxChunkBytes: number = CAPSULE_CHUNK_SIZE
): Promise<CapsulePayloadEnc> {
  // Convert JSON to bytes
  const plaintext = stringToBytes(payloadJson)
  
  // Compute plaintext hash and size
  const sha256PlainValue = await sha256(plaintext)
  const bytesPlain = plaintext.length
  
  // ALWAYS chunk for canon A.3.042 compliance
  // Even small payloads get chunked (will result in a single chunk)
  const plaintextChunks = chunkBytes(plaintext, maxChunkBytes)
  const encryptedChunks: EncryptedChunk[] = []
  const chunkHashes: string[] = []
  
  for (let i = 0; i < plaintextChunks.length; i++) {
    const chunk = plaintextChunks[i]
    // Encrypt with AAD binding (currently AAD passed but not used by aeadEncrypt unless wired)
    // TODO: Wire AAD to aeadEncrypt in next step
    const encrypted = await aeadEncrypt(capsuleKey, chunk, aad)
    const ciphertextBytes = fromBase64(encrypted.ciphertext)
    const chunkHash = await sha256(ciphertextBytes)
    
    encryptedChunks.push({
      index: i,
      nonce: encrypted.nonce,
      ciphertext: encrypted.ciphertext,
      sha256Cipher: chunkHash,
      bytesPlain: chunk.length
    })
    
    chunkHashes.push(chunkHash)
  }
  
  // Compute Merkle root from chunk hashes (commits to all ciphertext)
  const merkleRoot = await computeMerkleRoot(chunkHashes)
  
  return {
    sha256Plain: sha256PlainValue,
    bytesPlain,
    chunking: {
      enabled: true,
      count: encryptedChunks.length,
      maxChunkBytes,
      merkleRoot
    },
    chunks: encryptedChunks
  }
}

/**
 * Decrypt capsule payload
 * 
 * @param capsuleKey - Derived capsule key
 * @param encrypted - Encrypted payload
 * @returns Decrypted JSON string
 */
export async function decryptCapsulePayload(
  capsuleKey: Uint8Array,
  encrypted: AeadCiphertext
): Promise<string> {
  const plaintext = await aeadDecrypt(
    capsuleKey,
    encrypted.nonce,
    encrypted.ciphertext
  )
  return bytesToString(plaintext)
}

/**
 * Encrypt a raster artefact (e.g., rasterized page image)
 * 
 * @param artefactKey - Derived artefact key
 * @param artefact - Artefact with base64 image data
 * @returns Encrypted artefact with class: "raster"
 */
export async function encryptArtefact(
  artefactKey: Uint8Array,
  artefact: {
    artefactRef: string
    attachmentId: string
    page: number
    mime: string
    base64: string
    sha256: string
    width: number
    height: number
    bytes: number
  }
): Promise<EncryptedArtefact> {
  // Decode base64 plaintext
  const plaintext = fromBase64(artefact.base64)
  
  // Base artefact data
  const baseArtefact = {
    class: 'raster' as const,
    artefactRef: artefact.artefactRef,
    attachmentId: artefact.attachmentId,
    page: artefact.page,
    mime: artefact.mime,
    sha256Plain: artefact.sha256,
    width: artefact.width,
    height: artefact.height,
    bytesPlain: artefact.bytes
  }
  
  // Use chunking for large artefacts (per canon A.3.054.11)
  if (shouldChunk(plaintext.length)) {
    const { chunks, chunking } = await encryptChunks(artefactKey, plaintext)
    return {
      ...baseArtefact,
      chunking,
      chunks
    }
  }
  
  // Small artefact: use legacy single-blob encryption
  const encrypted = await aeadEncrypt(artefactKey, plaintext)
  const ciphertextBytes = fromBase64(encrypted.ciphertext)
  const sha256CipherValue = await sha256(ciphertextBytes)
  
  return {
    ...baseArtefact,
    nonce: encrypted.nonce,
    ciphertext: encrypted.ciphertext,
    sha256Cipher: sha256CipherValue
  }
}

/**
 * Encrypt an original file artefact (source file bytes)
 * Per canon A.3.043: Original artefacts MUST be contained, encrypted, 
 * and linked to Envelope commitments.
 * 
 * Uses chunking for large files per canon A.3.054.11.
 * 
 * @param artefactKey - Derived artefact key
 * @param original - Original file with base64 data
 * @returns Encrypted artefact with class: "original"
 */
export async function encryptOriginalArtefact(
  artefactKey: Uint8Array,
  original: {
    attachmentId: string
    filename: string
    mime: string
    base64: string
  }
): Promise<EncryptedArtefact> {
  // Decode base64 plaintext
  const plaintext = fromBase64(original.base64)
  
  // Compute sha256 of plaintext (sha256 returns hex string)
  const sha256PlainValue = await sha256(plaintext)
  
  // Generate artefact reference
  const artefactRef = `original_${original.attachmentId}_${sha256PlainValue.substring(0, 8)}`
  
  // Base artefact data
  const baseArtefact = {
    class: 'original' as const,
    artefactRef,
    attachmentId: original.attachmentId,
    filename: original.filename,
    mime: original.mime,
    sha256Plain: sha256PlainValue,
    bytesPlain: plaintext.length
  }
  
  // Use chunking for large artefacts (per canon A.3.054.11)
  if (shouldChunk(plaintext.length)) {
    const { chunks, chunking } = await encryptChunks(artefactKey, plaintext)
    return {
      ...baseArtefact,
      chunking,
      chunks
    }
  }
  
  // Small artefact: use legacy single-blob encryption
  const encrypted = await aeadEncrypt(artefactKey, plaintext)
  
  // Compute sha256 of ciphertext for integrity
  const ciphertextBytes = fromBase64(encrypted.ciphertext)
  const sha256CipherValue = await sha256(ciphertextBytes)
  
  return {
    ...baseArtefact,
    nonce: encrypted.nonce,
    ciphertext: encrypted.ciphertext,
    sha256Cipher: sha256CipherValue
  }
}

// =============================================================================
// AAD-Aware Artefact Encryption (Per Canon A.3.054.10)
// =============================================================================

/**
 * Encrypt a raster artefact with AAD binding.
 * 
 * Per canon A.3.054.10: "The AEAD additional authenticated data (AAD) SHALL include
 * the canonical, non-encrypted Envelope header fields."
 * 
 * @param artefactKey - Derived artefact key
 * @param artefact - Artefact with base64 image data
 * @param aad - Additional authenticated data (canonical envelope fields)
 * @returns Encrypted artefact with class: "raster"
 */
export async function encryptArtefactWithAAD(
  artefactKey: Uint8Array,
  artefact: {
    artefactRef: string
    attachmentId: string
    page: number
    mime: string
    base64: string
    sha256: string
    width: number
    height: number
    bytes: number
  },
  aad: Uint8Array
): Promise<EncryptedArtefact> {
  // Decode base64 plaintext
  const plaintext = fromBase64(artefact.base64)
  
  // Base artefact data
  const baseArtefact = {
    class: 'raster' as const,
    artefactRef: artefact.artefactRef,
    attachmentId: artefact.attachmentId,
    page: artefact.page,
    mime: artefact.mime,
    sha256Plain: artefact.sha256,
    width: artefact.width,
    height: artefact.height,
    bytesPlain: artefact.bytes
  }
  
  // Use chunking for large artefacts (per canon A.3.054.11)
  if (shouldChunk(plaintext.length)) {
    const { chunks, chunking } = await encryptChunks(artefactKey, plaintext, DEFAULT_MAX_CHUNK_BYTES, aad)
    return {
      ...baseArtefact,
      chunking,
      chunks
    }
  }
  
  // Small artefact: use single-blob encryption with AAD
  const encrypted = await aeadEncrypt(artefactKey, plaintext, aad)
  const ciphertextBytes = fromBase64(encrypted.ciphertext)
  const sha256CipherValue = await sha256(ciphertextBytes)
  
  return {
    ...baseArtefact,
    nonce: encrypted.nonce,
    ciphertext: encrypted.ciphertext,
    sha256Cipher: sha256CipherValue
  }
}

/**
 * Encrypt an original file artefact with AAD binding.
 * 
 * Per canon A.3.043: Original artefacts MUST be contained, encrypted, 
 * and linked to Envelope commitments.
 * 
 * Per canon A.3.054.10: AAD binds encryption to envelope fields.
 * 
 * @param artefactKey - Derived artefact key
 * @param original - Original file with base64 data
 * @param aad - Additional authenticated data (canonical envelope fields)
 * @returns Encrypted artefact with class: "original"
 */
export async function encryptOriginalArtefactWithAAD(
  artefactKey: Uint8Array,
  original: {
    attachmentId: string
    filename: string
    mime: string
    base64: string
  },
  aad: Uint8Array
): Promise<EncryptedArtefact> {
  // Decode base64 plaintext
  const plaintext = fromBase64(original.base64)
  
  // Compute sha256 of plaintext (sha256 returns hex string)
  const sha256PlainValue = await sha256(plaintext)
  
  // Generate artefact reference
  const artefactRef = `original_${original.attachmentId}_${sha256PlainValue.substring(0, 8)}`
  
  // Base artefact data
  const baseArtefact = {
    class: 'original' as const,
    artefactRef,
    attachmentId: original.attachmentId,
    filename: original.filename,
    mime: original.mime,
    sha256Plain: sha256PlainValue,
    bytesPlain: plaintext.length
  }
  
  // Use chunking for large artefacts (per canon A.3.054.11)
  if (shouldChunk(plaintext.length)) {
    const { chunks, chunking } = await encryptChunks(artefactKey, plaintext, DEFAULT_MAX_CHUNK_BYTES, aad)
    return {
      ...baseArtefact,
      chunking,
      chunks
    }
  }
  
  // Small artefact: use single-blob encryption with AAD
  const encrypted = await aeadEncrypt(artefactKey, plaintext, aad)
  
  // Compute sha256 of ciphertext for integrity
  const ciphertextBytes = fromBase64(encrypted.ciphertext)
  const sha256CipherValue = await sha256(ciphertextBytes)
  
  return {
    ...baseArtefact,
    nonce: encrypted.nonce,
    ciphertext: encrypted.ciphertext,
    sha256Cipher: sha256CipherValue
  }
}

/**
 * Decrypt an artefact (raster or original)
 * 
 * @param artefactKey - Derived artefact key
 * @param encrypted - Encrypted artefact
 * @returns Decrypted artefact with base64 data
 */
export async function decryptArtefact(
  artefactKey: Uint8Array,
  encrypted: EncryptedArtefact
): Promise<{
  class: 'raster' | 'original'
  artefactRef: string
  attachmentId: string
  page?: number
  filename?: string
  mime: string
  base64: string
  sha256: string
  width?: number
  height?: number
  bytes: number
}> {
  let plaintext: Uint8Array
  
  // Handle chunked vs legacy encryption
  if (encrypted.chunking?.enabled && encrypted.chunks && encrypted.chunks.length > 0) {
    // Chunked artefact: decrypt and reassemble chunks
    plaintext = await decryptChunks(artefactKey, encrypted.chunks)
  } else if (encrypted.nonce && encrypted.ciphertext) {
    // Legacy single-blob artefact
    plaintext = await aeadDecrypt(
      artefactKey,
      encrypted.nonce,
      encrypted.ciphertext
    )
  } else {
    throw new Error(`Invalid encrypted artefact: missing both chunks and ciphertext for ${encrypted.artefactRef}`)
  }
  
  return {
    class: encrypted.class,
    artefactRef: encrypted.artefactRef,
    attachmentId: encrypted.attachmentId,
    page: encrypted.page,
    filename: encrypted.filename,
    mime: encrypted.mime,
    base64: toBase64(plaintext),
    sha256: encrypted.sha256Plain,
    width: encrypted.width,
    height: encrypted.height,
    bytes: encrypted.bytesPlain
  }
}

// =============================================================================
// Ed25519 Digital Signatures
// =============================================================================

import * as ed from '@noble/ed25519'

// Configure @noble/ed25519 to use Web Crypto for SHA-512
// This is required for browser environments
ed.etc.sha512Sync = undefined // Disable sync (we use async)
ed.etc.sha512Async = async (message: Uint8Array): Promise<Uint8Array> => {
  const hash = await crypto.subtle.digest('SHA-512', message)
  return new Uint8Array(hash)
}

/**
 * Ed25519 key pair for signing
 */
export interface Ed25519KeyPair {
  /** Private key (32 bytes, base64) - KEEP SECRET */
  privateKey: string
  /** Public key (32 bytes, base64) - Safe to share */
  publicKey: string
  /** Key ID for identification (first 8 bytes of public key hash, hex) */
  keyId: string
}

/**
 * Signature with metadata
 */
export interface BeapSignature {
  /** Signature algorithm */
  algorithm: 'Ed25519'
  /** Base64-encoded signature (64 bytes) */
  signature: string
  /** Key ID of the signing key */
  keyId: string
  /** Base64-encoded public key for verification */
  publicKey: string
}

/**
 * Generate a new Ed25519 key pair
 * 
 * @returns Key pair with private key, public key, and key ID
 */
export async function generateEd25519KeyPair(): Promise<Ed25519KeyPair> {
  // Generate random 32-byte private key
  const privateKeyBytes = randomBytes(32)
  
  // Derive public key from private key
  const publicKeyBytes = await ed.getPublicKeyAsync(privateKeyBytes)
  
  // Generate key ID from first 8 bytes of SHA-256 of public key
  const publicKeyHash = await sha256(publicKeyBytes)
  const keyId = publicKeyHash.substring(0, 16) // 8 bytes = 16 hex chars
  
  return {
    privateKey: toBase64(privateKeyBytes),
    publicKey: toBase64(publicKeyBytes),
    keyId
  }
}

/**
 * Sign data with Ed25519 private key
 * 
 * @param privateKeyBase64 - Base64-encoded private key
 * @param data - Data to sign (Uint8Array)
 * @returns Base64-encoded signature
 */
export async function ed25519Sign(
  privateKeyBase64: string,
  data: Uint8Array
): Promise<string> {
  const privateKey = fromBase64(privateKeyBase64)
  const signature = await ed.signAsync(data, privateKey)
  return toBase64(signature)
}

/**
 * Verify Ed25519 signature
 * 
 * @param publicKeyBase64 - Base64-encoded public key
 * @param signatureBase64 - Base64-encoded signature
 * @param data - Original data that was signed
 * @returns true if signature is valid
 */
export async function ed25519Verify(
  publicKeyBase64: string,
  signatureBase64: string,
  data: Uint8Array
): Promise<boolean> {
  const publicKey = fromBase64(publicKeyBase64)
  const signature = fromBase64(signatureBase64)
  return ed.verifyAsync(signature, data, publicKey)
}

/**
 * Create a BEAP signature over structured data
 * 
 * @param keyPair - Ed25519 key pair
 * @param data - Data to sign
 * @returns Signature with metadata
 */
export async function createBeapSignature(
  keyPair: Ed25519KeyPair,
  data: Uint8Array
): Promise<BeapSignature> {
  const signature = await ed25519Sign(keyPair.privateKey, data)
  
  return {
    algorithm: 'Ed25519',
    signature,
    keyId: keyPair.keyId,
    publicKey: keyPair.publicKey
  }
}

/**
 * Verify a BEAP signature
 * 
 * @param sig - Signature with metadata
 * @param data - Original data that was signed
 * @returns true if signature is valid
 */
export async function verifyBeapSignature(
  sig: BeapSignature,
  data: Uint8Array
): Promise<boolean> {
  if (sig.algorithm !== 'Ed25519') {
    throw new Error(`Unsupported signature algorithm: ${sig.algorithm}`)
  }
  
  return ed25519Verify(sig.publicKey, sig.signature, data)
}

// =============================================================================
// Content Hashing for BEAP Headers
// =============================================================================

/**
 * Compute SHA-256 hash of bytes, return as hex string
 */
export async function sha256Hex(data: Uint8Array): Promise<string> {
  return sha256(data)
}

/**
 * Compute SHA-256 hash of a string (UTF-8 encoded)
 */
export async function sha256String(str: string): Promise<string> {
  return sha256(stringToBytes(str))
}

/**
 * Compute content hash for BEAP envelope
 * 
 * @param body - Message body (authoritative content)
 * @param attachments - Attachment metadata (names and sizes for determinism)
 * @returns SHA-256 hex string
 */
export async function computeContentHash(
  body: string,
  attachments?: Array<{ originalName: string; originalSize: number }>
): Promise<string> {
  // Canonical structure for content hash
  const contentData = JSON.stringify({
    body,
    attachments: attachments?.map(a => ({
      name: a.originalName,
      size: a.originalSize
    })).sort((a, b) => a.name.localeCompare(b.name)) || []
  })
  
  return sha256String(contentData)
}

/**
 * Compute template hash for BEAP envelope
 * 
 * @param templateId - Template identifier (default: 'beap-default-v1')
 * @param templateVersion - Template version
 * @returns SHA-256 hex string
 */
export async function computeTemplateHash(
  templateId: string = 'beap-default-v1',
  templateVersion: string = '1.0.0'
): Promise<string> {
  const templateData = JSON.stringify({
    id: templateId,
    version: templateVersion
  })
  
  return sha256String(templateData)
}

/**
 * Compute policy hash for BEAP envelope
 * 
 * @param policyConfig - Policy configuration object
 * @returns SHA-256 hex string
 */
export async function computePolicyHash(
  policyConfig?: {
    requiresEncryptedMessage?: boolean
    requiresPrivateTriggersInEncryptedOnly?: boolean
  }
): Promise<string> {
  // Default policy if none provided
  const policy = policyConfig || {
    requiresEncryptedMessage: false,
    requiresPrivateTriggersInEncryptedOnly: false
  }
  
  const policyData = JSON.stringify(policy)
  return sha256String(policyData)
}

/**
 * Compute signing data for BEAP package
 * 
 * Creates a deterministic byte array from:
 * - Header (without signature field)
 * - Encrypted payload OR plaintext payload
 * - Encrypted artefacts manifest (refs and hashes only, not ciphertext)
 * 
 * @param header - BEAP header (signature fields will be ignored)
 * @param payloadCiphertext - Encrypted payload ciphertext (base64) OR plaintext payload
 * @param artefactsManifest - Artefact refs and hashes for signing
 * @returns Bytes to sign
 */
/**
 * Structured payload commitment for signing.
 * Per canon: signing must bind to capsule chunk merkleRoot (for chunked payloads).
 */
export interface PayloadCommitment {
  /** True if payload is chunked (per canon A.3.042) */
  isChunked: boolean
  /** Merkle root of chunk ciphertexts (if chunked) */
  merkleRoot?: string
  /** SHA-256 of plaintext payload */
  sha256Plain: string
  /** Size of plaintext payload in bytes */
  bytesPlain: number
  /** SHA-256 of ciphertext (if legacy single-blob) */
  sha256Cipher?: string
}

/**
 * Compute signing data for BEAP signature.
 * 
 * Per canon A.3.054.10: "The Capsule Builder SHALL produce cryptographic commitments 
 * that allow validation before interpretation, including commitments to the ciphertext
 * of the Capsule payload."
 * 
 * @param header - Envelope header (signature field excluded automatically)
 * @param payloadCommitment - Structured payload commitment (preferred for new packages)
 * @param artefactsManifest - Artefact refs and hashes for binding
 * @returns SHA-256 hash of canonical signing data as bytes
 */
export async function computeSigningData(
  header: Record<string, unknown>,
  payloadCommitment: string | PayloadCommitment,
  artefactsManifest?: Array<{ artefactRef: string; sha256Plain?: string }>
): Promise<Uint8Array> {
  // Create a copy of header without signature-related fields
  const headerForSigning = { ...header }
  delete headerForSigning.signature
  
  // Normalize payload commitment to structured format
  // For backward compatibility: if string is passed, treat as legacy mode
  let payloadForSigning: unknown
  if (typeof payloadCommitment === 'string') {
    // Legacy mode: direct string (ciphertext or merkle root)
    payloadForSigning = payloadCommitment
  } else {
    // Structured mode (per canon A.3.054.10)
    // Include all commitment fields for binding
    payloadForSigning = {
      isChunked: payloadCommitment.isChunked,
      sha256Plain: payloadCommitment.sha256Plain,
      bytesPlain: payloadCommitment.bytesPlain,
      // For chunked: include merkle root (commits to all chunk ciphertexts)
      // For legacy: include ciphertext hash
      ...(payloadCommitment.isChunked 
        ? { merkleRoot: payloadCommitment.merkleRoot }
        : { sha256Cipher: payloadCommitment.sha256Cipher })
    }
  }
  
  // Canonical signing structure
  // Artefacts are sorted by ref for deterministic ordering
  const signingDataObject = {
    header: headerForSigning,
    payload: payloadForSigning,
    artefacts: artefactsManifest?.map(a => ({
      ref: a.artefactRef,
      hash: a.sha256Plain
    })).sort((a, b) => a.ref.localeCompare(b.ref)) || []
  }
  
  // Capture signing data for debug validation (dev-only)
  captureDebugSigningData(signingDataObject)
  
  const signingData = JSON.stringify(signingDataObject)
  
  // Hash the signing data to get fixed-size input for Ed25519
  const signingHash = await sha256(stringToBytes(signingData))
  return stringToBytes(signingHash)
}

// =============================================================================
// Ephemeral Signing Key Storage (MVP)
// =============================================================================

// In-memory key storage for MVP
// PRODUCTION: Store in vault with proper key management
let _ephemeralSigningKey: Ed25519KeyPair | null = null

/**
 * Get or generate the ephemeral signing key
 * 
 * MVP: Stores key in memory (lost on extension reload)
 * PRODUCTION: Should store in secure vault
 */
export async function getSigningKeyPair(): Promise<Ed25519KeyPair> {
  if (!_ephemeralSigningKey) {
    _ephemeralSigningKey = await generateEd25519KeyPair()
    console.log('[BEAP Crypto] Generated ephemeral signing key:', _ephemeralSigningKey.keyId)
  }
  return _ephemeralSigningKey
}

/**
 * Clear the ephemeral signing key (for testing)
 */
export function clearSigningKeyPair(): void {
  _ephemeralSigningKey = null
}

// =============================================================================
// Post-Quantum KEM Interface (ML-KEM-768)
// =============================================================================

/**
 * Result of a PQ KEM encapsulation operation.
 * The sender uses this to derive a shared secret with the recipient.
 */
export interface PQEncapsulationResult {
  /** Base64-encoded KEM ciphertext (to send to recipient) */
  kemCiphertextB64: string
  /** Raw shared secret bytes (32 bytes for ML-KEM-768) */
  sharedSecretBytes: Uint8Array
}

/**
 * Result of a PQ KEM decapsulation operation.
 * The recipient uses this to recover the shared secret.
 */
export interface PQDecapsulationResult {
  /** Raw shared secret bytes (32 bytes for ML-KEM-768) */
  sharedSecretBytes: Uint8Array
}

/**
 * Error thrown when post-quantum KEM operations are attempted but PQ is not available.
 */
export class PQNotAvailableError extends Error {
  constructor(operation: string) {
    super(`Post-quantum cryptography not available: ${operation}. ML-KEM-768 library is not installed.`)
    this.name = 'PQNotAvailableError'
  }
}

// Electron API base URL for PQ operations
const ELECTRON_PQ_BASE_URL = 'http://127.0.0.1:17179'

// Cache for PQ availability status (to avoid repeated HTTP calls)
let _pqAvailabilityCache: { available: boolean; checkedAt: number } | null = null
const PQ_CACHE_TTL_MS = 30000 // 30 seconds

/**
 * Check if post-quantum KEM (ML-KEM-768) is supported.
 * 
 * Per canon A.3.054.10: "uses post-quantum encryption as the default for qBEAP"
 * Per canon A.3.13: ".qBEAP MUST be encrypted using post-quantum-ready end-to-end cryptography"
 * 
 * This function checks whether the Electron backend has ML-KEM-768 available.
 * Uses a cached result to avoid repeated HTTP calls.
 * 
 * @returns true if PQ KEM operations are available, false otherwise
 */
export function pqKemSupported(): boolean {
  // Check cache first
  if (_pqAvailabilityCache && (Date.now() - _pqAvailabilityCache.checkedAt) < PQ_CACHE_TTL_MS) {
    return _pqAvailabilityCache.available
  }
  
  // Synchronous check: we can't make HTTP call here
  // Return cached value if available, otherwise assume false
  // The actual check happens in pqKemSupportedAsync()
  return _pqAvailabilityCache?.available ?? false
}

/**
 * Async check for PQ KEM availability.
 * This is the authoritative check that queries the Electron backend.
 * 
 * @returns true if PQ KEM operations are available
 */
export async function pqKemSupportedAsync(): Promise<boolean> {
  try {
    const response = await fetch(`${ELECTRON_PQ_BASE_URL}/api/crypto/pq/status`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000)
    })
    
    if (!response.ok) {
      _pqAvailabilityCache = { available: false, checkedAt: Date.now() }
      return false
    }
    
    const data = await response.json()
    const available = data.success && data.pq?.available === true
    
    _pqAvailabilityCache = { available, checkedAt: Date.now() }
    return available
  } catch (error) {
    console.warn('[PQ-KEM] Electron not reachable for PQ status:', error)
    _pqAvailabilityCache = { available: false, checkedAt: Date.now() }
    return false
  }
}

/**
 * Generate a new ML-KEM-768 key pair via Electron backend.
 * 
 * @throws PQNotAvailableError if PQ is not supported
 * @returns Public and private key pair (base64-encoded) + keyId
 */
export async function pqKemGenerateKeyPair(): Promise<{
  keyId: string
  publicKeyB64: string
  secretKeyB64: string
}> {
  // Check availability first
  const available = await pqKemSupportedAsync()
  if (!available) {
    throw new PQNotAvailableError('pqKemGenerateKeyPair')
  }
  
  try {
    const response = await fetch(`${ELECTRON_PQ_BASE_URL}/api/crypto/pq/mlkem768/keypair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000)
    })
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new PQNotAvailableError(`pqKemGenerateKeyPair: ${errorData.error || response.statusText}`)
    }
    
    const data = await response.json()
    
    if (!data.success) {
      throw new PQNotAvailableError(`pqKemGenerateKeyPair: ${data.error || 'Unknown error'}`)
    }
    
    return {
      keyId: data.keyId,
      publicKeyB64: data.publicKeyB64,
      secretKeyB64: data.secretKeyB64
    }
  } catch (error) {
    if (error instanceof PQNotAvailableError) throw error
    throw new PQNotAvailableError(`pqKemGenerateKeyPair: ${error instanceof Error ? error.message : 'Network error'}`)
  }
}

/**
 * Encapsulate a shared secret using the recipient's ML-KEM-768 public key.
 * 
 * This is the sender-side operation:
 * 1. Takes the recipient's PQ public key
 * 2. Generates a random shared secret
 * 3. Encapsulates it into a ciphertext that only the recipient can decapsulate
 * 
 * Per canon A.3.054.10 / A.3.13: Used for qBEAP post-quantum key agreement.
 * 
 * @param peerPublicKeyB64 - Recipient's ML-KEM-768 public key (base64-encoded)
 * @returns KEM ciphertext and shared secret
 * @throws PQNotAvailableError if PQ is not supported
 */
export async function pqEncapsulate(peerPublicKeyB64: string): Promise<PQEncapsulationResult> {
  // Check availability first
  const available = await pqKemSupportedAsync()
  if (!available) {
    throw new PQNotAvailableError('pqEncapsulate')
  }
  
  try {
    const response = await fetch(`${ELECTRON_PQ_BASE_URL}/api/crypto/pq/mlkem768/encapsulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ peerPublicKeyB64 }),
      signal: AbortSignal.timeout(10000)
    })
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new PQNotAvailableError(`pqEncapsulate: ${errorData.error || response.statusText}`)
    }
    
    const data = await response.json()
    
    if (!data.success) {
      throw new PQNotAvailableError(`pqEncapsulate: ${data.error || 'Unknown error'}`)
    }
    
    // Convert base64 shared secret to Uint8Array
    const sharedSecretBytes = fromBase64(data.sharedSecretB64)
    
    return {
      kemCiphertextB64: data.ciphertextB64,
      sharedSecretBytes
    }
  } catch (error) {
    if (error instanceof PQNotAvailableError) throw error
    throw new PQNotAvailableError(`pqEncapsulate: ${error instanceof Error ? error.message : 'Network error'}`)
  }
}

/**
 * Decapsulate a shared secret using the recipient's ML-KEM-768 private key.
 * 
 * This is the recipient-side operation:
 * 1. Takes the KEM ciphertext from the sender
 * 2. Uses local private key to recover the shared secret
 * 
 * @param kemCiphertextB64 - KEM ciphertext from sender (base64-encoded)
 * @param secretKeyB64 - Recipient's ML-KEM-768 secret key (base64-encoded)
 * @returns Recovered shared secret
 * @throws PQNotAvailableError if PQ is not supported
 */
export async function pqDecapsulate(kemCiphertextB64: string, secretKeyB64: string): Promise<PQDecapsulationResult> {
  // Check availability first
  const available = await pqKemSupportedAsync()
  if (!available) {
    throw new PQNotAvailableError('pqDecapsulate')
  }
  
  try {
    const response = await fetch(`${ELECTRON_PQ_BASE_URL}/api/crypto/pq/mlkem768/decapsulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ciphertextB64: kemCiphertextB64, secretKeyB64 }),
      signal: AbortSignal.timeout(10000)
    })
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new PQNotAvailableError(`pqDecapsulate: ${errorData.error || response.statusText}`)
    }
    
    const data = await response.json()
    
    if (!data.success) {
      throw new PQNotAvailableError(`pqDecapsulate: ${data.error || 'Unknown error'}`)
    }
    
    // Convert base64 shared secret to Uint8Array
    const sharedSecretBytes = fromBase64(data.sharedSecretB64)
    
    return { sharedSecretBytes }
  } catch (error) {
    if (error instanceof PQNotAvailableError) throw error
    throw new PQNotAvailableError(`pqDecapsulate: ${error instanceof Error ? error.message : 'Network error'}`)
  }
}

