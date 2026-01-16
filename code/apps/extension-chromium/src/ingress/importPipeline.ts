/**
 * Import Pipeline
 * 
 * Functions for importing BEAP messages through the three ingress paths.
 * Creates canonical Inbox items + ingressEvent records.
 * 
 * NO decryption, NO parsing, NO rendering at import time.
 * NO remote identity resolution (local-only).
 * 
 * @version 1.0.0
 */

import type {
  IngressSource,
  IdentityHint,
  RawEnvelopeData,
  RawCapsuleRef,
  ImportPayload,
  IngressEvent,
  InboxImportItem,
  ImportResult,
  ValidationResult,
  EmailCandidate
} from './types'
import { useIngressStore } from './useIngressStore'
import { useBeapMessagesStore } from '../beap-messages/useBeapMessagesStore'
import { useWRGuardStore } from '../wrguard'

// =============================================================================
// Minimal Validation (NO parsing)
// =============================================================================

/**
 * BEAP insert text header pattern (minimal check only)
 */
const BEAP_INSERT_PATTERN = /^📦\s*BEAP|^\[BEAP\]|^BEAP™|^---\s*beap/i

/**
 * BEAP package file signature (minimal check)
 */
const BEAP_FILE_SIGNATURE = /^{"beap"|^\{[\s\n]*"envelope"/

/**
 * Validate import payload with minimal parsing
 * Only checks format, does NOT parse content
 */
export function validateImportPayload(
  rawData: string,
  source: IngressSource
): ValidationResult {
  if (!rawData || rawData.trim().length === 0) {
    return {
      valid: false,
      error: 'Empty payload'
    }
  }
  
  const trimmed = rawData.trim()
  
  // Check for BEAP insert text format (messenger)
  if (BEAP_INSERT_PATTERN.test(trimmed)) {
    return {
      valid: true,
      formatHint: 'beap-insert',
      envelopeHint: extractEnvelopeHint(trimmed),
      capsuleHint: extractCapsuleHint(trimmed)
    }
  }
  
  // Check for BEAP package JSON format (file/download)
  if (BEAP_FILE_SIGNATURE.test(trimmed)) {
    return {
      valid: true,
      formatHint: 'beap-package',
      envelopeHint: extractEnvelopeHint(trimmed),
      capsuleHint: extractCapsuleHint(trimmed)
    }
  }
  
  // For email, be more lenient - accept if it has any BEAP markers
  if (source === 'email') {
    if (trimmed.toLowerCase().includes('beap') || trimmed.includes('📦')) {
      return {
        valid: true,
        formatHint: 'unknown',
        envelopeHint: extractEnvelopeHint(trimmed),
        capsuleHint: extractCapsuleHint(trimmed)
      }
    }
  }
  
  return {
    valid: false,
    error: 'Content does not appear to be a valid BEAP package'
  }
}

/**
 * Extract envelope hints WITHOUT full parsing
 */
function extractEnvelopeHint(rawData: string): Partial<RawEnvelopeData> {
  const hints: Partial<RawEnvelopeData> = {
    signatureStatus: 'unknown'
  }
  
  // Try to extract envelope ID if visible
  const envelopeIdMatch = rawData.match(/"envelopeId":\s*"([^"]+)"/i)
  if (envelopeIdMatch) {
    hints.envelopeId = envelopeIdMatch[1]
  }
  
  // Try to extract fingerprint if visible
  const fingerprintMatch = rawData.match(/"senderFingerprint":\s*"([^"]+)"/i)
    || rawData.match(/fingerprint[:\s]+([A-F0-9]{8,})/i)
  if (fingerprintMatch) {
    hints.senderFingerprint = fingerprintMatch[1]
  }
  
  // Check for signature presence
  if (rawData.includes('"signature"') || rawData.includes('Signature:')) {
    hints.signatureStatus = 'present'
  }
  
  return hints
}

/**
 * Extract capsule hints WITHOUT full parsing
 */
function extractCapsuleHint(rawData: string): Partial<RawCapsuleRef> {
  const hints: Partial<RawCapsuleRef> = {}
  
  // Try to extract capsule ID if visible
  const capsuleIdMatch = rawData.match(/"capsuleId":\s*"([^"]+)"/i)
  if (capsuleIdMatch) {
    hints.capsuleId = capsuleIdMatch[1]
  }
  
  // Try to extract title/subject hint
  const titleMatch = rawData.match(/"title":\s*"([^"]+)"/i)
    || rawData.match(/Subject:\s*(.+)/i)
  if (titleMatch) {
    hints.titleHint = titleMatch[1].substring(0, 100)
  }
  
  // Count attachment hints
  const attachmentMatches = rawData.match(/"attachments":\s*\[/gi)
  if (attachmentMatches) {
    // Try to count items
    const countMatch = rawData.match(/"attachments":\s*\[([\s\S]*?)\]/i)
    if (countMatch) {
      const commaCount = (countMatch[1].match(/},/g) || []).length
      hints.attachmentCountHint = commaCount + (countMatch[1].includes('{') ? 1 : 0)
    }
  }
  
  return hints
}

// =============================================================================
// Core Import Function
// =============================================================================

/**
 * Import a BEAP message from any source
 * Creates canonical Inbox item + ingressEvent record
 * 
 * NO decryption, NO parsing, NO rendering
 */
export async function importBeapMessage(
  rawData: string,
  source: IngressSource,
  options?: {
    emailProviderId?: string
    emailSender?: string
    originalFilename?: string
    mimeType?: string
  }
): Promise<ImportResult> {
  try {
    // Step 1: Validate (minimal, no parsing)
    const validation = validateImportPayload(rawData, source)
    if (!validation.valid) {
      return {
        success: false,
        error: validation.error || 'Invalid payload'
      }
    }
    
    // Step 2: Generate IDs
    const messageId = `msg_${crypto.randomUUID().slice(0, 8)}`
    const payloadId = `payload_${crypto.randomUUID().slice(0, 8)}`
    const eventId = `event_${crypto.randomUUID().slice(0, 8)}`
    const rawRef = `payload:${payloadId}`
    
    // Step 3: Store raw payload
    const payload: ImportPayload = {
      payloadId,
      rawData,
      mimeType: options?.mimeType,
      originalFilename: options?.originalFilename,
      size: new Blob([rawData]).size,
      storedAt: Date.now()
    }
    useIngressStore.getState().storePayload(payload)
    
    // Step 4: Create ingress event
    const event: IngressEvent = {
      eventId,
      messageId,
      source,
      timestamp: Date.now(),
      rawRef,
      emailProviderId: options?.emailProviderId,
      emailSender: options?.emailSender
    }
    useIngressStore.getState().addEvent(event)
    
    // Step 5: Build identity hint (local-only, NO remote resolution)
    let identityHint: IdentityHint = 'unknown'
    if (source === 'email' && options?.emailSender) {
      identityHint = `email:${options.emailSender}`
    } else if (source === 'messenger' || source === 'download') {
      identityHint = 'local'
    }
    
    // Step 6: Build envelope data from hints (NO full parsing)
    const envelope: RawEnvelopeData = {
      envelopeId: validation.envelopeHint?.envelopeId || crypto.randomUUID(),
      signatureStatus: validation.envelopeHint?.signatureStatus || 'unknown',
      senderFingerprint: validation.envelopeHint?.senderFingerprint,
      ingressChannel: source,
      createdAt: Date.now()
    }
    
    // Step 7: Build capsule reference (NO parsing)
    const capsuleRef: RawCapsuleRef = {
      capsuleId: validation.capsuleHint?.capsuleId || crypto.randomUUID(),
      titleHint: validation.capsuleHint?.titleHint,
      attachmentCountHint: validation.capsuleHint?.attachmentCountHint
    }
    
    // Step 8: Create inbox item via store
    const { importMessage } = useBeapMessagesStore.getState()
    
    importMessage({
      id: messageId,
      folder: 'inbox',
      fingerprint: envelope.senderFingerprint
        ? envelope.senderFingerprint.slice(0, 12) + '...'
        : '—',
      fingerprintFull: envelope.senderFingerprint,
      deliveryMethod: source === 'email' ? 'email' : source === 'messenger' ? 'messenger' : 'download',
      title: capsuleRef.titleHint || `Imported Package (${source})`,
      timestamp: Date.now(),
      bodyText: '[Encrypted - Verification Required]',
      attachments: Array(capsuleRef.attachmentCountHint || 0).fill(null).map((_, i) => ({
        name: `Attachment ${i + 1}`,
        type: 'unknown'
      })),
      status: 'pending_verification',
      verificationStatus: 'pending_verification',
      direction: 'inbound',
      channelSite: source === 'email' ? options?.emailSender : undefined,
      incomingMessageRef: messageId
    })
    
    console.log(`[Ingress] Imported message ${messageId} from ${source}`)
    
    return {
      success: true,
      messageId,
      eventId
    }
    
  } catch (error) {
    console.error('[Ingress] Import failed:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Import failed'
    }
  }
}

// =============================================================================
// Email Import
// =============================================================================

/**
 * Check if email import is available
 */
export function isEmailImportAvailable(): { available: boolean; reason?: string } {
  const { getConnectedProviders } = useWRGuardStore.getState()
  const providers = getConnectedProviders()
  
  if (providers.length === 0) {
    return {
      available: false,
      reason: 'No email provider connected. Configure providers in WRGuard.'
    }
  }
  
  return { available: true }
}

/**
 * Get stub email candidates (simulated)
 * In production, this would fetch from real email provider
 */
export async function getEmailCandidates(
  providerId: string
): Promise<EmailCandidate[]> {
  // Stub implementation - returns sample candidates
  await new Promise(resolve => setTimeout(resolve, 500)) // Simulate network
  
  return [
    {
      emailId: `email_${crypto.randomUUID().slice(0, 8)}`,
      providerId,
      sender: 'alice@example.com',
      subject: 'BEAP™ Secure Package - Q4 Review',
      receivedAt: Date.now() - 1000 * 60 * 30,
      hasBeapContent: true,
      preview: '📦 BEAP Package attached. Please verify and review...'
    },
    {
      emailId: `email_${crypto.randomUUID().slice(0, 8)}`,
      providerId,
      sender: 'bob@company.org',
      subject: '[BEAP] Contract Draft for Review',
      receivedAt: Date.now() - 1000 * 60 * 60 * 2,
      hasBeapContent: true,
      preview: 'Attached is the encrypted contract draft...'
    },
    {
      emailId: `email_${crypto.randomUUID().slice(0, 8)}`,
      providerId,
      sender: 'team@partner.io',
      subject: 'Weekly Status Update - BEAP Encrypted',
      receivedAt: Date.now() - 1000 * 60 * 60 * 24,
      hasBeapContent: true,
      preview: 'Find the encrypted status report attached...'
    }
  ]
}

/**
 * Import from email (stub)
 */
export async function importFromEmail(
  emailId: string,
  providerId: string,
  sender: string,
  subject: string
): Promise<ImportResult> {
  // Stub: Generate a sample BEAP package payload
  const stubPayload = JSON.stringify({
    beap: '1.0',
    envelope: {
      envelopeId: crypto.randomUUID(),
      signatureStatus: 'present',
      senderFingerprint: crypto.randomUUID().toUpperCase().replace(/-/g, ''),
      ingressDeclarations: [
        { type: 'handshake', source: sender, verified: true }
      ],
      egressDeclarations: [
        { type: 'none', target: 'local-only', required: false }
      ]
    },
    capsule: {
      capsuleId: crypto.randomUUID(),
      title: subject,
      attachmentCount: Math.floor(Math.random() * 3)
    },
    encrypted: '[encrypted-content]'
  })
  
  return importBeapMessage(stubPayload, 'email', {
    emailProviderId: providerId,
    emailSender: sender
  })
}

// =============================================================================
// Messenger Import
// =============================================================================

/**
 * Import from messenger paste
 */
export async function importFromMessenger(
  pastedText: string
): Promise<ImportResult> {
  return importBeapMessage(pastedText, 'messenger')
}

// =============================================================================
// Download/File Import
// =============================================================================

/**
 * Import from file
 */
export async function importFromFile(
  file: File
): Promise<ImportResult> {
  try {
    const rawData = await file.text()
    
    return importBeapMessage(rawData, 'download', {
      originalFilename: file.name,
      mimeType: file.type
    })
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to read file'
    }
  }
}

