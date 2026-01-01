/**
 * Policy Service
 * 
 * Handles policy CRUD, package distribution, and evaluation on the backend.
 */

import { 
  AdminPolicyPackageSchema, 
  type AdminPolicyPackage, 
  type PolicySyncStatus,
  type PolicyApplicationResult,
  type PolicyNode,
} from './types'
import * as crypto from 'crypto'

// In-memory storage (replace with DB in production)
let localPolicy: any = null
let networkPolicy: any = null
let appliedPackages: AdminPolicyPackage[] = []
let registeredNodes: PolicyNode[] = []

/**
 * Create an admin policy package
 */
export function createAdminPackage(
  policyPayload: string,
  options: {
    targetNodeIds?: string[]
    targetGroups?: string[]
    targetAll?: boolean
    description?: string
    createdBy: string
    effectiveDate?: number
  }
): AdminPolicyPackage {
  const now = Date.now()
  const payloadHash = crypto.createHash('sha256').update(policyPayload).digest('hex')
  
  const pkg: AdminPolicyPackage = {
    id: crypto.randomUUID(),
    version: '1.0.0',
    targetSelectors: {
      nodeIds: options.targetNodeIds,
      groups: options.targetGroups,
      all: options.targetAll ?? false,
    },
    policyPayload,
    effectiveDate: options.effectiveDate ?? now,
    hashes: {
      sha256: payloadHash,
    },
    metadata: {
      createdAt: now,
      createdBy: options.createdBy,
      description: options.description,
      priority: 0,
    },
  }
  
  // Validate
  const result = AdminPolicyPackageSchema.safeParse(pkg)
  if (!result.success) {
    throw new Error(`Invalid package: ${result.error.message}`)
  }
  
  return pkg
}

/**
 * Sign an admin package
 */
export function signAdminPackage(
  pkg: AdminPolicyPackage,
  privateKey: string,
  keyId: string
): AdminPolicyPackage {
  const sign = crypto.createSign('SHA256')
  sign.update(pkg.policyPayload)
  const signature = sign.sign(privateKey, 'base64')
  
  return {
    ...pkg,
    signatureMetadata: {
      algorithm: 'RS256',
      keyId,
      signature,
    },
  }
}

/**
 * Verify an admin package signature
 */
export function verifyAdminPackage(
  pkg: AdminPolicyPackage,
  publicKey: string
): boolean {
  if (!pkg.signatureMetadata) {
    return false
  }
  
  try {
    const verify = crypto.createVerify('SHA256')
    verify.update(pkg.policyPayload)
    return verify.verify(publicKey, pkg.signatureMetadata.signature, 'base64')
  } catch {
    return false
  }
}

/**
 * Apply an admin package to update the network policy
 */
export function applyAdminPackage(pkg: AdminPolicyPackage): PolicyApplicationResult {
  const now = Date.now()
  
  try {
    // Verify hash
    const computedHash = crypto.createHash('sha256').update(pkg.policyPayload).digest('hex')
    if (computedHash !== pkg.hashes.sha256) {
      return {
        success: false,
        packageId: pkg.id,
        appliedAt: now,
        error: 'Hash verification failed',
      }
    }
    
    // Parse policy
    const policy = JSON.parse(pkg.policyPayload)
    const previousPolicyId = networkPolicy?.id
    
    // Store
    networkPolicy = policy
    appliedPackages.push(pkg)
    
    console.log('[PolicyService] Applied admin package:', pkg.id)
    
    return {
      success: true,
      packageId: pkg.id,
      appliedAt: now,
      previousPolicyId,
    }
  } catch (e: any) {
    return {
      success: false,
      packageId: pkg.id,
      appliedAt: now,
      error: e.message,
    }
  }
}

/**
 * Get current network policy
 */
export function getNetworkPolicy(): any {
  return networkPolicy
}

/**
 * Get local policy
 */
export function getLocalPolicy(): any {
  return localPolicy
}

/**
 * Set local policy
 */
export function setLocalPolicy(policy: any): void {
  localPolicy = policy
}

/**
 * Get applied packages history
 */
export function getAppliedPackages(): AdminPolicyPackage[] {
  return appliedPackages
}

/**
 * Rollback to a previous package
 */
export function rollbackToPackage(packageId: string): PolicyApplicationResult {
  const pkg = appliedPackages.find(p => p.id === packageId)
  if (!pkg) {
    return {
      success: false,
      packageId,
      appliedAt: Date.now(),
      error: 'Package not found',
    }
  }
  
  return applyAdminPackage(pkg)
}

/**
 * Register a node for policy distribution
 */
export function registerNode(node: Omit<PolicyNode, 'lastSeen' | 'syncStatus'>): PolicyNode {
  const existing = registeredNodes.find(n => n.id === node.id)
  
  const fullNode: PolicyNode = {
    ...node,
    lastSeen: Date.now(),
    syncStatus: {
      lastSync: null,
      lastPackageId: null,
      pendingPackages: 0,
      status: 'pending',
    },
  }
  
  if (existing) {
    Object.assign(existing, fullNode)
    return existing
  }
  
  registeredNodes.push(fullNode)
  return fullNode
}

/**
 * Get registered nodes
 */
export function getRegisteredNodes(): PolicyNode[] {
  return registeredNodes
}

/**
 * Get pending packages for a node
 */
export function getPendingPackagesForNode(nodeId: string): AdminPolicyPackage[] {
  const node = registeredNodes.find(n => n.id === nodeId)
  if (!node) return []
  
  return appliedPackages.filter(pkg => {
    // Check if package targets this node
    if (pkg.targetSelectors.all) return true
    if (pkg.targetSelectors.nodeIds?.includes(nodeId)) return true
    if (pkg.targetSelectors.groups?.some(g => node.groups.includes(g))) return true
    return false
  }).filter(pkg => {
    // Check if already applied
    return !node.syncStatus.lastPackageId || 
           pkg.metadata.createdAt > (node.syncStatus.lastSync ?? 0)
  })
}

/**
 * Mark node as synced
 */
export function markNodeSynced(nodeId: string, packageId: string): void {
  const node = registeredNodes.find(n => n.id === nodeId)
  if (!node) return
  
  node.lastSeen = Date.now()
  node.syncStatus = {
    lastSync: Date.now(),
    lastPackageId: packageId,
    pendingPackages: 0,
    status: 'synced',
  }
  
  const pkg = appliedPackages.find(p => p.id === packageId)
  if (pkg) {
    node.policyVersion = pkg.version
  }
}

/**
 * Get sync status summary
 */
export function getSyncStatusSummary(): {
  totalNodes: number
  syncedNodes: number
  pendingNodes: number
  errorNodes: number
} {
  return {
    totalNodes: registeredNodes.length,
    syncedNodes: registeredNodes.filter(n => n.syncStatus.status === 'synced').length,
    pendingNodes: registeredNodes.filter(n => n.syncStatus.status === 'pending').length,
    errorNodes: registeredNodes.filter(n => n.syncStatus.status === 'error').length,
  }
}



