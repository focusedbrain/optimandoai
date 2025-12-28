/**
 * Policy Evaluation Engine
 * 
 * Computes the effective policy from multiple policy layers.
 * 
 * Policy Stack (ordered from most to least restrictive):
 * 1. Network Baseline Policy (NBP) - organization-wide baseline
 * 2. Local Node Policy (LNP) - device-specific overrides
 * 3. Handshake/Sender Policy (HSP) - per-sender trust levels
 * 4. Capsule Ask Policy (CAP) - per-capsule permissions
 * 
 * Effective Policy = NBP ∩ LNP ∩ HSP ∩ CAP
 * 
 * Key Invariants:
 * - NO ESCALATION: CAP cannot enable what LNP denies
 * - DENY BY DEFAULT: Undefined = denied
 * - PURE FUNCTION: No side effects, deterministic
 */

import type { CanonicalPolicy, PolicyLayer, RiskTier } from '../schema'
import { 
  POLICY_VERSION,
  DEFAULT_INGRESS_POLICY, 
  DEFAULT_EGRESS_POLICY,
  calculateRiskTier,
} from '../schema'
import { intersectIngress, intersectEgress } from './intersection'
import type { PolicyDecision, PolicyDenial } from './decisions'

/**
 * Input to the policy evaluator
 */
export interface PolicyEvaluationInput {
  /** Network Baseline Policy (optional - uses defaults if missing) */
  nbp?: CanonicalPolicy
  
  /** Local Node Policy (required) */
  lnp: CanonicalPolicy
  
  /** Handshake/Sender Policy (optional) */
  hsp?: CanonicalPolicy
  
  /** Capsule Ask Policy (optional) */
  cap?: CanonicalPolicy
}

/**
 * Result of policy evaluation
 */
export interface EffectivePolicyResult {
  /** The computed effective policy */
  effective: CanonicalPolicy
  
  /** All decisions made during evaluation */
  decisions: PolicyDecision[]
  
  /** All denials with explanations */
  denials: PolicyDenial[]
  
  /** Whether user consent is required for any capability */
  requiresConsent: boolean
  
  /** Computed risk tier of effective policy */
  effectiveRiskTier: RiskTier
  
  /** Policy layers that were applied */
  appliedLayers: PolicyLayer[]
  
  /** Evaluation timestamp */
  evaluatedAt: number
}

/**
 * Compute the effective policy from multiple layers
 * 
 * @param input - Policy layers to intersect
 * @returns Effective policy result with decisions and denials
 */
export function computeEffectivePolicy(input: PolicyEvaluationInput): EffectivePolicyResult {
  const { nbp, lnp, hsp, cap } = input
  const evaluatedAt = Date.now()
  
  // Track which layers are applied
  const appliedLayers: PolicyLayer[] = ['local']
  if (nbp) appliedLayers.unshift('network')
  if (hsp) appliedLayers.push('handshake')
  if (cap) appliedLayers.push('capsule')
  
  // Layer names for decision tracking
  const layerNames = appliedLayers.map(l => l)
  
  // Collect policies for intersection (in order: NBP, LNP, HSP, CAP)
  const ingressPolicies = [
    nbp?.ingress,
    lnp.ingress ?? DEFAULT_INGRESS_POLICY,
    hsp?.ingress,
    cap?.ingress,
  ]
  
  const egressPolicies = [
    nbp?.egress,
    lnp.egress ?? DEFAULT_EGRESS_POLICY,
    hsp?.egress,
    cap?.egress,
  ]
  
  // Intersect ingress policies
  const ingressResult = intersectIngress(
    ingressPolicies.filter((_, i) => appliedLayers[i] !== undefined || i <= 1),
    layerNames
  )
  
  // Intersect egress policies
  const egressResult = intersectEgress(
    egressPolicies.filter((_, i) => appliedLayers[i] !== undefined || i <= 1),
    layerNames
  )
  
  // Combine all decisions and denials
  const allDecisions = [...ingressResult.decisions, ...egressResult.decisions]
  const allDenials = [...ingressResult.denials, ...egressResult.denials]
  
  // Build effective policy
  const effective: CanonicalPolicy = {
    id: crypto.randomUUID(),
    name: `Effective Policy (${appliedLayers.join(' ∩ ')})`,
    description: `Computed effective policy from ${appliedLayers.length} layers`,
    layer: 'local', // Effective policy is treated as local
    version: POLICY_VERSION,
    createdAt: evaluatedAt,
    updatedAt: evaluatedAt,
    riskTier: 'low', // Will be calculated
    isActive: true,
    tags: ['effective', 'computed'],
    ingress: ingressResult.policy,
    egress: egressResult.policy,
  }
  
  // Calculate effective risk tier
  const effectiveRiskTier = calculateRiskTier(effective)
  effective.riskTier = effectiveRiskTier
  
  // Determine if consent is required
  // Consent is required if CAP requests capabilities not in HSP
  const requiresConsent = cap !== undefined && hsp !== undefined && (
    // Check if CAP requests more than HSP allows
    (cap.ingress?.allowDynamicContent && !hsp.ingress?.allowDynamicContent) ||
    (cap.ingress?.allowReconstruction && !hsp.ingress?.allowReconstruction) ||
    (!cap.egress?.requireApproval && hsp.egress?.requireApproval) ||
    (cap.egress?.allowBulkExport && !hsp.egress?.allowBulkExport)
  )
  
  return {
    effective,
    decisions: allDecisions,
    denials: allDenials,
    requiresConsent,
    effectiveRiskTier,
    appliedLayers,
    evaluatedAt,
  }
}

/**
 * Check if a specific capability is allowed in a policy
 */
export function isCapabilityAllowed(
  policy: CanonicalPolicy,
  domain: 'ingress' | 'egress',
  capability: string
): boolean {
  if (domain === 'ingress' && policy.ingress) {
    const ingress = policy.ingress
    switch (capability) {
      case 'allowDynamicContent':
        return ingress.allowDynamicContent
      case 'allowReconstruction':
        return ingress.allowReconstruction
      case 'allowExternalResources':
        return ingress.allowExternalResources
      default:
        return false
    }
  }
  
  if (domain === 'egress' && policy.egress) {
    const egress = policy.egress
    switch (capability) {
      case 'allowBulkExport':
        return egress.allowBulkExport
      case 'requireApproval':
        return !egress.requireApproval // Inverted: not requiring approval = more permissive
      default:
        return false
    }
  }
  
  return false
}

/**
 * Get all denied capabilities between two policies
 * Useful for showing what CAP requests but effective policy denies
 */
export function getDeniedCapabilities(
  requested: CanonicalPolicy,
  effective: CanonicalPolicy
): PolicyDenial[] {
  const denials: PolicyDenial[] = []
  
  // Check ingress denials
  if (requested.ingress && effective.ingress) {
    if (requested.ingress.allowDynamicContent && !effective.ingress.allowDynamicContent) {
      denials.push({
        domain: 'ingress',
        capability: 'allowDynamicContent',
        allowed: false,
        reason: 'Dynamic content not allowed by effective policy',
        decidedBy: 'local',
        deniedBy: 'local',
      })
    }
    
    if (requested.ingress.allowReconstruction && !effective.ingress.allowReconstruction) {
      denials.push({
        domain: 'ingress',
        capability: 'allowReconstruction',
        allowed: false,
        reason: 'Artefact reconstruction not allowed by effective policy',
        decidedBy: 'local',
        deniedBy: 'local',
      })
    }
    
    // Check artefact types
    for (const type of requested.ingress.allowedArtefactTypes) {
      if (!effective.ingress.allowedArtefactTypes.includes(type)) {
        denials.push({
          domain: 'ingress',
          capability: 'allowedArtefactTypes',
          allowed: false,
          reason: `Artefact type '${type}' not allowed by effective policy`,
          decidedBy: 'local',
          deniedBy: 'local',
          requestedValue: type,
        })
      }
    }
  }
  
  // Check egress denials
  if (requested.egress && effective.egress) {
    if (requested.egress.allowBulkExport && !effective.egress.allowBulkExport) {
      denials.push({
        domain: 'egress',
        capability: 'allowBulkExport',
        allowed: false,
        reason: 'Bulk export not allowed by effective policy',
        decidedBy: 'local',
        deniedBy: 'local',
      })
    }
    
    // Check channels
    for (const channel of requested.egress.allowedChannels) {
      if (!effective.egress.allowedChannels.includes(channel)) {
        denials.push({
          domain: 'egress',
          capability: 'allowedChannels',
          allowed: false,
          reason: `Channel '${channel}' not allowed by effective policy`,
          decidedBy: 'local',
          deniedBy: 'local',
          requestedValue: channel,
        })
      }
    }
    
    // Check data categories
    for (const cat of requested.egress.allowedDataCategories) {
      if (!effective.egress.allowedDataCategories.includes(cat)) {
        denials.push({
          domain: 'egress',
          capability: 'allowedDataCategories',
          allowed: false,
          reason: `Data category '${cat}' not allowed by effective policy`,
          decidedBy: 'local',
          deniedBy: 'local',
          requestedValue: cat,
        })
      }
    }
  }
  
  return denials
}

/**
 * Check the non-escalation invariant
 * Returns true if no escalation is detected
 */
export function verifyNoEscalation(
  higherLayer: CanonicalPolicy,
  lowerLayer: CanonicalPolicy
): { valid: boolean; violations: string[] } {
  const violations: string[] = []
  
  // Check ingress escalations
  if (lowerLayer.ingress && higherLayer.ingress) {
    if (lowerLayer.ingress.allowDynamicContent && !higherLayer.ingress.allowDynamicContent) {
      violations.push('Lower layer enables dynamic content denied by higher layer')
    }
    
    if (lowerLayer.ingress.allowReconstruction && !higherLayer.ingress.allowReconstruction) {
      violations.push('Lower layer enables reconstruction denied by higher layer')
    }
    
    if (lowerLayer.ingress.maxSizeBytes > higherLayer.ingress.maxSizeBytes) {
      violations.push('Lower layer has higher size limit than higher layer')
    }
    
    // Check artefact types
    for (const type of lowerLayer.ingress.allowedArtefactTypes) {
      if (!higherLayer.ingress.allowedArtefactTypes.includes(type)) {
        violations.push(`Lower layer allows artefact type '${type}' denied by higher layer`)
      }
    }
  }
  
  // Check egress escalations
  if (lowerLayer.egress && higherLayer.egress) {
    if (lowerLayer.egress.allowBulkExport && !higherLayer.egress.allowBulkExport) {
      violations.push('Lower layer enables bulk export denied by higher layer')
    }
    
    if (!lowerLayer.egress.requireApproval && higherLayer.egress.requireApproval) {
      violations.push('Lower layer disables approval required by higher layer')
    }
    
    // Check channels
    for (const channel of lowerLayer.egress.allowedChannels) {
      if (!higherLayer.egress.allowedChannels.includes(channel)) {
        violations.push(`Lower layer allows channel '${channel}' denied by higher layer`)
      }
    }
    
    // Check data categories
    for (const cat of lowerLayer.egress.allowedDataCategories) {
      if (!higherLayer.egress.allowedDataCategories.includes(cat)) {
        violations.push(`Lower layer allows data category '${cat}' denied by higher layer`)
      }
    }
  }
  
  return {
    valid: violations.length === 0,
    violations,
  }
}


