/**
 * BEAP Package Registration Service
 * 
 * Handles the logic for registering packages from channel imports.
 * Enforces auto-registration rules based on handshake trust.
 * 
 * AUTO-REGISTER RULES (strict):
 * - Auto-register allowed ONLY when:
 *   1. Trusted handshake exists AND
 *   2. Handshake policy permits Full-Auto (handshake-scoped)
 * - Otherwise: require explicit user consent before registering
 * 
 * @version 1.0.0
 */

import type {
  PackageRegistrationRequest,
  PackageRegistrationResult,
  AutoRegisterCheckResult,
  AutoRegisterPolicy,
  IngressChannel
} from './types'
import { usePackageStore } from './usePackageStore'
import type { Handshake, AutomationMode } from '../handshake/types'

// =============================================================================
// Handshake Store Interface (injected to avoid circular deps)
// =============================================================================

export interface HandshakeRegistry {
  getHandshakeByFingerprint: (fingerprint: string) => Handshake | null
  getHandshakeById: (id: string) => Handshake | null
}

// =============================================================================
// Package ID Generation
// =============================================================================

/**
 * Generate a canonical package ID from envelope data
 * 
 * Uses SHA-256 hash of envelope contents to ensure:
 * - Same package from different channels gets same ID
 * - Stable, reproducible IDs
 * 
 * @param envelopeData - The envelope data to hash
 * @returns Canonical package ID in format "beap_<hash>"
 */
export async function generatePackageId(envelopeData: {
  sender_fingerprint: string | null
  recipient_fingerprint: string | null
  signature: string | null
  timestamp: number
}): Promise<string> {
  // Create deterministic string from envelope data
  const canonical = JSON.stringify({
    s: envelopeData.sender_fingerprint || '',
    r: envelopeData.recipient_fingerprint || '',
    sig: envelopeData.signature || '',
    t: envelopeData.timestamp
  })
  
  // Hash with SHA-256
  const encoder = new TextEncoder()
  const data = encoder.encode(canonical)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  
  // Convert to hex
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  
  return `beap_${hashHex}`
}

/**
 * Generate package ID synchronously (fallback using simple hash)
 */
export function generatePackageIdSync(envelopeData: {
  sender_fingerprint: string | null
  recipient_fingerprint: string | null
  signature: string | null
  timestamp: number
}): string {
  // Simple hash fallback for synchronous contexts
  const canonical = JSON.stringify({
    s: envelopeData.sender_fingerprint || '',
    r: envelopeData.recipient_fingerprint || '',
    sig: envelopeData.signature || '',
    t: envelopeData.timestamp
  })
  
  // Simple hash (djb2 algorithm)
  let hash = 5381
  for (let i = 0; i < canonical.length; i++) {
    hash = ((hash << 5) + hash) + canonical.charCodeAt(i)
    hash = hash >>> 0 // Convert to unsigned
  }
  
  return `beap_${hash.toString(16).padStart(16, '0')}`
}

// =============================================================================
// Auto-Registration Check
// =============================================================================

/**
 * Check if a package should be auto-registered
 * 
 * STRICT RULES:
 * - Auto-register ONLY when:
 *   1. Trusted handshake exists (verified or local)
 *   2. Handshake automation_mode is 'ALLOW' (Full-Auto)
 * - All other cases require explicit user consent
 * 
 * @param senderFingerprint - Sender's fingerprint from envelope
 * @param handshakeRegistry - Registry to look up handshakes
 * @returns Check result with decision and reason
 */
export function checkAutoRegister(
  senderFingerprint: string | null,
  handshakeRegistry: HandshakeRegistry | null
): AutoRegisterCheckResult {
  // No sender fingerprint - cannot auto-register
  if (!senderFingerprint) {
    return {
      allowed: false,
      reason: 'No sender fingerprint - cannot verify sender',
      handshake_id: null,
      policy: 'deny'
    }
  }
  
  // No handshake registry - cannot check trust
  if (!handshakeRegistry) {
    return {
      allowed: false,
      reason: 'Handshake registry not available',
      handshake_id: null,
      policy: 'deny'
    }
  }
  
  // Look up handshake by fingerprint
  const handshake = handshakeRegistry.getHandshakeByFingerprint(senderFingerprint)
  
  // No handshake found - unknown sender
  if (!handshake) {
    return {
      allowed: false,
      reason: 'Unknown sender - no handshake found',
      handshake_id: null,
      policy: 'deny'
    }
  }
  
  // Map automation_mode to AutoRegisterPolicy
  const policyMap: Record<AutomationMode, AutoRegisterPolicy> = {
    'DENY': 'deny',
    'REVIEW': 'review',
    'ALLOW': 'full-auto'
  }
  
  const policy = policyMap[handshake.automation_mode]
  
  // Check if Full-Auto is permitted
  if (handshake.automation_mode !== 'ALLOW') {
    return {
      allowed: false,
      reason: `Handshake policy is ${handshake.automation_mode} - requires consent`,
      handshake_id: handshake.id,
      policy
    }
  }
  
  // All checks passed - auto-registration allowed
  return {
    allowed: true,
    reason: 'Trusted handshake with Full-Auto policy',
    handshake_id: handshake.id,
    policy: 'full-auto'
  }
}

// =============================================================================
// Registration Service
// =============================================================================

/**
 * Register a package from a channel import
 * 
 * This is the main entry point for channel-native imports.
 * It handles:
 * 1. Package ID generation/deduplication
 * 2. Auto-registration check
 * 3. Creating or linking to canonical package
 * 4. Creating ingress event
 * 
 * @param request - Registration request with envelope and capsule data
 * @param handshakeRegistry - Registry to check handshake trust
 * @returns Registration result
 */
export function registerPackageFromChannel(
  request: Omit<PackageRegistrationRequest, 'package_id'> & { package_id?: string },
  handshakeRegistry: HandshakeRegistry | null
): PackageRegistrationResult {
  const store = usePackageStore.getState()
  
  // Generate package ID if not provided
  const packageId = request.package_id || generatePackageIdSync(request.envelope_data)
  
  // Check if package already exists
  if (store.hasPackage(packageId)) {
    // Package exists - just add event and return existing
    const fullRequest: PackageRegistrationRequest = {
      ...request,
      package_id: packageId
    }
    
    // Use a permissive check since package already exists
    const autoCheck: AutoRegisterCheckResult = {
      allowed: true,
      reason: 'Package already registered',
      handshake_id: store.getPackage(packageId)?.handshake_id || null,
      policy: 'full-auto'
    }
    
    return store.registerPackage(fullRequest, autoCheck)
  }
  
  // Check auto-registration rules
  const autoCheck = checkAutoRegister(
    request.envelope_data.sender_fingerprint,
    handshakeRegistry
  )
  
  const fullRequest: PackageRegistrationRequest = {
    ...request,
    package_id: packageId
  }
  
  // Register (will either create package or queue for consent)
  return store.registerPackage(fullRequest, autoCheck)
}

/**
 * Accept a package that was queued for consent
 * 
 * @param packageId - ID of the pending package
 * @returns Registration result
 */
export function acceptPendingPackage(packageId: string): PackageRegistrationResult {
  const store = usePackageStore.getState()
  return store.acceptPendingPackage(packageId)
}

/**
 * Reject a package that was queued for consent
 * 
 * @param packageId - ID of the pending package
 * @param reason - Reason for rejection
 * @returns Whether rejection succeeded
 */
export function rejectPendingPackage(packageId: string, reason: string): boolean {
  const store = usePackageStore.getState()
  return store.rejectPendingPackage(packageId, reason)
}

// =============================================================================
// Channel Import Helpers
// =============================================================================

/**
 * Import a package from Gmail
 */
export function importFromGmail(params: {
  messageId: string
  rawRef: string
  senderFingerprint: string | null
  subject: string
  preview: string | null
  capsuleRef: string
  timestamp: number
}, handshakeRegistry: HandshakeRegistry | null): PackageRegistrationResult {
  return registerPackageFromChannel({
    envelope_data: {
      sender_fingerprint: senderFingerprint,
      recipient_fingerprint: null,
      signature: null,
      timestamp: params.timestamp
    },
    capsule_ref: params.capsuleRef,
    channel: 'gmail',
    site: 'mail.google.com',
    raw_ref: params.rawRef,
    channel_message_id: params.messageId,
    subject: params.subject,
    preview: params.preview
  }, handshakeRegistry)
  
  // Fix: use params.senderFingerprint
  function senderFingerprint() { return params.senderFingerprint }
}

/**
 * Import a package from Outlook
 */
export function importFromOutlook(params: {
  conversationId: string
  rawRef: string
  senderFingerprint: string | null
  subject: string
  preview: string | null
  capsuleRef: string
  timestamp: number
  site: string
}, handshakeRegistry: HandshakeRegistry | null): PackageRegistrationResult {
  return registerPackageFromChannel({
    envelope_data: {
      sender_fingerprint: params.senderFingerprint,
      recipient_fingerprint: null,
      signature: null,
      timestamp: params.timestamp
    },
    capsule_ref: params.capsuleRef,
    channel: 'outlook',
    site: params.site,
    raw_ref: params.rawRef,
    channel_message_id: params.conversationId,
    subject: params.subject,
    preview: params.preview
  }, handshakeRegistry)
}

/**
 * Import a package from file download
 */
export function importFromDownload(params: {
  filename: string
  rawRef: string
  senderFingerprint: string | null
  subject: string
  preview: string | null
  capsuleRef: string
  timestamp: number
}, handshakeRegistry: HandshakeRegistry | null): PackageRegistrationResult {
  return registerPackageFromChannel({
    envelope_data: {
      sender_fingerprint: params.senderFingerprint,
      recipient_fingerprint: null,
      signature: null,
      timestamp: params.timestamp
    },
    capsule_ref: params.capsuleRef,
    channel: 'download',
    site: null,
    raw_ref: params.rawRef,
    channel_message_id: params.filename,
    subject: params.subject,
    preview: params.preview
  }, handshakeRegistry)
}

/**
 * Import a package from web messenger
 */
export function importFromWebMessenger(params: {
  messageId: string
  rawRef: string
  senderFingerprint: string | null
  subject: string
  preview: string | null
  capsuleRef: string
  timestamp: number
  site: string
}, handshakeRegistry: HandshakeRegistry | null): PackageRegistrationResult {
  return registerPackageFromChannel({
    envelope_data: {
      sender_fingerprint: params.senderFingerprint,
      recipient_fingerprint: null,
      signature: null,
      timestamp: params.timestamp
    },
    capsule_ref: params.capsuleRef,
    channel: 'web-messenger',
    site: params.site,
    raw_ref: params.rawRef,
    channel_message_id: params.messageId,
    subject: params.subject,
    preview: params.preview
  }, handshakeRegistry)
}



