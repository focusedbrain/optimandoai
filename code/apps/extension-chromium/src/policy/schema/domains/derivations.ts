/**
 * Post-Verification Derivations Domain Schema
 * 
 * Controls WHAT CAN BE DERIVED from artefacts AFTER BEAP verification.
 * This is the capability model - what transformations/processing are allowed.
 * 
 * BEAP SECURITY INVARIANT:
 * - ALL derivations occur ONLY after BEAP verification completes
 * - Original artefacts remain sealed in the verified package
 * - Derivations are one-way (cannot reconstruct original by default)
 * - Each derivation has a risk tier
 * 
 * @version 2.0.0
 */

import { z } from 'zod'

/**
 * Risk tier for derivations
 */
export const DerivationRiskSchema = z.enum([
  'minimal',    // Read-only metadata, no content exposure
  'low',        // Safe text extraction, no execution risk
  'medium',     // Content transformation, potential info leakage
  'high',       // Complex processing, execution context
  'critical',   // Full access, reconstruction, or external calls
])

export type DerivationRisk = z.infer<typeof DerivationRiskSchema>

/**
 * Derivation capability configuration
 */
export const DerivationCapabilitySchema = z.object({
  // Whether this derivation is permitted
  enabled: z.boolean(),
  
  // Require explicit approval per-use
  requireApproval: z.boolean().default(false),
  
  // Maximum uses per package (0 = unlimited)
  maxUsesPerPackage: z.number().int().nonnegative().default(0),
  
  // Log all uses
  auditUsage: z.boolean().default(true),
})

export type DerivationCapability = z.infer<typeof DerivationCapabilitySchema>

/**
 * Derivations Policy Schema
 * 
 * Defines which post-verification derivations are permitted.
 * Grouped by risk tier and category.
 */
export const DerivationsPolicySchema = z.object({
  // ========================================
  // MINIMAL RISK - Metadata only
  // ========================================
  
  // Extract artefact metadata (size, type, count, timestamps)
  deriveMetadata: DerivationCapabilitySchema.default({
    enabled: true, // Safe by default
    requireApproval: false,
    maxUsesPerPackage: 0,
    auditUsage: false, // Too noisy to log
  }),
  
  // ========================================
  // LOW RISK - Safe text extraction
  // ========================================
  
  // Extract plain text from text-based artefacts
  derivePlainText: DerivationCapabilitySchema.default({
    enabled: true,
    requireApproval: false,
    maxUsesPerPackage: 0,
    auditUsage: true,
  }),
  
  // Extract structured data (JSON/CSV) without transformation
  deriveStructuredData: DerivationCapabilitySchema.default({
    enabled: true,
    requireApproval: false,
    maxUsesPerPackage: 0,
    auditUsage: true,
  }),
  
  // ========================================
  // MEDIUM RISK - Content transformation
  // ========================================
  
  // Extract text from PDF documents
  derivePdfText: DerivationCapabilitySchema.default({
    enabled: false, // Off by default
    requireApproval: false,
    maxUsesPerPackage: 10,
    auditUsage: true,
  }),
  
  // OCR text from images
  deriveImageOcr: DerivationCapabilitySchema.default({
    enabled: false,
    requireApproval: false,
    maxUsesPerPackage: 10,
    auditUsage: true,
  }),
  
  // Sanitize HTML (strip scripts, styles, external refs)
  deriveHtmlSanitized: DerivationCapabilitySchema.default({
    enabled: false,
    requireApproval: false,
    maxUsesPerPackage: 10,
    auditUsage: true,
  }),
  
  // Generate preview thumbnails
  derivePreviewThumbnails: DerivationCapabilitySchema.default({
    enabled: false,
    requireApproval: false,
    maxUsesPerPackage: 20,
    auditUsage: true,
  }),
  
  // Generate vector embeddings
  deriveEmbeddings: DerivationCapabilitySchema.default({
    enabled: false,
    requireApproval: false,
    maxUsesPerPackage: 5,
    auditUsage: true,
  }),
  
  // LLM-generated summary
  deriveLlmSummary: DerivationCapabilitySchema.default({
    enabled: false,
    requireApproval: true, // Requires approval
    maxUsesPerPackage: 3,
    auditUsage: true,
  }),
  
  // Code syntax highlighting / parsing
  deriveCodeParsed: DerivationCapabilitySchema.default({
    enabled: false,
    requireApproval: false,
    maxUsesPerPackage: 10,
    auditUsage: true,
  }),
  
  // ========================================
  // HIGH RISK - Execution context
  // ========================================
  
  // Execute automation/workflow steps
  deriveAutomationExec: DerivationCapabilitySchema.default({
    enabled: false,
    requireApproval: true,
    maxUsesPerPackage: 1,
    auditUsage: true,
  }),
  
  // Render in sandboxed preview
  deriveSandboxedRender: DerivationCapabilitySchema.default({
    enabled: false,
    requireApproval: true,
    maxUsesPerPackage: 3,
    auditUsage: true,
  }),
  
  // Call external APIs with derived data
  deriveExternalApiCall: DerivationCapabilitySchema.default({
    enabled: false,
    requireApproval: true,
    maxUsesPerPackage: 1,
    auditUsage: true,
  }),
  
  // ========================================
  // CRITICAL RISK - Full access
  // ========================================
  
  // Reconstruct original artefact from sealed package
  deriveOriginalReconstruction: DerivationCapabilitySchema.default({
    enabled: false,
    requireApproval: true,
    maxUsesPerPackage: 1,
    auditUsage: true,
  }),
  
  // Export to external storage
  deriveExternalExport: DerivationCapabilitySchema.default({
    enabled: false,
    requireApproval: true,
    maxUsesPerPackage: 1,
    auditUsage: true,
  }),
  
  // Full content decryption (if encrypted sub-layers)
  deriveFullDecryption: DerivationCapabilitySchema.default({
    enabled: false,
    requireApproval: true,
    maxUsesPerPackage: 1,
    auditUsage: true,
  }),
  
  // ========================================
  // GLOBAL DERIVATION SETTINGS
  // ========================================
  
  // Maximum total derivations per package
  maxTotalDerivationsPerPackage: z.number().int().positive().default(100),
  
  // Require WRGuard active for any derivation
  requireWrguardActive: z.boolean().default(true),
  
  // Log all derivation attempts
  auditAllDerivations: z.boolean().default(true),
  
  // Cache derived results (for performance)
  cacheDerivations: z.boolean().default(true),
  
  // Cache TTL (seconds)
  cacheTtlSeconds: z.number().int().positive().default(3600), // 1 hour
})

export type DerivationsPolicy = z.infer<typeof DerivationsPolicySchema>

/**
 * Default derivations policy - minimal by default
 */
export const DEFAULT_DERIVATIONS_POLICY: DerivationsPolicy = {
  deriveMetadata: {
    enabled: true,
    requireApproval: false,
    maxUsesPerPackage: 0,
    auditUsage: false,
  },
  derivePlainText: {
    enabled: true,
    requireApproval: false,
    maxUsesPerPackage: 0,
    auditUsage: true,
  },
  deriveStructuredData: {
    enabled: true,
    requireApproval: false,
    maxUsesPerPackage: 0,
    auditUsage: true,
  },
  derivePdfText: {
    enabled: false,
    requireApproval: false,
    maxUsesPerPackage: 10,
    auditUsage: true,
  },
  deriveImageOcr: {
    enabled: false,
    requireApproval: false,
    maxUsesPerPackage: 10,
    auditUsage: true,
  },
  deriveHtmlSanitized: {
    enabled: false,
    requireApproval: false,
    maxUsesPerPackage: 10,
    auditUsage: true,
  },
  derivePreviewThumbnails: {
    enabled: false,
    requireApproval: false,
    maxUsesPerPackage: 20,
    auditUsage: true,
  },
  deriveEmbeddings: {
    enabled: false,
    requireApproval: false,
    maxUsesPerPackage: 5,
    auditUsage: true,
  },
  deriveLlmSummary: {
    enabled: false,
    requireApproval: true,
    maxUsesPerPackage: 3,
    auditUsage: true,
  },
  deriveCodeParsed: {
    enabled: false,
    requireApproval: false,
    maxUsesPerPackage: 10,
    auditUsage: true,
  },
  deriveAutomationExec: {
    enabled: false,
    requireApproval: true,
    maxUsesPerPackage: 1,
    auditUsage: true,
  },
  deriveSandboxedRender: {
    enabled: false,
    requireApproval: true,
    maxUsesPerPackage: 3,
    auditUsage: true,
  },
  deriveExternalApiCall: {
    enabled: false,
    requireApproval: true,
    maxUsesPerPackage: 1,
    auditUsage: true,
  },
  deriveOriginalReconstruction: {
    enabled: false,
    requireApproval: true,
    maxUsesPerPackage: 1,
    auditUsage: true,
  },
  deriveExternalExport: {
    enabled: false,
    requireApproval: true,
    maxUsesPerPackage: 1,
    auditUsage: true,
  },
  deriveFullDecryption: {
    enabled: false,
    requireApproval: true,
    maxUsesPerPackage: 1,
    auditUsage: true,
  },
  maxTotalDerivationsPerPackage: 100,
  requireWrguardActive: true,
  auditAllDerivations: true,
  cacheDerivations: true,
  cacheTtlSeconds: 3600,
}

/**
 * Get risk tier for a derivation capability
 */
export function getDerivationRisk(capability: keyof DerivationsPolicy): DerivationRisk {
  const riskMap: Record<string, DerivationRisk> = {
    deriveMetadata: 'minimal',
    derivePlainText: 'low',
    deriveStructuredData: 'low',
    derivePdfText: 'medium',
    deriveImageOcr: 'medium',
    deriveHtmlSanitized: 'medium',
    derivePreviewThumbnails: 'medium',
    deriveEmbeddings: 'medium',
    deriveLlmSummary: 'medium',
    deriveCodeParsed: 'medium',
    deriveAutomationExec: 'high',
    deriveSandboxedRender: 'high',
    deriveExternalApiCall: 'high',
    deriveOriginalReconstruction: 'critical',
    deriveExternalExport: 'critical',
    deriveFullDecryption: 'critical',
  }
  return riskMap[capability] ?? 'medium'
}



