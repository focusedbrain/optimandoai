/**
 * P2.6 — Inbox AI security provider setting.
 *
 * Defines the AiProviderSetting type, tier-based default resolution, and the
 * runtime resolver that selects an LLM provider for phishing/crosscheck analyses.
 *
 * Rules:
 * - Default resolution lives in ONE place: defaultProviderKindForTier().
 * - No automatic failover: if the chosen provider is unavailable, analysis fails.
 * - The 'cloud' endpoint field is stored for future custom-deployment support
 *   but does not yet override the ocrRouter-configured endpoint (TODO: P2.x).
 */

import type { ResolvedLlmContext } from '../inboxLlmChat'

// ── Types ──────────────────────────────────────────────────────────────────────

export type AiProviderKind = 'default' | 'local_ollama' | 'cloud'

export type AiProviderSetting =
  | { kind: 'default' }
  | { kind: 'local_ollama' }
  | {
      kind: 'cloud'
      /** Model name override; when absent, ocrRouter default is used. */
      model?: string
      /**
       * Custom API endpoint URL (e.g. Azure OpenAI, self-hosted proxy).
       * Stored now; endpoint override support will be wired in a future step.
       * TODO P2.x: pass endpoint into provider dispatch.
       */
      endpoint?: string
    }

// ── Tier defaults (single source of truth) ────────────────────────────────────

/**
 * Auth tiers that are treated as "paid" for AI provider default resolution.
 * Free / unknown → local Ollama; any paid tier → cloud.
 */
const PAID_TIERS = new Set([
  'private',
  'private_lifetime',
  'pro',
  'publisher',
  'publisher_lifetime',
  'enterprise',
])

/**
 * Returns the default AI provider kind for a given auth tier.
 *
 * THIS IS THE SINGLE SOURCE OF TRUTH for tier→provider defaults.
 * Do not add tier logic elsewhere.
 *
 * - Paid tier → 'cloud' (recommended; more accurate but processes data externally)
 * - Free / unknown → 'local_ollama' (private; may be less accurate on low-end HW)
 */
export function defaultProviderKindForTier(tier: string): 'local_ollama' | 'cloud' {
  return PAID_TIERS.has(tier) ? 'cloud' : 'local_ollama'
}

// ── Normalisation ─────────────────────────────────────────────────────────────

/**
 * Validate and normalise an AiProviderSetting from untrusted storage (SQLite JSON).
 * Returns { kind: 'default' } for any unrecognised value.
 */
export function normalizeAiProviderSetting(raw: unknown): AiProviderSetting {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { kind: 'default' }
  const obj = raw as Record<string, unknown>
  if (obj.kind === 'local_ollama') return { kind: 'local_ollama' }
  if (obj.kind === 'cloud') {
    const model =
      typeof obj.model === 'string' && obj.model.trim() ? obj.model.trim() : undefined
    const endpoint =
      typeof obj.endpoint === 'string' && obj.endpoint.trim() ? obj.endpoint.trim() : undefined
    return { kind: 'cloud', model, endpoint }
  }
  return { kind: 'default' }
}

// ── Provider resolution ───────────────────────────────────────────────────────

/**
 * Resolver callbacks — injected for testability.
 * Production callers pass `preResolveOllamaLlm` and `preResolveCloudLlm`
 * from inboxLlmChat; tests pass stubs.
 */
export interface SecurityProviderResolvers {
  ollama: () => Promise<ResolvedLlmContext | null>
  cloud: () => Promise<ResolvedLlmContext | null>
}

/**
 * Resolve an LLM provider for security sub-analyses (phishing + crosscheck).
 *
 * Resolution order:
 *   'default'      → uses tier default (see defaultProviderKindForTier)
 *   'local_ollama' → always Ollama; returns null if unavailable
 *   'cloud'        → always cloud; returns null if no cloud key configured
 *
 * No automatic failover. If the chosen provider is unavailable, null is returned
 * and the caller (ipc.ts) skips the sub-analyses.
 *
 * A model override in a 'cloud' setting replaces the resolved model name but
 * does not change the provider or endpoint.
 */
export async function resolveSecurityAiProvider(
  setting: AiProviderSetting,
  tier: string,
  resolvers: SecurityProviderResolvers,
): Promise<ResolvedLlmContext | null> {
  const effectiveKind =
    setting.kind === 'default' ? defaultProviderKindForTier(tier) : setting.kind

  if (effectiveKind === 'local_ollama') {
    return resolvers.ollama()
  }

  // cloud branch
  const base = await resolvers.cloud()
  if (!base) return null

  // Apply optional model override stored in the cloud setting.
  const modelOverride =
    setting.kind === 'cloud' && setting.model ? setting.model : undefined
  return modelOverride ? { ...base, model: modelOverride } : base
}
