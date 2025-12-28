/**
 * Egress Domain Schema
 * 
 * Defines what data can leave the system and where it can go.
 * Deny by default: empty arrays = nothing allowed out.
 */

import { z } from 'zod'

/**
 * Data categories for egress control
 */
export const DataCategorySchema = z.enum([
  'public',         // Publicly available information
  'internal',       // Internal organizational data
  'confidential',   // Confidential business data
  'pii',            // Personally identifiable information
  'financial',      // Financial/payment data
  'health',         // Health/medical information (HIPAA)
  'credentials',    // Passwords, tokens, keys
  'audit',          // Audit/compliance records
])

export type DataCategory = z.infer<typeof DataCategorySchema>

/**
 * Egress channels
 */
export const EgressChannelSchema = z.enum([
  'email',          // Email transmission
  'api',            // API calls to external services
  'webhook',        // Webhook notifications
  'file_export',    // File download/export
  'clipboard',      // Clipboard copy
  'print',          // Print output
  'screen_share',   // Screen sharing
  'messaging',      // IM/chat platforms
])

export type EgressChannel = z.infer<typeof EgressChannelSchema>

/**
 * Destination pattern for allowlist/blocklist
 */
export const DestinationPatternSchema = z.object({
  pattern: z.string(), // Domain, email pattern, or API endpoint
  type: z.enum(['domain', 'email', 'api', 'ip']),
  description: z.string().optional(),
})

export type DestinationPattern = z.infer<typeof DestinationPatternSchema>

/**
 * Egress Policy Schema
 * Controls what can leave the system
 */
export const EgressPolicySchema = z.object({
  // Allowed destination patterns (empty = deny all)
  allowedDestinations: z.array(z.string()).default([]),
  
  // Blocked destination patterns (takes precedence over allowed)
  blockedDestinations: z.array(z.string()).default([]),
  
  // Allowed data categories for egress (empty = deny all)
  allowedDataCategories: z.array(DataCategorySchema).default([]),
  
  // Allowed egress channels (empty = deny all)
  allowedChannels: z.array(EgressChannelSchema).default([]),
  
  // Require human approval for egress
  requireApproval: z.boolean().default(true),
  
  // Require encryption for egress
  requireEncryption: z.boolean().default(true),
  
  // Maximum egress size in bytes per operation
  maxEgressSizeBytes: z.number().int().positive().default(5_000_000), // 5MB
  
  // Rate limiting: max operations per hour
  maxOperationsPerHour: z.number().int().positive().default(100),
  
  // Log all egress operations
  auditAllEgress: z.boolean().default(true),
  
  // Redact sensitive data before egress
  redactSensitiveData: z.boolean().default(true),
  
  // Allow bulk export operations
  allowBulkExport: z.boolean().default(false),
  
  // Require destination verification (e.g., email confirmation)
  requireDestinationVerification: z.boolean().default(false),
})

export type EgressPolicy = z.infer<typeof EgressPolicySchema>

/**
 * Default restrictive egress policy
 */
export const DEFAULT_EGRESS_POLICY: EgressPolicy = {
  allowedDestinations: [],
  blockedDestinations: [],
  allowedDataCategories: ['public'], // Only public data by default
  allowedChannels: [], // No channels by default
  requireApproval: true,
  requireEncryption: true,
  maxEgressSizeBytes: 5_000_000,
  maxOperationsPerHour: 100,
  auditAllEgress: true,
  redactSensitiveData: true,
  allowBulkExport: false,
  requireDestinationVerification: false,
}


