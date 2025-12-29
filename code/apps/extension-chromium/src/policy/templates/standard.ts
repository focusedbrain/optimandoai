/**
 * Standard Policy Template
 * 
 * Balanced template for typical business use.
 * BEAP-first, reasonable derivations, good security.
 * 
 * @version 2.0.0 - BEAP-aligned
 */

import type { CanonicalPolicy } from '../schema'
import { POLICY_VERSION } from '../schema'

export const STANDARD_TEMPLATE: Omit<CanonicalPolicy, 'id' | 'createdAt' | 'updatedAt'> = {
  name: 'Standard Policy',
  description: 'Balanced policy for typical business environments. BEAP-first with reasonable derivations.',
  layer: 'local',
  version: POLICY_VERSION,
  riskTier: 'medium',
  isActive: true,
  tags: ['template', 'standard', 'balanced', 'beap', 'mode:standard'],
  
  // === BEAP-ALIGNED INGRESS ===
  
  // Channels: BEAP primary, extension enabled
  channels: {
    beapPackages: {
      enabled: true,
      requiredAttestation: 'self_signed', // All verified senders (default)
      allowedScopes: ['lan', 'vpn', 'internet'],
      rateLimitPerHour: 500,
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
      enabled: false, // Off by default
      requiredAttestation: 'verified_org',
      allowedScopes: [],
      rateLimitPerHour: 100,
      allowedHandshakeGroups: [],
      blockedSenders: [],
    },
    emailBridge: {
      enabled: false, // Off by default
      requiredAttestation: 'verified_org',
      allowedScopes: [],
      rateLimitPerHour: 50,
      allowedHandshakeGroups: [],
      blockedSenders: [],
    },
    filesystemWatch: {
      enabled: false,
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
  
  // Pre-verification: Reasonable limits
  preVerification: {
    maxPackageSizeBytes: 50_000_000, // 50MB
    maxChunksPerPackage: 100,
    maxArtefactsPerPackage: 50,
    maxArtefactSizeBytes: 25_000_000, // 25MB
    maxPackagesPerSenderPerHour: 100,
    maxPackagesPerGroupPerHour: 500,
    maxUnknownSenderPackagesPerHour: 10,
    maxPendingPackages: 1000,
    rateLimitAction: 'reject',
    verificationFailureBehavior: 'reject',
    invalidSignatureBehavior: 'reject',
    blockedSenderBehavior: 'drop_silent',
    quarantineTimeoutSeconds: 86400, // 24 hours
    maxPendingStorageBytes: 500_000_000, // 500MB
    maxQuarantineStorageBytes: 100_000_000, // 100MB
    autoPurgePending: true,
    requireValidEnvelope: true,
    requireValidTimestamp: true,
    timestampValidityWindowSeconds: 300, // 5 minutes
    requireReplayProtection: true,
    auditPreVerification: true,
    auditRejections: true,
    auditRateLimits: true,
  },
  
  // Derivations: Common business use cases
  derivations: {
    deriveMetadata: { enabled: true, requireApproval: false, maxUsesPerPackage: 0, auditUsage: false },
    derivePlainText: { enabled: true, requireApproval: false, maxUsesPerPackage: 0, auditUsage: true },
    deriveStructuredData: { enabled: true, requireApproval: false, maxUsesPerPackage: 0, auditUsage: true },
    derivePdfText: { enabled: true, requireApproval: false, maxUsesPerPackage: 20, auditUsage: true },
    deriveImageOcr: { enabled: false, requireApproval: false, maxUsesPerPackage: 10, auditUsage: true },
    deriveHtmlSanitized: { enabled: true, requireApproval: false, maxUsesPerPackage: 20, auditUsage: true },
    derivePreviewThumbnails: { enabled: true, requireApproval: false, maxUsesPerPackage: 50, auditUsage: true },
    deriveEmbeddings: { enabled: false, requireApproval: false, maxUsesPerPackage: 10, auditUsage: true },
    deriveLlmSummary: { enabled: false, requireApproval: true, maxUsesPerPackage: 5, auditUsage: true },
    deriveCodeParsed: { enabled: true, requireApproval: false, maxUsesPerPackage: 20, auditUsage: true },
    deriveAutomationExec: { enabled: false, requireApproval: true, maxUsesPerPackage: 1, auditUsage: true },
    deriveSandboxedRender: { enabled: false, requireApproval: true, maxUsesPerPackage: 5, auditUsage: true },
    deriveExternalApiCall: { enabled: false, requireApproval: true, maxUsesPerPackage: 1, auditUsage: true },
    deriveOriginalReconstruction: { enabled: false, requireApproval: true, maxUsesPerPackage: 1, auditUsage: true },
    deriveExternalExport: { enabled: false, requireApproval: true, maxUsesPerPackage: 1, auditUsage: true },
    deriveFullDecryption: { enabled: false, requireApproval: true, maxUsesPerPackage: 1, auditUsage: true },
    maxTotalDerivationsPerPackage: 100,
    requireWrguardActive: true,
    auditAllDerivations: true,
    cacheDerivations: true,
    cacheTtlSeconds: 3600, // 1 hour
  },
  
  // === EGRESS ===
  egress: {
    allowedDestinations: ['*'], // All verified destinations
    blockedDestinations: [],
    allowedDataCategories: ['public', 'internal'],
    allowedChannels: ['email', 'api', 'file_export'],
    requireApproval: true,
    requireEncryption: true,
    maxEgressSizeBytes: 5_000_000, // 5MB
    maxOperationsPerHour: 100,
    auditAllEgress: true,
    redactSensitiveData: true,
    allowBulkExport: false,
    requireDestinationVerification: false,
  },
}

export function createStandardPolicy(): CanonicalPolicy {
  const now = Date.now()
  return {
    ...STANDARD_TEMPLATE,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  }
}
