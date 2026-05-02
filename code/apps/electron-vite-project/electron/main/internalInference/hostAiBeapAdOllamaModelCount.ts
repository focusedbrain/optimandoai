/**
 * Ollama model count for Host AI BEAP advertisement gating.
 * Ollama is loaded via dynamic `import()` so this file stays safe when tests import {@link hostAiDirectBeapAdPublish};
 * tests mock this module with `vi.mock('./hostAiBeapAdOllamaModelCount')` instead of loading `ollama-manager`.
 */

export async function hostAiBeapAdLocalOllamaModelCount(): Promise<{ ollama_ok: boolean; models_count: number }> {
  try {
    const { ollamaManager } = await import('../llm/ollama-manager')
    const installed = await ollamaManager.listModels()
    const n = Array.isArray(installed) ? installed.length : 0
    return { ollama_ok: true, models_count: n }
  } catch {
    return { ollama_ok: false, models_count: 0 }
  }
}
