/**
 * Policy Schema Module
 * 
 * Central export point for the canonical policy model.
 * 
 * @example
 * import { 
 *   CanonicalPolicy, 
 *   createDefaultPolicy, 
 *   validatePolicy,
 *   computeEffectivePolicy 
 * } from '@/policy/schema'
 */

// Core policy schema and utilities
export {
  CanonicalPolicySchema,
  PolicyMetadataSchema,
  PolicyLayerSchema,
  RiskTierSchema,
  POLICY_VERSION,
  createDefaultPolicy,
  validatePolicy,
  serializePolicy,
  hashPolicy,
  calculateRiskTier,
  lockdownPolicy,
} from './policy.schema'

// All types
export * from './types'

// Domain schemas
export * from './domains'



