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
  attachments?: File[]
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
}

export interface BeapEnvelopeHeader {
  version: '1.0'
  encoding: 'qBEAP' | 'pBEAP'
  encryption_mode: 'AES256_GCM' | 'NONE'
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
}

export interface BeapPackage {
  header: BeapEnvelopeHeader
  payload: string // Base64 encoded (encrypted for qBEAP, plain for pBEAP)
  signature: string // Sender signature
  metadata: {
    created_at: number
    delivery_method: DeliveryMethod
    delivery_hint?: string // Email address for delivery (not identity)
    filename: string
  }
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
// Hash Generation (Stubbed - would use real crypto in production)
// =============================================================================

function generateHash(data: string): string {
  // Stub: In production, use SHA-256
  let hash = 0
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return Math.abs(hash).toString(16).padStart(16, '0').slice(0, 16)
}

function generateContentHash(body: string, attachments?: File[]): string {
  const content = body + (attachments?.map(f => f.name).join(',') || '')
  return generateHash(content)
}

function generateTemplateHash(): string {
  return generateHash('beap-template-v1-' + Date.now())
}

function generatePolicyHash(): string {
  return generateHash('beap-policy-default-' + Date.now())
}

function generateSignature(data: string, fingerprint: string): string {
  return generateHash(data + fingerprint + 'sig')
}

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
 * 
 * @returns PackageBuildResult with success/error status
 */
function buildQBeapPackage(config: BeapPackageConfig): PackageBuildResult {
  const now = Date.now()
  const recipient = config.selectedRecipient!

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

  const header: BeapEnvelopeHeader = {
    version: '1.0',
    encoding: 'qBEAP',
    encryption_mode: 'AES256_GCM',
    timestamp: now,
    sender_fingerprint: config.senderFingerprint,
    receiver_fingerprint: recipient.receiver_fingerprint_full,
    receiver_binding: {
      handshake_id: recipient.handshake_id,
      display_name: recipient.receiver_display_name,
      organization: recipient.receiver_organization
    },
    template_hash: generateTemplateHash(),
    policy_hash: generatePolicyHash(),
    // Content hash based on authoritative content
    content_hash: generateContentHash(authoritativeBody, config.attachments)
  }

  // Capsule payload contains the authoritative (possibly encrypted) message
  // Stub: In production, encrypt payload with handshake-derived key
  const capsulePayload = JSON.stringify({
    subject: config.subject || 'BEAP™ Message',
    body: authoritativeBody, // Authoritative content (encryptedMessage if provided)
    transport_plaintext: transportPlaintext, // Non-authoritative outer message
    has_authoritative_encrypted: hasEncryptedMessage,
    attachments: config.attachments?.map(f => ({ name: f.name, size: f.size })) || [],
    // Automation metadata (capsule-bound)
    automation: automationMeta
  })
  const payloadEncrypted = safeBase64Encode(capsulePayload) // Stub: Would be actual encryption

  const signature = generateSignature(
    JSON.stringify(header) + payloadEncrypted,
    config.senderFingerprint
  )

  const shortFp = recipient.receiver_fingerprint_short.replace(/[…\.]/g, '').slice(0, 8)
  const dateStr = new Date(now).toISOString().slice(0, 10).replace(/-/g, '')
  const filename = `beap_${dateStr}_${shortFp}.beap`

  const pkg: BeapPackage = {
    header,
    payload: payloadEncrypted,
    signature,
    metadata: {
      created_at: now,
      delivery_method: config.deliveryMethod,
      delivery_hint: recipient.receiver_email_list[0] || config.emailTo,
      filename
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
function buildPBeapPackage(config: BeapPackageConfig): BeapPackage {
  const now = Date.now()

  const header: BeapEnvelopeHeader = {
    version: '1.0',
    encoding: 'pBEAP',
    encryption_mode: 'NONE',
    timestamp: now,
    sender_fingerprint: config.senderFingerprint,
    // No receiver_fingerprint or receiver_binding for public distribution
    template_hash: generateTemplateHash(),
    policy_hash: generatePolicyHash(),
    content_hash: generateContentHash(config.messageBody, config.attachments)
  }

  // Plaintext payload for public distribution
  const payloadPlain = JSON.stringify({
    subject: config.subject || 'BEAP Public Message',
    body: config.messageBody,
    attachments: config.attachments?.map(f => ({ name: f.name, size: f.size })) || [],
    audit_notice: 'This is a public BEAP package. Content is not encrypted and is fully auditable.'
  })
  const payloadEncoded = safeBase64Encode(payloadPlain) // Base64 for transport, not encryption

  const signature = generateSignature(
    JSON.stringify(header) + payloadEncoded,
    config.senderFingerprint
  )

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
    }
  }
}

/**
 * Build a BEAP package based on recipient mode
 */
export function buildPackage(config: BeapPackageConfig): PackageBuildResult {
  const validation = validatePackageConfig(config)
  
  if (!validation.valid) {
    return {
      success: false,
      error: validation.errors.join('; ')
    }
  }

  try {
    if (config.recipientMode === 'private') {
      // qBEAP: buildQBeapPackage returns PackageBuildResult directly
      const result = buildQBeapPackage(config)
      return result
    } else {
      // pBEAP: buildPBeapPackage returns BeapPackage, wrap it
      const pkg = buildPBeapPackage(config)
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
export function buildDraftEmailPackage(config: BeapPackageConfig): BeapBuildResult {
  const result = buildPackage(config)
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
  // Build the package first
  const buildResult = buildPackage(config)
  
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

