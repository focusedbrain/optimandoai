/**
 * BEAP Minimal Validators
 * 
 * Safe validators for BEAP package handling.
 * These are intentionally minimal - they check structure markers only.
 * 
 * INVARIANTS:
 * - isBeapPackageJson: checks marker keys only, NOT full schema
 * - detectImportKind: extension-based detection only
 * - No content parsing, no artefact inspection
 * - Unknown fields are preserved, not stripped
 * 
 * @version 1.0.0
 */

import {
  BEAP_PACKAGE_EXT,
  BEAP_ENCRYPTED_CAPSULE_EXT,
  BEAP_MIN_MARKER_TYPE,
} from './constants'

import type { ImportKind, MinimalEnvelopeMarker } from './types'

// =============================================================================
// Package Marker Validation
// =============================================================================

/**
 * Check if an object looks like a BEAP package
 * 
 * MINIMAL validation only - checks marker keys:
 * - beapVersion (string)
 * - type === "BEAP_PACKAGE"
 * - envelope (object)
 * 
 * This does NOT validate:
 * - Full envelope schema
 * - Capsule contents
 * - Signatures
 * - Artefacts
 * 
 * Use this for quick "is this a BEAP file" detection only.
 * 
 * @param obj - Object to check (typically parsed JSON)
 * @returns true if object has minimal BEAP package markers
 */
export function isBeapPackageJson(obj: unknown): obj is MinimalEnvelopeMarker {
  if (obj === null || typeof obj !== 'object') {
    return false
  }
  
  const candidate = obj as Record<string, unknown>
  
  // Check beapVersion exists and is string
  if (typeof candidate.beapVersion !== 'string') {
    return false
  }
  
  // Check type is exactly BEAP_PACKAGE
  if (candidate.type !== BEAP_MIN_MARKER_TYPE) {
    return false
  }
  
  // Check envelope exists and is object
  if (candidate.envelope === null || typeof candidate.envelope !== 'object') {
    return false
  }
  
  return true
}

// =============================================================================
// Import Kind Detection
// =============================================================================

/**
 * Detect import kind from file name/path
 * 
 * Based on file extension only:
 * - .beap → beap_package (importable as message)
 * - .qbeap → encrypted_capsule (NOT importable as message)
 * - else → unknown
 * 
 * CRITICAL: .qbeap files cannot be imported as standalone messages.
 * They are only valid as referenced artefacts within a .beap package.
 * 
 * @param filename - File name or path to check
 * @returns Import kind classification
 */
export function detectImportKind(filename: string): ImportKind {
  const lower = filename.toLowerCase()
  
  if (lower.endsWith(BEAP_PACKAGE_EXT)) {
    return 'beap_package'
  }
  
  if (lower.endsWith(BEAP_ENCRYPTED_CAPSULE_EXT)) {
    return 'encrypted_capsule'
  }
  
  return 'unknown'
}

/**
 * Check if a file is importable as a BEAP message
 * 
 * @param filename - File name or path to check
 * @returns true if file can be imported as a message
 */
export function isImportableAsMessage(filename: string): boolean {
  return detectImportKind(filename) === 'beap_package'
}

/**
 * Check if a file is an encrypted capsule
 * 
 * @param filename - File name or path to check
 * @returns true if file is an encrypted capsule (.qbeap)
 */
export function isEncryptedCapsule(filename: string): boolean {
  return detectImportKind(filename) === 'encrypted_capsule'
}

// =============================================================================
// Premature Processing Guard
// =============================================================================

/**
 * GUARDRAIL: Assert no premature processing
 * 
 * This is a documentation and runtime assertion helper.
 * Call this at the start of any function that should only
 * run AFTER package acceptance.
 * 
 * Premature processing includes:
 * - JSON.parse on .qbeap files (never allowed)
 * - Artefact parsing before acceptance
 * - Content rendering before acceptance
 * - Decryption before acceptance
 * - Preview generation before acceptance
 * 
 * ENFORCEMENT POINTS:
 * - Import pipeline: store rawRef only, no parsing
 * - Verification: envelope only, no capsule access
 * - Reconstruction: only after verificationState === 'accepted'
 * - Preview/render: only reconstructed artefacts, never originals
 * 
 * @param verificationState - Current verification state
 * @param operation - Description of operation being attempted
 * @throws Error if verificationState is not 'accepted'
 */
export function assertNoPrematureProcessing(
  verificationState: 'pending_verification' | 'accepted' | 'rejected',
  operation: string
): void {
  if (verificationState !== 'accepted') {
    throw new Error(
      `[BEAP Security] Premature processing attempt: ${operation}. ` +
      `Current state: ${verificationState}. ` +
      `Processing only allowed after acceptance.`
    )
  }
}

/**
 * GUARDRAIL: Assert capsule is not being parsed as JSON
 * 
 * .qbeap files are OPAQUE BINARY BLOBS.
 * They must NEVER be:
 * - JSON.parse()'d
 * - Decoded as text
 * - Inspected for structure
 * 
 * Capsule binding is done via envelope (hash/size/encoding).
 * Decryption is receiver-side only, outside originating network.
 * 
 * This function documents the invariant but doesn't enforce at runtime.
 * Use code review and grep to ensure no JSON.parse calls on .qbeap.
 */
export function documentCapsuleOpacityInvariant(): void {
  // This function exists for documentation purposes.
  // The invariant it documents:
  //
  // 1. .qbeap is always opaque binary
  // 2. No JSON.parse() on .qbeap at any point
  // 3. No structure validation on .qbeap
  // 4. Envelope binds capsule via hash/size/encoding metadata
  // 5. Decryption is future, receiver-side, outside originating network
  //
  // To verify compliance:
  // grep -r "JSON.parse" | grep -i "qbeap\|capsule"
  // should return NO results
}


