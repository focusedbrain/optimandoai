/**
 * Policy Backend Types
 * 
 * Types for the Electron policy service.
 */

import { z } from 'zod'

/**
 * Admin Policy Package Schema (BEAP - Backend Admin Package)
 * 
 * Used for distributing network baseline policies to nodes.
 */
export const AdminPolicyPackageSchema = z.object({
  // Package identifier
  id: z.string().uuid(),
  
  // Package version
  version: z.string(),
  
  // Target selectors - which nodes should receive this package
  targetSelectors: z.object({
    nodeIds: z.array(z.string()).optional(),
    groups: z.array(z.string()).optional(),
    all: z.boolean().optional(),
  }),
  
  // The policy payload (serialized CanonicalPolicy)
  policyPayload: z.string(),
  
  // When this package becomes effective
  effectiveDate: z.number(),
  
  // Optional rollback reference
  rollbackReference: z.string().optional(),
  
  // Digital signature metadata
  signatureMetadata: z.object({
    algorithm: z.string(),
    keyId: z.string(),
    signature: z.string(),
  }).optional(),
  
  // Content hashes for integrity verification
  hashes: z.object({
    sha256: z.string(),
    sha512: z.string().optional(),
  }),
  
  // Package metadata
  metadata: z.object({
    createdAt: z.number(),
    createdBy: z.string(),
    description: z.string().optional(),
    priority: z.number().default(0),
    expiresAt: z.number().optional(),
  }),
})

export type AdminPolicyPackage = z.infer<typeof AdminPolicyPackageSchema>

/**
 * Policy sync status
 */
export interface PolicySyncStatus {
  lastSync: number | null
  lastPackageId: string | null
  pendingPackages: number
  status: 'synced' | 'pending' | 'error'
  errorMessage?: string
}

/**
 * Policy application result
 */
export interface PolicyApplicationResult {
  success: boolean
  packageId: string
  appliedAt: number
  previousPolicyId?: string
  error?: string
}

/**
 * Node registration for policy distribution
 */
export interface PolicyNode {
  id: string
  name: string
  groups: string[]
  lastSeen: number
  policyVersion: string | null
  syncStatus: PolicySyncStatus
}



