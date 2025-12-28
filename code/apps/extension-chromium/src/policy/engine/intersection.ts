/**
 * Policy Intersection Logic
 * 
 * Implements the core intersection algorithm for combining policies.
 * The effective policy is the INTERSECTION of all layers:
 * - For arrays: intersection of allowed values
 * - For booleans: AND for permissions, OR for restrictions
 * - For numbers: MIN for limits, MAX for minimums
 * 
 * Key invariant: NO ESCALATION
 * A lower layer cannot enable what a higher layer denies.
 */

import type { CanonicalPolicy, IngressPolicy, EgressPolicy } from '../schema'
import { DEFAULT_INGRESS_POLICY, DEFAULT_EGRESS_POLICY } from '../schema'
import { createDecision, createDenial, type PolicyDecision, type PolicyDenial } from './decisions'

/**
 * Intersect two arrays - only keep common elements
 */
export function intersectArrays<T>(a: T[], b: T[]): T[] {
  const setB = new Set(b)
  return a.filter(item => setB.has(item))
}

/**
 * Union two arrays - combine all unique elements
 */
export function unionArrays<T>(a: T[], b: T[]): T[] {
  return [...new Set([...a, ...b])]
}

/**
 * Intersect ingress policies
 * More restrictive settings win
 */
export function intersectIngress(
  policies: (IngressPolicy | undefined)[],
  layerNames: string[]
): { policy: IngressPolicy; decisions: PolicyDecision[]; denials: PolicyDenial[] } {
  const decisions: PolicyDecision[] = []
  const denials: PolicyDenial[] = []
  
  // Start with the first defined policy or defaults
  const base = policies.find(p => p !== undefined) ?? DEFAULT_INGRESS_POLICY
  
  const result: IngressPolicy = {
    // Arrays: intersection (most restrictive)
    allowedArtefactTypes: base.allowedArtefactTypes,
    allowedSources: base.allowedSources,
    
    // Blocked sources: union (combine all blocks)
    blockedSources: base.blockedSources,
    
    // Numbers: minimum (most restrictive)
    maxSizeBytes: base.maxSizeBytes,
    maxTotalSizeBytes: base.maxTotalSizeBytes,
    maxAttachments: base.maxAttachments,
    
    // Booleans: AND for permissions, OR for requirements
    allowReconstruction: base.allowReconstruction,
    allowDynamicContent: base.allowDynamicContent,
    allowExternalResources: base.allowExternalResources,
    requireSourceVerification: base.requireSourceVerification,
    
    // Enums: most restrictive
    parsingConstraint: base.parsingConstraint,
  }
  
  // Apply intersection for each additional policy
  for (let i = 0; i < policies.length; i++) {
    const policy = policies[i]
    if (!policy) continue
    
    const layerName = layerNames[i] ?? 'unknown'
    
    // Artefact types: intersection
    const prevTypes = result.allowedArtefactTypes
    result.allowedArtefactTypes = intersectArrays(result.allowedArtefactTypes, policy.allowedArtefactTypes)
    
    // Track what was denied
    const deniedTypes = prevTypes.filter(t => !result.allowedArtefactTypes.includes(t))
    for (const type of deniedTypes) {
      denials.push(createDenial('ingress', 'allowedArtefactTypes', 
        `Artefact type '${type}' denied by ${layerName}`, layerName as any))
    }
    
    // Allowed sources: intersection
    if (policy.allowedSources.length > 0 && result.allowedSources.length > 0) {
      result.allowedSources = intersectArrays(result.allowedSources, policy.allowedSources)
    } else if (policy.allowedSources.length > 0) {
      result.allowedSources = policy.allowedSources
    }
    
    // Blocked sources: union (all blocks apply)
    result.blockedSources = unionArrays(result.blockedSources, policy.blockedSources)
    
    // Size limits: minimum
    if (policy.maxSizeBytes < result.maxSizeBytes) {
      decisions.push(createDecision('ingress', 'maxSizeBytes', true,
        `Size limit reduced to ${policy.maxSizeBytes} by ${layerName}`, layerName as any))
      result.maxSizeBytes = policy.maxSizeBytes
    }
    
    if (policy.maxTotalSizeBytes < result.maxTotalSizeBytes) {
      result.maxTotalSizeBytes = policy.maxTotalSizeBytes
    }
    
    if (policy.maxAttachments < result.maxAttachments) {
      result.maxAttachments = policy.maxAttachments
    }
    
    // Boolean permissions: AND (false wins)
    if (!policy.allowReconstruction && result.allowReconstruction) {
      denials.push(createDenial('ingress', 'allowReconstruction',
        `Reconstruction denied by ${layerName}`, layerName as any))
      result.allowReconstruction = false
    }
    
    if (!policy.allowDynamicContent && result.allowDynamicContent) {
      denials.push(createDenial('ingress', 'allowDynamicContent',
        `Dynamic content denied by ${layerName}`, layerName as any))
      result.allowDynamicContent = false
    }
    
    if (!policy.allowExternalResources && result.allowExternalResources) {
      denials.push(createDenial('ingress', 'allowExternalResources',
        `External resources denied by ${layerName}`, layerName as any))
      result.allowExternalResources = false
    }
    
    // Boolean requirements: OR (true wins)
    if (policy.requireSourceVerification && !result.requireSourceVerification) {
      decisions.push(createDecision('ingress', 'requireSourceVerification', true,
        `Source verification required by ${layerName}`, layerName as any))
      result.requireSourceVerification = true
    }
    
    // Parsing constraint: most restrictive wins
    const constraintOrder = { 'strict': 0, 'permissive': 1, 'custom': 2 }
    if (constraintOrder[policy.parsingConstraint] < constraintOrder[result.parsingConstraint]) {
      result.parsingConstraint = policy.parsingConstraint
    }
  }
  
  return { policy: result, decisions, denials }
}

/**
 * Intersect egress policies
 * More restrictive settings win
 */
export function intersectEgress(
  policies: (EgressPolicy | undefined)[],
  layerNames: string[]
): { policy: EgressPolicy; decisions: PolicyDecision[]; denials: PolicyDenial[] } {
  const decisions: PolicyDecision[] = []
  const denials: PolicyDenial[] = []
  
  const base = policies.find(p => p !== undefined) ?? DEFAULT_EGRESS_POLICY
  
  const result: EgressPolicy = {
    allowedDestinations: base.allowedDestinations,
    blockedDestinations: base.blockedDestinations,
    allowedDataCategories: base.allowedDataCategories,
    allowedChannels: base.allowedChannels,
    requireApproval: base.requireApproval,
    requireEncryption: base.requireEncryption,
    maxEgressSizeBytes: base.maxEgressSizeBytes,
    maxOperationsPerHour: base.maxOperationsPerHour,
    auditAllEgress: base.auditAllEgress,
    redactSensitiveData: base.redactSensitiveData,
    allowBulkExport: base.allowBulkExport,
    requireDestinationVerification: base.requireDestinationVerification,
  }
  
  for (let i = 0; i < policies.length; i++) {
    const policy = policies[i]
    if (!policy) continue
    
    const layerName = layerNames[i] ?? 'unknown'
    
    // Allowed destinations: intersection
    if (policy.allowedDestinations.length > 0 && result.allowedDestinations.length > 0) {
      result.allowedDestinations = intersectArrays(result.allowedDestinations, policy.allowedDestinations)
    } else if (policy.allowedDestinations.length > 0) {
      result.allowedDestinations = policy.allowedDestinations
    }
    
    // Blocked destinations: union
    result.blockedDestinations = unionArrays(result.blockedDestinations, policy.blockedDestinations)
    
    // Data categories: intersection
    const prevCategories = result.allowedDataCategories
    result.allowedDataCategories = intersectArrays(result.allowedDataCategories, policy.allowedDataCategories)
    
    const deniedCategories = prevCategories.filter(c => !result.allowedDataCategories.includes(c))
    for (const cat of deniedCategories) {
      denials.push(createDenial('egress', 'allowedDataCategories',
        `Data category '${cat}' denied by ${layerName}`, layerName as any))
    }
    
    // Channels: intersection
    const prevChannels = result.allowedChannels
    result.allowedChannels = intersectArrays(result.allowedChannels, policy.allowedChannels)
    
    const deniedChannels = prevChannels.filter(c => !result.allowedChannels.includes(c))
    for (const ch of deniedChannels) {
      denials.push(createDenial('egress', 'allowedChannels',
        `Channel '${ch}' denied by ${layerName}`, layerName as any))
    }
    
    // Boolean requirements: OR (true wins)
    if (policy.requireApproval && !result.requireApproval) {
      decisions.push(createDecision('egress', 'requireApproval', true,
        `Approval required by ${layerName}`, layerName as any))
      result.requireApproval = true
    }
    
    if (policy.requireEncryption && !result.requireEncryption) {
      result.requireEncryption = true
    }
    
    if (policy.auditAllEgress && !result.auditAllEgress) {
      result.auditAllEgress = true
    }
    
    if (policy.redactSensitiveData && !result.redactSensitiveData) {
      result.redactSensitiveData = true
    }
    
    if (policy.requireDestinationVerification && !result.requireDestinationVerification) {
      result.requireDestinationVerification = true
    }
    
    // Boolean permissions: AND (false wins)
    if (!policy.allowBulkExport && result.allowBulkExport) {
      denials.push(createDenial('egress', 'allowBulkExport',
        `Bulk export denied by ${layerName}`, layerName as any))
      result.allowBulkExport = false
    }
    
    // Numbers: minimum
    if (policy.maxEgressSizeBytes < result.maxEgressSizeBytes) {
      result.maxEgressSizeBytes = policy.maxEgressSizeBytes
    }
    
    if (policy.maxOperationsPerHour < result.maxOperationsPerHour) {
      result.maxOperationsPerHour = policy.maxOperationsPerHour
    }
  }
  
  return { policy: result, decisions, denials }
}

