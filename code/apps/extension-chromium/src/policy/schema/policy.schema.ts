/**
 * Canonical Policy Schema
 * 
 * The ONE canonical policy model used across all layers:
 * - Network Baseline Policy (NBP)
 * - Local Node Policy (LNP)
 * - Handshake/Sender Policy (HSP)
 * - Capsule Ask Policy (CAP)
 * 
 * Effective Policy = INTERSECTION(NBP, LNP, HSP, CAP)
 * No upward override. No escalation. Deny by default.
 * 
 * @version 1.0.0
 */

import { z } from 'zod'

// BEAP-aligned ingress domains (replaces legacy ingress)
import { ChannelsPolicySchema, DEFAULT_CHANNELS_POLICY } from './domains/channels'
import { PreVerificationPolicySchema, DEFAULT_PRE_VERIFICATION_POLICY } from './domains/pre-verification'
import { DerivationsPolicySchema, DEFAULT_DERIVATIONS_POLICY } from './domains/derivations'

// Other domains
import { EgressPolicySchema, DEFAULT_EGRESS_POLICY } from './domains/egress'
import { ExecutionPolicySchema, DEFAULT_EXECUTION_POLICY } from './domains/execution'
import { VaultAccessPolicySchema, DEFAULT_VAULT_ACCESS_POLICY } from './domains/vault-access'
import { IdentityPolicySchema, DEFAULT_IDENTITY_POLICY } from './domains/identity'

// Legacy (deprecated)
import { IngressPolicySchema, DEFAULT_INGRESS_POLICY } from './domains/ingress'

/**
 * Policy version - semantic versioning
 */
export const POLICY_VERSION = '1.0.0' as const

/**
 * Risk tier levels for policy classification
 */
export const RiskTierSchema = z.enum([
  'low',       // Minimal risk, restrictive settings
  'medium',    // Balanced risk/functionality
  'high',      // Elevated risk, requires approval
  'critical',  // Maximum risk, requires multi-party approval
])

export type RiskTier = z.infer<typeof RiskTierSchema>

/**
 * Policy layer types - ordered from most to least restrictive
 */
export const PolicyLayerSchema = z.enum([
  'network',    // Network Baseline Policy (NBP) - most restrictive
  'local',      // Local Node Policy (LNP)
  'handshake',  // Handshake/Sender Policy (HSP)
  'capsule',    // Capsule Ask Policy (CAP) - least restrictive
])

export type PolicyLayer = z.infer<typeof PolicyLayerSchema>

/**
 * Policy metadata schema
 */
export const PolicyMetadataSchema = z.object({
  // Unique identifier (UUID)
  id: z.string().uuid(),
  
  // Human-readable name
  name: z.string().min(1).max(200),
  
  // Optional description
  description: z.string().max(1000).optional(),
  
  // Policy layer
  layer: PolicyLayerSchema,
  
  // Risk tier classification
  riskTier: RiskTierSchema,
  
  // Schema version
  version: z.string().default(POLICY_VERSION),
  
  // Creation timestamp (Unix ms)
  createdAt: z.number().int().positive(),
  
  // Last update timestamp (Unix ms)
  updatedAt: z.number().int().positive(),
  
  // Created by (user/system identifier)
  createdBy: z.string().optional(),
  
  // Last updated by
  updatedBy: z.string().optional(),
  
  // Whether this policy is currently active
  isActive: z.boolean().default(true),
  
  // Parent policy ID (for inheritance/derivation tracking)
  parentPolicyId: z.string().uuid().optional(),
  
  // Tags for organization
  tags: z.array(z.string()).default([]),
})

export type PolicyMetadata = z.infer<typeof PolicyMetadataSchema>

/**
 * Canonical Policy Schema
 * 
 * This is the complete policy structure used across all layers.
 * Each domain is optional to support partial policies and gradual adoption.
 */
export const CanonicalPolicySchema = z.object({
  // Metadata
  ...PolicyMetadataSchema.shape,
  
  // === BEAP-ALIGNED INGRESS DOMAINS ===
  // These replace the legacy "ingress" domain
  
  // Channels: What doors exist (BEAP, webhooks, filesystem)
  channels: ChannelsPolicySchema.optional(),
  
  // PreVerification: DoS protection, rate limits, quarantine (BEFORE BEAP verify)
  preVerification: PreVerificationPolicySchema.optional(),
  
  // Derivations: What can be derived AFTER BEAP verification
  derivations: DerivationsPolicySchema.optional(),
  
  // === OTHER DOMAINS ===
  
  // Egress: What can go OUT
  egress: EgressPolicySchema.optional(),
  
  // Execution: Automation, connectors, filesystem
  execution: ExecutionPolicySchema.optional(),
  
  // VaultAccess: WRVault compartments, queries, decryption
  vaultAccess: VaultAccessPolicySchema.optional(),
  
  // Identity: Attributes, sharing, purpose binding
  identity: IdentityPolicySchema.optional(),
  
  // === LEGACY (deprecated) ===
  // Kept for migration - will be removed in v2.0
  ingress: IngressPolicySchema.optional(),
})

export type CanonicalPolicy = z.infer<typeof CanonicalPolicySchema>

/**
 * Create a new policy with defaults
 */
export function createDefaultPolicy(
  layer: PolicyLayer,
  name: string,
  options?: Partial<{
    description: string
    riskTier: RiskTier
    createdBy: string
  }>
): CanonicalPolicy {
  const now = Date.now()
  const id = crypto.randomUUID()
  
  return {
    id,
    name,
    description: options?.description,
    layer,
    riskTier: options?.riskTier ?? 'low',
    version: POLICY_VERSION,
    createdAt: now,
    updatedAt: now,
    createdBy: options?.createdBy,
    isActive: true,
    tags: [],
    // BEAP-aligned ingress domains
    channels: { ...DEFAULT_CHANNELS_POLICY },
    preVerification: { ...DEFAULT_PRE_VERIFICATION_POLICY },
    derivations: { ...DEFAULT_DERIVATIONS_POLICY },
    // Other domains
    egress: { ...DEFAULT_EGRESS_POLICY },
  }
}

/**
 * Validate a policy object at runtime
 */
export function validatePolicy(policy: unknown): {
  success: boolean
  data?: CanonicalPolicy
  errors?: z.ZodError
} {
  const result = CanonicalPolicySchema.safeParse(policy)
  if (result.success) {
    return { success: true, data: result.data }
  }
  return { success: false, errors: result.error }
}

/**
 * Serialize a policy to canonical JSON string
 * Keys are sorted for deterministic output
 */
export function serializePolicy(policy: CanonicalPolicy): string {
  return JSON.stringify(policy, Object.keys(policy).sort(), 2)
}

/**
 * Calculate SHA-256 hash of a policy for integrity verification
 */
export async function hashPolicy(policy: CanonicalPolicy): Promise<string> {
  const serialized = serializePolicy(policy)
  const encoder = new TextEncoder()
  const data = encoder.encode(serialized)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Risk tier calculation based on policy settings
 */
export function calculateRiskTier(policy: CanonicalPolicy): RiskTier {
  let riskScore = 0
  
  // Channel risks
  if (policy.channels) {
    // Non-BEAP channels enabled = higher risk
    if (policy.channels.httpsWebhooks?.enabled) riskScore += 1
    if (policy.channels.emailBridge?.enabled) riskScore += 1
    if (!policy.channels.requireBeapWrapper) riskScore += 3
    // Low attestation requirements = higher risk
    if (policy.channels.beapPackages?.requiredAttestation === 'none') riskScore += 2
    if (policy.channels.beapPackages?.requiredAttestation === 'self_signed') riskScore += 1
  }
  
  // Pre-verification risks
  if (policy.preVerification) {
    // Lax rate limits
    if (policy.preVerification.maxPackagesPerSenderPerHour === 0) riskScore += 1
    if (policy.preVerification.maxUnknownSenderPackagesPerHour > 50) riskScore += 1
    // Relaxed verification
    if (!policy.preVerification.requireValidEnvelope) riskScore += 2
    if (!policy.preVerification.requireReplayProtection) riskScore += 2
  }
  
  // Derivation risks
  if (policy.derivations) {
    // Critical derivations enabled
    if (policy.derivations.deriveOriginalReconstruction?.enabled) riskScore += 3
    if (policy.derivations.deriveFullDecryption?.enabled) riskScore += 3
    if (policy.derivations.deriveExternalExport?.enabled) riskScore += 2
    // High-risk derivations
    if (policy.derivations.deriveAutomationExec?.enabled) riskScore += 2
    if (policy.derivations.deriveExternalApiCall?.enabled) riskScore += 2
    // WRGuard not required
    if (!policy.derivations.requireWrguardActive) riskScore += 3
  }
  
  // Egress risks
  if (policy.egress) {
    if (!policy.egress.requireApproval) riskScore += 2
    if (!policy.egress.requireEncryption) riskScore += 2
    if (policy.egress.allowBulkExport) riskScore += 2
    if (!policy.egress.auditAllEgress) riskScore += 1
    if (!policy.egress.redactSensitiveData) riskScore += 2
    if (policy.egress.allowedDataCategories.includes('credentials')) riskScore += 3
    if (policy.egress.allowedDataCategories.includes('financial')) riskScore += 2
    if (policy.egress.allowedDataCategories.includes('pii')) riskScore += 2
  }
  
  // Map score to tier
  if (riskScore >= 12) return 'critical'
  if (riskScore >= 7) return 'high'
  if (riskScore >= 3) return 'medium'
  return 'low'
}

/**
 * Apply lockdown to a policy - disable high-risk capabilities
 */
export function lockdownPolicy(
  policy: CanonicalPolicy,
  tier: 'high' | 'critical' = 'high'
): CanonicalPolicy {
  const locked = { ...policy, updatedAt: Date.now() }
  
  // Lockdown channels - disable non-BEAP channels
  if (locked.channels) {
    locked.channels = {
      ...locked.channels,
      httpsWebhooks: { ...locked.channels.httpsWebhooks!, enabled: false },
      emailBridge: { ...locked.channels.emailBridge!, enabled: false },
      filesystemWatch: tier === 'critical' ? { ...locked.channels.filesystemWatch!, enabled: false } : locked.channels.filesystemWatch,
      requireBeapWrapper: true,
      auditChannelActivity: true,
    }
    // Strengthen attestation requirements
    if (locked.channels.beapPackages) {
      locked.channels.beapPackages = {
        ...locked.channels.beapPackages,
        requiredAttestation: tier === 'critical' ? 'verified_org' : 'known_sender',
      }
    }
  }
  
  // Lockdown pre-verification - strict limits
  if (locked.preVerification) {
    locked.preVerification = {
      ...locked.preVerification,
      maxUnknownSenderPackagesPerHour: tier === 'critical' ? 0 : 5,
      verificationFailureBehavior: 'reject',
      invalidSignatureBehavior: 'reject',
      requireValidEnvelope: true,
      requireValidTimestamp: true,
      requireReplayProtection: true,
      auditPreVerification: true,
      auditRejections: true,
    }
  }
  
  // Lockdown derivations - disable high/critical risk
  if (locked.derivations) {
    locked.derivations = {
      ...locked.derivations,
      // Disable all critical derivations
      deriveOriginalReconstruction: { ...locked.derivations.deriveOriginalReconstruction!, enabled: false },
      deriveExternalExport: { ...locked.derivations.deriveExternalExport!, enabled: false },
      deriveFullDecryption: { ...locked.derivations.deriveFullDecryption!, enabled: false },
      // Disable high-risk derivations
      deriveAutomationExec: { ...locked.derivations.deriveAutomationExec!, enabled: false },
      deriveExternalApiCall: { ...locked.derivations.deriveExternalApiCall!, enabled: false },
      deriveSandboxedRender: tier === 'critical' ? { ...locked.derivations.deriveSandboxedRender!, enabled: false } : locked.derivations.deriveSandboxedRender,
      // Enforce WRGuard
      requireWrguardActive: true,
      auditAllDerivations: true,
    }
  }
  
  // Lockdown egress
  if (locked.egress) {
    locked.egress = {
      ...locked.egress,
      requireApproval: true,
      requireEncryption: true,
      allowBulkExport: false,
      auditAllEgress: true,
      redactSensitiveData: true,
      // Remove high-risk data categories
      allowedDataCategories: locked.egress.allowedDataCategories.filter(
        cat => !['credentials', 'financial', 'pii', 'health'].includes(cat)
      ),
    }
    
    if (tier === 'critical') {
      // Critical lockdown: only public data
      locked.egress.allowedDataCategories = ['public']
      locked.egress.allowedChannels = []
    }
  }
  
  locked.riskTier = 'low'
  return locked
}

