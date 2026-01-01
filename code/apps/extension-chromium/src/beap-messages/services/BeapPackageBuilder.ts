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

// =============================================================================
// Types
// =============================================================================

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

// =============================================================================
// Package Building
// =============================================================================

/**
 * Build a qBEAP package (Private/Encrypted)
 */
function buildQBeapPackage(config: BeapPackageConfig): BeapPackage {
  const now = Date.now()
  const recipient = config.selectedRecipient!

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
    content_hash: generateContentHash(config.messageBody, config.attachments)
  }

  // Stub: In production, encrypt payload with handshake-derived key
  const payloadPlain = JSON.stringify({
    subject: config.subject || 'BEAP™ Message',
    body: config.messageBody,
    attachments: config.attachments?.map(f => ({ name: f.name, size: f.size })) || []
  })
  const payloadEncrypted = btoa(payloadPlain) // Stub: Would be actual encryption

  const signature = generateSignature(
    JSON.stringify(header) + payloadEncrypted,
    config.senderFingerprint
  )

  const shortFp = recipient.receiver_fingerprint_short.replace(/[…\.]/g, '').slice(0, 8)
  const dateStr = new Date(now).toISOString().slice(0, 10).replace(/-/g, '')
  const filename = `beap_${dateStr}_${shortFp}.beap`

  return {
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
    subject: config.subject || 'BEAP™ Public Message',
    body: config.messageBody,
    attachments: config.attachments?.map(f => ({ name: f.name, size: f.size })) || [],
    audit_notice: 'This is a public BEAP™ package. Content is not encrypted and is fully auditable.'
  })
  const payloadEncoded = btoa(payloadPlain) // Base64 for transport, not encryption

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
    const pkg = config.recipientMode === 'private'
      ? buildQBeapPackage(config)
      : buildPBeapPackage(config)

    return {
      success: true,
      package: pkg,
      packageJson: JSON.stringify(pkg, null, 2)
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to build package'
    }
  }
}

// =============================================================================
// Delivery Actions
// =============================================================================

/**
 * Email action - Send package via email
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

  // Stub: In production, would integrate with email provider
  console.log('[BEAP Email] Sending package:', {
    to: toAddress,
    encoding: pkg.header.encoding,
    filename: pkg.metadata.filename,
    subject: config.subject || 'BEAP™ Secure Message'
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
      filename: pkg.metadata.filename
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

