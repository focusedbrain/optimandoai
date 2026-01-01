/**
 * Automation Risk Classification
 * 
 * Defines risk classes for automation capabilities.
 * This is the SOLE attack surface in BEAP - receiving packages is safe.
 * 
 * INVARIANTS:
 * - Risk Class 3 & 4 ALWAYS require explicit consent
 * - Consent for Class 4 is NEVER remembered
 * - Phase constraints cannot be overridden by policy
 * 
 * @version 1.0.0
 */

import { z } from 'zod'

/**
 * Automation Risk Classes
 * 
 * 0 = Read-only derivations (no state changes, no network)
 * 1 = Local deterministic automation (local compute, reversible)
 * 2 = External integration (network egress, allowlist-bounded)
 * 3 = Identity-affecting (ALWAYS requires consent)
 * 4 = Financial/irreversible (ALWAYS requires consent, NEVER remembered)
 */
export const AutomationRiskClassSchema = z.enum([
  'read_only',           // Class 0
  'local_deterministic', // Class 1
  'external_integration',// Class 2
  'identity_affecting',  // Class 3 - consent required
  'financial_irreversible', // Class 4 - consent required, never remembered
])

export type AutomationRiskClass = z.infer<typeof AutomationRiskClassSchema>

/**
 * Execution phases with invariant constraints
 */
export const ExecutionPhaseSchema = z.enum([
  'verification',  // BEAP envelope validation
  'unpackaging',   // Derivation, no outbound effects
  'automation',    // Workflow execution, policy-bounded
])

export type ExecutionPhase = z.infer<typeof ExecutionPhaseSchema>

/**
 * Phase constraints - these are INVARIANTS, not configurable
 */
export const PHASE_CONSTRAINTS = {
  verification: {
    networkEgress: false,
    stateChanges: false,
    userInteraction: false,
    description: 'BEAP envelope validation only',
  },
  unpackaging: {
    networkEgress: false, // INVARIANT: no outbound during unpack
    stateChanges: false,  // Cache only, no persistent changes
    userInteraction: false,
    description: 'Safe derivation, no side effects',
  },
  automation: {
    networkEgress: 'allowlist_bounded',
    stateChanges: 'policy_bounded',
    userInteraction: 'consent_for_class_3_4',
    description: 'Workflow execution within policy limits',
  },
} as const

/**
 * Automation capability to risk class mapping
 */
export const CAPABILITY_RISK_MAP: Record<string, AutomationRiskClass> = {
  // Class 0: Read-only
  deriveMetadata: 'read_only',
  derivePlainText: 'read_only',
  deriveStructuredData: 'read_only',
  derivePreviewThumbnails: 'read_only',
  
  // Class 1: Local deterministic
  derivePdfText: 'local_deterministic',
  deriveImageOcr: 'local_deterministic',
  deriveHtmlSanitized: 'local_deterministic',
  deriveCodeParsed: 'local_deterministic',
  deriveEmbeddings: 'local_deterministic',
  deriveLlmSummary: 'local_deterministic',
  
  // Class 2: External integration
  deriveExternalApiCall: 'external_integration',
  deriveAutomationExec: 'external_integration',
  deriveSandboxedRender: 'external_integration',
  
  // Class 3: Identity-affecting (always consent)
  // (reserved for future: signing, identity assertions)
  
  // Class 4: Financial/irreversible (always consent, never remembered)
  deriveOriginalReconstruction: 'financial_irreversible',
  deriveExternalExport: 'financial_irreversible',
  deriveFullDecryption: 'financial_irreversible',
}

/**
 * Get risk class for a capability
 */
export function getCapabilityRiskClass(capability: string): AutomationRiskClass {
  return CAPABILITY_RISK_MAP[capability] ?? 'external_integration'
}

/**
 * Check if capability requires consent
 */
export function requiresConsent(capability: string): boolean {
  const riskClass = getCapabilityRiskClass(capability)
  return riskClass === 'identity_affecting' || riskClass === 'financial_irreversible'
}

/**
 * Check if consent can be remembered for this capability
 */
export function canRememberConsent(capability: string): boolean {
  const riskClass = getCapabilityRiskClass(capability)
  // Class 4 consent is NEVER remembered
  return riskClass !== 'financial_irreversible'
}

/**
 * Preset automation limits
 */
export interface PresetAutomationLimits {
  maxRiskClass: AutomationRiskClass
  chainingAllowed: boolean
  consentMemory: 'never' | 'session' | 'time_bounded'
  scheduledActions: boolean
  outboundCalls: 'none' | 'allowlist'
}

/**
 * Preset definitions with formal guarantees
 */
export const PRESET_LIMITS: Record<string, PresetAutomationLimits> = {
  strict: {
    maxRiskClass: 'read_only',
    chainingAllowed: false,
    consentMemory: 'never',
    scheduledActions: false,
    outboundCalls: 'none',
  },
  restrictive: {
    maxRiskClass: 'local_deterministic',
    chainingAllowed: false,
    consentMemory: 'session',
    scheduledActions: false,
    outboundCalls: 'none',
  },
  standard: {
    maxRiskClass: 'local_deterministic',
    chainingAllowed: false, // Single-step only
    consentMemory: 'session',
    scheduledActions: false,
    outboundCalls: 'allowlist',
  },
  permissive: {
    maxRiskClass: 'external_integration',
    chainingAllowed: true, // Multi-step allowed
    consentMemory: 'time_bounded',
    scheduledActions: true, // With allowlist
    outboundCalls: 'allowlist',
  },
}

/**
 * Get preset limits
 */
export function getPresetLimits(preset: string): PresetAutomationLimits {
  return PRESET_LIMITS[preset] ?? PRESET_LIMITS.standard
}

/**
 * Check if automation is allowed for a preset
 */
export function isAutomationAllowedForPreset(
  preset: string,
  capability: string
): boolean {
  const limits = getPresetLimits(preset)
  const riskClass = getCapabilityRiskClass(capability)
  
  const riskOrder: AutomationRiskClass[] = [
    'read_only',
    'local_deterministic',
    'external_integration',
    'identity_affecting',
    'financial_irreversible',
  ]
  
  const maxIndex = riskOrder.indexOf(limits.maxRiskClass)
  const capabilityIndex = riskOrder.indexOf(riskClass)
  
  // Class 3 & 4 are ALWAYS allowed (they require consent anyway)
  if (capabilityIndex >= 3) return true
  
  return capabilityIndex <= maxIndex
}



