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

import type {
  HandshakeRequestPayload,
  HandshakeAcceptPayload,
  AutomationMode
} from './types'
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

/**
 * Input for creating a handshake request payload.
 */
export interface CreateHandshakeRequestInput {
  /** Display name to include in request */
  senderDisplayName: string
  
  /** Email address (optional) */
  senderEmail?: string
  
  /** Organization (optional) */
  senderOrganization?: string
  
  /** Human-readable message to recipient */
  message: string
  
  /** Expiration time in ms from now (optional, default: 7 days) */
  expiresInMs?: number
}

/**
 * Acceptor info for creating accept payload.
 */
export interface AcceptorInfo {
  /** Display name */
  acceptorDisplayName: string
  
  /** Email (optional) */
  acceptorEmail?: string
  
  /** Organization (optional) */
  acceptorOrganization?: string
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
// Payload Creation
// =============================================================================

/**
 * Create a handshake request payload with real X25519 keys.
 * 
 * Uses the device's stable identity (not mock fingerprints).
 * 
 * @param input - Request input with display name, message, etc.
 * @returns HandshakeRequestPayload ready for serialization
 */
export async function createHandshakeRequestPayload(
  input: CreateHandshakeRequestInput
): Promise<HandshakeRequestPayload> {
  // Get our stable identity
  const identity = await getOurIdentity()
  
  const now = Date.now()
  
  // Default expiration: 7 days
  const defaultExpiresInMs = 7 * 24 * 60 * 60 * 1000
  const expiresAt = input.expiresInMs !== undefined
    ? now + input.expiresInMs
    : now + defaultExpiresInMs
  
  const payload: HandshakeRequestPayload = {
    type: 'BEAP_HANDSHAKE_REQUEST',
    version: 1,
    senderDisplayName: input.senderDisplayName,
    senderFingerprint: identity.fingerprint,
    senderX25519PublicKeyB64: identity.x25519PublicKeyB64,
    message: input.message,
    createdAt: now,
    expiresAt
  }
  
  // Add optional fields if provided
  if (input.senderEmail) {
    payload.senderEmail = input.senderEmail
  }
  if (input.senderOrganization) {
    payload.senderOrganization = input.senderOrganization
  }
  
  // ML-KEM: Not included for now (Electron-only, optional)
  // Future: payload.senderMlkem768PublicKeyB64 = ...
  
  console.log('[HandshakeService] Created request payload:', {
    senderDisplayName: payload.senderDisplayName,
    fingerprintShort: `${payload.senderFingerprint.slice(0, 8)}…${payload.senderFingerprint.slice(-8)}`,
    hasX25519Key: !!payload.senderX25519PublicKeyB64
  })
  
  return payload
}

/**
 * Create a handshake accept payload in response to a request.
 * 
 * Uses the device's stable identity (not mock fingerprints).
 * 
 * @param requestPayload - The original request we're accepting
 * @param acceptorInfo - Info about the acceptor (display name, email, org)
 * @param automationMode - Chosen automation mode for this handshake
 * @returns HandshakeAcceptPayload ready for serialization
 */
export async function createHandshakeAcceptPayload(
  requestPayload: HandshakeRequestPayload,
  acceptorInfo: AcceptorInfo,
  automationMode: AutomationMode
): Promise<HandshakeAcceptPayload> {
  // Get our stable identity
  const identity = await getOurIdentity()
  
  const now = Date.now()
  
  // Generate a request ID based on the original request
  // Use sender fingerprint + createdAt to create a deterministic ID
  const requestIdSource = `${requestPayload.senderFingerprint}:${requestPayload.createdAt}`
  const requestIdBytes = new TextEncoder().encode(requestIdSource)
  const requestIdHash = await sha256Hex(requestIdBytes)
  const requestId = `req_${requestIdHash.slice(0, 16)}`
  
  const payload: HandshakeAcceptPayload = {
    type: 'BEAP_HANDSHAKE_ACCEPT',
    version: 1,
    requestId,
    acceptorDisplayName: acceptorInfo.acceptorDisplayName,
    acceptorFingerprint: identity.fingerprint,
    acceptorX25519PublicKeyB64: identity.x25519PublicKeyB64,
    automationMode,
    createdAt: now
  }
  
  // Add optional fields if provided
  if (acceptorInfo.acceptorEmail) {
    payload.acceptorEmail = acceptorInfo.acceptorEmail
  }
  if (acceptorInfo.acceptorOrganization) {
    payload.acceptorOrganization = acceptorInfo.acceptorOrganization
  }
  
  // ML-KEM: Not included for now (Electron-only, optional)
  // Future: payload.acceptorMlkem768PublicKeyB64 = ...
  
  console.log('[HandshakeService] Created accept payload:', {
    requestId: payload.requestId,
    acceptorDisplayName: payload.acceptorDisplayName,
    fingerprintShort: `${payload.acceptorFingerprint.slice(0, 8)}…${payload.acceptorFingerprint.slice(-8)}`,
    automationMode: payload.automationMode,
    hasX25519Key: !!payload.acceptorX25519PublicKeyB64
  })
  
  return payload
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






