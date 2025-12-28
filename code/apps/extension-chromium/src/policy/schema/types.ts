/**
 * Policy Type Exports
 * 
 * Re-exports all TypeScript types derived from zod schemas.
 * Use these types for type-safe policy handling.
 * 
 * BEAP-ALIGNED STRUCTURE (v2.0.0):
 * - Channels: What doors exist
 * - PreVerification: DoS protection before BEAP verification  
 * - Derivations: What can be derived AFTER BEAP verification
 * 
 * DEPRECATED: Ingress types (replaced by Channels + PreVerification + Derivations)
 */

// Core policy types
export type {
  CanonicalPolicy,
  PolicyMetadata,
  PolicyLayer,
  RiskTier,
} from './policy.schema'

// === BEAP-ALIGNED INGRESS DOMAINS (v2.0.0) ===

// Channels domain
export type {
  ChannelsPolicy,
  ChannelConfig,
  AttestationTier,
  NetworkScope,
} from './domains/channels'

// Pre-Verification domain
export type {
  PreVerificationPolicy,
  QuarantineBehavior,
  RateLimitAction,
} from './domains/pre-verification'

// Derivations domain
export type {
  DerivationsPolicy,
  DerivationCapability,
  DerivationRisk,
} from './domains/derivations'

// === OTHER DOMAINS ===

export type {
  EgressPolicy,
  DataCategory,
  EgressChannel,
  DestinationPattern,
} from './domains/egress'

export type {
  ExecutionPolicy,
  ConnectorType,
  AutomationCapability,
  FilesystemOperation,
} from './domains/execution'

export type {
  VaultAccessPolicy,
  VaultOperation,
  CompartmentAccess,
} from './domains/vault-access'

export type {
  IdentityPolicy,
  IdentityAttribute,
  VerificationLevel,
  PseudonymityMode,
} from './domains/identity'

// === LEGACY (deprecated) ===
export type {
  IngressPolicy,
  ArtefactType,
  ParsingConstraint,
} from './domains/ingress'

// ===============================================
// Re-export schemas for runtime validation
// ===============================================

export {
  CanonicalPolicySchema,
  PolicyMetadataSchema,
  PolicyLayerSchema,
  RiskTierSchema,
  POLICY_VERSION,
} from './policy.schema'

// BEAP-aligned schemas
export {
  ChannelsPolicySchema,
  ChannelConfigSchema,
  AttestationTierSchema,
  NetworkScopeSchema,
  DEFAULT_CHANNELS_POLICY,
} from './domains/channels'

export {
  PreVerificationPolicySchema,
  QuarantineBehaviorSchema,
  RateLimitActionSchema,
  DEFAULT_PRE_VERIFICATION_POLICY,
} from './domains/pre-verification'

export {
  DerivationsPolicySchema,
  DerivationCapabilitySchema,
  DerivationRiskSchema,
  DEFAULT_DERIVATIONS_POLICY,
  getDerivationRisk,
} from './domains/derivations'

// Other domain schemas
export {
  EgressPolicySchema,
  DataCategorySchema,
  EgressChannelSchema,
  DestinationPatternSchema,
  DEFAULT_EGRESS_POLICY,
} from './domains/egress'

export {
  ExecutionPolicySchema,
  ConnectorTypeSchema,
  AutomationCapabilitySchema,
  FilesystemOperationSchema,
  DEFAULT_EXECUTION_POLICY,
} from './domains/execution'

export {
  VaultAccessPolicySchema,
  VaultOperationSchema,
  CompartmentAccessSchema,
  DEFAULT_VAULT_ACCESS_POLICY,
} from './domains/vault-access'

export {
  IdentityPolicySchema,
  IdentityAttributeSchema,
  VerificationLevelSchema,
  PseudonymityModeSchema,
  DEFAULT_IDENTITY_POLICY,
} from './domains/identity'

// Legacy schemas (deprecated)
export {
  IngressPolicySchema,
  ArtefactTypeSchema,
  ParsingConstraintSchema,
  DEFAULT_INGRESS_POLICY,
} from './domains/ingress'
