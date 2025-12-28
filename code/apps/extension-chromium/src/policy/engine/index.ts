/**
 * Policy Engine Module
 * 
 * Exports the policy evaluation engine and intersection logic.
 */

// Main evaluator
export {
  computeEffectivePolicy,
  isCapabilityAllowed,
  getDeniedCapabilities,
  verifyNoEscalation,
  type PolicyEvaluationInput,
  type EffectivePolicyResult,
} from './evaluator'

// Intersection utilities
export {
  intersectArrays,
  unionArrays,
  intersectIngress,
  intersectEgress,
} from './intersection'

// Decision types
export {
  createDecision,
  createDenial,
  type PolicyDecision,
  type PolicyDenial,
  type PolicyDiff,
  type ApprovalType,
} from './decisions'

