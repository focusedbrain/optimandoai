/**
 * Ollama model roster for Host AI BEAP advertisement (relay bootstrap).
 * Ollama is loaded via dynamic `import()` so this file stays safe when tests import {@link hostAiDirectBeapAdPublish};
 * tests mock this module with `vi.mock('./hostAiBeapAdOllamaModelCount')`.
 */

export type HostAiBeapAdOllamaModelWireEntry = {
  id: string
  name: string
  provider: 'ollama'
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
    const { ollamaManager } = await import('../llm/ollama-manager')
    const { getHostInternalInferencePolicy } = await import('./hostInferencePolicyStore')
    const { resolveModelForInternalInference } = await import('../llm/internalHostInferenceOllama')
    const hostPolicy = getHostInternalInferencePolicy()
    const allow = hostPolicy.modelAllowlist ?? []
    let resolved = await resolveModelForInternalInference(undefined, allow)
    let modelSource = 'resolveModelForInternalInference'
    if (!('model' in resolved)) {
      const st = await ollamaManager.getStatus()
      const active = st.activeModel?.trim()
      const nameSet = new Set((await ollamaManager.listModels()).map((x) => x.name))
      if (active && nameSet.has(active) && (allow.length === 0 || allow.includes(active))) {
        resolved = { model: active }
        modelSource = 'ollama_status_activeModel'
      }
    }
    const installed = await ollamaManager.listModels()
    const n = Array.isArray(installed) ? installed.length : 0
    const activeId = 'model' in resolved ? resolved.model.trim() : null
    const models: HostAiBeapAdOllamaModelWireEntry[] = (installed ?? []).map((m) => {
      const name = String(m.name ?? '').trim()
      if (!name) return null
      const allowed = allow.length === 0 || allow.includes(name)
      return {
        id: name,
        name,
        provider: 'ollama' as const,
        available: allowed,
        active: Boolean(activeId && name === activeId),
      }
    }).filter((x): x is HostAiBeapAdOllamaModelWireEntry => x != null)
    return {
      ollama_ok: true,
      models_count: n,
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
