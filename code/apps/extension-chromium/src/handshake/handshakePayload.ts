/**
 * Handshake Payload Serialization & Parsing
 * 
 * Utilities for serializing and parsing BEAP handshake request/accept payloads.
 * Used for wire format communication via email, messenger, or download.
 * 
 * Security: All parsing is fail-closed (returns null on any validation failure).
 * 
 * @version 1.0.0
 */

import type {
  HandshakeRequestPayload,
  HandshakeAcceptPayload,
  AutomationMode
} from './types'

// =============================================================================
// Constants
// =============================================================================

const CURRENT_VERSION = 1
const REQUEST_TYPE = 'BEAP_HANDSHAKE_REQUEST' as const
const ACCEPT_TYPE = 'BEAP_HANDSHAKE_ACCEPT' as const

// Valid automation modes for validation
const VALID_AUTOMATION_MODES: AutomationMode[] = ['DENY', 'REVIEW', 'ALLOW']

// =============================================================================
// Serialization
// =============================================================================

/**
 * Serialize a HandshakeRequestPayload to JSON string.
 * 
 * @param payload - The handshake request payload to serialize
 * @returns JSON string representation
 */
export function serializeHandshakeRequestPayload(payload: HandshakeRequestPayload): string {
  return JSON.stringify(payload, null, 2)
}

/**
 * Serialize a HandshakeAcceptPayload to JSON string.
 * 
 * @param payload - The handshake accept payload to serialize
 * @returns JSON string representation
 */
export function serializeHandshakeAcceptPayload(payload: HandshakeAcceptPayload): string {
  return JSON.stringify(payload, null, 2)
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if a value is a valid HandshakeRequestPayload.
 * 
 * Validates:
 * - type === 'BEAP_HANDSHAKE_REQUEST'
 * - version === 1
 * - Required string fields are non-empty
 * - X25519 public key is present and non-empty
 * 
 * @param x - Value to check
 * @returns true if valid HandshakeRequestPayload
 */
export function isHandshakeRequestPayload(x: unknown): x is HandshakeRequestPayload {
  if (!x || typeof x !== 'object') return false
  
  const obj = x as Record<string, unknown>
  
  // Check type discriminator
  if (obj.type !== REQUEST_TYPE) return false
  
  // Check version
  if (obj.version !== CURRENT_VERSION) return false
  
  // Required string fields must be non-empty
  if (typeof obj.senderDisplayName !== 'string' || obj.senderDisplayName.length === 0) return false
  if (typeof obj.senderFingerprint !== 'string' || obj.senderFingerprint.length === 0) return false
  if (typeof obj.senderX25519PublicKeyB64 !== 'string' || obj.senderX25519PublicKeyB64.length === 0) return false
  if (typeof obj.message !== 'string') return false // message can be empty
  
  // createdAt must be a number
  if (typeof obj.createdAt !== 'number') return false
  
  // Optional fields: check type if present
  if (obj.senderEmail !== undefined && typeof obj.senderEmail !== 'string') return false
  if (obj.senderOrganization !== undefined && typeof obj.senderOrganization !== 'string') return false
  if (obj.senderMlkem768PublicKeyB64 !== undefined && typeof obj.senderMlkem768PublicKeyB64 !== 'string') return false
  if (obj.expiresAt !== undefined && typeof obj.expiresAt !== 'number') return false
  
  return true
}

/**
 * Check if a value is a valid HandshakeAcceptPayload.
 * 
 * Validates:
 * - type === 'BEAP_HANDSHAKE_ACCEPT'
 * - version === 1
 * - Required string fields are non-empty
 * - X25519 public key is present and non-empty
 * - automationMode is valid
 * 
 * @param x - Value to check
 * @returns true if valid HandshakeAcceptPayload
 */
export function isHandshakeAcceptPayload(x: unknown): x is HandshakeAcceptPayload {
  if (!x || typeof x !== 'object') return false
  
  const obj = x as Record<string, unknown>
  
  // Check type discriminator
  if (obj.type !== ACCEPT_TYPE) return false
  
  // Check version
  if (obj.version !== CURRENT_VERSION) return false
  
  // Required string fields must be non-empty
  if (typeof obj.requestId !== 'string' || obj.requestId.length === 0) return false
  if (typeof obj.acceptorDisplayName !== 'string' || obj.acceptorDisplayName.length === 0) return false
  if (typeof obj.acceptorFingerprint !== 'string' || obj.acceptorFingerprint.length === 0) return false
  if (typeof obj.acceptorX25519PublicKeyB64 !== 'string' || obj.acceptorX25519PublicKeyB64.length === 0) return false
  
  // createdAt must be a number
  if (typeof obj.createdAt !== 'number') return false
  
  // automationMode must be valid
  if (!VALID_AUTOMATION_MODES.includes(obj.automationMode as AutomationMode)) return false
  
  // Optional fields: check type if present
  if (obj.acceptorEmail !== undefined && typeof obj.acceptorEmail !== 'string') return false
  if (obj.acceptorOrganization !== undefined && typeof obj.acceptorOrganization !== 'string') return false
  if (obj.acceptorMlkem768PublicKeyB64 !== undefined && typeof obj.acceptorMlkem768PublicKeyB64 !== 'string') return false
  
  return true
}

// =============================================================================
// Parsing
// =============================================================================

/**
 * Parse a raw JSON string into a HandshakeRequestPayload or HandshakeAcceptPayload.
 * 
 * Security: Fail-closed design.
 * - Returns null on any parse or validation error
 * - Validates type discriminator and version
 * - Validates required fields are present and non-empty
 * - Validates X25519 public key field is present
 * 
 * @param raw - Raw JSON string to parse
 * @returns Parsed payload or null if invalid
 */
export function parseHandshakePayload(
  raw: string
): HandshakeRequestPayload | HandshakeAcceptPayload | null {
  // Step 1: Safe JSON parse
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // Invalid JSON
    return null
  }
  
  // Step 2: Check if it's an object
  if (!parsed || typeof parsed !== 'object') {
    return null
  }
  
  const obj = parsed as Record<string, unknown>
  
  // Step 3: Check type discriminator and delegate to type guards
  if (obj.type === REQUEST_TYPE) {
    if (isHandshakeRequestPayload(parsed)) {
      return parsed
    }
    return null
  }
  
  if (obj.type === ACCEPT_TYPE) {
    if (isHandshakeAcceptPayload(parsed)) {
      return parsed
    }
    return null
  }
  
  // Unknown type
  return null
}

// =============================================================================
// Convenience Helpers
// =============================================================================

/**
 * Parse a raw string specifically as a HandshakeRequestPayload.
 * 
 * @param raw - Raw JSON string
 * @returns Parsed request payload or null
 */
export function parseHandshakeRequestPayload(raw: string): HandshakeRequestPayload | null {
  const payload = parseHandshakePayload(raw)
  if (payload && isHandshakeRequestPayload(payload)) {
    return payload
  }
  return null
}

/**
 * Parse a raw string specifically as a HandshakeAcceptPayload.
 * 
 * @param raw - Raw JSON string
 * @returns Parsed accept payload or null
 */
export function parseHandshakeAcceptPayload(raw: string): HandshakeAcceptPayload | null {
  const payload = parseHandshakePayload(raw)
  if (payload && isHandshakeAcceptPayload(payload)) {
    return payload
  }
  return null
}







