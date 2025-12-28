/**
 * Vault Access Domain Schema
 * 
 * Defines WRVault access constraints: compartments, query types, decryption.
 * Deny by default: empty arrays = no vault access.
 */

import { z } from 'zod'

/**
 * Vault operation types
 */
export const VaultOperationSchema = z.enum([
  'read_metadata',      // Read entry metadata only
  'read_content',       // Read decrypted content
  'write_entry',        // Create new entries
  'update_entry',       // Update existing entries
  'delete_entry',       // Delete entries
  'search_content',     // Full-text search
  'search_metadata',    // Metadata search only
  'export_entries',     // Export entries
  'share_entries',      // Share with others
])

export type VaultOperation = z.infer<typeof VaultOperationSchema>

/**
 * Compartment access levels
 */
export const CompartmentAccessSchema = z.enum([
  'none',               // No access
  'read_only',          // Read access only
  'read_write',         // Read and write
  'admin',              // Full admin access
])

export type CompartmentAccess = z.infer<typeof CompartmentAccessSchema>

/**
 * Vault Access Policy Schema
 */
export const VaultAccessPolicySchema = z.object({
  // Allowed vault operations (empty = deny all)
  allowedOperations: z.array(VaultOperationSchema).default([]),
  
  // Compartment access patterns (name -> access level)
  compartmentAccess: z.record(z.string(), CompartmentAccessSchema).default({}),
  
  // Default access for unspecified compartments
  defaultCompartmentAccess: CompartmentAccessSchema.default('none'),
  
  // Allowed content types to decrypt
  allowedContentTypes: z.array(z.string()).default([]),
  
  // Maximum entries per query
  maxEntriesPerQuery: z.number().int().positive().default(100),
  
  // Maximum entries per export
  maxEntriesPerExport: z.number().int().positive().default(50),
  
  // Allow bulk operations
  allowBulkOperations: z.boolean().default(false),
  
  // Require hardware key for sensitive operations
  requireHardwareKey: z.boolean().default(false),
  
  // Time-limited access (seconds, 0 = no limit)
  accessTimeoutSeconds: z.number().int().nonnegative().default(0),
  
  // Audit all vault access
  auditAllAccess: z.boolean().default(true),
  
  // Require purpose specification
  requirePurpose: z.boolean().default(true),
  
  // Purpose binding (only allow specified purposes)
  allowedPurposes: z.array(z.string()).default([]),
})

export type VaultAccessPolicy = z.infer<typeof VaultAccessPolicySchema>

/**
 * Default restrictive vault access policy
 */
export const DEFAULT_VAULT_ACCESS_POLICY: VaultAccessPolicy = {
  allowedOperations: ['search_metadata'],
  compartmentAccess: {},
  defaultCompartmentAccess: 'none',
  allowedContentTypes: [],
  maxEntriesPerQuery: 100,
  maxEntriesPerExport: 50,
  allowBulkOperations: false,
  requireHardwareKey: false,
  accessTimeoutSeconds: 0,
  auditAllAccess: true,
  requirePurpose: true,
  allowedPurposes: [],
}

