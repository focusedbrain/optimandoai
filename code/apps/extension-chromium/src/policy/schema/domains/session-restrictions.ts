/**
 * Session Restrictions Schema
 * 
 * Controls what can happen DURING automation execution.
 * These are isolation controls that prevent interference.
 * 
 * INVARIANTS:
 * - Stricter modes = more isolation during automation
 * - Admin can lock any setting (future feature)
 * 
 * @version 1.0.0
 */

import { z } from 'zod'

/**
 * Automation Session Restrictions
 * 
 * What is allowed/restricted WHILE automation is running
 */
export const AutomationSessionRestrictionsSchema = z.object({
  // === INGRESS DURING AUTOMATION ===
  
  // Allow unpacking new capsules while automation runs
  allowCapsuleUnpacking: z.boolean().default(false),
  
  // Allow importing new agents/modules while automation runs
  allowAgentImport: z.boolean().default(false),
  
  // Allow receiving new packages while automation runs
  ingressDuringAutomation: z.enum([
    'none',           // Block all ingress
    'handshake_only', // Only from handshake partners
    'all_verified',   // Normal verified packages
  ]).default('handshake_only'),
  
  // === EGRESS DURING AUTOMATION ===
  
  // Allow data egress while automation runs
  egressDuringAutomation: z.enum([
    'none',           // Block all egress
    'allowlist_only', // Only to whitelisted destinations
    'unrestricted',   // Normal egress (still policy-bounded)
  ]).default('allowlist_only'),
  
  // === PACKAGE BUILDING DURING AUTOMATION ===
  
  // Allow building new packages while automation runs
  allowPackageBuilding: z.boolean().default(false),
  
  // Allow media/attachment uploads while automation runs
  allowMediaUpload: z.boolean().default(false),
  
  // Allow starting new automation sessions while one is running
  allowConcurrentSessions: z.boolean().default(false),
  
  // === SESSION LIMITS ===
  
  // Maximum concurrent automation sessions
  maxConcurrentSessions: z.number().int().positive().default(1),
  
  // Maximum automation duration (seconds, 0 = no limit)
  maxAutomationDuration: z.number().int().nonnegative().default(300), // 5 min default
  
  // Auto-terminate on idle (seconds)
  idleTimeout: z.number().int().nonnegative().default(60),
})

export type AutomationSessionRestrictions = z.infer<typeof AutomationSessionRestrictionsSchema>

/**
 * Mode-based defaults for session restrictions
 */
export const SESSION_RESTRICTION_DEFAULTS: Record<string, AutomationSessionRestrictions> = {
  strict: {
    allowCapsuleUnpacking: false,
    allowAgentImport: false,
    ingressDuringAutomation: 'none',
    egressDuringAutomation: 'none',
    allowPackageBuilding: false,
    allowMediaUpload: false,
    allowConcurrentSessions: false,
    maxConcurrentSessions: 1,
    maxAutomationDuration: 60,  // 1 minute max
    idleTimeout: 30,
  },
  restrictive: {
    allowCapsuleUnpacking: false,
    allowAgentImport: false,
    ingressDuringAutomation: 'none',
    egressDuringAutomation: 'none',
    allowPackageBuilding: false,
    allowMediaUpload: false,
    allowConcurrentSessions: false,
    maxConcurrentSessions: 1,
    maxAutomationDuration: 120, // 2 minutes
    idleTimeout: 60,
  },
  standard: {
    allowCapsuleUnpacking: false,
    allowAgentImport: false,
    ingressDuringAutomation: 'handshake_only',
    egressDuringAutomation: 'allowlist_only',
    allowPackageBuilding: true,
    allowMediaUpload: false,
    allowConcurrentSessions: false,
    maxConcurrentSessions: 1,
    maxAutomationDuration: 300, // 5 minutes
    idleTimeout: 60,
  },
  permissive: {
    allowCapsuleUnpacking: true,
    allowAgentImport: true,
    ingressDuringAutomation: 'all_verified',
    egressDuringAutomation: 'allowlist_only',
    allowPackageBuilding: true,
    allowMediaUpload: true,
    allowConcurrentSessions: true,
    maxConcurrentSessions: 3,
    maxAutomationDuration: 600, // 10 minutes
    idleTimeout: 120,
  },
  // Automation Partners: Full bidirectional automation without consent
  // BEAP functions as an API-like protocol for trusted machine-to-machine communication
  automation_partner: {
    allowCapsuleUnpacking: true,
    allowAgentImport: true,
    ingressDuringAutomation: 'all_verified',
    egressDuringAutomation: 'allowlist_only', // Still respects allowlists
    allowPackageBuilding: true,
    allowMediaUpload: true,
    allowConcurrentSessions: true,
    maxConcurrentSessions: 10, // High concurrency for API-like usage
    maxAutomationDuration: 3600, // 1 hour for long-running automations
    idleTimeout: 300, // 5 minutes idle before cleanup
  },
}

/**
 * Get session restrictions for a mode
 */
export function getSessionRestrictionsForMode(mode: string): AutomationSessionRestrictions {
  return SESSION_RESTRICTION_DEFAULTS[mode] ?? SESSION_RESTRICTION_DEFAULTS.standard
}

