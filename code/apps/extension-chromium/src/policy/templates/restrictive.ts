/**
 * Restrictive Policy Template
 * 
 * Locked-down template for high-security environments.
 * BEAP-only, minimal derivations, maximum restrictions.
 * 
 * @version 2.0.0 - BEAP-aligned
 */

import type { CanonicalPolicy } from '../schema'
import { POLICY_VERSION } from '../schema'

export const RESTRICTIVE_TEMPLATE: Omit<CanonicalPolicy, 'id' | 'createdAt' | 'updatedAt'> = {
  name: 'Restrictive Policy',
  description: 'Locked-down policy for high-security environments. BEAP-only, minimal derivations.',
  layer: 'local',
  version: POLICY_VERSION,
  riskTier: 'low',
  isActive: true,
  tags: ['template', 'restrictive', 'security', 'beap', 'mode:restrictive'],
  
  // === BEAP-ALIGNED INGRESS ===
  
  // Channels: BEAP only, all verified senders
  channels: {
    beapPackages: {
      enabled: true,
      requiredAttestation: 'self_signed', // All verified senders (default)
      allowedScopes: ['lan', 'vpn', 'internet'],
      rateLimitPerHour: 100,
      allowedHandshakeGroups: [],
      blockedSenders: [],
    },
    localPackageBuilder: {
      enabled: true,
      requiredAttestation: 'none',
      allowedScopes: ['localhost'],
      rateLimitPerHour: 0,
      allowedHandshakeGroups: [],
      blockedSenders: [],
    },
    httpsWebhooks: {
      enabled: false, // Disabled
      requiredAttestation: 'verified_org',
      allowedScopes: [],
      rateLimitPerHour: 0,
      allowedHandshakeGroups: [],
      blockedSenders: [],
    },
    emailBridge: {
      enabled: false, // Disabled
      requiredAttestation: 'verified_org',
      allowedScopes: [],
      rateLimitPerHour: 0,
      allowedHandshakeGroups: [],
      blockedSenders: [],
    },
    filesystemWatch: {
      enabled: false, // Disabled
      requiredAttestation: 'none',
      allowedScopes: ['localhost'],
      rateLimitPerHour: 0,
      allowedHandshakeGroups: [],
      blockedSenders: [],
    },
    browserExtension: {
      enabled: true,
      requiredAttestation: 'none',
      allowedScopes: ['localhost'],
      rateLimitPerHour: 0,
      allowedHandshakeGroups: [],
      blockedSenders: [],
    },
    requireBeapWrapper: true,
    auditChannelActivity: true,
  },
  
  // Pre-verification: Strict limits
  preVerification: {
    maxPackageSizeBytes: 10_000_000, // 10MB
    maxChunksPerPackage: 20,
    maxArtefactsPerPackage: 10,
    maxArtefactSizeBytes: 5_000_000, // 5MB
    maxPackagesPerSenderPerHour: 50,
    maxPackagesPerGroupPerHour: 200,
    maxUnknownSenderPackagesPerHour: 0, // Block unknown senders
    maxPendingPackages: 100,
    rateLimitAction: 'reject',
    verificationFailureBehavior: 'reject',
    invalidSignatureBehavior: 'reject',
    blockedSenderBehavior: 'drop_silent',
    quarantineTimeoutSeconds: 3600, // 1 hour
    maxPendingStorageBytes: 100_000_000, // 100MB
    maxQuarantineStorageBytes: 50_000_000, // 50MB
    autoPurgePending: true,
    requireValidEnvelope: true,
    requireValidTimestamp: true,
    timestampValidityWindowSeconds: 60, // Very strict: 1 minute
    requireReplayProtection: true,
    auditPreVerification: true,
    auditRejections: true,
    auditRateLimits: true,
  },
  
  // Derivations: Minimal - metadata and plain text only
  derivations: {
    deriveMetadata: { enabled: true, requireApproval: false, maxUsesPerPackage: 0, auditUsage: false },
    derivePlainText: { enabled: true, requireApproval: false, maxUsesPerPackage: 0, auditUsage: true },
    deriveStructuredData: { enabled: false, requireApproval: false, maxUsesPerPackage: 0, auditUsage: true },
    derivePdfText: { enabled: false, requireApproval: false, maxUsesPerPackage: 0, auditUsage: true },
    deriveImageOcr: { enabled: false, requireApproval: false, maxUsesPerPackage: 0, auditUsage: true },
    deriveHtmlSanitized: { enabled: false, requireApproval: false, maxUsesPerPackage: 0, auditUsage: true },
    derivePreviewThumbnails: { enabled: false, requireApproval: false, maxUsesPerPackage: 0, auditUsage: true },
    deriveEmbeddings: { enabled: false, requireApproval: false, maxUsesPerPackage: 0, auditUsage: true },
    deriveLlmSummary: { enabled: false, requireApproval: true, maxUsesPerPackage: 0, auditUsage: true },
    deriveCodeParsed: { enabled: false, requireApproval: false, maxUsesPerPackage: 0, auditUsage: true },
    deriveAutomationExec: { enabled: false, requireApproval: true, maxUsesPerPackage: 0, auditUsage: true },
    deriveSandboxedRender: { enabled: false, requireApproval: true, maxUsesPerPackage: 0, auditUsage: true },
    deriveExternalApiCall: { enabled: false, requireApproval: true, maxUsesPerPackage: 0, auditUsage: true },
    deriveOriginalReconstruction: { enabled: false, requireApproval: true, maxUsesPerPackage: 0, auditUsage: true },
    deriveExternalExport: { enabled: false, requireApproval: true, maxUsesPerPackage: 0, auditUsage: true },
    deriveFullDecryption: { enabled: false, requireApproval: true, maxUsesPerPackage: 0, auditUsage: true },
    maxTotalDerivationsPerPackage: 50,
    requireWrguardActive: true,
    auditAllDerivations: true,
    cacheDerivations: true,
    cacheTtlSeconds: 1800, // 30 min
  },
  
  // === EGRESS ===
  egress: {
    allowedDestinations: [], // Must be explicitly configured
    blockedDestinations: [],
    allowedDataCategories: ['public'], // Only public data
    allowedChannels: ['email'], // Only email
    requireApproval: true,
    requireEncryption: true,
    maxEgressSizeBytes: 1_000_000, // 1MB
    maxOperationsPerHour: 50,
    auditAllEgress: true,
    redactSensitiveData: true,
    allowBulkExport: false,
    requireDestinationVerification: true,
  },
}

export function createRestrictivePolicy(): CanonicalPolicy {
  const now = Date.now()
  return {
    ...RESTRICTIVE_TEMPLATE,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  }
}
