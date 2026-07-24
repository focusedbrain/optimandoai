/**
 * B1 regression test: `hostAiBeapAdLocalOllamaModelRoster` must report `ollama_ok` from the
 * real llama-server reachability probe (`LocalLlmProviderStatus.serverRunning`), never from
 * "the disk-scan-based roster derivation didn't throw".
 *
 * Before the fix, a filesystem GGUF scan that finds models on disk while the llama-server
 * process is down (or unreachable) still produced `ollama_ok: true`, which caused the BEAP ad
 * publish gate to advertise Host AI availability while inference actually could not be served.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const getLocalLlmProviderStatusMock = vi.hoisted(() => vi.fn())
vi.mock('../../llm/localLlmProviderStatus', () => ({
  getLocalLlmProviderStatus: (...a: unknown[]) => getLocalLlmProviderStatusMock(...a),
}))

const getHostInternalInferencePolicyMock = vi.hoisted(() =>
  vi.fn(() => ({ modelAllowlist: [] as string[] })),
)
vi.mock('../hostInferencePolicyStore', () => ({
  getHostInternalInferencePolicy: (...a: unknown[]) => getHostInternalInferencePolicyMock(...a),
}))

const resolveModelForInternalInferenceMock = vi.hoisted(() =>
  vi.fn(async () => ({ error: 'no_model' as const })),
)
vi.mock('../../llm/internalHostInferenceLocal', () => ({
  resolveModelForInternalInference: (...a: unknown[]) => resolveModelForInternalInferenceMock(...a),
}))

describe('hostAiBeapAdLocalOllamaModelRoster — B1 ollama_ok truth regression', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('reports ollama_ok=false when the probe fails even though disk scan found models', async () => {
    // Disk scan succeeded (models present) but the real llama-server HTTP probe is down.
    getLocalLlmProviderStatusMock.mockResolvedValue({
      binaryInstalled: true,
      serverRunning: false,
      modelsInstalled: [
        { name: 'gemma4-12b-it-q8_0', size: 1, modified: '', digest: '', isActive: true },
      ],
      modelsCount: 1,
      activeModel: 'gemma4-12b-it-q8_0',
      activeModelUnresolvable: false,
      port: 8080,
      baseUrl: 'http://127.0.0.1:8080',
    })

    const { hostAiBeapAdLocalOllamaModelRoster } = await import('../hostAiBeapAdOllamaModelCount')
    const result = await hostAiBeapAdLocalOllamaModelRoster()

    expect(result.ollama_ok).toBe(false)
    expect(result.models_count).toBe(1)
  })

  it('reports ollama_ok=true when the probe succeeds and models are installed', async () => {
    getLocalLlmProviderStatusMock.mockResolvedValue({
      binaryInstalled: true,
      serverRunning: true,
      modelsInstalled: [
        { name: 'gemma4-12b-it-q8_0', size: 1, modified: '', digest: '', isActive: true },
      ],
      modelsCount: 1,
      activeModel: 'gemma4-12b-it-q8_0',
      activeModelUnresolvable: false,
      port: 8080,
      baseUrl: 'http://127.0.0.1:8080',
    })
    resolveModelForInternalInferenceMock.mockResolvedValue({ model: 'gemma4-12b-it-q8_0' })

    const { hostAiBeapAdLocalOllamaModelRoster } = await import('../hostAiBeapAdOllamaModelCount')
    const result = await hostAiBeapAdLocalOllamaModelRoster()

    expect(result.ollama_ok).toBe(true)
    expect(result.models_count).toBe(1)
  })

  it('reports ollama_ok=false with zero models when nothing is installed and the server is down', async () => {
    getLocalLlmProviderStatusMock.mockResolvedValue({
      binaryInstalled: false,
      serverRunning: false,
      modelsInstalled: [],
      modelsCount: 0,
      activeModel: null,
      activeModelUnresolvable: false,
      port: 8080,
      baseUrl: 'http://127.0.0.1:8080',
    })

    const { hostAiBeapAdLocalOllamaModelRoster } = await import('../hostAiBeapAdOllamaModelCount')
    const result = await hostAiBeapAdLocalOllamaModelRoster()

    expect(result.ollama_ok).toBe(false)
    expect(result.models_count).toBe(0)
  })
})
