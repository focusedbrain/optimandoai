/**
 * Ollama model roster for Host AI BEAP advertisement (relay bootstrap).
 * Ollama is loaded via dynamic `import()` so this file stays safe when tests import {@link hostAiDirectBeapAdPublish};
 * tests mock this module with `vi.mock('./hostAiBeapAdOllamaModelCount')`.
 */

export type HostAiBeapAdOllamaModelWireEntry = {
  id: string
  name: string
  provider: 'llamacpp' | 'ollama'
  available: boolean
  /** Exactly one Host execution model at a time (VRAM); see `max_concurrent_local_models`. */
  active: boolean
}

export type HostAiBeapAdLocalOllamaModelRosterResult = {
  ollama_ok: boolean
  models_count: number
  models: HostAiBeapAdOllamaModelWireEntry[]
  active_model_id: string | null
  active_model_name: string | null
  /** Where {@link active_model_id} was resolved (for diagnostics only). */
  model_source: string
}

export async function hostAiBeapAdLocalOllamaModelRoster(): Promise<HostAiBeapAdLocalOllamaModelRosterResult> {
  try {
    const { getLocalLlmProviderStatus } = await import('../llm/localLlmProviderStatus')
    const { getHostInternalInferencePolicy } = await import('./hostInferencePolicyStore')
    const { resolveModelForInternalInference } = await import('../llm/internalHostInferenceLocal')
    const { canonicalLocalModelName, localModelIdsMatch } = await import('../llm/localModelIdentity')
    const hostPolicy = getHostInternalInferencePolicy()
    const allow = hostPolicy.modelAllowlist ?? []
    const providerStatus = await getLocalLlmProviderStatus()
    let resolved = await resolveModelForInternalInference(undefined, allow)
    let modelSource = 'resolveModelForInternalInference'
    if (!('model' in resolved)) {
      const active = providerStatus.activeModel?.trim()
      const nameSet = new Set(providerStatus.modelsInstalled.map((x) => canonicalLocalModelName(x.name)))
      const activeCanon = canonicalLocalModelName(active)
      if (
        activeCanon &&
        nameSet.has(activeCanon) &&
        (allow.length === 0 || allow.some((a) => localModelIdsMatch(a, activeCanon)))
      ) {
        resolved = { model: activeCanon }
        modelSource = 'llamacpp_status_activeModel'
      }
    }
    const installed = providerStatus.modelsInstalled
    /**
     * Canonical identity outward: exactly ONE roster entry per model (filename without .gguf),
     * never the full GGUF path as its own entry. `activeId` is canonical too.
     */
    const activeId = 'model' in resolved ? canonicalLocalModelName(resolved.model) || null : null
    const seen = new Set<string>()
    const models: HostAiBeapAdOllamaModelWireEntry[] = []
    for (const m of installed ?? []) {
      const name = canonicalLocalModelName(m.name)
      if (!name || seen.has(name)) continue
      seen.add(name)
      const allowed = allow.length === 0 || allow.some((a) => localModelIdsMatch(a, name))
      models.push({
        id: name,
        name,
        provider: 'llamacpp',
        available: allowed,
        active: Boolean(activeId && name === activeId),
      })
    }
    return {
      // B1 fix: this must reflect the real llama-server reachability probe (`serverRunning`),
      // never "the roster derivation above didn't throw". A filesystem GGUF scan always
      // succeeds even with zero models and even when the server itself is unreachable —
      // that previously produced `ollama_ok: true` while the server was actually down.
      ollama_ok: providerStatus.serverRunning,
      models_count: models.length,
      models,
      active_model_id: activeId,
      active_model_name: activeId,
      model_source: modelSource,
    }
  } catch {
    return {
      ollama_ok: false,
      models_count: 0,
      models: [],
      active_model_id: null,
      active_model_name: null,
      model_source: 'error',
    }
  }
}

/** @deprecated Prefer {@link hostAiBeapAdLocalOllamaModelRoster}; kept for older test mocks. */
export async function hostAiBeapAdLocalOllamaModelCount(): Promise<{ ollama_ok: boolean; models_count: number }> {
  const r = await hostAiBeapAdLocalOllamaModelRoster()
  return { ollama_ok: r.ollama_ok, models_count: r.models_count }
}
