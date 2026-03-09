/**
 * AI Policy — Exclusive mode model and legacy mapping
 *
 * Replaces the previous two-boolean model (cloud_ai, internal_ai) with
 * an exclusive enum. Legacy data is defensively normalized.
 */

import type { AiProcessingMode } from './types'

// Re-export for backward compat — canonical definition lives in types.ts
export type { AiProcessingMode } from './types'

/** Legacy format (deprecated, for read compatibility) */
export interface LegacyPolicySelection {
  cloud_ai?: boolean
  internal_ai?: boolean
}

/** New format (ai_processing_mode) */
export interface PolicySelectionNew {
  ai_processing_mode?: AiProcessingMode
}

/** Union for parsing: accepts both formats */
export type PolicySelectionInput = PolicySelectionNew | LegacyPolicySelection

/** Default when no policy is set */
export const DEFAULT_AI_PROCESSING_MODE: AiProcessingMode = 'local_only'

/**
 * Normalize legacy boolean format to ai_processing_mode.
 * Invalid state (both true) is defensively mapped to local_only.
 */
export function legacyToAiProcessingMode(legacy: LegacyPolicySelection | null | undefined): AiProcessingMode {
  if (!legacy) return DEFAULT_AI_PROCESSING_MODE
  const cloud = !!legacy.cloud_ai
  const internal = !!legacy.internal_ai
  if (cloud && internal) {
    // Invalid: both true — normalize to local_only (conservative)
    return 'local_only'
  }
  if (cloud && !internal) return 'internal_and_cloud'
  if (!cloud && internal) return 'local_only'
  return 'none'
}

/**
 * Parse policy from JSON/object. Supports both legacy and new format.
 */
export function parsePolicyToMode(input: PolicySelectionInput | null | undefined): AiProcessingMode {
  if (!input || typeof input !== 'object') return DEFAULT_AI_PROCESSING_MODE
  const asNew = input as PolicySelectionNew
  if (asNew.ai_processing_mode) {
    const mode = asNew.ai_processing_mode
    // Backward compat: accept old 'cloud_allowed' value from existing capsules/DB records
    if ((mode as string) === 'cloud_allowed') return 'internal_and_cloud'
    if (['none', 'local_only', 'internal_and_cloud'].includes(mode)) {
      return mode
    }
  }
  return legacyToAiProcessingMode(input as LegacyPolicySelection)
}

/**
 * Convert ai_processing_mode to UsagePolicy flags (local_ai_allowed, cloud_ai_allowed).
 */
export function modeToUsageFlags(mode: AiProcessingMode): { local_ai_allowed: boolean; cloud_ai_allowed: boolean } {
  switch (mode) {
    case 'none':
      return { local_ai_allowed: false, cloud_ai_allowed: false }
    case 'local_only':
      return { local_ai_allowed: true, cloud_ai_allowed: false }
    case 'internal_and_cloud':
      return { local_ai_allowed: true, cloud_ai_allowed: true }
    default:
      return { local_ai_allowed: true, cloud_ai_allowed: false }
  }
}

/**
 * Convert ai_processing_mode to legacy format for backward-compatible persistence.
 * New writes should prefer storing ai_processing_mode; this is for transition.
 */
export function modeToLegacy(mode: AiProcessingMode): LegacyPolicySelection {
  switch (mode) {
    case 'none':
      return { cloud_ai: false, internal_ai: false }
    case 'local_only':
      return { cloud_ai: false, internal_ai: true }
    case 'internal_and_cloud':
      return { cloud_ai: true, internal_ai: false }
    default:
      return { cloud_ai: false, internal_ai: true }
  }
}

/**
 * Serialize for DB. Stores ai_processing_mode as primary; legacy fields for compatibility.
 */
export function serializePolicyForDb(mode: AiProcessingMode): string {
  const legacy = modeToLegacy(mode)
  return JSON.stringify({ ai_processing_mode: mode, ...legacy })
}
