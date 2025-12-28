/**
 * Handshake Policy Overrides Schema
 * 
 * Allows per-handshake customization without changing global defaults.
 * Each handshake can have its own mode, restrictions, and permissions.
 * 
 * PRECEDENCE:
 * Handshake Override > Global Mode > Default
 * 
 * INVARIANTS:
 * - Override cannot exceed global ceiling (no escalation)
 * - Admin locks apply to overrides too
 * 
 * @version 1.0.0
 */

import { z } from 'zod'
import { AutomationSessionRestrictionsSchema } from './session-restrictions'

/**
 * Handshake-specific automation permissions
 */
export const HandshakeAutomationPermissionsSchema = z.object({
  // Override mode for this handshake (null = use global)
  // 'automation_partner' = Full bidirectional automation without consent (API-like mode)
  mode: z.enum(['strict', 'restrictive', 'standard', 'permissive', 'automation_partner']).nullable().default(null),
  
  // For automation_partner mode: Skip consent for all automation actions
  // Still respects allowlists, rate limits, and other restrictions
  skipConsentForAutomation: z.boolean().default(false),
  
  // Specific capability overrides (true = allow, false = deny, null = use mode default)
  capabilities: z.object({
    aiAnalysis: z.boolean().nullable().default(null),
    smartSearch: z.boolean().nullable().default(null),
    documentProcessing: z.boolean().nullable().default(null),
    runWorkflows: z.boolean().nullable().default(null),
    apiIntegrations: z.boolean().nullable().default(null),
  }).default({}),
  
  // Session restrictions override for this handshake
  sessionRestrictions: AutomationSessionRestrictionsSchema.partial().nullable().default(null),
  
  // === AUTOMATION PARTNER SPECIFIC ===
  // These only apply when mode = 'automation_partner'
  
  // Actions that still require consent even in automation_partner mode
  alwaysRequireConsentFor: z.array(z.enum([
    'financial_transactions',  // Payments, transfers
    'data_export_external',    // Export to external systems
    'identity_changes',        // Modify identity/credentials
    'policy_changes',          // Modify security policies
  ])).default(['financial_transactions', 'identity_changes', 'policy_changes']),
  
  // Rate limits for automation partner (API-like limits)
  automationPartnerLimits: z.object({
    maxRequestsPerMinute: z.number().int().positive().default(60),
    maxRequestsPerHour: z.number().int().positive().default(1000),
    maxConcurrentWorkflows: z.number().int().positive().default(10),
    maxDataEgressPerHourMB: z.number().positive().default(100),
  }).default({}),
})

export type HandshakeAutomationPermissions = z.infer<typeof HandshakeAutomationPermissionsSchema>

/**
 * Handshake-specific egress permissions
 */
export const HandshakeEgressPermissionsSchema = z.object({
  // Additional allowed destinations for this handshake
  additionalAllowedDestinations: z.array(z.string()).default([]),
  
  // Blocked destinations (takes precedence)
  blockedDestinations: z.array(z.string()).default([]),
  
  // Data categories this handshake can receive
  allowedDataCategories: z.array(z.string()).nullable().default(null),
  
  // Require encryption for this handshake
  requireEncryption: z.boolean().nullable().default(null),
})

export type HandshakeEgressPermissions = z.infer<typeof HandshakeEgressPermissionsSchema>

/**
 * Handshake-specific ingress permissions
 */
export const HandshakeIngressPermissionsSchema = z.object({
  // Maximum package size from this handshake (bytes, null = use default)
  maxPackageSize: z.number().int().positive().nullable().default(null),
  
  // Rate limit for this handshake (packages/hour, null = use default)
  rateLimit: z.number().int().nonnegative().nullable().default(null),
  
  // Allow automation from this handshake
  allowAutomation: z.boolean().default(true),
  
  // Priority level (affects queue ordering)
  priority: z.enum(['low', 'normal', 'high']).default('normal'),
})

export type HandshakeIngressPermissions = z.infer<typeof HandshakeIngressPermissionsSchema>

/**
 * Complete handshake policy override
 */
export const HandshakePolicyOverrideSchema = z.object({
  // Handshake identifier
  handshakeId: z.string(),
  
  // Display name for UI
  displayName: z.string(),
  
  // Optional description
  description: z.string().optional(),
  
  // When this override was created
  createdAt: z.number().int().positive(),
  
  // When this override was last modified
  updatedAt: z.number().int().positive(),
  
  // Whether this override is active
  isActive: z.boolean().default(true),
  
  // Automation permissions
  automation: HandshakeAutomationPermissionsSchema.default({}),
  
  // Egress permissions
  egress: HandshakeEgressPermissionsSchema.default({}),
  
  // Ingress permissions
  ingress: HandshakeIngressPermissionsSchema.default({}),
  
  // Admin lock status (for future use)
  adminLock: z.object({
    locked: z.boolean().default(false),
    lockedBy: z.string().optional(),
    lockedAt: z.number().int().positive().optional(),
    lockedFields: z.array(z.string()).default([]),
  }).default({}),
})

export type HandshakePolicyOverride = z.infer<typeof HandshakePolicyOverrideSchema>

/**
 * Collection of handshake overrides
 */
export const HandshakeOverridesCollectionSchema = z.object({
  overrides: z.array(HandshakePolicyOverrideSchema).default([]),
  
  // Default permissions for new handshakes
  defaultsForNewHandshakes: z.object({
    mode: z.enum(['strict', 'restrictive', 'standard', 'permissive']).default('standard'),
    requireApprovalForNew: z.boolean().default(true),
  }).default({}),
})

export type HandshakeOverridesCollection = z.infer<typeof HandshakeOverridesCollectionSchema>

/**
 * Create a new handshake override with defaults
 */
export function createHandshakeOverride(
  handshakeId: string,
  displayName: string,
  options?: Partial<HandshakePolicyOverride>
): HandshakePolicyOverride {
  const now = Date.now()
  return {
    handshakeId,
    displayName,
    createdAt: now,
    updatedAt: now,
    isActive: true,
    automation: {},
    egress: {
      additionalAllowedDestinations: [],
      blockedDestinations: [],
      allowedDataCategories: null,
      requireEncryption: null,
    },
    ingress: {
      maxPackageSize: null,
      rateLimit: null,
      allowAutomation: true,
      priority: 'normal',
    },
    adminLock: {
      locked: false,
      lockedFields: [],
    },
    ...options,
  }
}

/**
 * Merge handshake override with global policy
 * Returns effective permissions (handshake override takes precedence)
 */
export function mergeWithGlobalPolicy<T extends Record<string, unknown>>(
  global: T,
  override: Partial<T> | null
): T {
  if (!override) return global
  
  const merged = { ...global }
  for (const key of Object.keys(override) as Array<keyof T>) {
    const value = override[key]
    if (value !== null && value !== undefined) {
      merged[key] = value as T[keyof T]
    }
  }
  return merged
}

