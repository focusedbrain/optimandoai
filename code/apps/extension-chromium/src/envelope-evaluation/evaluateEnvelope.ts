/**
 * Envelope Evaluation Logic
 * 
 * Deterministic, fail-closed evaluation of incoming BEAP messages.
 * 
 * Evaluation order (canonical - MUST be enforced):
 * 1. Envelope verification (integrity + identity metadata)
 * 2. Envelope-declared ingress/egress boundaries
 * 3. Intersection with local WRGuard configuration
 * 
 * If any step fails → message is Rejected with a reason.
 * No previewing, parsing, decrypting, rendering, or executing
 * the capsule is permitted before envelope verification completes.
 * 
 * @version 1.0.0
 */

import type {
  BeapEnvelope,
  CapsuleMetadata,
  EvaluationResult,
  RejectionReason,
  RejectionCode,
  EnvelopeSummaryDisplay,
  IncomingBeapMessage
} from './types'
import { useWRGuardStore } from '../wrguard'

// =============================================================================
// Step 1: Envelope Verification
// =============================================================================

interface EnvelopeVerificationResult {
  passed: boolean
  rejectionReason?: RejectionReason
}

/**
 * Verify envelope integrity and identity metadata (stub implementation)
 * 
 * Checks:
 * - envelopeHash field exists
 * - signatureStatus flag is valid
 * - declared ingress and egress fields exist
 * 
 * NOTE: This is a stub - no real cryptography is implemented here.
 */
function verifyEnvelope(envelope: BeapEnvelope): EnvelopeVerificationResult {
  // Check envelope hash exists
  if (!envelope.envelopeHash) {
    return {
      passed: false,
      rejectionReason: createRejection(
        'envelope_hash_missing',
        'Envelope hash is missing. Message integrity cannot be verified.',
        'The envelope does not contain a hash field required for integrity verification.',
        'envelope_verification'
      )
    }
  }
  
  // Check signature status (stub - treat missing/invalid as failure)
  if (!envelope.signatureStatus || envelope.signatureStatus === 'invalid') {
    return {
      passed: false,
      rejectionReason: createRejection(
        envelope.signatureStatus === 'invalid' ? 'signature_invalid' : 'signature_missing',
        envelope.signatureStatus === 'invalid'
          ? 'Envelope signature is invalid. Message authenticity cannot be verified.'
          : 'Envelope signature is missing. Message authenticity cannot be verified.',
        `Signature status: ${envelope.signatureStatus || 'not present'}`,
        'envelope_verification'
      )
    }
  }
  
  // Check ingress declarations exist
  if (!envelope.ingressDeclarations || envelope.ingressDeclarations.length === 0) {
    return {
      passed: false,
      rejectionReason: createRejection(
        'ingress_missing',
        'Ingress declarations are missing. Cannot determine message origin.',
        'The envelope does not declare any ingress sources.',
        'envelope_verification'
      )
    }
  }
  
  // Check egress declarations exist
  if (!envelope.egressDeclarations || envelope.egressDeclarations.length === 0) {
    return {
      passed: false,
      rejectionReason: createRejection(
        'egress_missing',
        'Egress declarations are missing. Cannot determine execution boundaries.',
        'The envelope does not declare any egress destinations.',
        'envelope_verification'
      )
    }
  }
  
  // Check expiry
  if (envelope.expiresAt && envelope.expiresAt < Date.now()) {
    return {
      passed: false,
      rejectionReason: createRejection(
        'envelope_expired',
        'Envelope has expired. Message is no longer valid.',
        `Expired at: ${new Date(envelope.expiresAt).toISOString()}`,
        'envelope_verification'
      )
    }
  }
  
  return { passed: true }
}

// =============================================================================
// Step 2: Boundary Check
// =============================================================================

interface BoundaryCheckResult {
  passed: boolean
  rejectionReason?: RejectionReason
}

/**
 * Check envelope-declared ingress/egress boundaries
 * 
 * Ensures the declared boundaries are structurally valid.
 */
function checkBoundaries(envelope: BeapEnvelope): BoundaryCheckResult {
  // Validate ingress declarations have required fields
  for (const ingress of envelope.ingressDeclarations) {
    if (!ingress.type || !ingress.source) {
      return {
        passed: false,
        rejectionReason: createRejection(
          'ingress_missing',
          'Invalid ingress declaration structure.',
          `Ingress declaration missing type or source: ${JSON.stringify(ingress)}`,
          'boundary_check'
        )
      }
    }
  }
  
  // Validate egress declarations have required fields
  for (const egress of envelope.egressDeclarations) {
    if (!egress.type || !egress.target) {
      return {
        passed: false,
        rejectionReason: createRejection(
          'egress_missing',
          'Invalid egress declaration structure.',
          `Egress declaration missing type or target: ${JSON.stringify(egress)}`,
          'boundary_check'
        )
      }
    }
  }
  
  return { passed: true }
}

// =============================================================================
// Step 3: WRGuard Intersection
// =============================================================================

interface WRGuardIntersectionResult {
  passed: boolean
  rejectionReason?: RejectionReason
}

/**
 * Evaluate envelope against local WRGuard configuration
 * 
 * Checks:
 * 1. Provider requirement (for email channel)
 * 2. Protected Sites requirement (for web egress)
 * 3. Ingress requirement (local posture)
 * 
 * Local WRGuard config is authoritative for acceptance into Inbox.
 */
function evaluateWRGuardIntersection(envelope: BeapEnvelope): WRGuardIntersectionResult {
  const wrguardState = useWRGuardStore.getState()
  
  // 3.1 Provider requirement (for email channel)
  if (envelope.ingressChannel === 'email') {
    const configuredProviders = wrguardState.getProviders()
    const connectedProviders = configuredProviders.filter(p => p.status === 'connected')
    
    // Check if any provider is configured and connected
    if (connectedProviders.length === 0) {
      return {
        passed: false,
        rejectionReason: createRejection(
          'provider_not_configured',
          'No email provider is configured in WRGuard.',
          'Message arrived via email channel but no email provider is connected in WRGuard → Email Providers.',
          'wrguard_intersection'
        )
      }
    }
    
    // If envelope specifies a provider, check if it's configured
    if (envelope.emailProviderId) {
      const providerMatch = connectedProviders.find(
        p => p.id === envelope.emailProviderId || p.email === envelope.emailProviderId
      )
      
      if (!providerMatch) {
        return {
          passed: false,
          rejectionReason: createRejection(
            'provider_not_configured',
            `Email provider "${envelope.emailProviderId}" is not configured in WRGuard.`,
            'The specified email provider is not connected. Configure it in WRGuard → Email Providers.',
            'wrguard_intersection'
          )
        }
      }
    }
  }
  
  // 3.2 Protected Sites requirement (for web-based egress)
  const webEgressDeclarations = envelope.egressDeclarations.filter(e => e.type === 'web')
  
  if (webEgressDeclarations.length > 0) {
    const protectedSites = wrguardState.getEnabledSites()
    const policyOverview = wrguardState.getPolicyOverview()
    
    // Check each web egress destination
    for (const egress of webEgressDeclarations) {
      const targetDomain = extractDomain(egress.target)
      
      // Check if target is in protected sites
      const isProtected = protectedSites.some(site => {
        const siteDomain = site.domain.toLowerCase()
        return targetDomain === siteDomain || targetDomain.endsWith('.' + siteDomain)
      })
      
      // If not in protected sites and egress posture is restrictive, reject
      if (!isProtected && policyOverview.egress.posture === 'restrictive') {
        return {
          passed: false,
          rejectionReason: createRejection(
            'egress_not_allowed_by_wrguard',
            `Egress destination "${targetDomain}" is not in Protected Sites.`,
            `The envelope declares egress to "${egress.target}" which is not in the WRGuard Protected Sites allowlist. Add it to WRGuard → Protected Sites to allow.`,
            'wrguard_intersection'
          )
        }
      }
    }
  }
  
  // 3.3 Ingress requirement (local posture)
  const policyOverview = wrguardState.getPolicyOverview()
  
  // Check ingress posture
  if (policyOverview.ingress.posture === 'restrictive') {
    // In restrictive mode, only allow verified handshake or allowlist sources
    const hasVerifiedIngress = envelope.ingressDeclarations.some(
      ingress => ingress.verified && (ingress.type === 'handshake' || ingress.type === 'allowlist')
    )
    
    if (!hasVerifiedIngress) {
      // Check if any ingress is from a public/unverified source
      const hasPublicIngress = envelope.ingressDeclarations.some(
        ingress => ingress.type === 'public' || !ingress.verified
      )
      
      if (hasPublicIngress) {
        return {
          passed: false,
          rejectionReason: createRejection(
            'ingress_not_allowed_by_wrguard',
            'Ingress from unverified source not allowed under restrictive policy.',
            'Local ingress policy is restrictive. Only verified handshake or allowlist sources are permitted.',
            'wrguard_intersection'
          )
        }
      }
    }
  }
  
  return { passed: true }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create a structured rejection reason
 */
function createRejection(
  code: RejectionCode,
  humanSummary: string,
  details: string,
  failedStep: 'envelope_verification' | 'boundary_check' | 'wrguard_intersection'
): RejectionReason {
  return {
    code,
    humanSummary,
    details,
    timestamp: Date.now(),
    failedStep
  }
}

/**
 * Extract domain from URL or domain string
 */
function extractDomain(target: string): string {
  try {
    // Try parsing as URL
    if (target.startsWith('http://') || target.startsWith('https://')) {
      const url = new URL(target)
      return url.hostname.toLowerCase()
    }
    // Assume it's already a domain
    return target.toLowerCase().replace(/^www\./, '')
  } catch {
    return target.toLowerCase()
  }
}

/**
 * Create envelope summary for display
 */
function createEnvelopeSummary(envelope: BeapEnvelope): EnvelopeSummaryDisplay {
  const channelLabels: Record<string, string> = {
    email: '📧 Email',
    messenger: '💬 Messenger',
    download: '📥 Download',
    chat: '💬 WR Chat',
    unknown: '❓ Unknown'
  }
  
  return {
    envelopeIdShort: envelope.envelopeId.slice(0, 8) + '...',
    senderFingerprintDisplay: envelope.senderFingerprint
      ? envelope.senderFingerprint.slice(0, 16) + '...'
      : '(unknown)',
    channelDisplay: channelLabels[envelope.ingressChannel] || channelLabels.unknown,
    ingressSummary: envelope.ingressDeclarations
      .map(i => `${i.type}:${i.verified ? '✓' : '○'}`)
      .join(', '),
    egressSummary: envelope.egressDeclarations
      .map(e => `${e.type}:${e.target.slice(0, 20)}`)
      .join(', '),
    createdAt: envelope.createdAt,
    expiryStatus: envelope.expiresAt
      ? (envelope.expiresAt < Date.now() ? 'expired' : 'valid')
      : 'no_expiry',
    signatureStatusDisplay: envelope.signatureStatus === 'valid' ? '✓ Valid'
      : envelope.signatureStatus === 'invalid' ? '✗ Invalid'
      : envelope.signatureStatus === 'missing' ? '○ Missing'
      : '? Unknown',
    hashVerificationDisplay: envelope.envelopeHash ? '✓ Present' : '✗ Missing'
  }
}

// =============================================================================
// Main Evaluation Function
// =============================================================================

/**
 * Evaluate an incoming BEAP message
 * 
 * This is the main entry point for envelope evaluation.
 * Executes all three steps in canonical order:
 * 1. Envelope verification
 * 2. Boundary check
 * 3. WRGuard intersection
 * 
 * If any step fails, evaluation stops and returns a rejection.
 * 
 * @param message The incoming BEAP message to evaluate
 * @returns EvaluationResult with pass/fail status and details
 */
export function evaluateIncomingMessage(message: IncomingBeapMessage): EvaluationResult {
  const stepsCompleted = {
    envelopeVerification: false,
    boundaryCheck: false,
    wrguardIntersection: false
  }
  
  try {
    // Check envelope exists
    if (!message.envelope) {
      return {
        passed: false,
        status: 'rejected',
        rejectionReason: createRejection(
          'envelope_missing',
          'Envelope is missing. Cannot process message.',
          'The incoming message does not contain an envelope.',
          'envelope_verification'
        ),
        stepsCompleted,
        evaluatedAt: Date.now()
      }
    }
    
    // Step 1: Envelope Verification
    const envelopeResult = verifyEnvelope(message.envelope)
    if (!envelopeResult.passed) {
      return {
        passed: false,
        status: 'rejected',
        rejectionReason: envelopeResult.rejectionReason,
        envelopeSummary: createEnvelopeSummary(message.envelope),
        stepsCompleted,
        evaluatedAt: Date.now()
      }
    }
    stepsCompleted.envelopeVerification = true
    
    // Step 2: Boundary Check
    const boundaryResult = checkBoundaries(message.envelope)
    if (!boundaryResult.passed) {
      return {
        passed: false,
        status: 'rejected',
        rejectionReason: boundaryResult.rejectionReason,
        envelopeSummary: createEnvelopeSummary(message.envelope),
        stepsCompleted,
        evaluatedAt: Date.now()
      }
    }
    stepsCompleted.boundaryCheck = true
    
    // Step 3: WRGuard Intersection
    const wrguardResult = evaluateWRGuardIntersection(message.envelope)
    if (!wrguardResult.passed) {
      return {
        passed: false,
        status: 'rejected',
        rejectionReason: wrguardResult.rejectionReason,
        envelopeSummary: createEnvelopeSummary(message.envelope),
        stepsCompleted,
        evaluatedAt: Date.now()
      }
    }
    stepsCompleted.wrguardIntersection = true
    
    // All steps passed - message accepted
    return {
      passed: true,
      status: 'accepted',
      envelopeSummary: createEnvelopeSummary(message.envelope),
      capsuleMetadata: message.capsuleMetadata,
      stepsCompleted,
      evaluatedAt: Date.now()
    }
    
  } catch (error) {
    // Fail-closed: any error results in rejection
    return {
      passed: false,
      status: 'rejected',
      rejectionReason: createRejection(
        'evaluation_error',
        'An error occurred during envelope evaluation.',
        error instanceof Error ? error.message : 'Unknown error',
        'envelope_verification'
      ),
      stepsCompleted,
      evaluatedAt: Date.now()
    }
  }
}

/**
 * Create a mock incoming message for testing
 */
export function createMockIncomingMessage(
  overrides?: Partial<IncomingBeapMessage>
): IncomingBeapMessage {
  const baseEnvelope: BeapEnvelope = {
    envelopeId: crypto.randomUUID(),
    packageId: crypto.randomUUID(),
    envelopeHash: 'sha256:' + crypto.randomUUID().replace(/-/g, ''),
    signatureStatus: 'valid',
    senderFingerprint: crypto.randomUUID().toUpperCase(),
    ingressChannel: 'email',
    ingressDeclarations: [
      { type: 'handshake', source: 'verified-sender', verified: true }
    ],
    egressDeclarations: [
      { type: 'none', target: 'local-only', required: false }
    ],
    createdAt: Date.now()
  }
  
  const baseCapsuleMetadata: CapsuleMetadata = {
    capsuleId: crypto.randomUUID(),
    title: 'Test Message',
    attachmentCount: 0,
    attachmentNames: [],
    sessionRefCount: 0,
    hasDataRequest: false,
    contentLengthHint: 100
  }
  
  return {
    id: crypto.randomUUID(),
    envelope: overrides?.envelope || baseEnvelope,
    capsuleMetadata: overrides?.capsuleMetadata || baseCapsuleMetadata,
    encryptedCapsule: '[encrypted]',
    importSource: 'email',
    importedAt: Date.now(),
    ...overrides
  }
}

