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
import { useBeapInboxStore } from '../beap-messages/useBeapInboxStore'
import { useWRGuardStore } from '../wrguard'
import {
  sandboxDepackage,
  isSandboxSuccess,
  isSandboxFailure,
  type SandboxDecryptOptions,
} from '../beap-messages/sandbox'
import type { SanitisedDecryptedPackage, RejectionReasonUI } from '../beap-messages/sandbox'
import { getHandshake } from '../handshake/handshakeRpc'
import { getLocalMlkemSecret } from '../handshake/mlkemHandshakeStorage'
import { parseBeapFile } from '../beap-messages/services/beapDecrypt'
import { deriveSharedSecretX25519 } from '../beap-messages/services/x25519KeyAgreement'
import { pqDecapsulate } from '../beap-messages/services/beapCrypto'

// =============================================================================
// Verification Result
// =============================================================================

/**
 * Result of a Stage 5 sandbox verification attempt.
 */
export interface VerifyImportedMessageResult {
  success: boolean
  messageId: string
  /** Non-disclosing error (safe for display). Present on failure. */
  nonDisclosingError?: string
  /** Failure stage indicator (coarse-grained, non-disclosing). */
  failureStage?: string
  /** Validated capsule data — present on success only. */
  sanitisedPackage?: SanitisedDecryptedPackage
}

// =============================================================================
// Minimal Validation (NO parsing)
// =============================================================================

/**
 * BEAP insert text header pattern (minimal check only)
 */
const BEAP_INSERT_PATTERN = /^📦\s*BEAP|^\[BEAP\]|^BEAP™|^---\s*beap/i

/**
 * BEAP package file signature (minimal check)
 * Includes header (qBEAP/pBEAP), envelope, beap
 */
const BEAP_FILE_SIGNATURE = /^{"beap"|^\{[\s\n]*"envelope"|^\{[\s\n]*"header"/

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
    } else if (source === 'messenger' || source === 'download' || source === 'p2p') {
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
      deliveryMethod: source === 'email' ? 'email' : source === 'messenger' ? 'messenger' : source === 'p2p' ? 'p2p' : 'download',
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

/** Progress phases during file import + auto-verify. */
export type ImportFileProgressPhase = 'importing' | 'verifying'

/**
 * Import from file
 *
 * After import, auto-verifies via sandbox depackaging (same flow as Electron
 * p2p_pending_beap path). Message appears in inbox when verification succeeds.
 *
 * @param file - The .beap file to import
 * @param options.onProgress - Called when phase changes (for loading UI)
 */
export async function importFromFile(
  file: File,
  options?: { onProgress?: (phase: ImportFileProgressPhase) => void }
): Promise<ImportResult> {
  try {
    options?.onProgress?.('importing')
    const rawData = await file.text()

    const importResult = await importBeapMessage(rawData, 'download', {
      originalFilename: file.name,
      mimeType: file.type
    })

    if (!importResult.success || !importResult.messageId) {
      return importResult
    }

    options?.onProgress?.('verifying')
    const verifyResult = await verifyImportedMessage(importResult.messageId, {
      handshakeId: '__file_import__'
    })

    if (verifyResult.success) {
      return importResult
    }

    return {
      success: false,
      error: verifyResult.nonDisclosingError ?? 'Verification failed'
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to read file'
    }
  }
}

// =============================================================================
// Stage 5: Sandbox Verification (Annex I §I.2 — Mandatory)
// =============================================================================

/**
 * Verify an already-imported message through the Stage 5 sandbox isolation
 * boundary (Annex I §I.2 — Normative).
 *
 * This is the MANDATORY gate between ingress (raw storage) and capsule access.
 * The host (extension renderer) NEVER touches raw capsule bytes directly —
 * all crypto operations run inside the Chrome Extension Sandboxed Page.
 *
 * Workflow:
 *   1. Retrieve raw payload from the ingress store.
 *   2. Mark message status as `'verifying'` in the UI store.
 *   3. Send payload to the sandbox via `sandboxDepackage()`.
 *   4a. On success: call `acceptMessage()` with the sanitised package.
 *   4b. On failure: call `rejectMessage()` with a non-disclosing reason.
 *
 * Per A.3.055 Stage 5:
 *   - The sandbox runs Stages 0, 2, 4, 6.1–6.3, 7 + Gates 1–6 (Canon §10).
 *   - Only a sanitised `SanitisedDecryptedPackage` crosses the boundary.
 *   - Fail-closed: if the sandbox fails, the message is rejected with no
 *     additional disclosure.
 *
 * @param messageId - The message ID from `importBeapMessage`
 * @param options   - Serialisable decryption options (handshakes, sender keys, etc.)
 */
export async function verifyImportedMessage(
  messageId: string,
  options: SandboxDecryptOptions = {}
): Promise<VerifyImportedMessageResult> {
  const { getEventsByMessageId, getPayloadByRef } = useIngressStore.getState()
  const { updateVerificationStatus, acceptMessage, rejectMessage } = useBeapMessagesStore.getState()

  // ------------------------------------------------------------------
  // Step 1: Retrieve raw payload from ingress store
  // ------------------------------------------------------------------
  const events = getEventsByMessageId(messageId)
  if (events.length === 0) {
    const reason: RejectionReasonUI = {
      code: 'STAGE5_NO_EVENT',
      humanSummary: 'Package not found in ingress store.',
      timestamp: Date.now(),
      failedStep: 'Stage 5 — Ingress lookup'
    }
    rejectMessage(messageId, reason)
    return {
      success: false,
      messageId,
      nonDisclosingError: 'Package verification failed',
      failureStage: 'INTERNAL',
    }
  }

  const latestEvent = events[events.length - 1]
  const payload = getPayloadByRef(latestEvent.rawRef)

  if (!payload) {
    const reason: RejectionReasonUI = {
      code: 'STAGE5_NO_PAYLOAD',
      humanSummary: 'Raw package data not found in ingress store.',
      timestamp: Date.now(),
      failedStep: 'Stage 5 — Payload lookup'
    }
    rejectMessage(messageId, reason)
    return {
      success: false,
      messageId,
      nonDisclosingError: 'Package verification failed',
      failureStage: 'INTERNAL',
    }
  }

  // ------------------------------------------------------------------
  // Step 2: Mark message as verifying in UI
  // ------------------------------------------------------------------
  updateVerificationStatus(messageId, 'verifying')

  // ------------------------------------------------------------------
  // Step 2b: Augment options for qBEAP (Fix A + host-side hybrid pre-decapsulation)
  // - File import: resolve handshake from package.receiver_binding.handshake_id
  // - Hybrid packages: when mlkemSecretKeyB64 available, compute hybridSharedSecretB64 in host
  // ------------------------------------------------------------------
  const augmentedOptions = await augmentVerifyOptionsForQBeap(payload.rawData, options)

  // ------------------------------------------------------------------
  // Step 3: Route to Stage 5 sandbox
  // ------------------------------------------------------------------
  let sandboxResponse
  try {
    sandboxResponse = await sandboxDepackage(payload.rawData, augmentedOptions)
  } catch (err) {
    // sandboxDepackage is designed to never throw — this is a belt-and-braces
    // catch for unexpected errors. Fail-closed.
    console.error('[Ingress] Unexpected error from sandboxDepackage:', err)
    const reason: RejectionReasonUI = {
      code: 'STAGE5_UNEXPECTED_ERROR',
      humanSummary: 'Package verification failed',
      timestamp: Date.now(),
      failedStep: 'Stage 5 — Sandbox error'
    }
    rejectMessage(messageId, reason)
    return {
      success: false,
      messageId,
      nonDisclosingError: 'Package verification failed',
      failureStage: 'INTERNAL',
    }
  }

  // ------------------------------------------------------------------
  // Step 4a: Success path
  // ------------------------------------------------------------------
  if (isSandboxSuccess(sandboxResponse)) {
    const pkg = sandboxResponse.result

    // Build UI summary from sanitised package
    const envelopeSummary = buildEnvelopeSummary(pkg)
    const capsuleMetadata = buildCapsuleMetadata(pkg)

    acceptMessage(messageId, envelopeSummary, capsuleMetadata, pkg)

    // Populate BEAP inbox store so messages appear in BeapInboxView, handshake view, bulk inbox
    if (
      pkg.allGatesPassed &&
      pkg.authorizedProcessing?.decision === 'AUTHORIZED'
    ) {
      const handshakeId = resolveHandshakeId(pkg, augmentedOptions)
      useBeapInboxStore.getState().addMessage(pkg, handshakeId)
    }

    console.log(`[Ingress] Stage 5 verification succeeded for message ${messageId}`)

    return {
      success: true,
      messageId,
      sanitisedPackage: pkg,
    }
  }

  // ------------------------------------------------------------------
  // Step 4b: Failure path — fail-closed
  // ------------------------------------------------------------------
  if (isSandboxFailure(sandboxResponse)) {
    const reason: RejectionReasonUI = {
      code: `STAGE5_${sandboxResponse.failureStage}`,
      humanSummary: sandboxResponse.nonDisclosingError,
      timestamp: Date.now(),
      failedStep: `Stage 5 — ${sandboxResponse.failureStage}`
    }
    rejectMessage(messageId, reason)

    console.warn(
      `[Ingress] Stage 5 verification failed for message ${messageId}:`,
      sandboxResponse.failureStage
    )

    return {
      success: false,
      messageId,
      nonDisclosingError: sandboxResponse.nonDisclosingError,
      failureStage: sandboxResponse.failureStage,
    }
  }

  // Should not reach here (ACK-only response) — fail-closed
  const reason: RejectionReasonUI = {
    code: 'STAGE5_UNKNOWN',
    humanSummary: 'Package verification failed',
    timestamp: Date.now(),
    failedStep: 'Stage 5 — Unknown response'
  }
  rejectMessage(messageId, reason)
  return {
    success: false,
    messageId,
    nonDisclosingError: 'Package verification failed',
    failureStage: 'INTERNAL',
  }
}

// =============================================================================
// Options Augmentation for qBEAP (Fix A + host-side hybrid pre-decapsulation)
// =============================================================================

/**
 * Augment sandbox options for qBEAP packages.
 * - File import: resolve handshake from package.receiver_binding.handshake_id, add senderX25519PublicKey
 * - Hybrid packages: when mlkemSecretKeyB64 available, compute hybridSharedSecretB64 in host (sandbox has no network)
 */
async function augmentVerifyOptionsForQBeap(
  rawData: string,
  options: SandboxDecryptOptions
): Promise<SandboxDecryptOptions> {
  const parsed = parseBeapFile(rawData)
  if (!parsed.success) return options

  const pkg = parsed.package
  if (pkg.header?.encoding !== 'qBEAP') return options

  let handshakeId = options.handshakeId
  let senderX25519PublicKey = options.senderX25519PublicKey
  let hybridSharedSecretB64 = options.hybridSharedSecretB64
  let mlkemSecretKeyB64 = options.mlkemSecretKeyB64

  // Fix A: File import — resolve handshake from package.receiver_binding.handshake_id
  if (handshakeId === '__file_import__' || handshakeId === '__email_import__') {
    const pkgHandshakeId = pkg.header.receiver_binding?.handshake_id
    if (pkgHandshakeId) {
      try {
        const hs = await getHandshake(pkgHandshakeId)
        if (hs.peerX25519PublicKey) {
          handshakeId = pkgHandshakeId
          senderX25519PublicKey = hs.peerX25519PublicKey
        }
      } catch {
        // Handshake lookup failed — continue with original options (Gate 4 will use package header fallback)
      }
    }
  }

  if (
    !mlkemSecretKeyB64?.trim() &&
    handshakeId &&
    handshakeId !== '__file_import__' &&
    handshakeId !== '__email_import__'
  ) {
    const fromStore = await getLocalMlkemSecret(handshakeId)
    if (fromStore) mlkemSecretKeyB64 = fromStore
  }

  // Host-side hybrid pre-decapsulation: sandbox cannot reach PQ service (127.0.0.1:51248)
  const pq = pkg.header.crypto?.pq
  const isHybrid = pq && typeof pq === 'object' && pq.kemCiphertextB64 && typeof pq.kemCiphertextB64 === 'string' && pq.kemCiphertextB64.length > 0
  if (isHybrid && mlkemSecretKeyB64?.trim() && !hybridSharedSecretB64) {
    const resolvedSenderKey = senderX25519PublicKey?.trim() ||
      (typeof pkg.header.crypto?.senderX25519PublicKeyB64 === 'string' ? pkg.header.crypto.senderX25519PublicKeyB64.trim() : '')
    if (resolvedSenderKey) {
      try {
        const ecdhResult = await deriveSharedSecretX25519(resolvedSenderKey)
        const decap = await pqDecapsulate(pq.kemCiphertextB64, mlkemSecretKeyB64.trim())
        const hybridSecret = new Uint8Array(decap.sharedSecretBytes.length + ecdhResult.sharedSecret.length)
        hybridSecret.set(decap.sharedSecretBytes, 0)
        hybridSecret.set(ecdhResult.sharedSecret, decap.sharedSecretBytes.length)
        hybridSharedSecretB64 = btoa(String.fromCharCode(...hybridSecret))
      } catch {
        // Pre-decapsulation failed — sandbox will try with mlkemSecretKeyB64 (will fail if no network)
      }
    }
  }

  const changed =
    handshakeId !== options.handshakeId ||
    senderX25519PublicKey !== options.senderX25519PublicKey ||
    hybridSharedSecretB64 !== options.hybridSharedSecretB64 ||
    mlkemSecretKeyB64 !== options.mlkemSecretKeyB64
  if (!changed) return options
  return { ...options, handshakeId, senderX25519PublicKey, hybridSharedSecretB64, mlkemSecretKeyB64 }
}

// =============================================================================
// Handshake Resolution
// =============================================================================

/**
 * Resolve handshakeId for inbox store. qBEAP: from options or match by sender fingerprint.
 * pBEAP / depackaged email: null.
 */
function resolveHandshakeId(
  pkg: SanitisedDecryptedPackage,
  options: SandboxDecryptOptions
): string | null {
  if (pkg.header.encoding === 'pBEAP') return null
  if (options.handshakeId) return options.handshakeId
  const fp = pkg.header.sender_fingerprint
  const match = options.handshakes?.find((h) => h.senderFingerprint === fp)
  return match?.handshakeId ?? null
}

// =============================================================================
// UI Summary Builders
// =============================================================================

/**
 * Build an `EnvelopeSummaryUI` from a sanitised package result.
 * Used to populate the inbox message display after acceptance.
 */
function buildEnvelopeSummary(pkg: SanitisedDecryptedPackage): import('../beap-messages/types').EnvelopeSummaryUI {
  const fp = pkg.header.sender_fingerprint
  return {
    envelopeIdShort: pkg.header.content_hash.slice(0, 12),
    senderFingerprintDisplay: fp.length > 12 ? `${fp.slice(0, 8)}…${fp.slice(-4)}` : fp,
    channelDisplay: pkg.metadata.delivery_method,
    ingressSummary: `Received via ${pkg.metadata.delivery_method}`,
    egressSummary: pkg.authorizedProcessing.decision === 'AUTHORIZED' ? 'Processing authorized' : 'Processing blocked',
    createdAt: pkg.metadata.created_at,
    expiryStatus: 'no_expiry',
    signatureStatusDisplay: pkg.verification.signatureValid ? 'Valid' : 'Invalid',
    hashVerificationDisplay: pkg.allGatesPassed ? 'Verified' : 'Failed',
  }
}

/**
 * Build a `CapsuleMetadataUI` from a sanitised package result.
 */
function buildCapsuleMetadata(pkg: SanitisedDecryptedPackage): import('../beap-messages/types').CapsuleMetadataUI {
  const attachments = pkg.capsule.attachments ?? []
  return {
    capsuleId: pkg.header.content_hash.slice(0, 16),
    title: pkg.capsule.subject ?? 'Untitled',
    attachmentCount: attachments.length,
    attachmentNames: attachments.map(a => a.originalName).filter(Boolean),
    sessionRefCount: 0,
    hasDataRequest: (pkg.capsule.automation?.tags?.length ?? 0) > 0,
  }
}

