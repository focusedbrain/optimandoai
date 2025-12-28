/**
 * Policy Decision Types
 * 
 * Defines the result types for policy evaluation.
 */

import type { PolicyLayer, RiskTier } from '../schema'

/**
 * Approval types that may be required for a capability
 */
export type ApprovalType = 'human' | 'hardware_key' | 'multi_party' | 'time_bounded'

/**
 * Individual policy decision for a specific capability
 */
export interface PolicyDecision {
  /** Domain name (e.g., 'ingress', 'egress') */
  domain: string
  
  /** Specific capability being evaluated (e.g., 'allowDynamicContent') */
  capability: string
  
  /** Whether the capability is allowed */
  allowed: boolean
  
  /** Human-readable reason for the decision */
  reason: string
  
  /** Which policy layer made this decision */
  decidedBy: PolicyLayer
  
  /** Required approvals if allowed conditionally */
  requiredApprovals?: ApprovalType[]
  
  /** Risk tier associated with this capability */
  riskLevel?: RiskTier
  
  /** Original requested value */
  requestedValue?: unknown
  
  /** Effective value after intersection */
  effectiveValue?: unknown
}

/**
 * Denial record with detailed explanation
 */
export interface PolicyDenial extends PolicyDecision {
  allowed: false
  
  /** Which layer denied the capability */
  deniedBy: PolicyLayer
  
  /** All layers that would have denied this */
  alsoDenieBy?: PolicyLayer[]
}

/**
 * Policy difference between two policies
 */
export interface PolicyDiff {
  /** Domain affected */
  domain: string
  
  /** Capability changed */
  capability: string
  
  /** Change type */
  changeType: 'added' | 'removed' | 'modified'
  
  /** Previous value */
  previousValue: unknown
  
  /** New value */
  newValue: unknown
  
  /** Risk impact direction */
  riskImpact: 'increase' | 'decrease' | 'neutral'
}

/**
 * Create a decision object
 */
export function createDecision(
  domain: string,
  capability: string,
  allowed: boolean,
  reason: string,
  decidedBy: PolicyLayer,
  options?: Partial<Omit<PolicyDecision, 'domain' | 'capability' | 'allowed' | 'reason' | 'decidedBy'>>
): PolicyDecision {
  return {
    domain,
    capability,
    allowed,
    reason,
    decidedBy,
    ...options,
  }
}

/**
 * Create a denial object
 */
export function createDenial(
  domain: string,
  capability: string,
  reason: string,
  deniedBy: PolicyLayer,
  options?: Partial<Omit<PolicyDenial, 'domain' | 'capability' | 'allowed' | 'reason' | 'decidedBy' | 'deniedBy'>>
): PolicyDenial {
  return {
    domain,
    capability,
    allowed: false,
    reason,
    decidedBy: deniedBy,
    deniedBy,
    ...options,
  }
}


