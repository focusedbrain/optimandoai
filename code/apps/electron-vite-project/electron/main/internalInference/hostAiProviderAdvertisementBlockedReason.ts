/**
 * Pure helper: primary blocked-reason string for Host AI provider advertisement diagnostics.
 * Kept dependency-free so unit tests do not load Electron / ledger / orchestrator.
 */

export type HostAiLedgerEffectiveRoleForAd = 'host' | 'sandbox' | 'none' | 'mixed'

/** Why provider advertisement failed — single primary reason for support / `[HOST_AI_PROVIDER_ADVERTISEMENT_BLOCKED]`. */
export function deriveProviderAdvertisementBlockedReason(p: {
  effective_role: HostAiLedgerEffectiveRoleForAd
  can_publish_host_endpoint: boolean
  policyAllowsRemote: boolean | null | undefined
  /** True when user explicitly disabled Host inference sharing (persisted `deny`). */
  policyExplicitUserDisabled?: boolean
  /** From {@link resolveHostAiRemoteInferencePolicy} when remote inference is not allowed. */
  policyDenialReason?: string | null
  ollama_ok: boolean
  models_count: number
  host_published_direct_endpoint: string | null
  advertisement_headers_can_generate: boolean
}): string {
  if (p.effective_role === 'sandbox') return 'sandbox_device_must_not_publish_host_ad'
  if (p.effective_role === 'mixed') return 'ledger_role_mixed_cannot_publish_host_ad'
  if (p.effective_role !== 'host') return 'effective_host_ai_role_not_host'
  if (!p.can_publish_host_endpoint) return 'cannot_publish_host_endpoint'
  if (p.policyAllowsRemote !== true) {
    if (p.policyExplicitUserDisabled) return 'explicit_user_disabled_remote_inference'
    const d = p.policyDenialReason
    if (d === 'no_active_internal_sandbox_peer') return 'host_inference_policy_no_internal_sandbox_peer'
    if (d === 'not_ledger_eligible_host') return 'host_inference_policy_not_ledger_eligible_host'
    if (d === 'ledger_db_unavailable') return 'host_inference_policy_ledger_db_unavailable'
    return 'host_inference_policy_denies_remote'
  }
  if (!p.ollama_ok) return 'ollama_discovery_failed'
  if (p.models_count < 1) return 'no_ollama_models'
  if (p.host_published_direct_endpoint == null || String(p.host_published_direct_endpoint).trim() === '')
    return 'no_host_published_direct_endpoint'
  if (!p.advertisement_headers_can_generate) return 'advertisement_headers_not_generatable'
  return 'unknown'
}
