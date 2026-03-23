/**
 * Handshake Service
 * 
 * Core service for creating real X25519-based handshake identities and payloads.
 * Uses stable device keypair (not mock fingerprints).
 * 
 * Key Principles:
 * - Identity is stable across sessions (device keypair)
 * - Fingerprint is derived from X25519 public key (deterministic)
 * - ML-KEM is optional and doesn't block handshake creation
 * 
 * @version 1.0.0
 */

import {
  getOrCreateDeviceKeypair,
  type X25519KeyPair
} from '../beap-messages/services/x25519KeyAgreement'
import {
  sha256Hex,
  fromBase64
} from '../beap-messages/services/beapCrypto'

// =============================================================================
// Types
// =============================================================================

/**
 * Our local identity for handshake operations.
 * Derived from the device's X25519 keypair.
 */
export interface OurIdentity {
  /** Fingerprint (SHA-256 of X25519 public key, 64 hex chars) */
  fingerprint: string
  
  /** X25519 public key (base64, 32 bytes) */
  x25519PublicKeyB64: string
  
  /** Key ID for the local keypair (first 8 bytes of pubkey hash) */
  localX25519KeyId: string
}


// =============================================================================
// Fingerprint Derivation
// =============================================================================

/**
 * Derive a fingerprint from an X25519 public key.
 * 
 * Process:
 * 1. Base64 decode the public key to raw bytes
 * 2. SHA-256 hash the raw bytes
 * 3. Return uppercase hex string (64 chars)
 * 
 * This is deterministic: same public key always produces same fingerprint.
 * 
 * @param publicKeyB64 - X25519 public key (base64, 32 bytes)
 * @returns Fingerprint as 64-char uppercase hex string
 */
export async function deriveFingerprintFromX25519(publicKeyB64: string): Promise<string> {
  // Decode base64 to raw bytes
  const publicKeyBytes = fromBase64(publicKeyB64)
  
  // SHA-256 hash to get fingerprint
  const fingerprintHex = await sha256Hex(publicKeyBytes)
  
  // Return uppercase for consistency
  return fingerprintHex.toUpperCase()
}

// =============================================================================
// Identity Management
// =============================================================================

// Cache the identity to avoid repeated async operations
let _cachedIdentity: OurIdentity | null = null

/**
 * Get our stable identity for handshake operations.
 * 
 * Uses the device's X25519 keypair which is:
 * - Created once and stored in chrome.storage.local
 * - Stable across browser sessions
 * - The same keypair used for qBEAP encryption
 * 
 * @returns Our identity with fingerprint and public key
 */
export async function getOurIdentity(): Promise<OurIdentity> {
  // Return cached identity if available
  if (_cachedIdentity) {
    return _cachedIdentity
  }
  
  // Get or create the device keypair
  const keypair: X25519KeyPair = await getOrCreateDeviceKeypair()
  
  // Derive fingerprint from public key
  const fingerprint = await deriveFingerprintFromX25519(keypair.publicKey)
  
  // Build identity
  _cachedIdentity = {
    fingerprint,
    x25519PublicKeyB64: keypair.publicKey,
    localX25519KeyId: keypair.keyId
  }
  
  console.log('[HandshakeService] Identity loaded:', {
    fingerprintShort: `${fingerprint.slice(0, 8)}…${fingerprint.slice(-8)}`,
    keyId: keypair.keyId
  })
  
  return _cachedIdentity
}

/**
 * Clear the cached identity (for testing or key rotation).
 */
export function clearIdentityCache(): void {
  _cachedIdentity = null
}


// =============================================================================
// Fingerprint Formatting (convenience re-exports)
// =============================================================================

import { formatFingerprintShort, formatFingerprintGrouped } from './fingerprint'

/**
 * Get our identity with formatted fingerprints.
 * Convenience function for UI display.
 */
export async function getOurIdentityForDisplay(): Promise<{
  fingerprint: string
  fingerprintShort: string
  fingerprintGrouped: string
  x25519PublicKeyB64: string
  localX25519KeyId: string
}> {
  const identity = await getOurIdentity()
  
  return {
    ...identity,
    fingerprintShort: formatFingerprintShort(identity.fingerprint),
    fingerprintGrouped: formatFingerprintGrouped(identity.fingerprint)
  }
}







