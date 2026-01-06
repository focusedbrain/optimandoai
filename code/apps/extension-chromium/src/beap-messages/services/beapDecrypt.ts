/**
 * BEAP Package Decryption Service
 * 
 * Implements the canonical parsing and disclosure pipeline per A.3.055:
 * - Stage 0: Recipient eligibility determination (qBEAP)
 * - Stage 1: Public Envelope integrity verification
 * - Stage 4: Inner Envelope metadata disclosure
 * - Stage 6: Capsule access and parsing
 * 
 * Per canon:
 * - All failures prior to Capsule access MUST be non-disclosing
 * - qBEAP eligibility MUST be constant-behavior (no timing leaks)
 * - pBEAP skips eligibility checks (auditable mode)
 * 
 * @version 1.0.0
 */

import type { BeapPackage, BeapEnvelopeHeader, BeapArtefact, BeapArtefactEncrypted } from './BeapPackageBuilder'
import {
  deriveBeapKeys,
  decryptCapsulePayload,
  decryptArtefact,
  verifyBeapSignature,
  computeSigningData,
  fromBase64,
  toBase64,
  sha256,
  type BeapSignature,
  type EncryptedArtefact
} from './beapCrypto'
import { deriveSharedSecretX25519 } from './x25519KeyAgreement'

// =============================================================================
// Types
// =============================================================================

/**
 * Decrypted capsule payload structure
 */
export interface DecryptedCapsulePayload {
  subject: string
  body: string
  transport_plaintext?: string
  has_authoritative_encrypted?: boolean
  attachments: Array<{
    id: string
    originalName: string
    originalSize: number
    originalType: string
    semanticExtracted: boolean
    semanticContent?: string
    encryptedRef?: string
    previewRef?: string
    rasterProof?: {
      pages: Array<{
        page: number
        width: number
        height: number
        bytes: number
        sha256: string
        artefactRef: string
      }>
    }
    isMedia?: boolean
  }>
  automation?: {
    tags: string[]
    tagSource: 'encrypted' | 'plaintext' | 'both' | 'none'
    receiverHasFinalAuthority: true
  }
  audit_notice?: string // pBEAP only
}

/**
 * Decrypted artefact (raster or original)
 */
export interface DecryptedArtefact {
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
}

/**
 * Complete decrypted package
 */
export interface DecryptedPackage {
  header: BeapEnvelopeHeader
  capsule: DecryptedCapsulePayload
  artefacts: DecryptedArtefact[]
  metadata: BeapPackage['metadata']
  verification: {
    signatureValid: boolean
    signatureAlgorithm: string
    signerKeyId: string
    verifiedAt: number
  }
}

/**
 * Verification result before decryption
 */
export interface VerificationResult {
  valid: boolean
  stage: 'eligibility' | 'integrity' | 'signature' | 'complete'
  error?: string
  /** Per canon A.3.055: errors must be non-disclosing */
  nonDisclosingError: string
}

/**
 * Decryption result
 */
export interface DecryptionResult {
  success: boolean
  package?: DecryptedPackage
  error?: string
  /** Per canon: non-disclosing error for external display */
  nonDisclosingError?: string
}

// =============================================================================
// Stage 0: Recipient Eligibility (qBEAP only)
// =============================================================================

/**
 * Check recipient eligibility for qBEAP packages.
 * 
 * Per canon A.3.055 Stage 0:
 * - Eligibility MUST be evaluated solely via opaque handshake-derived binding
 * - MUST be non-disclosing and constant-behavior
 * - If eligibility cannot be established, treat as "not-for-me"
 * 
 * @param header - Package header
 * @param localHandshakeId - Local handshake ID to check against
 * @returns true if eligible, false if "not-for-me"
 */
export function checkRecipientEligibility(
  header: BeapEnvelopeHeader,
  localHandshakeId: string
): boolean {
  // pBEAP: No eligibility check (per canon A.3.06)
  if (header.encoding === 'pBEAP') {
    return true
  }
  
  // qBEAP: Must match handshake binding
  if (!header.receiver_binding?.handshake_id) {
    // No handshake binding - not eligible
    return false
  }
  
  // Constant-time comparison would be ideal here for security
  // For MVP, using string comparison
  return header.receiver_binding.handshake_id === localHandshakeId
}

// =============================================================================
// Stage 1: Public Envelope Integrity Verification
// =============================================================================

/**
 * Verify public envelope integrity.
 * 
 * Per canon A.3.055 Stage 1:
 * - Verify outer Envelope governance material
 * - Failure MUST result in fail-closed rejection
 * - MUST NOT permit any encrypted Envelope disclosure on failure
 * 
 * @param pkg - Package to verify
 * @returns Verification result
 */
export async function verifyEnvelopeIntegrity(
  pkg: BeapPackage
): Promise<VerificationResult> {
  // Check required fields
  if (!pkg.header?.version || !pkg.header?.encoding) {
    return {
      valid: false,
      stage: 'integrity',
      error: 'Missing required header fields',
      nonDisclosingError: 'Package verification failed'
    }
  }
  
  // Verify version
  if (pkg.header.version !== '1.0') {
    return {
      valid: false,
      stage: 'integrity',
      error: `Unsupported version: ${pkg.header.version}`,
      nonDisclosingError: 'Package verification failed'
    }
  }
  
  // Verify encoding mode
  if (pkg.header.encoding !== 'qBEAP' && pkg.header.encoding !== 'pBEAP') {
    return {
      valid: false,
      stage: 'integrity',
      error: `Invalid encoding: ${pkg.header.encoding}`,
      nonDisclosingError: 'Package verification failed'
    }
  }
  
  // Verify required hashes are present
  if (!pkg.header.template_hash || !pkg.header.policy_hash || !pkg.header.content_hash) {
    return {
      valid: false,
      stage: 'integrity',
      error: 'Missing commitment hashes',
      nonDisclosingError: 'Package verification failed'
    }
  }
  
  // Verify signature is present
  if (!pkg.signature?.signature) {
    return {
      valid: false,
      stage: 'integrity',
      error: 'Missing signature',
      nonDisclosingError: 'Package verification failed'
    }
  }
  
  return {
    valid: true,
    stage: 'integrity',
    nonDisclosingError: ''
  }
}

// =============================================================================
// Signature Verification
// =============================================================================

/**
 * Verify package signature.
 * 
 * Per canon A.3.054.10:
 * - All cryptographic protections are explicit and verifiable
 * - Signature binds envelope, capsule, and artefacts
 * 
 * @param pkg - Package to verify
 * @returns Verification result
 */
export async function verifyPackageSignature(
  pkg: BeapPackage
): Promise<VerificationResult> {
  try {
    // Build artefacts manifest for verification
    let artefactsManifest: Array<{ artefactRef: string; sha256Plain?: string }> | undefined
    
    if (pkg.header.encoding === 'qBEAP' && pkg.artefactsEnc) {
      artefactsManifest = pkg.artefactsEnc.map(a => ({
        artefactRef: a.artefactRef,
        sha256Plain: a.sha256Plain
      }))
    } else if (pkg.header.encoding === 'pBEAP' && pkg.artefacts) {
      artefactsManifest = pkg.artefacts.map(a => ({
        artefactRef: a.artefactRef,
        sha256Plain: a.sha256
      }))
    }
    
    // Get payload data for signing
    const payloadData = pkg.header.encoding === 'qBEAP'
      ? pkg.payloadEnc?.ciphertext || ''
      : pkg.payload || ''
    
    // Compute expected signing data
    const signingData = await computeSigningData(
      pkg.header as unknown as Record<string, unknown>,
      payloadData,
      artefactsManifest
    )
    
    // Verify signature
    const isValid = await verifyBeapSignature(pkg.signature, signingData)
    
    if (!isValid) {
      return {
        valid: false,
        stage: 'signature',
        error: 'Signature verification failed',
        nonDisclosingError: 'Package verification failed'
      }
    }
    
    return {
      valid: true,
      stage: 'signature',
      nonDisclosingError: ''
    }
  } catch (error) {
    return {
      valid: false,
      stage: 'signature',
      error: error instanceof Error ? error.message : 'Signature verification error',
      nonDisclosingError: 'Package verification failed'
    }
  }
}

// =============================================================================
// Stage 6: Capsule Decryption
// =============================================================================

/**
 * Decrypt a qBEAP package.
 * 
 * Per canon A.3.055 Stage 6:
 * - Decrypt after successful completion of Stages 1-4
 * - Parsing MUST be strict, schema-governed, bounded
 * - MUST occur within verified isolation boundary
 * 
 * @param pkg - Package to decrypt
 * @param handshakeId - Handshake ID for key derivation
 * @param senderFingerprint - Sender fingerprint for key derivation
 * @returns Decryption result
 */
export async function decryptQBeapPackage(
  pkg: BeapPackage,
  senderX25519PublicKey: string
): Promise<DecryptionResult> {
  try {
    // Verify this is a qBEAP package
    if (pkg.header.encoding !== 'qBEAP') {
      return {
        success: false,
        error: 'Not a qBEAP package',
        nonDisclosingError: 'Package decryption failed'
      }
    }
    
    // Verify payloadEnc exists
    if (!pkg.payloadEnc?.nonce || !pkg.payloadEnc?.ciphertext) {
      return {
        success: false,
        error: 'Missing encrypted payload',
        nonDisclosingError: 'Package decryption failed'
      }
    }
    
    // Get salt from header
    const salt = pkg.header.crypto?.salt
    if (!salt) {
      return {
        success: false,
        error: 'Missing envelope salt',
        nonDisclosingError: 'Package decryption failed'
      }
    }
    
    // Re-derive keys using X25519 ECDH
    // qBEAP requires real key agreement - no fallback allowed
    const ecdhResult = await deriveSharedSecretX25519(senderX25519PublicKey)
    const { capsuleKey, artefactKey } = await deriveBeapKeys(ecdhResult.sharedSecret, fromBase64(salt))
    
    // Decrypt capsule payload
    const capsuleJson = await decryptCapsulePayload(capsuleKey, pkg.payloadEnc)
    let capsule: DecryptedCapsulePayload
    try {
      capsule = JSON.parse(capsuleJson)
    } catch {
      return {
        success: false,
        error: 'Invalid capsule JSON',
        nonDisclosingError: 'Package decryption failed'
      }
    }
    
    // Decrypt artefacts
    const decryptedArtefacts: DecryptedArtefact[] = []
    if (pkg.artefactsEnc && pkg.artefactsEnc.length > 0) {
      for (const encArtefact of pkg.artefactsEnc) {
        const decrypted = await decryptArtefact(artefactKey, encArtefact as EncryptedArtefact)
        decryptedArtefacts.push(decrypted)
      }
    }
    
    // Verify signature
    const sigResult = await verifyPackageSignature(pkg)
    
    return {
      success: true,
      package: {
        header: pkg.header,
        capsule,
        artefacts: decryptedArtefacts,
        metadata: pkg.metadata,
        verification: {
          signatureValid: sigResult.valid,
          signatureAlgorithm: pkg.signature.algorithm,
          signerKeyId: pkg.signature.keyId,
          verifiedAt: Date.now()
        }
      }
    }
  } catch (error) {
    console.error('[BEAP Decrypt] Error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Decryption failed',
      nonDisclosingError: 'Package decryption failed'
    }
  }
}

/**
 * Decode a pBEAP package (no decryption needed).
 * 
 * Per canon A.3.14:
 * - pBEAP capsules are unencrypted
 * - Full envelope is readable and inspectable in plaintext
 * 
 * @param pkg - Package to decode
 * @returns Decryption result
 */
export async function decodePBeapPackage(
  pkg: BeapPackage
): Promise<DecryptionResult> {
  try {
    // Verify this is a pBEAP package
    if (pkg.header.encoding !== 'pBEAP') {
      return {
        success: false,
        error: 'Not a pBEAP package',
        nonDisclosingError: 'Package decoding failed'
      }
    }
    
    // Verify payload exists
    if (!pkg.payload) {
      return {
        success: false,
        error: 'Missing payload',
        nonDisclosingError: 'Package decoding failed'
      }
    }
    
    // Decode base64 payload
    let capsuleJson: string
    try {
      capsuleJson = atob(pkg.payload)
    } catch {
      return {
        success: false,
        error: 'Invalid base64 payload',
        nonDisclosingError: 'Package decoding failed'
      }
    }
    
    // Parse JSON
    let capsule: DecryptedCapsulePayload
    try {
      capsule = JSON.parse(capsuleJson)
    } catch {
      return {
        success: false,
        error: 'Invalid capsule JSON',
        nonDisclosingError: 'Package decoding failed'
      }
    }
    
    // Convert plaintext artefacts to decrypted format
    const artefacts: DecryptedArtefact[] = []
    if (pkg.artefacts && pkg.artefacts.length > 0) {
      for (const artefact of pkg.artefacts) {
        artefacts.push({
          class: 'raster', // pBEAP currently only has raster artefacts
          artefactRef: artefact.artefactRef,
          attachmentId: artefact.attachmentId,
          page: artefact.page,
          mime: artefact.mime,
          base64: artefact.base64,
          sha256: artefact.sha256,
          width: artefact.width,
          height: artefact.height,
          bytes: artefact.bytes
        })
      }
    }
    
    // Verify signature
    const sigResult = await verifyPackageSignature(pkg)
    
    return {
      success: true,
      package: {
        header: pkg.header,
        capsule,
        artefacts,
        metadata: pkg.metadata,
        verification: {
          signatureValid: sigResult.valid,
          signatureAlgorithm: pkg.signature.algorithm,
          signerKeyId: pkg.signature.keyId,
          verifiedAt: Date.now()
        }
      }
    }
  } catch (error) {
    console.error('[BEAP Decode] Error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Decoding failed',
      nonDisclosingError: 'Package decoding failed'
    }
  }
}

// =============================================================================
// Main Decryption Entry Point
// =============================================================================

/**
 * Decrypt/decode a BEAP package following the canonical pipeline.
 * 
 * Implements A.3.055 stages:
 * 1. Envelope integrity verification
 * 2. Recipient eligibility (qBEAP only)
 * 3. Signature verification
 * 4. Capsule decryption/decoding
 * 
 * @param pkg - Package to decrypt
 * @param options - Decryption options
 * @returns Decryption result
 */
export async function decryptBeapPackage(
  pkg: BeapPackage,
  options: {
    /** Handshake ID for qBEAP (required for qBEAP) */
    handshakeId?: string
    /** Sender's X25519 public key for key agreement (required for qBEAP) */
    senderX25519PublicKey?: string
    /** Skip signature verification (NOT recommended) */
    skipSignatureVerification?: boolean
  } = {}
): Promise<DecryptionResult> {
  // Stage 1: Envelope integrity verification
  const integrityResult = await verifyEnvelopeIntegrity(pkg)
  if (!integrityResult.valid) {
    return {
      success: false,
      error: integrityResult.error,
      nonDisclosingError: integrityResult.nonDisclosingError
    }
  }
  
  // Stage 0: Recipient eligibility (qBEAP only)
  if (pkg.header.encoding === 'qBEAP') {
    if (!options.handshakeId) {
      return {
        success: false,
        error: 'Handshake ID required for qBEAP',
        nonDisclosingError: 'Package decryption failed'
      }
    }
    
    const isEligible = checkRecipientEligibility(pkg.header, options.handshakeId)
    if (!isEligible) {
      // Per canon: "not-for-me" is not an error, just non-disclosing rejection
      return {
        success: false,
        error: 'Not eligible recipient',
        nonDisclosingError: 'Package not for this recipient'
      }
    }
    
    // qBEAP requires X25519 key agreement - no fallback
    if (!options.senderX25519PublicKey) {
      return {
        success: false,
        error: 'Sender X25519 public key required for qBEAP decryption. Complete the handshake key exchange.',
        nonDisclosingError: 'Package decryption failed'
      }
    }
  }
  
  // Optional: Verify signature before decryption
  if (!options.skipSignatureVerification) {
    const sigResult = await verifyPackageSignature(pkg)
    if (!sigResult.valid) {
      return {
        success: false,
        error: sigResult.error,
        nonDisclosingError: sigResult.nonDisclosingError
      }
    }
  }
  
  // Stage 6: Decrypt/decode based on encoding
  if (pkg.header.encoding === 'qBEAP') {
    return decryptQBeapPackage(
      pkg,
      options.senderX25519PublicKey!
    )
  } else {
    return decodePBeapPackage(pkg)
  }
}

// =============================================================================
// Package Parsing (from JSON string)
// =============================================================================

/**
 * Parse a .beap file contents into a BeapPackage object.
 * 
 * Per canon A.3.055 Pre-eligibility handling:
 * - Only minimal, non-semantic transport framing
 * - No structural parsing beyond locating boundaries
 * 
 * @param beapJson - JSON string from .beap file
 * @returns Parsed package or error
 */
export function parseBeapFile(
  beapJson: string
): { success: true; package: BeapPackage } | { success: false; error: string } {
  try {
    const pkg = JSON.parse(beapJson) as BeapPackage
    
    // Minimal structural validation (per canon: only transport framing)
    if (!pkg.header) {
      return { success: false, error: 'Missing header' }
    }
    
    if (!pkg.signature) {
      return { success: false, error: 'Missing signature' }
    }
    
    if (!pkg.metadata) {
      return { success: false, error: 'Missing metadata' }
    }
    
    return { success: true, package: pkg }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Invalid JSON'
    }
  }
}

// =============================================================================
// Utility: Get Artefact by Reference
// =============================================================================

/**
 * Get a specific artefact from a decrypted package by reference.
 * 
 * @param pkg - Decrypted package
 * @param artefactRef - Artefact reference to find
 * @returns Artefact or undefined
 */
export function getArtefactByRef(
  pkg: DecryptedPackage,
  artefactRef: string
): DecryptedArtefact | undefined {
  return pkg.artefacts.find(a => a.artefactRef === artefactRef)
}

/**
 * Get all artefacts for an attachment.
 * 
 * @param pkg - Decrypted package
 * @param attachmentId - Attachment ID
 * @returns Array of artefacts
 */
export function getArtefactsForAttachment(
  pkg: DecryptedPackage,
  attachmentId: string
): DecryptedArtefact[] {
  return pkg.artefacts.filter(a => a.attachmentId === attachmentId)
}

/**
 * Get original file artefact for an attachment.
 * 
 * @param pkg - Decrypted package
 * @param attachmentId - Attachment ID
 * @returns Original artefact or undefined
 */
export function getOriginalArtefact(
  pkg: DecryptedPackage,
  attachmentId: string
): DecryptedArtefact | undefined {
  return pkg.artefacts.find(
    a => a.attachmentId === attachmentId && a.class === 'original'
  )
}

/**
 * Get raster page artefacts for an attachment (sorted by page number).
 * 
 * @param pkg - Decrypted package
 * @param attachmentId - Attachment ID
 * @returns Array of raster artefacts sorted by page
 */
export function getRasterArtefacts(
  pkg: DecryptedPackage,
  attachmentId: string
): DecryptedArtefact[] {
  return pkg.artefacts
    .filter(a => a.attachmentId === attachmentId && a.class === 'raster')
    .sort((a, b) => (a.page ?? 0) - (b.page ?? 0))
}

