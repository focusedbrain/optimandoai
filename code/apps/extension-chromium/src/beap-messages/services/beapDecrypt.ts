/**
 * BEAP Package Decryption Service
 * 
 * Implements the canonical parsing and disclosure pipeline per A.3.055:
 * - Stage 0: Recipient eligibility determination (qBEAP)
 * - Stage 1: Public Envelope integrity verification
 * - Stage 4: Inner Envelope metadata decryption + validation (v2.0 qBEAP)
 * - Stage 6: Capsule access and parsing
 * - Stage 6.1–6.3: Processing Event Gate (consent, capability, artefact gating)
 * 
 * Per canon:
 * - All failures prior to Capsule access MUST be non-disclosing
 * - qBEAP eligibility MUST be constant-behavior (no timing leaks)
 * - pBEAP skips eligibility checks (auditable mode)
 * - Stage 4 inner envelope decryption/validation MUST occur before Stage 6 (v2.0)
 * 
 * @version 2.0.0
 */

import type { BeapPackage, BeapEnvelopeHeader, BeapArtefact, BeapArtefactEncrypted } from './BeapPackageBuilder'
import {
  deriveBeapKeys,
  decryptCapsulePayload,
  decryptArtefact,
  verifyBeapSignature,
  computeSigningData,
  fromBase64,
  toBase64,
  sha256,
  buildEnvelopeAadFields,
  canonicalSerializeAAD,
  type BeapSignature,
  type EncryptedArtefact
} from './beapCrypto'
import { deriveSharedSecretX25519 } from './x25519KeyAgreement'
import {
  getDeclarationForClass,
  isProcessingPermitted,
  type ProcessingEventOffer,
  type ProcessingBoundary,
  type ProcessingScope
} from './processingEvents'
import {
  runStage61Gate,
  DEFAULT_CAPABILITY_POLICY,
  type ReceiverCapabilityPolicy,
  type AuthorizedProcessingResult,
} from './processingEventGate'
import {
  decryptInnerEnvelope,
  type InnerEnvelopeMetadata,
} from './outerEnvelope'
import {
  evaluateRecipientEligibility,
  evaluateLegacyEligibility,
  type LocalHandshake,
  type EligibilityCheckResult,
} from './eligibilityCheck'
import {
  runDepackagingPipeline,
  type PipelineInput,
  type PipelineResult,
  type Gate6Context,
  type SenderIdentity,
  type KnownReceiver,
  type GateResult,
} from './depackagingPipeline'
import {
  verifyPoAERecord,
  generatePoAERLog,
  computeCapsuleHash,
  type PoAERecord,
  type PoAEVerificationResult,
  type PoAERLog,
  type PoAEAnchorProvider,
} from './poae'
import {
  verifyUrlNormalization,
  type UrlNormalizationVerification,
  type ExtractedUrl,
} from './urlNormalizer'

// Re-export eligibility check types for callers that build LocalHandshake records
export type { LocalHandshake, EligibilityCheckResult }

// Re-export depackaging pipeline types for callers
export type { SenderIdentity, KnownReceiver, GateResult, PipelineResult, Gate6Context }

// =============================================================================
// Types
// =============================================================================

/**
 * Decrypted capsule payload structure
 */
export interface DecryptedCapsulePayload {
  subject: string
  body: string
  transport_plaintext?: string
  has_authoritative_encrypted?: boolean
  attachments: Array<{
    id: string
    originalName: string
    originalSize: number
    originalType: string
    semanticExtracted: boolean
    semanticContent?: string
    encryptedRef?: string
    previewRef?: string
    rasterProof?: {
      pages: Array<{
        page: number
        width: number
        height: number
        bytes: number
        sha256: string
        artefactRef: string
      }>
    }
    isMedia?: boolean
  }>
  automation?: {
    tags: string[]
    tagSource: 'encrypted' | 'plaintext' | 'both' | 'none'
    receiverHasFinalAuthority: true
  }
  audit_notice?: string // pBEAP only
  /**
   * A.3.054.6 — URL references extracted from body during capsule assembly.
   * All entries are in normalized (non-clickable) form.  Present when the sender
   * populated normalized_url_refs; absent on legacy packages.
   */
  normalized_url_refs?: Array<{ url: string; scheme: string }>
  /**
   * A.3.054.6 — Receiver-side URL normalization verification result.
   * Populated by the depackaging pipeline after capsule decryption.
   * Non-compliant indicates the sender did not normalize URLs before packaging.
   */
  urlNormalizationVerification?: UrlNormalizationVerification
}

/**
 * Decrypted artefact (raster or original)
 */
export interface DecryptedArtefact {
  class: 'raster' | 'original'
  artefactRef: string
  attachmentId: string
  page?: number
  filename?: string
  mime: string
  base64: string
  sha256: string
  width?: number
  height?: number
  bytes: number
}

/**
 * Complete decrypted package
 */
export interface DecryptedPackage {
  header: BeapEnvelopeHeader
  capsule: DecryptedCapsulePayload
  artefacts: DecryptedArtefact[]
  metadata: BeapPackage['metadata']
  verification: {
    signatureValid: boolean
    signatureAlgorithm: string
    signerKeyId: string
    verifiedAt: number
  }
  /**
   * Result of the full Stage 6.1 Processing Event Gate (A.3.055 + A.3.054 Stage 6.1.1).
   *
   * Consumers MUST check `authorizedProcessing.decision === 'AUTHORIZED'` and
   * `authorizedProcessing.processingGate.effective.<class>.permitted` before
   * invoking any AI or automation operations on capsule content.
   *
   * `processingGate` is forwarded inside `authorizedProcessing` for backward
   * compatibility with callers that previously read `pkg.processingGate`.
   */
  authorizedProcessing: AuthorizedProcessingResult

  /**
   * Decrypted inner envelope metadata (v2.0 qBEAP packages only).
   *
   * Present when `pkg.outerEnvelopeVersion === '2.0'` AND `header.encoding === 'qBEAP'`.
   * Contains processingEvents, artefactTopology, policyFingerprint, and retention declarations
   * as decrypted and validated by Stage 4.
   *
   * null for v1.0 packages and pBEAP packages.
   */
  innerEnvelopeMetadata: InnerEnvelopeMetadata | null

  /**
   * Full 6-gate depackaging pipeline result (Canon §10).
   *
   * Carries per-gate pass/fail results and the chain-of-custody context.
   * `pipelineResult.verifiedContext` is the Gate 6 context confirming that
   * all 6 canonical verification gates passed.
   *
   * Always populated when decryption succeeds.
   */
  pipelineResult?: PipelineResult

  /**
   * Stage 2: Sender PoAE record verification result (A.3.055 Stage 2).
   *
   * Present when `pkg.poae` exists in the received package.
   * When `poaeVerification.anchorRequired === true`, this MUST be `meetsHighAssuranceRequirement === true`
   * or the package would have been rejected (fail-closed) before reaching here.
   *
   * null when the package carries no PoAE record.
   */
  poaeVerification: PoAEVerificationResult | null

  /**
   * Stage 7: Receiver-side PoAE-R log (A.3.055 Stage 7).
   *
   * Generated if: execution occurred AND sender's policy requested a log
   * AND receiver's policy permits it. Absence SHALL NOT be interpreted
   * as a processing outcome by any party.
   *
   * null when conditions for generation were not met.
   */
  poaeRLog: PoAERLog | null
}

/**
 * Verification result before decryption
 */
export interface VerificationResult {
  valid: boolean
  stage: 'eligibility' | 'integrity' | 'signature' | 'complete'
  error?: string
  /** Per canon A.3.055: errors must be non-disclosing */
  nonDisclosingError: string
}

/**
 * Decryption result
 */
export interface DecryptionResult {
  success: boolean
  package?: DecryptedPackage
  error?: string
  /** Per canon: non-disclosing error for external display */
  nonDisclosingError?: string
}

// =============================================================================
// Stage 6.1–6.3: Processing Event Declaration Gate (A.3.054.9.1 + A.3.054.10.1)
// =============================================================================

/**
 * Receiver-side processing event policy (A.3.054.9.1 + A.3.054.10.1).
 *
 * This represents the RECEIVER'S OWN POLICY — not the sender's declared offer.
 * Per canon: sender declarations are intent only; effective permission is
 * determined exclusively by receiver-side policy evaluation.
 */
export interface ReceiverProcessingPolicy {
  /**
   * Whether to permit non-NONE semantic processing events.
   * Default: false (no semantic processing permitted unless explicitly enabled).
   */
  allowSemanticProcessing?: boolean

  /**
   * Whether to permit non-NONE actuating processing events.
   * Default: false (no actuating processing permitted unless explicitly enabled).
   */
  allowActuatingProcessing?: boolean

  /**
   * Maximum boundary permitted for semantic processing.
   * Default: 'NONE' (no semantic processing).
   */
  maxSemanticBoundary?: ProcessingBoundary

  /**
   * Maximum boundary permitted for actuating processing.
   * Default: 'NONE' (no actuating processing).
   */
  maxActuatingBoundary?: ProcessingBoundary

  /**
   * Allowlist of provider IDs the receiver trusts for semantic processing.
   * When set, any declared semantic provider not in this set causes a violation.
   * When undefined (default): no provider allowlist enforced.
   *
   * Format: Set of reverse-DNS identifiers matching ProcessingProvider.providerId.
   */
  allowedSemanticProviderIds?: Set<string>

  /**
   * Allowlist of provider IDs the receiver trusts for actuating processing.
   * When undefined (default): no provider allowlist enforced.
   */
  allowedActuatingProviderIds?: Set<string>

  /**
   * Maximum retention level permitted for semantic processing.
   * Default: 'NONE' (no retention).
   */
  maxSemanticRetention?: ProcessingRetention

  /**
   * Maximum retention level permitted for actuating processing.
   * Default: 'NONE' (no retention).
   */
  maxActuatingRetention?: ProcessingRetention
}

/** The default receiver policy: no processing permitted for either class. */
export const DEFAULT_RECEIVER_POLICY: ReceiverProcessingPolicy = {
  allowSemanticProcessing: false,
  allowActuatingProcessing: false,
  maxSemanticBoundary: 'NONE',
  maxActuatingBoundary: 'NONE',
  maxSemanticRetention: 'NONE',
  maxActuatingRetention: 'NONE'
}

/**
 * Result of the Stage 6.1–6.3 processing event gate.
 */
export interface ProcessingGateResult {
  /** Whether the gate passed (all declarations within receiver policy) */
  passed: boolean
  /**
   * Per-class effective permission after receiver policy evaluation.
   * Populated regardless of pass/fail for audit purposes.
   */
  effective: {
    semantic: {
      permitted: boolean
      boundary: ProcessingBoundary
      scope: ProcessingScope
      retention: ProcessingRetention
      /** Provider IDs declared by sender and permitted by receiver policy */
      permittedProviderIds: string[]
      /** Provider IDs declared by sender but rejected by receiver allowlist */
      rejectedProviderIds: string[]
    }
    actuating: {
      permitted: boolean
      boundary: ProcessingBoundary
      scope: ProcessingScope
      retention: ProcessingRetention
      permittedProviderIds: string[]
      rejectedProviderIds: string[]
    }
  }
  /**
   * Policy violations found during evaluation.
   * Empty when passed=true.
   */
  violations: string[]
}

/**
 * Stage 6.1: Processing Event declaration alignment.
 * Stage 6.2: Boundary/scope/retention/provider resolution.
 * Stage 6.3: Gating — fail-closed if actuating events exceed receiver policy.
 *
 * Per canon A.3.054.9.1:
 * - Sender declarations are INTENT ONLY; receiver policy is authoritative.
 * - Gate does NOT block capsule access for semantic-only policy mismatches;
 *   it records effective permissions for downstream AI/automation systems.
 * - Actuating events that exceed receiver policy are violations (fail-closed
 *   on actuation).
 *
 * Per canon A.3.054.10.1:
 * - Provider allowlist check: any declared provider not in the receiver's
 *   allowedProviderIds set is added to rejectedProviderIds and triggers a
 *   violation for actuating class; informational for semantic class.
 *
 * @param offer - The sender's declared ProcessingEventOffer from the header
 * @param policy - The receiver's own processing policy (defaults to all-NONE)
 * @returns ProcessingGateResult with effective permissions and any violations
 */
export function evaluateProcessingEventGate(
  offer: ProcessingEventOffer | undefined | null,
  policy: ReceiverProcessingPolicy = DEFAULT_RECEIVER_POLICY
): ProcessingGateResult {
  const violations: string[] = []

  // Resolve declared boundaries per class (absent = NONE per A.3.054.14.1)
  const semanticDecl = getDeclarationForClass(offer, 'semantic')
  const actuatingDecl = getDeclarationForClass(offer, 'actuating')

  // Boundary hierarchy for comparison: NONE < LOCAL < REMOTE
  const boundaryLevel: Record<ProcessingBoundary, number> = {
    NONE: 0, LOCAL: 1, REMOTE: 2
  }

  // Retention hierarchy: NONE < SESSION < PERSISTENT
  const retentionLevel: Record<ProcessingRetention, number> = {
    NONE: 0, SESSION: 1, PERSISTENT: 2
  }

  // ── Evaluate semantic class ────────────────────────────────────────────────
  const maxSemanticLevel = boundaryLevel[policy.maxSemanticBoundary ?? 'NONE']
  const declaredSemanticLevel = boundaryLevel[semanticDecl.boundary]
  const semanticBoundaryOk =
    declaredSemanticLevel <= maxSemanticLevel &&
    (policy.allowSemanticProcessing === true || semanticDecl.boundary === 'NONE')

  const semanticRetention: ProcessingRetention = semanticDecl.retention ?? 'NONE'
  const maxSemanticRetentionLevel = retentionLevel[policy.maxSemanticRetention ?? 'NONE']
  const semanticRetentionOk = retentionLevel[semanticRetention] <= maxSemanticRetentionLevel

  // Provider allowlist evaluation — semantic
  const semanticDeclaredIds: string[] = (semanticDecl.providers ?? []).map(p => p.providerId)
  const semanticPermittedIds: string[] = []
  const semanticRejectedIds: string[] = []
  if (semanticDecl.boundary !== 'NONE' && policy.allowedSemanticProviderIds) {
    for (const id of semanticDeclaredIds) {
      if (policy.allowedSemanticProviderIds.has(id)) {
        semanticPermittedIds.push(id)
      } else {
        semanticRejectedIds.push(id)
      }
    }
  } else {
    semanticPermittedIds.push(...semanticDeclaredIds)
  }

  const semanticPermitted = semanticBoundaryOk && semanticRetentionOk

  // ── Evaluate actuating class ───────────────────────────────────────────────
  const maxActuatingLevel = boundaryLevel[policy.maxActuatingBoundary ?? 'NONE']
  const declaredActuatingLevel = boundaryLevel[actuatingDecl.boundary]
  const actuatingBoundaryOk =
    declaredActuatingLevel <= maxActuatingLevel &&
    (policy.allowActuatingProcessing === true || actuatingDecl.boundary === 'NONE')

  const actuatingRetention: ProcessingRetention = actuatingDecl.retention ?? 'NONE'
  const maxActuatingRetentionLevel = retentionLevel[policy.maxActuatingRetention ?? 'NONE']
  const actuatingRetentionOk = retentionLevel[actuatingRetention] <= maxActuatingRetentionLevel

  // Provider allowlist evaluation — actuating
  const actuatingDeclaredIds: string[] = (actuatingDecl.providers ?? []).map(p => p.providerId)
  const actuatingPermittedIds: string[] = []
  const actuatingRejectedIds: string[] = []
  if (actuatingDecl.boundary !== 'NONE' && policy.allowedActuatingProviderIds) {
    for (const id of actuatingDeclaredIds) {
      if (policy.allowedActuatingProviderIds.has(id)) {
        actuatingPermittedIds.push(id)
      } else {
        actuatingRejectedIds.push(id)
      }
    }
  } else {
    actuatingPermittedIds.push(...actuatingDeclaredIds)
  }

  const actuatingPermitted = actuatingBoundaryOk && actuatingRetentionOk

  // ── Stage 6.3: Violations (fail-closed on actuating) ──────────────────────

  // Boundary violations
  if (!actuatingBoundaryOk && actuatingDecl.boundary !== 'NONE') {
    violations.push(
      `STAGE_6.3: Actuating processing declared as boundary='${actuatingDecl.boundary}' ` +
      `but receiver policy permits at most '${policy.maxActuatingBoundary ?? 'NONE'}'. ` +
      `Actuating processing BLOCKED.`
    )
  }

  // Retention violations — actuating
  if (!actuatingRetentionOk && actuatingDecl.boundary !== 'NONE') {
    violations.push(
      `STAGE_6.3: Actuating processing declared retention='${actuatingRetention}' ` +
      `but receiver policy permits at most '${policy.maxActuatingRetention ?? 'NONE'}'. ` +
      `Actuating processing BLOCKED.`
    )
  }

  // Provider allowlist violations — actuating (fail-closed)
  if (actuatingRejectedIds.length > 0) {
    violations.push(
      `STAGE_6.3: Actuating processing declares provider(s) not in receiver allowlist: ` +
      `[${actuatingRejectedIds.join(', ')}]. Actuating processing BLOCKED.`
    )
  }

  // Provider allowlist violations — semantic (informational, not a gate violation)
  // Logged in rejectedProviderIds but do not add to violations[] (does not block capsule access)

  return {
    passed: violations.length === 0,
    effective: {
      semantic: {
        permitted: semanticPermitted,
        boundary: semanticDecl.boundary,
        scope: semanticDecl.scope,
        retention: semanticRetention,
        permittedProviderIds: semanticPermittedIds,
        rejectedProviderIds: semanticRejectedIds
      },
      actuating: {
        permitted: actuatingPermitted,
        boundary: actuatingDecl.boundary,
        scope: actuatingDecl.scope,
        retention: actuatingRetention,
        permittedProviderIds: actuatingPermittedIds,
        rejectedProviderIds: actuatingRejectedIds
      }
    },
    violations
  }
}

// =============================================================================
// Stage 0: Recipient Eligibility (qBEAP only)
// =============================================================================

/**
 * Check recipient eligibility for qBEAP packages.
 * 
 * Per canon A.3.055 Stage 0:
 * - Eligibility MUST be evaluated solely via opaque handshake-derived binding
 * - MUST be non-disclosing and constant-behavior
 * - If eligibility cannot be established, treat as "not-for-me"
 *
 * v2.0 packages: delegates to `evaluateRecipientEligibility` in `eligibilityCheck.ts`
 *   for HMAC-based, constant-time, non-disclosing evaluation.
 * v1.0 packages: falls back to `evaluateLegacyEligibility` (handshake_id string match).
 *
 * For simple single-handshake callers (legacy API), use this function.
 * For multi-handshake callers or full canonical compliance, use
 * `evaluateRecipientEligibility` from `eligibilityCheck.ts` directly.
 * 
 * @param header - Package header
 * @param localHandshakeId - Local handshake ID to check against
 * @returns true if eligible, false if "not-for-me"
 */
export function checkRecipientEligibility(
  header: BeapEnvelopeHeader,
  localHandshakeId: string
): boolean {
  // pBEAP: No eligibility check (per canon A.3.06)
  if (header.encoding === 'pBEAP') {
    return true
  }
  
  // v1.0 legacy fallback: handshake_id string match
  return evaluateLegacyEligibility(header.receiver_binding?.handshake_id, localHandshakeId)
}

// =============================================================================
// Stage 1: Public Envelope Integrity Verification
// =============================================================================

/**
 * Verify public envelope integrity.
 * 
 * Per canon A.3.055 Stage 1:
 * - Verify outer Envelope governance material
 * - Failure MUST result in fail-closed rejection
 * - MUST NOT permit any encrypted Envelope disclosure on failure
 * 
 * @param pkg - Package to verify
 * @returns Verification result
 */
export async function verifyEnvelopeIntegrity(
  pkg: BeapPackage
): Promise<VerificationResult> {
  // Check required fields
  if (!pkg.header?.version || !pkg.header?.encoding) {
    return {
      valid: false,
      stage: 'integrity',
      error: 'Missing required header fields',
      nonDisclosingError: 'Package verification failed'
    }
  }
  
  // Verify version — accept both v1.0 (legacy) and v2.0 (dual-envelope)
  if (pkg.header.version !== '1.0' && pkg.header.version !== '2.0') {
    return {
      valid: false,
      stage: 'integrity',
      error: `Unsupported version: ${pkg.header.version}`,
      nonDisclosingError: 'Package verification failed'
    }
  }
  
  // Verify encoding mode
  if (pkg.header.encoding !== 'qBEAP' && pkg.header.encoding !== 'pBEAP') {
    return {
      valid: false,
      stage: 'integrity',
      error: `Invalid encoding: ${pkg.header.encoding}`,
      nonDisclosingError: 'Package verification failed'
    }
  }
  
  // Verify required hashes are present
  if (!pkg.header.template_hash || !pkg.header.policy_hash || !pkg.header.content_hash) {
    return {
      valid: false,
      stage: 'integrity',
      error: 'Missing commitment hashes',
      nonDisclosingError: 'Package verification failed'
    }
  }
  
  // Verify signature is present
  if (!pkg.signature?.signature) {
    return {
      valid: false,
      stage: 'integrity',
      error: 'Missing signature',
      nonDisclosingError: 'Package verification failed'
    }
  }
  
  return {
    valid: true,
    stage: 'integrity',
    nonDisclosingError: ''
  }
}

// =============================================================================
// Signature Verification
// =============================================================================

/**
 * Verify package signature.
 * 
 * Per canon A.3.054.10:
 * - All cryptographic protections are explicit and verifiable
 * - Signature binds envelope, capsule, and artefacts
 * 
 * @param pkg - Package to verify
 * @returns Verification result
 */
export async function verifyPackageSignature(
  pkg: BeapPackage
): Promise<VerificationResult> {
  try {
    // Build artefacts manifest for verification
    let artefactsManifest: Array<{ artefactRef: string; sha256Plain?: string }> | undefined
    
    if (pkg.header.encoding === 'qBEAP' && pkg.artefactsEnc) {
      artefactsManifest = pkg.artefactsEnc.map(a => ({
        artefactRef: a.artefactRef,
        sha256Plain: a.sha256Plain
      }))
    } else if (pkg.header.encoding === 'pBEAP' && pkg.artefacts) {
      artefactsManifest = pkg.artefacts.map(a => ({
        artefactRef: a.artefactRef,
        sha256Plain: a.sha256
      }))
    }
    
    // Get payload data for signing
    const payloadData = pkg.header.encoding === 'qBEAP'
      ? pkg.payloadEnc?.ciphertext || ''
      : pkg.payload || ''
    
    // Compute expected signing data
    const signingData = await computeSigningData(
      pkg.header as unknown as Record<string, unknown>,
      payloadData,
      artefactsManifest
    )
    
    // Verify signature
    const isValid = await verifyBeapSignature(pkg.signature, signingData)
    
    if (!isValid) {
      return {
        valid: false,
        stage: 'signature',
        error: 'Signature verification failed',
        nonDisclosingError: 'Package verification failed'
      }
    }
    
    return {
      valid: true,
      stage: 'signature',
      nonDisclosingError: ''
    }
  } catch (error) {
    return {
      valid: false,
      stage: 'signature',
      error: error instanceof Error ? error.message : 'Signature verification error',
      nonDisclosingError: 'Package verification failed'
    }
  }
}

// =============================================================================
// Stage 6: Capsule Decryption
// =============================================================================

/**
 * Decrypt a qBEAP package.
 * 
 * Per canon A.3.055 Stage 6:
 * - Decrypt after successful completion of Stages 1-4
 * - Parsing MUST be strict, schema-governed, bounded
 * - MUST occur within verified isolation boundary
 * 
 * @param pkg - Package to decrypt
 * @param handshakeId - Handshake ID for key derivation
 * @param senderFingerprint - Sender fingerprint for key derivation
 * @returns Decryption result
 */
export async function decryptQBeapPackage(
  pkg: BeapPackage,
  senderX25519PublicKey: string
): Promise<DecryptionResult> {
  try {
    // Verify this is a qBEAP package
    if (pkg.header.encoding !== 'qBEAP') {
      return {
        success: false,
        error: 'Not a qBEAP package',
        nonDisclosingError: 'Package decryption failed'
      }
    }
    
    // Verify payloadEnc exists
    if (!pkg.payloadEnc?.nonce || !pkg.payloadEnc?.ciphertext) {
      return {
        success: false,
        error: 'Missing encrypted payload',
        nonDisclosingError: 'Package decryption failed'
      }
    }
    
    // Get salt from header
    const salt = pkg.header.crypto?.salt
    if (!salt) {
      return {
        success: false,
        error: 'Missing envelope salt',
        nonDisclosingError: 'Package decryption failed'
      }
    }
    
    // Re-derive keys using X25519 ECDH
    // qBEAP requires real key agreement - no fallback allowed
    const ecdhResult = await deriveSharedSecretX25519(senderX25519PublicKey)
    const { capsuleKey, artefactKey } = await deriveBeapKeys(ecdhResult.sharedSecret, fromBase64(salt))
    
    // Decrypt capsule payload (nonce/ciphertext verified present above)
    const capsuleJson = await decryptCapsulePayload(capsuleKey, {
      nonce: pkg.payloadEnc.nonce!,
      ciphertext: pkg.payloadEnc.ciphertext!
    })
    let capsule: DecryptedCapsulePayload
    try {
      capsule = JSON.parse(capsuleJson)
    } catch {
      return {
        success: false,
        error: 'Invalid capsule JSON',
        nonDisclosingError: 'Package decryption failed'
      }
    }
    
    // Decrypt artefacts
    const decryptedArtefacts: DecryptedArtefact[] = []
    if (pkg.artefactsEnc && pkg.artefactsEnc.length > 0) {
      for (const encArtefact of pkg.artefactsEnc) {
        const decrypted = await decryptArtefact(artefactKey, encArtefact as EncryptedArtefact)
        decryptedArtefacts.push(decrypted)
      }
    }
    
    // Verify signature
    const sigResult = await verifyPackageSignature(pkg)

    return {
      success: true,
      package: {
        header: pkg.header,
        capsule,
        artefacts: decryptedArtefacts,
        metadata: pkg.metadata,
        verification: {
          signatureValid: sigResult.valid,
          signatureAlgorithm: pkg.signature.algorithm,
          signerKeyId: pkg.signature.keyId,
          verifiedAt: Date.now()
        },
        // authorizedProcessing is populated by the outer decryptBeapPackage orchestrator
        // after Stage 6.1 gate evaluation. Initialise to all-BLOCKED pending.
        authorizedProcessing: {
          decision: 'BLOCKED',
          processingGate: {
            passed: true,
            effective: {
              semantic: {
                permitted: false,
                boundary: 'NONE',
                scope: 'MINIMAL',
                retention: 'NONE',
                permittedProviderIds: [],
                rejectedProviderIds: []
              },
              actuating: {
                permitted: false,
                boundary: 'NONE',
                scope: 'MINIMAL',
                retention: 'NONE',
                permittedProviderIds: [],
                rejectedProviderIds: []
              }
            },
            violations: []
          },
          impliedEvents: [],
          authorizedEvents: [],
          blockedEvents: [],
          alignmentViolations: [],
          capabilityViolations: [],
          authorizedTokenIds: [],
          consentResolution: {
            semantic: { mayProceed: false, requiresInteractiveConsent: false, matchedConsentRecord: null, attestationSatisfied: null, violations: [] },
            actuating: { mayProceed: false, requiresInteractiveConsent: false, matchedConsentRecord: null, attestationSatisfied: null, violations: [] }
          },
          consentViolations: [],
          gatingArtefacts: []
        },
        innerEnvelopeMetadata: null,
        poaeVerification: null,
        poaeRLog: null
      }
    }
  } catch (error) {
    console.error('[BEAP Decrypt] Error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Decryption failed',
      nonDisclosingError: 'Package decryption failed'
    }
  }
}

/**
 * Decode a pBEAP package (no decryption needed).
 * 
 * Per canon A.3.14:
 * - pBEAP capsules are unencrypted
 * - Full envelope is readable and inspectable in plaintext
 * 
 * @param pkg - Package to decode
 * @returns Decryption result
 */
export async function decodePBeapPackage(
  pkg: BeapPackage
): Promise<DecryptionResult> {
  try {
    // Verify this is a pBEAP package
    if (pkg.header.encoding !== 'pBEAP') {
      return {
        success: false,
        error: 'Not a pBEAP package',
        nonDisclosingError: 'Package decoding failed'
      }
    }
    
    // Verify payload exists
    if (!pkg.payload) {
      return {
        success: false,
        error: 'Missing payload',
        nonDisclosingError: 'Package decoding failed'
      }
    }
    
    // Decode base64 payload
    let capsuleJson: string
    try {
      capsuleJson = atob(pkg.payload)
    } catch {
      return {
        success: false,
        error: 'Invalid base64 payload',
        nonDisclosingError: 'Package decoding failed'
      }
    }
    
    // Parse JSON
    let capsule: DecryptedCapsulePayload
    try {
      capsule = JSON.parse(capsuleJson)
    } catch {
      return {
        success: false,
        error: 'Invalid capsule JSON',
        nonDisclosingError: 'Package decoding failed'
      }
    }
    
    // Convert plaintext artefacts to decrypted format
    const artefacts: DecryptedArtefact[] = []
    if (pkg.artefacts && pkg.artefacts.length > 0) {
      for (const artefact of pkg.artefacts) {
        artefacts.push({
          class: 'raster', // pBEAP currently only has raster artefacts
          artefactRef: artefact.artefactRef,
          attachmentId: artefact.attachmentId,
          page: artefact.page,
          mime: artefact.mime,
          base64: artefact.base64,
          sha256: artefact.sha256,
          width: artefact.width,
          height: artefact.height,
          bytes: artefact.bytes
        })
      }
    }
    
    // Verify signature
    const sigResult = await verifyPackageSignature(pkg)

    return {
      success: true,
      package: {
        header: pkg.header,
        capsule,
        artefacts,
        metadata: pkg.metadata,
        verification: {
          signatureValid: sigResult.valid,
          signatureAlgorithm: pkg.signature.algorithm,
          signerKeyId: pkg.signature.keyId,
          verifiedAt: Date.now()
        },
        // authorizedProcessing is populated by the outer decryptBeapPackage orchestrator
        // after Stage 6.1 gate evaluation. Initialise to all-BLOCKED pending.
        authorizedProcessing: {
          decision: 'BLOCKED',
          processingGate: {
            passed: true,
            effective: {
              semantic: {
                permitted: false,
                boundary: 'NONE',
                scope: 'MINIMAL',
                retention: 'NONE',
                permittedProviderIds: [],
                rejectedProviderIds: []
              },
              actuating: {
                permitted: false,
                boundary: 'NONE',
                scope: 'MINIMAL',
                retention: 'NONE',
                permittedProviderIds: [],
                rejectedProviderIds: []
              }
            },
            violations: []
          },
          impliedEvents: [],
          authorizedEvents: [],
          blockedEvents: [],
          alignmentViolations: [],
          capabilityViolations: [],
          authorizedTokenIds: [],
          consentResolution: {
            semantic: { mayProceed: false, requiresInteractiveConsent: false, matchedConsentRecord: null, attestationSatisfied: null, violations: [] },
            actuating: { mayProceed: false, requiresInteractiveConsent: false, matchedConsentRecord: null, attestationSatisfied: null, violations: [] }
          },
          consentViolations: [],
          gatingArtefacts: []
        },
        innerEnvelopeMetadata: null,
        poaeVerification: null,
        poaeRLog: null
      }
    }
  } catch (error) {
    console.error('[BEAP Decode] Error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Decoding failed',
      nonDisclosingError: 'Package decoding failed'
    }
  }
}

// =============================================================================
// Context-Based Decryption Helpers (Canon §10 Pipeline Integration)
// =============================================================================
// These helpers consume the already-verified Gate6Context from the depackaging
// pipeline. They avoid double key-derivation and double decryption — the capsule
// plaintext and derived keys are carried forward from Gate 4.

/**
 * Build a DecryptedPackage for qBEAP using the pipeline-verified Gate6Context.
 *
 * Uses `verifiedCtx.capsulePlaintext` (decrypted in Gate 4) and
 * `verifiedCtx.artefactKey` for artefact decryption.
 */
async function decryptQBeapPackageFromContext(
  pkg: BeapPackage,
  ctx: Gate6Context
): Promise<DecryptionResult> {
  try {
    // Parse the pipeline-decrypted capsule plaintext
    let capsule: DecryptedCapsulePayload
    try {
      capsule = JSON.parse(ctx.authorizedCapsulePlaintext)
    } catch {
      return { success: false, error: 'Invalid capsule JSON', nonDisclosingError: 'Package decryption failed' }
    }

    // A.3.054.6 — Receiver-side URL normalization verification (presentation-layer, non-fatal)
    try {
      capsule.urlNormalizationVerification = verifyUrlNormalization(capsule.body ?? '')
      if (capsule.transport_plaintext) {
        const tpVerif = verifyUrlNormalization(capsule.transport_plaintext)
        if (!tpVerif.compliant && capsule.urlNormalizationVerification.compliant) {
          capsule.urlNormalizationVerification = tpVerif
        }
      }
    } catch {
      // Non-fatal: log but do not abort depackaging
      console.warn('[BEAP Decrypt] URL normalization verification failed (non-fatal)')
    }

    // Decrypt artefacts using pipeline-derived artefactKey
    const decryptedArtefacts: DecryptedArtefact[] = []
    if (pkg.artefactsEnc && pkg.artefactsEnc.length > 0) {
      for (const encArtefact of pkg.artefactsEnc) {
        const decrypted = await decryptArtefact(ctx.artefactKey, encArtefact as EncryptedArtefact)
        decryptedArtefacts.push(decrypted)
      }
    }

    return {
      success: true,
      package: {
        header: pkg.header,
        capsule,
        artefacts: decryptedArtefacts,
        metadata: pkg.metadata,
        verification: {
          signatureValid: ctx.signatureVerified,
          signatureAlgorithm: ctx.signingAlgorithm,
          signerKeyId: ctx.signerKeyId,
          verifiedAt: Date.now()
        },
        authorizedProcessing: {
          decision: 'BLOCKED',
          processingGate: {
            passed: true,
            effective: {
              semantic: { permitted: false, boundary: 'NONE', scope: 'MINIMAL', retention: 'NONE', permittedProviderIds: [], rejectedProviderIds: [] },
              actuating: { permitted: false, boundary: 'NONE', scope: 'MINIMAL', retention: 'NONE', permittedProviderIds: [], rejectedProviderIds: [] }
            },
            violations: []
          },
          impliedEvents: [],
          authorizedEvents: [],
          blockedEvents: [],
          alignmentViolations: [],
          capabilityViolations: [],
          authorizedTokenIds: [],
          consentResolution: {
            semantic: { mayProceed: false, requiresInteractiveConsent: false, matchedConsentRecord: null, attestationSatisfied: null, violations: [] },
            actuating: { mayProceed: false, requiresInteractiveConsent: false, matchedConsentRecord: null, attestationSatisfied: null, violations: [] }
          },
          consentViolations: [],
          gatingArtefacts: []
        },
        innerEnvelopeMetadata: null,
        poaeVerification: null,
        poaeRLog: null
      }
    }
  } catch (error) {
    console.error('[BEAP Decrypt] Error:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Decryption failed', nonDisclosingError: 'Package decryption failed' }
  }
}

/**
 * Build a DecryptedPackage for pBEAP using the pipeline-verified Gate6Context.
 *
 * Uses `verifiedCtx.authorizedCapsulePlaintext` (decoded in Gate 4).
 */
async function decodePBeapPackageFromContext(
  pkg: BeapPackage,
  ctx: Gate6Context
): Promise<DecryptionResult> {
  try {
    let capsule: DecryptedCapsulePayload
    try {
      capsule = JSON.parse(ctx.authorizedCapsulePlaintext)
    } catch {
      return { success: false, error: 'Invalid capsule JSON', nonDisclosingError: 'Package decoding failed' }
    }

    // A.3.054.6 — Receiver-side URL normalization verification (presentation-layer, non-fatal)
    try {
      capsule.urlNormalizationVerification = verifyUrlNormalization(capsule.body ?? '')
    } catch {
      console.warn('[BEAP Decrypt] URL normalization verification failed (non-fatal)')
    }

    const artefacts: DecryptedArtefact[] = (pkg.artefacts ?? []).map(artefact => ({
      class: 'raster' as const,
      artefactRef: artefact.artefactRef,
      attachmentId: artefact.attachmentId,
      page: artefact.page,
      mime: artefact.mime,
      base64: artefact.base64,
      sha256: artefact.sha256,
      width: artefact.width,
      height: artefact.height,
      bytes: artefact.bytes
    }))

    return {
      success: true,
      package: {
        header: pkg.header,
        capsule,
        artefacts,
        metadata: pkg.metadata,
        verification: {
          signatureValid: ctx.signatureVerified,
          signatureAlgorithm: ctx.signingAlgorithm,
          signerKeyId: ctx.signerKeyId,
          verifiedAt: Date.now()
        },
        authorizedProcessing: {
          decision: 'BLOCKED',
          processingGate: {
            passed: true,
            effective: {
              semantic: { permitted: false, boundary: 'NONE', scope: 'MINIMAL', retention: 'NONE', permittedProviderIds: [], rejectedProviderIds: [] },
              actuating: { permitted: false, boundary: 'NONE', scope: 'MINIMAL', retention: 'NONE', permittedProviderIds: [], rejectedProviderIds: [] }
            },
            violations: []
          },
          impliedEvents: [],
          authorizedEvents: [],
          blockedEvents: [],
          alignmentViolations: [],
          capabilityViolations: [],
          authorizedTokenIds: [],
          consentResolution: {
            semantic: { mayProceed: false, requiresInteractiveConsent: false, matchedConsentRecord: null, attestationSatisfied: null, violations: [] },
            actuating: { mayProceed: false, requiresInteractiveConsent: false, matchedConsentRecord: null, attestationSatisfied: null, violations: [] }
          },
          consentViolations: [],
          gatingArtefacts: []
        },
        innerEnvelopeMetadata: null,
        poaeVerification: null,
        poaeRLog: null
      }
    }
  } catch (error) {
    console.error('[BEAP Decode] Error:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Decoding failed', nonDisclosingError: 'Package decoding failed' }
  }
}

// =============================================================================
// Main Decryption Entry Point
// =============================================================================

/**
 * Decrypt/decode a BEAP package following the canonical pipeline.
 * 
 * Implements A.3.055 stages:
 * 1. Envelope integrity verification
 * 2. Recipient eligibility (qBEAP only)
 * 3. Signature verification
 * 4. Capsule decryption/decoding
 * 
 * @param pkg - Package to decrypt
 * @param options - Decryption options
 * @returns Decryption result
 */
export async function decryptBeapPackage(
  pkg: BeapPackage,
  options: {
    /** Handshake ID for qBEAP (required for qBEAP legacy v1.0 path) */
    handshakeId?: string
    /**
     * Full local handshake records for canonical v2.0 Stage 0 eligibility check.
     *
     * Per A.3.055 Stage 0 (Normative): eligibility MUST be evaluated against all
     * local handshake records using constant-time HMAC comparison.
     *
     * When provided, the v2.0 HMAC-based `evaluateRecipientEligibility` is used
     * (for v2.0 qBEAP packages). The matched handshake's hybridSharedSecret is
     * also used to re-derive the inner envelope key at Stage 4.
     *
     * Falls back to `handshakeId` string match for v1.0 packages.
     */
    handshakes?: LocalHandshake[]
    /** Sender's X25519 public key for key agreement (required for qBEAP). Fallback: pkg.header.crypto.senderX25519PublicKeyB64 */
    senderX25519PublicKey?: string
    /** Receiver's ML-KEM-768 secret key (base64) for hybrid qBEAP decapsulation. Required when package has pq.kemCiphertextB64 */
    mlkemSecretKeyB64?: string
    /** Pre-derived 64-byte hybrid secret (host-side decapsulation); when present, skips ECDH+ML-KEM */
    hybridSharedSecretB64?: string
    /** Skip signature verification (NOT recommended) */
    skipSignatureVerification?: boolean

    /**
     * Known sender identities for Canon §10 Gate 1 verification.
     *
     * When provided, Gate 1 pins the package's `sender_fingerprint` against
     * this set. If the sender is not in the set, Gate 1 fails (fail-closed).
     *
     * When absent, Gate 1 performs structural validation only.
     */
    knownSenders?: SenderIdentity[]

    /**
     * Local receiver identity for Canon §10 Gate 2 verification.
     *
     * When provided, Gate 2 verifies receiver_fingerprint or receiver_binding
     * against this identity. When absent, Gate 2 performs structural check only.
     */
    knownReceiver?: KnownReceiver

    /**
     * Known template hash map for Canon §10 Gate 6 verification.
     *
     * Map from template ID to expected SHA-256 hash.
     * When provided, Gate 6 verifies the package's `template_hash` matches.
     */
    knownTemplateHashes?: Map<string, string>

    /**
     * Expected content hash for Canon §10 Gate 6 content pinning.
     * When provided, Gate 6 verifies `pkg.header.content_hash` matches.
     */
    expectedContentHash?: string

    /**
     * Receiver's capability policy for Stage 6.1 gate (A.3.055 + A.3.054 Stage 6.1.1).
     *
     * Includes base boundary/scope/provider/retention constraints AND optional
     * Capability Tokens that govern data-class access per A.3.054 Stage 6.1.1.
     *
     * Per canon: receiver policy is AUTHORITATIVE. Sender declarations are
     * intent-only and cannot override this policy.
     *
     * Defaults to DEFAULT_CAPABILITY_POLICY (all-NONE, no processing permitted).
     *
     * Backward-compatible: passing a plain `ReceiverProcessingPolicy` (without
     * `capabilityTokens`) is valid — token gating is skipped in that case.
     */
    receiverCapabilityPolicy?: ReceiverCapabilityPolicy
    /**
     * @deprecated Use receiverCapabilityPolicy instead.
     * Accepted for backward compatibility; merged into receiverCapabilityPolicy
     * when receiverCapabilityPolicy is not explicitly provided.
     */
    receiverProcessingPolicy?: ReceiverProcessingPolicy

    /**
     * Anchor provider for Stage 2 PoAE anchor verification (A.3.055 Stage 2).
     *
     * When provided AND `pkg.poae.anchorRequired === true`, the anchor
     * commitment is verified against this provider. Failure → fail-closed.
     *
     * When not provided: anchor verification is skipped (signature check only).
     */
    anchorProvider?: PoAEAnchorProvider

    /**
     * Whether the receiver's policy permits generating a PoAE-R log (Stage 7).
     *
     * When `true`: a PoAE-R log is generated if execution occurs AND the sender
     * requested it. When `false` (default): no PoAE-R log is generated.
     */
    permitPoAERLog?: boolean
  } = {}
): Promise<DecryptionResult> {

  // ==========================================================================
  // Canon §10 — 6-Gate Depackaging Verification Pipeline
  // ==========================================================================
  // The pipeline enforces strict sequential gate ordering. NO later gate
  // executes unless ALL prior gates succeed. This replaces the previous
  // ad-hoc Stage 0 / Stage 1 / signature-check sequence.
  //
  // Gates 1–6 per §10:
  //   1. Sender identity verification
  //   2. Receiver identity verification
  //   3. Ciphertext integrity (AEAD tags, chunk hashes, Merkle root)
  //   4. PQ/Key derivation + AEAD decryption
  //   5. Capsule signature verification (Ed25519)
  //   6. Template hash verification
  //
  // On any gate failure: abort pipeline, return non-disclosing error.
  // Pre-Capsule failures MUST NOT emit receiver-identifying telemetry.

  const pipelineInput: PipelineInput = {
    pkg,
    knownSenders: options.knownSenders,
    knownReceiver: options.knownReceiver,
    senderX25519PublicKey: options.senderX25519PublicKey,
    mlkemSecretKeyB64: options.mlkemSecretKeyB64,
    hybridSharedSecretB64: options.hybridSharedSecretB64,
    skipSignatureVerification: options.skipSignatureVerification,
    knownTemplateHashes: options.knownTemplateHashes,
    expectedContentHash: options.expectedContentHash,
  }

  const pipelineResult = await runDepackagingPipeline(pipelineInput)

  if (!pipelineResult.success || !pipelineResult.verifiedContext) {
    return {
      success: false,
      error: pipelineResult.internalError,
      nonDisclosingError: pipelineResult.nonDisclosingError ?? 'Package verification failed'
    }
  }

  // All 6 gates passed. The pipeline has:
  //   - Verified sender and receiver identity (Gates 1–2)
  //   - Verified ciphertext integrity (Gate 3)
  //   - Derived keys and decrypted capsule plaintext (Gate 4)
  //   - Verified Ed25519 signature (Gate 5)
  //   - Verified template and content hashes (Gate 6)
  //
  // The verified context carries the authorised capsule plaintext and all derived keys.
  const verifiedCtx = pipelineResult.verifiedContext

  // ==========================================================================
  // Stage 2: PoAE Anchor Verification (A.3.055 Stage 2 — Optional High-Assurance)
  // ==========================================================================
  // MUST complete BEFORE any capsule opening, decryption, or execution-relevant
  // parsing. If the package carries a PoAE record with anchorRequired === true,
  // anchor verification failure → fail-closed (no disclosure).
  // If no PoAE record is present: skip (not all packages carry PoAE).
  // ==========================================================================
  let poaeVerification: PoAEVerificationResult | null = null

  if (pkg.poae) {
    const poaeRecord = pkg.poae as PoAERecord
    try {
      poaeVerification = await verifyPoAERecord(poaeRecord, options.anchorProvider)
    } catch {
      // Verification errors are treated as non-disclosing failure when anchor is required
      poaeVerification = {
        signatureValid: false,
        anchorVerified: false,
        anchorRequired: poaeRecord.anchorRequired ?? false,
        meetsHighAssuranceRequirement: false,
        internalReason: 'STAGE2: PoAE verification threw unexpectedly.'
      }
    }

    // Fail-closed: if anchor is required and not satisfied → reject the package
    if (poaeVerification.anchorRequired && !poaeVerification.meetsHighAssuranceRequirement) {
      return {
        success: false,
        error: poaeVerification.internalReason ?? 'STAGE2: Required PoAE anchor verification failed.',
        nonDisclosingError: 'Package verification failed'
      }
    }
  }

  // ==========================================================================
  // Stage 4: Inner Envelope Decryption (A.3.055 Stage 4 — Normative)
  // Applies to v2.0 qBEAP packages only. The pipeline (Gate 4) already derived
  // the innerEnvelopeKey — use it here to decrypt and validate the inner envelope.
  // ==========================================================================
  let innerEnvelopeMetadata: InnerEnvelopeMetadata | null = null
  let effectiveProcessingEvents: ProcessingEventOffer | undefined

  const isV2 = pkg.outerEnvelopeVersion === '2.0' || pkg.header.version === '2.0'

  if (isV2 && pkg.header.encoding === 'qBEAP') {
    if (!pkg.innerEnvelopeCiphertext) {
      return {
        success: false,
        error: 'STAGE_4: v2.0 qBEAP package is missing innerEnvelopeCiphertext. Package REJECTED.',
        nonDisclosingError: 'Package decryption failed'
      }
    }

    try {
      const outerAAD = canonicalSerializeAAD(
        buildEnvelopeAadFields(pkg.header as unknown as Parameters<typeof buildEnvelopeAadFields>[0])
      )

      innerEnvelopeMetadata = await decryptInnerEnvelope(
        pkg.innerEnvelopeCiphertext,
        verifiedCtx.innerEnvelopeKey,
        outerAAD,
        pkg.header.timestamp
      )

      effectiveProcessingEvents = innerEnvelopeMetadata.processingEvents
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Inner envelope decryption failed'
      return {
        success: false,
        error: message,
        nonDisclosingError: 'Package decryption failed'
      }
    }
  } else if (isV2 && pkg.header.encoding === 'pBEAP') {
    effectiveProcessingEvents = pkg.header.processingEvents
  } else {
    effectiveProcessingEvents = pkg.header.processingEvents
  }

  // ==========================================================================
  // Stage 6: Parse Capsule + Artefacts using pipeline-derived keys
  // ==========================================================================
  // The pipeline already decrypted the capsule (Gate 4); we parse here.
  // Artefacts are decrypted using the verified artefactKey from Gate 4.

  let result: DecryptionResult

  if (pkg.header.encoding === 'qBEAP') {
    // Use pipeline-decrypted capsule plaintext (avoid double decryption)
    result = await decryptQBeapPackageFromContext(pkg, verifiedCtx)
  } else {
    result = await decodePBeapPackageFromContext(pkg, verifiedCtx)
  }

  // ==========================================================================
  // Stages 6.1–6.3: Full Processing Event Gate
  // ==========================================================================
  if (result.success && result.package) {
    const effectivePolicy: ReceiverCapabilityPolicy =
      options.receiverCapabilityPolicy ??
      options.receiverProcessingPolicy ??
      DEFAULT_CAPABILITY_POLICY

    const authorizedProcessing = await runStage61Gate(
      result.package.capsule,
      result.package.artefacts,
      effectiveProcessingEvents,
      effectivePolicy
    )

    // ========================================================================
    // Stage 7: PoAE-R Log Generation (A.3.055 Stage 7)
    // ========================================================================
    // Generate a PoAE-R log if ALL of:
    //   1. Execution occurred (capsule was processed — we are here)
    //   2. Sender's processing events request log return (returnPoaeLog flag)
    //   3. Receiver's policy permits it (`permitPoAERLog` option)
    //
    // Absence, delay, or non-return SHALL NOT be interpreted as a processing outcome.
    // ========================================================================
    let poaeRLog: PoAERLog | null = null

    const senderRequestsPoaeLog =
      effectiveProcessingEvents?.declarations?.some(d => d.returnPoaeLog === true) === true

    const receiverPermitsPoaeLog = options.permitPoAERLog === true

    if (senderRequestsPoaeLog && receiverPermitsPoaeLog) {
      try {
        const capsuleHashForLog = await computeCapsuleHash(verifiedCtx.authorizedCapsulePlaintext)
        const receiverPolicyFingerprint = authorizedProcessing.gatingArtefacts[0]?.policyFingerprint ?? ''
        const gatingArtefactIds = authorizedProcessing.gatingArtefacts.map(a => a.artefactId)

        poaeRLog = await generatePoAERLog({
          senderPoAERecordId: pkg.poae?.recordId ?? null,
          capsuleHash: capsuleHashForLog,
          receiverPolicyFingerprint,
          gateDecision: authorizedProcessing.decision,
          gatingArtefactIds,
          returnRequested: true,
          returnPermitted: true,
          executedAt: Date.now(),
          anchorProvider: options.anchorProvider,
        })
      } catch {
        // PoAE-R log generation failure is non-fatal — per canon, absence of
        // the log SHALL NOT be interpreted as a processing outcome.
        poaeRLog = null
      }
    }

    result = {
      ...result,
      package: {
        ...result.package,
        authorizedProcessing,
        innerEnvelopeMetadata,
        pipelineResult,
        poaeVerification,
        poaeRLog,
      }
    }
  }

  return result
}

// =============================================================================
// Package Parsing (from JSON string)
// =============================================================================

/**
 * Parse a .beap file contents into a BeapPackage object.
 * 
 * Per canon A.3.055 Pre-eligibility handling:
 * - Only minimal, non-semantic transport framing
 * - No structural parsing beyond locating boundaries
 * 
 * @param beapJson - JSON string from .beap file
 * @returns Parsed package or error
 */
export function parseBeapFile(
  beapJson: string
): { success: true; package: BeapPackage } | { success: false; error: string } {
  try {
    const pkg = JSON.parse(beapJson) as BeapPackage
    
    // Minimal structural validation (per canon: only transport framing)
    if (!pkg.header) {
      return { success: false, error: 'Missing header' }
    }
    
    if (!pkg.signature) {
      return { success: false, error: 'Missing signature' }
    }
    
    if (!pkg.metadata) {
      return { success: false, error: 'Missing metadata' }
    }
    
    return { success: true, package: pkg }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Invalid JSON'
    }
  }
}

// =============================================================================
// Utility: Get Artefact by Reference
// =============================================================================

/**
 * Get a specific artefact from a decrypted package by reference.
 * 
 * @param pkg - Decrypted package
 * @param artefactRef - Artefact reference to find
 * @returns Artefact or undefined
 */
export function getArtefactByRef(
  pkg: DecryptedPackage,
  artefactRef: string
): DecryptedArtefact | undefined {
  return pkg.artefacts.find(a => a.artefactRef === artefactRef)
}

/**
 * Get all artefacts for an attachment.
 * 
 * @param pkg - Decrypted package
 * @param attachmentId - Attachment ID
 * @returns Array of artefacts
 */
export function getArtefactsForAttachment(
  pkg: DecryptedPackage,
  attachmentId: string
): DecryptedArtefact[] {
  return pkg.artefacts.filter(a => a.attachmentId === attachmentId)
}

/**
 * Get original file artefact for an attachment.
 * 
 * @param pkg - Decrypted package (or any object with artefacts array)
 * @param attachmentId - Attachment ID
 * @returns Original artefact or undefined
 */
export function getOriginalArtefact(
  pkg: { artefacts: DecryptedArtefact[] },
  attachmentId: string
): DecryptedArtefact | undefined {
  return pkg.artefacts.find(
    a => a.attachmentId === attachmentId && a.class === 'original'
  )
}

/**
 * Get raster page artefacts for an attachment (sorted by page number).
 * 
 * @param pkg - Decrypted package
 * @param attachmentId - Attachment ID
 * @returns Array of raster artefacts sorted by page
 */
export function getRasterArtefacts(
  pkg: DecryptedPackage,
  attachmentId: string
): DecryptedArtefact[] {
  return pkg.artefacts
    .filter(a => a.attachmentId === attachmentId && a.class === 'raster')
    .sort((a, b) => (a.page ?? 0) - (b.page ?? 0))
}

