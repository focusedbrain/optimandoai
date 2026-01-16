/**
 * BeapPackageBuilder Service
 * 
 * Builds BEAP packages with correct encoding and identity semantics:
 * - qBEAP (Private): Handshake-derived, encrypted, receiver-bound
 * - pBEAP (Public): No encryption, auditable, no receiver binding
 * 
 * @version 1.0.0
 */

import type { RecipientMode, SelectedRecipient } from '../components/RecipientModeSwitch'
import type { DeliveryMethod } from '../components/DeliveryMethodPanel'
import type { BeapBuildResult } from '../../beap-builder/types'
import type { CapsuleAttachment } from '../../beap-builder/canonical-types'
import {
  deriveBeapKeys,
  generateEnvelopeSalt,
  encryptCapsulePayloadChunked,
  encryptArtefactWithAAD,
  encryptOriginalArtefactWithAAD,
  toBase64,
  computeContentHash,
  computeTemplateHash,
  computePolicyHash,
  computeSigningData,
  createBeapSignature,
  getSigningKeyPair,
  pqKemSupported,
  pqKemSupportedAsync,
  pqEncapsulate,
  PQNotAvailableError,
  // Canonical AAD utilities (per canon A.3.054.10)
  buildEnvelopeAadFields,
  canonicalSerializeAAD,
  // Debug utilities (dev-only)
  resetDebugAadStats,
  setDebugAadTrackingEnabled,
  sha256Hex,
  type EncryptedArtefact,
  type BeapSignature,
  type CapsulePayloadEnc
} from './beapCrypto'
import { hasValidX25519Key, deriveSharedSecretX25519, getDeviceX25519PublicKey } from './x25519KeyAgreement'

// =============================================================================
// Canon Violation Error
// =============================================================================

/**
 * Error thrown when a BEAP operation would violate canon requirements.
 * This is a typed error for clear error handling in the UI.
 */
export class BeapCanonViolationError extends Error {
  readonly canonRules: string[]
  readonly requirement: string
  
  constructor(message: string, canonRules: string[], requirement: string) {
    super(message)
    this.name = 'BeapCanonViolationError'
    this.canonRules = canonRules
    this.requirement = requirement
  }
}

// =============================================================================
// Debug Validation Flag Detection
// =============================================================================

/**
 * Check if BEAP debug validation is enabled.
 * 
 * Supports both Node-style (process.env) and Vite-style (import.meta.env) environments.
 * This allows validation to work in extension builds where process.env may be absent.
 * 
 * @returns true if BEAP_DEBUG_VALIDATE === '1'
 */
function isBeapDebugValidateEnabled(): boolean {
  // Check Node-style env (process.env)
  try {
    if (typeof process !== 'undefined' && process.env?.BEAP_DEBUG_VALIDATE === '1') {
      return true
    }
  } catch {
    // process may throw in some environments
  }
  
  // Check Vite-style env (import.meta.env)
  try {
    // Use indirect access to avoid build-time errors when import.meta is unavailable
    const meta = (typeof globalThis !== 'undefined' && (globalThis as Record<string, unknown>).__vite_import_meta__) as { env?: Record<string, string> } | undefined
    if (meta?.env?.BEAP_DEBUG_VALIDATE === '1') {
      return true
    }
    // Direct check for Vite environment
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (typeof (import.meta as any)?.env?.BEAP_DEBUG_VALIDATE === 'string' && 
        (import.meta as any).env.BEAP_DEBUG_VALIDATE === '1') {
      return true
    }
  } catch {
    // import.meta may not exist in all environments
  }
  
  return false
}

// =============================================================================
// Post-Quantum Cryptography Availability
// =============================================================================

/**
 * Check if post-quantum cryptography (ML-KEM-768) is available (sync, cached).
 * 
 * Per canon A.3.054.10: "uses post-quantum encryption as the default for qBEAP"
 * Per canon A.3.13: ".qBEAP MUST be encrypted using post-quantum-ready end-to-end cryptography"
 * 
 * Delegates to pqKemSupported() in beapCrypto module.
 * Note: This uses cached value. For authoritative check, use isPostQuantumAvailableAsync().
 * 
 * Exported for testing and runtime inspection.
 * 
 * @returns true if PQ crypto is available (cached), false otherwise
 */
export function isPostQuantumAvailable(): boolean {
  return pqKemSupported()
}

/**
 * Check if post-quantum cryptography is available (async, authoritative).
 * 
 * This queries the Electron backend for actual PQ library availability.
 * 
 * @returns true if PQ crypto is available
 */
export async function isPostQuantumAvailableAsync(): Promise<boolean> {
  return pqKemSupportedAsync()
}

/**
 * PQ metadata structure for header.crypto.pq
 * Exported for type-safe access in tests and package inspection.
 */
export interface PQMetadata {
  /** Whether PQ is required by policy */
  required: boolean
  /** Whether PQ is active in this package */
  active: boolean
  /** KEM algorithm identifier */
  kem?: 'ML-KEM-768'
  /** Whether hybrid mode (PQ + classical) is used */
  hybrid?: boolean
  /** 
   * Base64-encoded KEM ciphertext for recipient decapsulation.
   * Present when active=true. Required for recipient to recover shared secret.
   */
  kemCiphertextB64?: string
}

/**
 * Size limits for BEAP packages (per canon A.3.054.9).
 * 
 * These limits are declared in the header and AAD-bound for integrity.
 * The builder enforces these limits and fails closed on overflow.
 */
export interface SizeLimits {
  /** Maximum envelope size in bytes (outer control layer) */
  envelopeMaxBytes: number
  /** Maximum capsule plaintext size in bytes */
  capsulePlaintextMaxBytes: number
  /** Maximum single artefact size in bytes */
  artefactMaxBytes: number
  /** Maximum total package size in bytes */
  packageMaxBytes: number
  /** Maximum chunk size in bytes (for chunked encryption) */
  chunkMaxBytes: number
  /** Computed: actual capsule plaintext size */
  capsulePlaintextBytes?: number
  /** Computed: total artefacts plaintext size */
  artefactsTotalBytes?: number
}

/**
 * Build compliance notes based on PQ status.
 * 
 * Per canon:
 * - A.3.054.10: "uses post-quantum encryption as the default for qBEAP"
 * - A.3.13: ".qBEAP MUST be encrypted using post-quantum-ready end-to-end cryptography"
 * 
 * Note: For qBEAP, this function is only called when PQ is active (since we fail closed otherwise).
 * 
 * @param pq - PQ metadata
 * @returns Array of compliance notes
 */
function buildComplianceNotes(pq: PQMetadata): string[] {
  const notes: string[] = []
  
  // PQ hybrid key agreement (per canon A.3.054.10 / A.3.13)
  if (pq.active && pq.hybrid) {
    notes.push('ML-KEM-768 + X25519 hybrid key agreement (post-quantum secure per canon A.3.054.10)')
  }
  
  // Chunking (per canon A.3.054.11)
  notes.push('Chunking implemented (per canon A.3.054.11): artefacts >1MB use per-chunk encryption')
  
  // Canon source reference
  notes.push('Canon source: external (referenced by A.3.* section IDs)')
  
  return notes
}

// =============================================================================
// Types
// =============================================================================

/**
 * Policy signals for draft builds.
 * These are derived from the sender's policy configuration.
 */
export interface DraftBuildPolicy {
  /**
   * If true, qBEAP builds MUST have encryptedMessage content.
   * Default: false (encrypted message is optional)
   */
  requiresEncryptedMessage?: boolean
  
  /**
   * If true, automation tags (#...) in plaintext are forbidden when
   * encryptedMessage exists. Tags must be in encrypted content only.
   * Default: false (tags allowed in both)
   */
  requiresPrivateTriggersInEncryptedOnly?: boolean
}

export interface BeapPackageConfig {
  recipientMode: RecipientMode
  deliveryMethod: DeliveryMethod
  selectedRecipient: SelectedRecipient | null
  senderFingerprint: string
  senderFingerprintShort: string
  emailTo?: string
  subject?: string
  messageBody: string
  /**
   * Attachments with full CapsuleAttachment data including
   * semanticContent and rasterProof from parser/rasterizer.
   */
  attachments?: CapsuleAttachment[]
  /**
   * Raster artefacts (base64 page images) from PDF rasterization.
   * Kept separate from CapsuleAttachment to avoid bloating the manifest.
   */
  rasterArtefacts?: Array<{
    artefactRef: string
    attachmentId: string
    page: number
    mime: string
    base64: string
    sha256: string
    width: number
    height: number
    bytes: number
  }>
  /**
   * Original file bytes for archival (ONLY for download builder).
   * These are encrypted and stored as "original" class artefacts per canon A.3.043.
   * Kept separate from CapsuleAttachment to avoid polluting canonical types.
   */
  originalFiles?: Array<{
    attachmentId: string
    filename: string
    mime: string
    base64: string
  }>
  /**
   * Encrypted message content for qBEAP (private) mode only.
   * This is the authoritative capsule-bound content.
   * Never transported outside the BEAP package.
   */
  encryptedMessage?: string
  /**
   * Policy signals for build validation.
   * If not provided, conservative defaults are used.
   */
  policy?: DraftBuildPolicy
  /**
   * @deprecated IGNORED - PQ is now MANDATORY for qBEAP per canon.
   * 
   * Per canon A.3.054.10: "uses post-quantum encryption as the default for qBEAP"
   * Per canon A.3.13: ".qBEAP MUST be encrypted using post-quantum-ready end-to-end cryptography"
   * 
   * This option is retained for backward compatibility but has no effect.
   * qBEAP creation will ALWAYS fail closed if PQ is not available.
   * There is no opt-out from PQ for qBEAP.
   */
  requirePostQuantumForQbeap?: boolean
}

export interface BeapEnvelopeHeader {
  version: '1.0'
  encoding: 'qBEAP' | 'pBEAP'
  encryption_mode: 'AES-256-GCM' | 'NONE'
  timestamp: number
  sender_fingerprint: string
  receiver_fingerprint?: string
  receiver_binding?: {
    handshake_id: string
    display_name: string
    organization?: string
  }
  template_hash: string
  policy_hash: string
  content_hash: string
  /** Cryptographic metadata for qBEAP (encrypted) packages */
  crypto?: {
    /** 
     * Cryptographic suite identifier for forward compatibility.
     * Per canon A.3.054.10: qBEAP uses post-quantum encryption as default.
     * 
     * HYBRID_MLKEM768_X25519_AES256GCM_HKDFSHA256_ED25519_v1: Post-quantum hybrid (current)
     * BEAP-v1-X25519-AES256GCM-HKDF-Ed25519: Classical only (deprecated for qBEAP)
     */
    suiteId: 'HYBRID_MLKEM768_X25519_AES256GCM_HKDFSHA256_ED25519_v1' | 'BEAP-v1-X25519-AES256GCM-HKDF-Ed25519'
    aead: 'AES-256-GCM'
    kdf: 'HKDF-SHA256'
    hash: 'SHA-256'
    /** 
     * Key derivation method indicator.
     * HYBRID_MLKEM768_X25519: Post-quantum hybrid key agreement (current for qBEAP)
     * X25519_ECDH: Classical ECDH only (deprecated for qBEAP)
     */
    keyDerivation: 'HYBRID_MLKEM768_X25519' | 'X25519_ECDH'
    /** Base64-encoded envelope salt (16 bytes) */
    salt: string
    /** Handshake ID for key binding */
    handshake_id: string
    /** 
     * Sender's X25519 public key (base64, 32 bytes).
     * Required for receiver to perform ECDH key agreement.
     * Per canon A.3.054.10: key material must be included for decryption.
     */
    senderX25519PublicKeyB64: string
    /** 
     * Post-quantum cryptography metadata.
     * Contains KEM algorithm, ciphertext for decapsulation, and status flags.
     * When false, PQ is not active (deprecated for qBEAP).
     */
    pq: PQMetadata | false
  }
  /** Signing metadata */
  signing?: {
    algorithm: 'Ed25519'
    /** Key ID of the signing key */
    keyId: string
    /** Base64-encoded public key for verification */
    publicKey: string
  }
  /** 
   * Compliance metadata for canon alignment transparency.
   * Explicitly documents what is/isn't implemented.
   */
  compliance?: {
    /** Compliance level: FULL, PARTIAL, NONE */
    canon: 'FULL' | 'PARTIAL' | 'NONE'
    /** Notes about what's not implemented */
    notes: string[]
  }
  /**
   * Size limits for the package (per canon A.3.054.9).
   * Declared and enforced by builder, AAD-bound for integrity.
   */
  sizeLimits?: SizeLimits
}

/**
 * Plaintext artefact entry (for pBEAP packages)
 */
export interface BeapArtefact {
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

/**
 * Encrypted artefact entry (for qBEAP packages)
 */
export interface BeapArtefactEncrypted {
  /** Artefact class: "raster" for reconstructed page images, "original" for source files */
  class: 'raster' | 'original'
  artefactRef: string
  attachmentId: string
  /** Page number (for raster artefacts only) */
  page?: number
  /** Original filename (for original artefacts only) */
  filename?: string
  mime: string
  /** Base64-encoded nonce for this artefact */
  nonce: string
  /** Base64-encoded ciphertext */
  ciphertext: string
  /** SHA-256 of plaintext (for verification after decrypt) */
  sha256Plain: string
  /** SHA-256 of ciphertext (for integrity verification) */
  sha256Cipher?: string
  /** Dimensions (for raster artefacts only) */
  width?: number
  height?: number
  /** Size of plaintext bytes */
  bytesPlain: number
}

export interface BeapPackage {
  header: BeapEnvelopeHeader
  /** 
   * For pBEAP: Base64-encoded plaintext JSON
   * For qBEAP: NOT used (see payloadEnc)
   */
  payload?: string
  /**
   * Encrypted payload for qBEAP packages.
   * 
   * Per canon A.3.042: "The Capsule MUST be chunked."
   * New packages use chunked mode (chunking.enabled=true, chunks[]).
   * Legacy packages may use single-blob mode (nonce, ciphertext) for backward compat.
   */
  payloadEnc?: CapsulePayloadEnc
  /** 
   * Ed25519 signature over canonical signing data
   */
  signature: BeapSignature
  metadata: {
    created_at: number
    delivery_method: DeliveryMethod
    delivery_hint?: string // Email address for delivery (not identity)
    filename: string
  }
  /**
   * Plaintext artefacts (pBEAP only)
   */
  artefacts?: BeapArtefact[]
  /**
   * Encrypted artefacts (qBEAP only)
   */
  artefactsEnc?: BeapArtefactEncrypted[]
}

export interface PackageBuildResult {
  success: boolean
  package?: BeapPackage
  packageJson?: string
  error?: string
}

export interface DeliveryResult {
  success: boolean
  action: 'sent' | 'copied' | 'downloaded'
  message: string
  details?: {
    to?: string
    filename?: string
    clipboardContent?: string
  }
}

// =============================================================================
// Validation
// =============================================================================

export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

export function validatePackageConfig(config: BeapPackageConfig): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // Recipient mode must be selected
  if (!config.recipientMode) {
    errors.push('Recipient mode must be selected (PRIVATE or PUBLIC)')
  }

  // PRIVATE mode requires handshake selection
  if (config.recipientMode === 'private' && !config.selectedRecipient) {
    errors.push('PRIVATE mode requires a verified handshake recipient')
  }

  // Sender fingerprint required
  if (!config.senderFingerprint) {
    errors.push('Sender fingerprint is required')
  }

  // Message body validation
  if (!config.messageBody?.trim()) {
    warnings.push('Message body is empty')
  }

  // Email delivery hints
  if (config.deliveryMethod === 'email') {
    if (config.recipientMode === 'private') {
      if (!config.selectedRecipient?.receiver_email_list?.length) {
        warnings.push('Selected handshake has no email address - manual delivery required')
      }
    } else if (config.recipientMode === 'public') {
      if (!config.emailTo?.trim()) {
        warnings.push('No delivery email specified for public distribution')
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  }
}

export function canBuildPackage(config: BeapPackageConfig): boolean {
  const validation = validatePackageConfig(config)
  return validation.valid
}

// =============================================================================
// Hash Generation (Real SHA-256)
// =============================================================================

// Note: These are now async and use the beapCrypto module functions:
// - computeContentHash(body, attachments)
// - computeTemplateHash(templateId?, templateVersion?)
// - computePolicyHash(policyConfig?)
// - computeSigningData(header, payloadData, artefactsManifest?)
// - createBeapSignature(keyPair, data)

/**
 * UTF-8 safe base64 encoding
 * Handles non-Latin1 characters that would break native btoa()
 */
function safeBase64Encode(str: string): string {
  try {
    // Try native btoa first (works for Latin-1)
    return btoa(str)
  } catch {
    // Fallback for UTF-8 content
    const encoder = new TextEncoder()
    const bytes = encoder.encode(str)
    let binary = ''
    for (const byte of bytes) {
      binary += String.fromCharCode(byte)
    }
    return btoa(binary)
  }
}

// =============================================================================
// Automation Tag Extraction
// =============================================================================

/**
 * Extract automation trigger tags from text.
 * Tags match: #<letters|numbers|_-|:|.>
 * 
 * @param text - Text to extract tags from
 * @returns Deduplicated array of tags in order of first appearance (preserves case)
 */
export function extractAutomationTags(text: string): string[] {
  if (!text) return []
  
  // Match #tag patterns: # followed by alphanumeric, underscores, hyphens, colons, dots
  const tagPattern = /#[a-zA-Z0-9_\-:.]+/g
  const matches = text.match(tagPattern)
  
  if (!matches) return []
  
  // Deduplicate while preserving order of first appearance
  const seen = new Set<string>()
  const result: string[] = []
  
  for (const tag of matches) {
    if (!seen.has(tag)) {
      seen.add(tag)
      result.push(tag)
    }
  }
  
  return result
}

/**
 * Automation metadata for capsule-bound storage
 */
interface AutomationMetadata {
  /** Automation trigger tags */
  tags: string[]
  /** Source of tags: 'encrypted' | 'plaintext' | 'both' */
  tagSource: 'encrypted' | 'plaintext' | 'both' | 'none'
  /** Receiver has final authority over automation execution */
  receiverHasFinalAuthority: true
}

/**
 * Build automation metadata from message content
 */
function buildAutomationMetadata(
  encryptedMessage: string | undefined,
  plaintextMessage: string
): AutomationMetadata {
  const encryptedTags = extractAutomationTags(encryptedMessage || '')
  const plaintextTags = extractAutomationTags(plaintextMessage)
  
  // Combine tags, preferring encrypted source
  const allTagsSet = new Set<string>()
  const tags: string[] = []
  
  // Add encrypted tags first (preferred source)
  for (const tag of encryptedTags) {
    if (!allTagsSet.has(tag)) {
      allTagsSet.add(tag)
      tags.push(tag)
    }
  }
  
  // Add plaintext tags that aren't already present
  for (const tag of plaintextTags) {
    if (!allTagsSet.has(tag)) {
      allTagsSet.add(tag)
      tags.push(tag)
    }
  }
  
  // Determine tag source
  let tagSource: AutomationMetadata['tagSource'] = 'none'
  if (encryptedTags.length > 0 && plaintextTags.length > 0) {
    tagSource = 'both'
  } else if (encryptedTags.length > 0) {
    tagSource = 'encrypted'
  } else if (plaintextTags.length > 0) {
    tagSource = 'plaintext'
  }
  
  return {
    tags,
    tagSource,
    receiverHasFinalAuthority: true
  }
}

// =============================================================================
// Policy Validation
// =============================================================================

/**
 * Validate qBEAP build against policy requirements
 * Returns error string if validation fails, null if valid
 */
function validateQBeapPolicy(
  config: BeapPackageConfig,
  automationMeta: AutomationMetadata
): string | null {
  const policy = config.policy || {}
  const hasEncryptedMessage = config.encryptedMessage && config.encryptedMessage.trim().length > 0
  
  // Check: Encrypted message required by policy
  if (policy.requiresEncryptedMessage && !hasEncryptedMessage) {
    return 'POLICY: Encrypted message required for this private build.'
  }
  
  // Check: Private triggers must be in encrypted only
  if (policy.requiresPrivateTriggersInEncryptedOnly && hasEncryptedMessage) {
    const plaintextTags = extractAutomationTags(config.messageBody)
    if (plaintextTags.length > 0) {
      return 'POLICY: Automation tags in plaintext are forbidden when encrypted message exists. Move tags to encrypted message only.'
    }
  }
  
  return null
}

// =============================================================================
// Package Building
// =============================================================================

/**
 * Build a qBEAP package (Private/Encrypted)
 * 
 * For qBEAP:
 * - config.messageBody is the outer transport-safe plaintext (non-authoritative)
 * - config.encryptedMessage (if present) is the authoritative capsule-bound content
 * - Capsule payload is AEAD encrypted with handshake-derived key
 * - Artefacts are AEAD encrypted with handshake-derived artefact key
 * 
 * @returns PackageBuildResult with success/error status
 */
async function buildQBeapPackage(config: BeapPackageConfig): Promise<PackageBuildResult> {
  const now = Date.now()
  const recipient = config.selectedRecipient!

  // Enable debug AAD tracking if validation is enabled (dev-only)
  const debugValidationEnabled = isBeapDebugValidateEnabled()
  if (debugValidationEnabled) {
    setDebugAadTrackingEnabled(true)
    resetDebugAadStats()
  }

  // SECURITY: Fail closed if no handshake binding
  if (!recipient.handshake_id) {
    return {
      success: false,
      error: 'SECURITY: qBEAP requires handshake binding. No handshake_id available.'
    }
  }
  
  // SECURITY: qBEAP REQUIRES real key agreement - NO FALLBACK
  // Per canon A.3.054.10: "uses post-quantum encryption as the default for qBEAP"
  // X25519 is the minimum requirement (stepping stone to PQ hybrid)
  const hasX25519KeyMaterial = hasValidX25519Key(recipient.peerX25519PublicKey)
  
  if (!hasX25519KeyMaterial) {
    return {
      success: false,
      error: 'SECURITY: qBEAP requires cryptographic key agreement. Selected handshake has no X25519 public key. Complete the handshake key exchange before sending private messages.'
    }
  }
  
  // ==========================================================================
  // Post-Quantum Cryptography Check (Canon A.3.054.10 / A.3.13)
  // ==========================================================================
  // Per canon A.3.054.10: "uses post-quantum encryption as the default for qBEAP"
  // Per canon A.3.13: ".qBEAP MUST be encrypted using post-quantum-ready end-to-end cryptography"
  // 
  // PQ is MANDATORY for qBEAP - there is NO opt-in/opt-out.
  // If PQ is not available, qBEAP generation MUST fail closed.
  
  const pqAvailable = await isPostQuantumAvailableAsync()
  
  // CANON ENFORCEMENT: qBEAP requires PQ - NO EXCEPTIONS
  if (!pqAvailable) {
    return {
      success: false,
      error: 'CANON VIOLATION: qBEAP requires post-quantum cryptography (ML-KEM-768 + X25519 hybrid) per canon A.3.054.10 and A.3.13. PQ library is not available. Cannot create qBEAP package without post-quantum protection.'
    }
  }

  // Determine authoritative content for capsule
  const hasEncryptedMessage = config.encryptedMessage && config.encryptedMessage.trim().length > 0
  const authoritativeBody = hasEncryptedMessage ? config.encryptedMessage! : config.messageBody
  const transportPlaintext = config.messageBody // Always the outer plaintext for transport

  // Build automation metadata (capsule-bound)
  const automationMeta = buildAutomationMetadata(config.encryptedMessage, config.messageBody)
  
  // Validate against policy
  const policyError = validateQBeapPolicy(config, automationMeta)
  if (policyError) {
    return {
      success: false,
      error: policyError
    }
  }

  // SECURITY: Leak prevention assertion - encrypted message must never appear in transport plaintext
  if (hasEncryptedMessage && transportPlaintext.includes(config.encryptedMessage!)) {
    return {
      success: false,
      error: 'SECURITY: encryptedMessage leaked into transport plaintext'
    }
  }

  // ==========================================================================
  // Compute Hashes (needed for header construction)
  // ==========================================================================
  // These must be computed early since they're included in the header and AAD.
  
  const [templateHash, policyHash, contentHash] = await Promise.all([
    computeTemplateHash('beap-default-v1', '1.0.0'),
    computePolicyHash(config.policy),
    computeContentHash(
      authoritativeBody,
      config.attachments?.map(a => ({ originalName: a.originalName, originalSize: a.originalSize }))
    )
  ])

  // ==========================================================================
  // Key Derivation (Hybrid: X25519 + ML-KEM-768)
  // ==========================================================================
  // Per canon A.3.054.10: qBEAP requires post-quantum key agreement.
  // Per canon A.3.13: qBEAP MUST use post-quantum-ready cryptography.
  // 
  // Hybrid key agreement: X25519 ECDH + ML-KEM-768 KEM
  // Both shared secrets are combined for post-quantum security.
  
  // Generate random envelope salt
  const envelopeSalt = generateEnvelopeSalt()
  const envelopeSaltBase64 = toBase64(envelopeSalt)
  
  // Get sender's X25519 public key for inclusion in header
  // Per canon A.3.054.10: receiver needs this for ECDH key agreement
  const senderX25519PublicKeyB64 = await getDeviceX25519PublicKey()
  
  // Step 1: X25519 ECDH (classical component)
  const ecdhResult = await deriveSharedSecretX25519(recipient.peerX25519PublicKey!)
  
  // Step 2: ML-KEM-768 encapsulation (post-quantum component)
  // This call enforces PQ requirement - will throw PQNotAvailableError if not installed
  let pqKemResult: { kemCiphertextB64: string; sharedSecretBytes: Uint8Array }
  try {
    // Attempt PQ encapsulation using recipient's ML-KEM-768 public key
    // Per canon A.3.054.10 / A.3.13: qBEAP requires hybrid PQ + classical key agreement
    const peerMlkemPublicKey = recipient.peerPQPublicKey
    if (!peerMlkemPublicKey) {
      return {
        success: false,
        error: 'Handshake missing ML-KEM-768 public key; cannot build qBEAP per canon A.3.054.10 and A.3.13. The selected handshake must include a peerMlkem768PublicKeyB64 for post-quantum key agreement.'
      }
    }
    pqKemResult = await pqEncapsulate(peerMlkemPublicKey)
  } catch (err) {
    if (err instanceof PQNotAvailableError) {
      return {
        success: false,
        error: 'CANON VIOLATION: qBEAP requires post-quantum cryptography (ML-KEM-768 + X25519 hybrid) per canon A.3.054.10 and A.3.13. PQ library is not available. Cannot create qBEAP package without post-quantum protection.'
      }
    }
    throw err // Re-throw unexpected errors
  }
  
  // Step 3: Combine shared secrets for hybrid key derivation
  // ==========================================================================
  // HYBRID SECRET CONSTRUCTION (Per canon A.3.054.10 / A.3.13)
  // ==========================================================================
  // Ordering: SS_PQ || SS_X25519 (post-quantum component first)
  // This follows standard hybrid KEM ordering where PQ provides primary security
  // and classical component provides defense-in-depth against PQ implementation flaws.
  //
  // hybridSecret = ML-KEM-768_shared_secret (32 bytes) || X25519_shared_secret (32 bytes)
  // Total: 64 bytes input to HKDF
  const hybridSecret = new Uint8Array(pqKemResult.sharedSecretBytes.length + ecdhResult.sharedSecret.length)
  hybridSecret.set(pqKemResult.sharedSecretBytes, 0)  // PQ component first
  hybridSecret.set(ecdhResult.sharedSecret, pqKemResult.sharedSecretBytes.length)  // Classical second
  
  // Derive capsule and artefact keys via HKDF-SHA256 from hybrid secret
  const { capsuleKey, artefactKey } = await deriveBeapKeys(hybridSecret, envelopeSalt)
  
  // ==========================================================================
  // Build PQ Metadata (includes KEM ciphertext for recipient decapsulation)
  // ==========================================================================
  const pqMetadata: PQMetadata = {
    required: true,           // Always required for qBEAP per canon A.3.054.10
    active: true,             // PQ is active (we passed availability check)
    kem: 'ML-KEM-768',        // KEM algorithm identifier
    hybrid: true,             // Using hybrid mode (ML-KEM-768 + X25519)
    kemCiphertextB64: pqKemResult.kemCiphertextB64  // Ciphertext for recipient decapsulation
  }
  
  // ==========================================================================
  // Build Capsule Payload JSON (to compute size for limits)
  // ==========================================================================
  
  const capsulePayloadJson = JSON.stringify({
    subject: config.subject || 'BEAP™ Message',
    body: authoritativeBody, // Authoritative content (encryptedMessage if provided)
    transport_plaintext: transportPlaintext, // Non-authoritative outer message
    has_authoritative_encrypted: hasEncryptedMessage,
    // Full attachment metadata including parsed semantic content and raster proof
    attachments: config.attachments?.map(att => ({
      id: att.id,
      originalName: att.originalName,
      originalSize: att.originalSize,
      originalType: att.originalType,
      semanticExtracted: att.semanticExtracted,
      semanticContent: att.semanticContent, // Capsule-bound semantic text
      encryptedRef: att.encryptedRef,
      previewRef: att.previewRef,
      rasterProof: att.rasterProof, // Raster manifest with page refs and hashes
      isMedia: att.isMedia
    })) || [],
    // Automation metadata (capsule-bound)
    automation: automationMeta
  })
  
  // ==========================================================================
  // Compute and Enforce Size Limits (Per Canon A.3.054.9)
  // ==========================================================================
  // "The Capsule Builder calculates and declares strict size limits for Envelope fields,
  // inner Envelope metadata, Capsule payloads, and individual artefacts."
  
  // Default size limits
  const SIZE_LIMITS = {
    ENVELOPE_MAX_BYTES: 64 * 1024,           // 64 KB
    CAPSULE_PLAINTEXT_MAX_BYTES: 10 * 1024 * 1024,  // 10 MB
    ARTEFACT_MAX_BYTES: 100 * 1024 * 1024,   // 100 MB
    PACKAGE_MAX_BYTES: 500 * 1024 * 1024,    // 500 MB
    CHUNK_MAX_BYTES: 256 * 1024              // 256 KB
  }
  
  // Compute actual sizes
  const capsulePlaintextBytes = new TextEncoder().encode(capsulePayloadJson).length
  
  // Compute artefact sizes from config
  let artefactsTotalBytes = 0
  if (config.rasterArtefacts) {
    for (const artefact of config.rasterArtefacts) {
      artefactsTotalBytes += artefact.bytes
    }
  }
  if (config.originalFiles) {
    for (const original of config.originalFiles) {
      // Base64 string to bytes: length * 3/4
      const byteSize = Math.ceil(original.base64.length * 3 / 4)
      artefactsTotalBytes += byteSize
    }
  }
  
  // Enforce capsule size limit (fail closed)
  if (capsulePlaintextBytes > SIZE_LIMITS.CAPSULE_PLAINTEXT_MAX_BYTES) {
    return {
      success: false,
      error: `LIMIT: Capsule plaintext size (${capsulePlaintextBytes} bytes) exceeds maximum (${SIZE_LIMITS.CAPSULE_PLAINTEXT_MAX_BYTES} bytes). Reduce message content or attachment metadata.`
    }
  }
  
  // Enforce artefact size limit (fail closed)
  if (artefactsTotalBytes > SIZE_LIMITS.ARTEFACT_MAX_BYTES) {
    return {
      success: false,
      error: `LIMIT: Total artefact size (${artefactsTotalBytes} bytes) exceeds maximum (${SIZE_LIMITS.ARTEFACT_MAX_BYTES} bytes). Reduce attachment sizes.`
    }
  }
  
  // Build size limits structure for header
  const sizeLimits: SizeLimits = {
    envelopeMaxBytes: SIZE_LIMITS.ENVELOPE_MAX_BYTES,
    capsulePlaintextMaxBytes: SIZE_LIMITS.CAPSULE_PLAINTEXT_MAX_BYTES,
    artefactMaxBytes: SIZE_LIMITS.ARTEFACT_MAX_BYTES,
    packageMaxBytes: SIZE_LIMITS.PACKAGE_MAX_BYTES,
    chunkMaxBytes: SIZE_LIMITS.CHUNK_MAX_BYTES,
    // Computed values (for receiver verification)
    capsulePlaintextBytes,
    artefactsTotalBytes
  }
  
  // ==========================================================================
  // Build Header Pre-Signature for AAD Computation
  // ==========================================================================
  // Per canon A.3.054.10: "The AEAD additional authenticated data (AAD) SHALL include
  // the canonical, non-encrypted Envelope header fields required for integrity and sizing"
  // 
  // We build the header BEFORE encryption so we can compute AAD for binding.
  // The signing fields will be added after encryption is complete.
  
  const headerPreSignature = {
    version: '1.0',
    encoding: 'qBEAP',
    encryption_mode: 'AES-256-GCM',
    timestamp: now,
    sender_fingerprint: config.senderFingerprint,
    receiver_fingerprint: recipient.receiver_fingerprint_full,
    template_hash: templateHash,
    policy_hash: policyHash,
    content_hash: contentHash,
    crypto: {
      suiteId: 'HYBRID_MLKEM768_X25519_AES256GCM_HKDFSHA256_ED25519_v1',
      aead: 'AES-256-GCM',
      kdf: 'HKDF-SHA256',
      hash: 'SHA-256',
      keyDerivation: 'HYBRID_MLKEM768_X25519',
      salt: envelopeSaltBase64,
      handshake_id: recipient.handshake_id,
      senderX25519PublicKeyB64,
      pq: pqMetadata
    },
    sizeLimits  // Per canon A.3.054.9: declared in header and AAD-bound
  }
  
  // ==========================================================================
  // Compute AAD from Header (Per Canon A.3.054.10)
  // ==========================================================================
  // AAD binds the ciphertext to non-encrypted envelope fields for integrity.
  // Any modification of eligibility material, size declarations, chunk topology,
  // or commitments is detected prior to further processing.
  
  const aadFields = buildEnvelopeAadFields(headerPreSignature as Parameters<typeof buildEnvelopeAadFields>[0])
  const aadBytes = canonicalSerializeAAD(aadFields)
  
  // Debug assertion: AAD must be non-empty for qBEAP (fail-closed sanity check)
  if (aadBytes.length === 0) {
    throw new BeapCanonViolationError(
      'A.3.054.10',
      'AAD bytes are empty for qBEAP; canonical header fields must be present'
    )
  }
  
  // Store AAD hash for drift detection (dev-only)
  // Used to verify header wasn't mutated between AAD derivation and signing
  let aadHashPre: string | undefined
  if (debugValidationEnabled) {
    aadHashPre = await sha256Hex(aadBytes)
  }
  
  // ==========================================================================
  // Encrypt Capsule Payload (Chunked per Canon A.3.042)
  // ==========================================================================
  // Per canon A.3.042: "The Capsule MUST be chunked."
  // Per canon A.3.054.10: AAD binds ciphertext to envelope fields.
  // We use 256KB chunks for capsule payload.
  const payloadEnc = await encryptCapsulePayloadChunked(
    capsuleKey, 
    capsulePayloadJson,
    aadBytes  // Real AAD from canonical envelope fields
  )

  // ==========================================================================
  // Encrypt Artefacts (Raster + Original) with AAD Binding
  // ==========================================================================
  // Per canon A.3.054.10: AAD SHALL include canonical envelope fields
  // All artefact encryption uses the same AAD for integrity binding.
  
  let artefactsEnc: BeapArtefactEncrypted[] | undefined
  
  // Encrypt raster artefacts (reconstructed page images)
  if (config.rasterArtefacts && config.rasterArtefacts.length > 0) {
    artefactsEnc = []
    for (const artefact of config.rasterArtefacts) {
      // Use AAD-aware encryption (per canon A.3.054.10)
      const encrypted = await encryptArtefactWithAAD(artefactKey, artefact, aadBytes)
      artefactsEnc.push(encrypted)
    }
  }
  
  // Encrypt original file artefacts (per canon A.3.043)
  // Original artefacts MUST be contained, encrypted, and linked to Envelope
  if (config.originalFiles && config.originalFiles.length > 0) {
    if (!artefactsEnc) artefactsEnc = []
    for (const original of config.originalFiles) {
      // Use AAD-aware encryption (per canon A.3.054.10)
      const encrypted = await encryptOriginalArtefactWithAAD(artefactKey, original, aadBytes)
      artefactsEnc.push(encrypted)
    }
  }

  // Get signing key pair
  const signingKeyPair = await getSigningKeyPair()

  // ==========================================================================
  // Build Header with Crypto Metadata
  // ==========================================================================

  const header: BeapEnvelopeHeader = {
    version: '1.0',
    encoding: 'qBEAP',
    encryption_mode: 'AES-256-GCM',
    timestamp: now,
    sender_fingerprint: config.senderFingerprint,
    receiver_fingerprint: recipient.receiver_fingerprint_full,
    receiver_binding: {
      handshake_id: recipient.handshake_id,
      display_name: recipient.receiver_display_name,
      organization: recipient.receiver_organization
    },
    template_hash: templateHash,
    policy_hash: policyHash,
    content_hash: contentHash,
    // Crypto metadata (X25519 ECDH mandatory for qBEAP, PQ hybrid is target)
    // Per canon A.3.054.10: "uses post-quantum encryption as the default for qBEAP"
    crypto: {
      // Suite ID reflects actual crypto in use
      // Per canon A.3.054.10: qBEAP uses post-quantum hybrid by default
      suiteId: 'HYBRID_MLKEM768_X25519_AES256GCM_HKDFSHA256_ED25519_v1',
      aead: 'AES-256-GCM',
      kdf: 'HKDF-SHA256',
      hash: 'SHA-256',
      keyDerivation: 'HYBRID_MLKEM768_X25519',
      salt: envelopeSaltBase64,
      handshake_id: recipient.handshake_id,
      // Sender's X25519 public key for receiver ECDH key agreement
      senderX25519PublicKeyB64,
      // Post-quantum cryptography metadata (includes KEM ciphertext for decapsulation)
      pq: pqMetadata
    },
    // Signing metadata
    signing: {
      algorithm: 'Ed25519',
      keyId: signingKeyPair.keyId,
      publicKey: signingKeyPair.publicKey
    },
    // Canon compliance metadata
    // Per canon A.3.054.10 / A.3.13: PQ is mandatory for qBEAP
    // We only reach this code when PQ is available (fail closed above otherwise)
    compliance: {
      canon: 'FULL', // Always FULL for qBEAP (PQ required, no PARTIAL packages allowed)
      notes: buildComplianceNotes(pqMetadata)
    },
    // Size limits (per canon A.3.054.9)
    // Declared in header and AAD-bound for integrity
    sizeLimits
  }

  // ==========================================================================
  // AAD Drift Detection (Dev-Only)
  // ==========================================================================
  // Verify header wasn't mutated between AAD derivation and signing.
  // This catches accidental header modifications that would break AAD binding.
  
  if (debugValidationEnabled && aadHashPre) {
    // Recompute AAD from headerPreSignature (should be unchanged)
    const aadFieldsPreSign = buildEnvelopeAadFields(headerPreSignature as Parameters<typeof buildEnvelopeAadFields>[0])
    const aadBytesPreSign = canonicalSerializeAAD(aadFieldsPreSign)
    const aadHashPreSign = await sha256Hex(aadBytesPreSign)
    
    if (aadHashPre !== aadHashPreSign) {
      return {
        success: false,
        error: 'VALIDATION: AAD drift detected: header mutated after AAD derivation. This is a builder bug that would break AAD binding.'
      }
    }
  }
  
  // ==========================================================================
  // Generate Signature
  // ==========================================================================
  
  // Build artefacts manifest for signing (refs and hashes only)
  // Sorted by artefactRef for deterministic ordering in computeSigningData
  const artefactsManifest = artefactsEnc?.map(a => ({
    artefactRef: a.artefactRef,
    sha256Plain: a.sha256Plain
  }))
  
  // Build structured payload commitment (per canon A.3.054.10)
  // Per canon: "The Capsule Builder SHALL produce cryptographic commitments that allow
  // validation before interpretation, including commitments to the ciphertext of the 
  // Capsule payload."
  //
  // For chunked payloads: merkleRoot commits to all chunk ciphertexts
  // For legacy single-blob: sha256Cipher commits to the ciphertext
  const payloadCommitment = {
    isChunked: payloadEnc.chunking?.enabled ?? false,
    merkleRoot: payloadEnc.chunking?.merkleRoot,
    sha256Plain: payloadEnc.sha256Plain,
    bytesPlain: payloadEnc.bytesPlain,
    sha256Cipher: payloadEnc.sha256Cipher
  }
  
  // Compute signing data
  const signingData = await computeSigningData(
    header as unknown as Record<string, unknown>,
    payloadCommitment,
    artefactsManifest
  )
  
  // Create signature
  const signature = await createBeapSignature(signingKeyPair, signingData)

  const shortFp = recipient.receiver_fingerprint_short.replace(/[…\.]/g, '').slice(0, 8)
  const dateStr = new Date(now).toISOString().slice(0, 10).replace(/-/g, '')
  const filename = `beap_${dateStr}_${shortFp}.beap`

  const pkg: BeapPackage = {
    header,
    // Encrypted payload (no plaintext payload for qBEAP)
    payloadEnc,
    signature,
    metadata: {
      created_at: now,
      delivery_method: config.deliveryMethod,
      delivery_hint: recipient.receiver_email_list[0] || config.emailTo,
      filename
    },
    // Encrypted artefacts (no plaintext artefacts for qBEAP)
    artefactsEnc
  }

  // ==========================================================================
  // Dev-Only Build Validation (gated behind BEAP_DEBUG_VALIDATE)
  // ==========================================================================
  // When enabled, validates the built package against canon requirements
  // and fails closed if validation errors are found.
  if (debugValidationEnabled) {
    const { runBuildValidation } = await import('../validation/beapBuildValidation')
    const isValid = await runBuildValidation(pkg)
    // Disable tracking after validation (cleanup)
    setDebugAadTrackingEnabled(false)
    if (!isValid) {
      return {
        success: false,
        error: 'VALIDATION: Built qBEAP package failed canon compliance validation. See console for details.'
      }
    }
  }

  return {
    success: true,
    package: pkg,
    packageJson: JSON.stringify(pkg, null, 2)
  }
}

/**
 * Build a pBEAP package (Public/Auditable)
 */
async function buildPBeapPackage(config: BeapPackageConfig): Promise<BeapPackage> {
  const now = Date.now()

  // Compute hashes
  const [templateHash, policyHash, contentHash] = await Promise.all([
    computeTemplateHash('beap-default-v1', '1.0.0'),
    computePolicyHash(config.policy),
    computeContentHash(
      config.messageBody,
      config.attachments?.map(a => ({ originalName: a.originalName, originalSize: a.originalSize }))
    )
  ])
  
  // Get signing key pair
  const signingKeyPair = await getSigningKeyPair()

  const header: BeapEnvelopeHeader = {
    version: '1.0',
    encoding: 'pBEAP',
    encryption_mode: 'NONE',
    timestamp: now,
    sender_fingerprint: config.senderFingerprint,
    // No receiver_fingerprint or receiver_binding for public distribution
    template_hash: templateHash,
    policy_hash: policyHash,
    content_hash: contentHash,
    // Signing metadata
    signing: {
      algorithm: 'Ed25519',
      keyId: signingKeyPair.keyId,
      publicKey: signingKeyPair.publicKey
    },
    // Canon compliance metadata
    // Note: pBEAP does NOT include original artefacts as encrypted (by design: auditable)
    // Canon A.3.043 requires original artefacts to be encrypted, which is a qBEAP-only guarantee
    // pBEAP is intentionally PARTIAL because it's designed for public audit, not encryption
    compliance: {
      canon: 'PARTIAL',
      notes: [
        'pBEAP: Public/auditable mode - no encryption by design',
        'pBEAP: Original artefacts not encrypted (per canon A.3.043: encryption is qBEAP-only)',
        'Canon source: external (not in repository)'
      ]
    }
  }

  // Plaintext payload for public distribution
  const payloadPlain = JSON.stringify({
    subject: config.subject || 'BEAP Public Message',
    body: config.messageBody,
    // Full attachment metadata for public package
    attachments: config.attachments?.map(att => ({
      id: att.id,
      originalName: att.originalName,
      originalSize: att.originalSize,
      originalType: att.originalType,
      semanticExtracted: att.semanticExtracted,
      semanticContent: att.semanticContent,
      encryptedRef: att.encryptedRef,
      previewRef: att.previewRef,
      rasterProof: att.rasterProof,
      isMedia: att.isMedia
    })) || [],
    audit_notice: 'This is a public BEAP package. Content is not encrypted and is fully auditable.'
  })
  const payloadEncoded = safeBase64Encode(payloadPlain) // Base64 for transport, not encryption

  // Build artefacts manifest for signing (for pBEAP, these are plaintext artefacts)
  const artefactsManifest = config.rasterArtefacts?.map(a => ({
    artefactRef: a.artefactRef,
    sha256Plain: a.sha256
  }))
  
  // Compute signing data
  const signingData = await computeSigningData(
    header as unknown as Record<string, unknown>,
    payloadEncoded,
    artefactsManifest
  )
  
  // Create signature
  const signature = await createBeapSignature(signingKeyPair, signingData)

  const dateStr = new Date(now).toISOString().slice(0, 10).replace(/-/g, '')
  const filename = `beap_${dateStr}_PUBLIC.beap`

  return {
    header,
    payload: payloadEncoded,
    signature,
    metadata: {
      created_at: now,
      delivery_method: config.deliveryMethod,
      delivery_hint: config.emailTo,
      filename
    },
    // Include raster artefacts (base64 page images) if provided
    artefacts: config.rasterArtefacts && config.rasterArtefacts.length > 0
      ? config.rasterArtefacts
      : undefined
  }
}

/**
 * Build a BEAP package based on recipient mode
 */
export async function buildPackage(config: BeapPackageConfig): Promise<PackageBuildResult> {
  const validation = validatePackageConfig(config)
  
  if (!validation.valid) {
    return {
      success: false,
      error: validation.errors.join('; ')
    }
  }

  try {
    if (config.recipientMode === 'private') {
      // qBEAP: buildQBeapPackage returns PackageBuildResult directly (async)
      const result = await buildQBeapPackage(config)
      return result
    } else {
      // pBEAP: buildPBeapPackage returns BeapPackage, wrap it (async)
      const pkg = await buildPBeapPackage(config)
      return {
        success: true,
        package: pkg,
        packageJson: JSON.stringify(pkg, null, 2)
      }
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to build package'
    }
  }
}

// =============================================================================
// Unified Build Result Adapter
// =============================================================================

/**
 * Adapts PackageBuildResult to the canonical BeapBuildResult type.
 * This ensures Draft Email builder output is consistent with the unified builder.
 */
function toBeapBuildResult(result: PackageBuildResult): BeapBuildResult {
  if (result.success && result.package) {
    return {
      success: true,
      packageId: result.package.metadata.filename.replace('.beap', ''),
      capsuleRef: result.package.header.content_hash,
      envelopeRef: result.package.header.template_hash,
      silentMode: false // Draft Email is explicit UI, never silent
    }
  }
  return {
    success: false,
    error: result.error || 'Build failed',
    silentMode: false
  }
}

/**
 * Build a BEAP package and return the canonical BeapBuildResult.
 * Use this at the UI boundary for consistent result types across WR Chat and Drafts.
 */
export async function buildDraftEmailPackage(config: BeapPackageConfig): Promise<BeapBuildResult> {
  const result = await buildPackage(config)
  return toBeapBuildResult(result)
}

// =============================================================================
// Email Transport Contract
// =============================================================================

/**
 * Canonical email transport contract.
 * Ensures strict separation between transport content and capsule content.
 */
interface EmailTransportContract {
  /** Email subject - must be safe, no user content */
  subject: string
  /** Email body - transport plaintext ONLY, never encrypted content */
  body: string
  /** Attachments - .beap package, safe filenames only */
  attachments: { name: string; data: string; mime: string }[]
}

/**
 * Default safe body for qBEAP when transport plaintext is minimal
 */
const QBEAP_DEFAULT_BODY = 'Private BEAP™ package attached. Open with a BEAP-compatible client.'

/**
 * Build the email transport contract with strict content separation
 */
function buildEmailTransportContract(
  pkg: BeapPackage,
  config: BeapPackageConfig
): EmailTransportContract {
  // Subject: Use safe default, never user content
  const subject = config.subject || 'BEAP™ Secure Message'
  
  // Body: Transport plaintext only
  let body: string
  if (config.recipientMode === 'private') {
    // qBEAP: Use transport plaintext, or safe default if empty/minimal
    const transportText = config.messageBody?.trim() || ''
    if (transportText.length < 10) {
      // Too short or empty - use safe default
      body = QBEAP_DEFAULT_BODY
    } else {
      body = transportText
    }
  } else {
    // pBEAP: Use message body as-is (unchanged behavior)
    body = config.messageBody || 'BEAP™ Public package attached.'
  }
  
  // Attachment: .beap package with safe filename
  const packageJson = JSON.stringify(pkg, null, 2)
  const attachments = [{
    name: pkg.metadata.filename,
    data: packageJson,
    mime: 'application/json'
  }]
  
  return { subject, body, attachments }
}

/**
 * Validate email transport contract for security violations
 * Throws if encrypted content would leak via email transport
 */
function validateEmailTransportContract(
  contract: EmailTransportContract,
  config: BeapPackageConfig
): void {
  const encryptedMessage = config.encryptedMessage?.trim()
  
  if (!encryptedMessage || encryptedMessage.length === 0) {
    return // No encrypted message to check
  }
  
  // Check subject for leakage
  if (contract.subject.includes(encryptedMessage)) {
    throw new Error('SECURITY: Encrypted content attempted to leave capsule via email subject')
  }
  
  // Check body for leakage
  if (contract.body.includes(encryptedMessage)) {
    throw new Error('SECURITY: Encrypted content attempted to leave capsule via email body')
  }
  
  // Check attachment filenames for leakage
  for (const attachment of contract.attachments) {
    if (attachment.name.includes(encryptedMessage)) {
      throw new Error('SECURITY: Encrypted content attempted to leave capsule via attachment filename')
    }
  }
}

// =============================================================================
// Delivery Actions
// =============================================================================

/**
 * Email action - Send package via email
 * 
 * Transport separation rules:
 * - Subject: Safe default only
 * - Body: Transport plaintext only (qBEAP uses safe default if minimal)
 * - Attachment: .beap package with safe filename
 * - encryptedMessage NEVER leaves the capsule
 */
export async function executeEmailAction(
  pkg: BeapPackage,
  config: BeapPackageConfig
): Promise<DeliveryResult> {
  const toAddress = config.recipientMode === 'private'
    ? config.selectedRecipient?.receiver_email_list[0] || config.emailTo
    : config.emailTo

  if (!toAddress) {
    return {
      success: false,
      action: 'sent',
      message: 'No email address available for delivery'
    }
  }

  // Build the email transport contract with strict content separation
  const emailContract = buildEmailTransportContract(pkg, config)
  
  // SECURITY: Validate no encrypted content leaks via email transport
  validateEmailTransportContract(emailContract, config)

  // Stub: In production, would integrate with email provider
  // NOTE: Intentionally NOT logging messageBody or encryptedMessage content
  console.log('[BEAP Email] Sending package:', {
    to: toAddress,
    encoding: pkg.header.encoding,
    filename: emailContract.attachments[0]?.name,
    subject: emailContract.subject,
    bodyLength: emailContract.body.length,
    // SECURITY: Never log body content or encryptedMessage
  })

  // Simulate email send
  await new Promise(resolve => setTimeout(resolve, 500))

  const recipientLabel = config.recipientMode === 'private'
    ? `${config.selectedRecipient?.receiver_display_name} (${config.selectedRecipient?.receiver_fingerprint_short})`
    : toAddress

  return {
    success: true,
    action: 'sent',
    message: `BEAP™ ${pkg.header.encoding} package sent to ${recipientLabel}`,
    details: {
      to: toAddress,
      filename: emailContract.attachments[0]?.name
    }
  }
}

/**
 * Messenger action - Copy payload to clipboard
 */
export async function executeMessengerAction(
  pkg: BeapPackage,
  config: BeapPackageConfig
): Promise<DeliveryResult> {
  const packageJson = JSON.stringify(pkg, null, 2)
  
  // Build labeled payload
  let clipboardContent: string
  if (config.recipientMode === 'private') {
    const recipient = config.selectedRecipient!
    clipboardContent = `--- BEAP™ Private Package (qBEAP) ---
Recipient: ${recipient.receiver_display_name}${recipient.receiver_organization ? ` — ${recipient.receiver_organization}` : ''}
Fingerprint: ${recipient.receiver_fingerprint_short}
Encoding: qBEAP (Encrypted)
---

${packageJson}`

    // SECURITY: Ensure encryptedMessage is not in clipboard header text (it's only in encrypted payload)
    // The encryptedMessage content should only exist within the encrypted payload, never in plaintext headers
    if (config.encryptedMessage && config.encryptedMessage.trim()) {
      const headerSection = clipboardContent.split('---')[1] || ''
      if (headerSection.includes(config.encryptedMessage)) {
        throw new Error('SECURITY: encryptedMessage leaked into messenger clipboard header')
      }
    }
  } else {
    clipboardContent = `--- BEAP™ Public Package (pBEAP) ---
Distribution: Public (Auditable)
Encoding: pBEAP (No Encryption)
Notice: This package is fully auditable and has no recipient binding.
---

${packageJson}`
  }

  try {
    await navigator.clipboard.writeText(clipboardContent)

    return {
      success: true,
      action: 'copied',
      message: `BEAP™ ${pkg.header.encoding} payload copied to clipboard`,
      details: {
        clipboardContent: clipboardContent.slice(0, 200) + '...'
      }
    }
  } catch (error) {
    return {
      success: false,
      action: 'copied',
      message: 'Failed to copy to clipboard'
    }
  }
}

/**
 * Download action - Save package as file
 */
export async function executeDownloadAction(
  pkg: BeapPackage,
  config: BeapPackageConfig
): Promise<DeliveryResult> {
  const packageJson = JSON.stringify(pkg, null, 2)
  const blob = new Blob([packageJson], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  
  const link = document.createElement('a')
  link.href = url
  link.download = pkg.metadata.filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)

  const label = config.recipientMode === 'private'
    ? `for ${config.selectedRecipient?.receiver_display_name}`
    : '(PUBLIC distribution)'

  return {
    success: true,
    action: 'downloaded',
    message: `BEAP™ ${pkg.header.encoding} package downloaded ${label}`,
    details: {
      filename: pkg.metadata.filename
    }
  }
}

/**
 * Execute the appropriate action based on delivery method
 */
export async function executeDeliveryAction(
  config: BeapPackageConfig
): Promise<DeliveryResult> {
  // Build the package first (async for qBEAP encryption)
  const buildResult = await buildPackage(config)
  
  if (!buildResult.success || !buildResult.package) {
    return {
      success: false,
      action: config.deliveryMethod === 'email' ? 'sent' : 
              config.deliveryMethod === 'messenger' ? 'copied' : 'downloaded',
      message: buildResult.error || 'Failed to build package'
    }
  }

  const pkg = buildResult.package

  // Execute appropriate action
  switch (config.deliveryMethod) {
    case 'email':
      return executeEmailAction(pkg, config)
    case 'messenger':
      return executeMessengerAction(pkg, config)
    case 'download':
      return executeDownloadAction(pkg, config)
    default:
      return {
        success: false,
        action: 'sent',
        message: `Unknown delivery method: ${config.deliveryMethod}`
      }
  }
}

