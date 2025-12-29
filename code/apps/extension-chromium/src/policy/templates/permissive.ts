/**
 * Permissive Policy Template
 * 
 * Development/testing template with relaxed restrictions.
 * BEAP still required, but more derivations enabled.
 * NOT for production use.
 * 
 * @version 2.0.0 - BEAP-aligned
 */

import type { CanonicalPolicy } from '../schema'
import { POLICY_VERSION } from '../schema'

export const PERMISSIVE_TEMPLATE: Omit<CanonicalPolicy, 'id' | 'createdAt' | 'updatedAt'> = {
  name: 'Extended Automation Policy',
  description: 'Full automation capabilities with multi-step workflows and scheduling. All critical actions still require consent.',
  layer: 'local',
  version: POLICY_VERSION,
  riskTier: 'medium',
  isActive: true,
  tags: ['template', 'permissive', 'extended', 'beap', 'mode:permissive'],
  
  // === BEAP-ALIGNED INGRESS ===
  
  // Channels: BEAP primary, most channels available
  channels: {
    beapPackages: {
      enabled: true,
      requiredAttestation: 'self_signed', // Lower bar for dev
      allowedScopes: ['localhost', 'lan', 'vpn', 'internet'],
      rateLimitPerHour: 0, // Unlimited
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
      enabled: true, // Enabled for dev
      requiredAttestation: 'self_signed',
      allowedScopes: ['localhost', 'lan'],
      rateLimitPerHour: 500,
      allowedHandshakeGroups: [],
      blockedSenders: [],
    },
    emailBridge: {
      enabled: false, // Still off - legacy
      requiredAttestation: 'known_sender',
      allowedScopes: [],
      rateLimitPerHour: 100,
      allowedHandshakeGroups: [],
      blockedSenders: [],
    },
    filesystemWatch: {
      enabled: true, // Enabled for dev
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
    requireBeapWrapper: true, // STILL REQUIRED - security invariant
    auditChannelActivity: true,
  },
  
  // Pre-verification: Relaxed limits
  preVerification: {
    maxPackageSizeBytes: 200_000_000, // 200MB
    maxChunksPerPackage: 500,
    maxArtefactsPerPackage: 200,
    maxArtefactSizeBytes: 100_000_000, // 100MB
    maxPackagesPerSenderPerHour: 1000,
    maxPackagesPerGroupPerHour: 5000,
    maxUnknownSenderPackagesPerHour: 50, // Allow some unknown
    maxPendingPackages: 5000,
    rateLimitAction: 'queue', // Queue instead of reject
    verificationFailureBehavior: 'quarantine', // Quarantine for inspection
    invalidSignatureBehavior: 'reject', // Still reject invalid sigs
    blockedSenderBehavior: 'reject',
    quarantineTimeoutSeconds: 604800, // 7 days
    maxPendingStorageBytes: 2_000_000_000, // 2GB
    maxQuarantineStorageBytes: 500_000_000, // 500MB
    autoPurgePending: true,
    requireValidEnvelope: true, // Still require valid envelope
    requireValidTimestamp: true,
    timestampValidityWindowSeconds: 3600, // 1 hour - relaxed
    requireReplayProtection: true,
    auditPreVerification: true,
    auditRejections: true,
    auditRateLimits: true,
  },
  
  // Derivations: Most enabled for development
  derivations: {
    deriveMetadata: { enabled: true, requireApproval: false, maxUsesPerPackage: 0, auditUsage: false },
    derivePlainText: { enabled: true, requireApproval: false, maxUsesPerPackage: 0, auditUsage: true },
    deriveStructuredData: { enabled: true, requireApproval: false, maxUsesPerPackage: 0, auditUsage: true },
    derivePdfText: { enabled: true, requireApproval: false, maxUsesPerPackage: 0, auditUsage: true },
    deriveImageOcr: { enabled: true, requireApproval: false, maxUsesPerPackage: 0, auditUsage: true },
    deriveHtmlSanitized: { enabled: true, requireApproval: false, maxUsesPerPackage: 0, auditUsage: true },
    derivePreviewThumbnails: { enabled: true, requireApproval: false, maxUsesPerPackage: 0, auditUsage: true },
    deriveEmbeddings: { enabled: true, requireApproval: false, maxUsesPerPackage: 0, auditUsage: true },
    deriveLlmSummary: { enabled: true, requireApproval: false, maxUsesPerPackage: 0, auditUsage: true },
    deriveCodeParsed: { enabled: true, requireApproval: false, maxUsesPerPackage: 0, auditUsage: true },
    deriveAutomationExec: { enabled: true, requireApproval: true, maxUsesPerPackage: 10, auditUsage: true },
    deriveSandboxedRender: { enabled: true, requireApproval: false, maxUsesPerPackage: 20, auditUsage: true },
    deriveExternalApiCall: { enabled: true, requireApproval: true, maxUsesPerPackage: 10, auditUsage: true },
    // CRITICAL derivations still require approval even in dev
    deriveOriginalReconstruction: { enabled: true, requireApproval: true, maxUsesPerPackage: 5, auditUsage: true },
    deriveExternalExport: { enabled: true, requireApproval: true, maxUsesPerPackage: 5, auditUsage: true },
    deriveFullDecryption: { enabled: false, requireApproval: true, maxUsesPerPackage: 1, auditUsage: true }, // Still disabled
    maxTotalDerivationsPerPackage: 500,
    requireWrguardActive: true, // STILL REQUIRED - security invariant
    auditAllDerivations: true,
    cacheDerivations: true,
    cacheTtlSeconds: 7200, // 2 hours
  },
  
  // === EGRESS ===
  egress: {
    allowedDestinations: ['*'],
    blockedDestinations: [],
    allowedDataCategories: ['public', 'internal', 'confidential'],
    allowedChannels: ['email', 'api', 'webhook', 'file_export', 'clipboard'],
    requireApproval: false, // No approval in dev
    requireEncryption: false, // Relaxed for dev
    maxEgressSizeBytes: 50_000_000, // 50MB
    maxOperationsPerHour: 1000,
    auditAllEgress: true, // Still audit
    redactSensitiveData: false, // Relaxed for dev
    allowBulkExport: true, // Allow in dev
    requireDestinationVerification: false,
  },
}

export function createPermissivePolicy(): CanonicalPolicy {
  const now = Date.now()
  return {
    ...PERMISSIVE_TEMPLATE,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  }
}
