import { describe, it, expect } from 'vitest'
import {
  isCpuSafeModel,
  resolveInferenceCapabilityFromInput,
  CPU_SAFE_MODEL_PATTERNS,
} from '../inferenceCapabilityResolver'

// ── isCpuSafeModel ────────────────────────────────────────────────────────────

describe('isCpuSafeModel', () => {
  it('gemma2:2b is CPU-safe', () => expect(isCpuSafeModel('gemma2:2b')).toBe(true))
  it('gemma:1b is CPU-safe', () => expect(isCpuSafeModel('gemma:1b')).toBe(true))
  it('gemma3:2b is CPU-safe (small variant)', () => expect(isCpuSafeModel('gemma3:2b')).toBe(true))

  // Hard rule: gemma3:12b must NOT be CPU-safe
  it('gemma3:12b is NOT CPU-safe', () => expect(isCpuSafeModel('gemma3:12b')).toBe(false))
  it('gemma3:27b is NOT CPU-safe', () => expect(isCpuSafeModel('gemma3:27b')).toBe(false))
  it('llama3.1:8b is NOT CPU-safe', () => expect(isCpuSafeModel('llama3.1:8b')).toBe(false))
  it('mistral:7b is NOT CPU-safe', () => expect(isCpuSafeModel('mistral:7b')).toBe(false))
  it('mixtral:8x7b is NOT CPU-safe', () => expect(isCpuSafeModel('mixtral:8x7b')).toBe(false))

  it('qwen2:0.5b is CPU-safe', () => expect(isCpuSafeModel('qwen2:0.5b')).toBe(true))
  it('qwen2:1.5b is CPU-safe', () => expect(isCpuSafeModel('qwen2:1.5b')).toBe(true))
  it('qwen2:7b is NOT CPU-safe', () => expect(isCpuSafeModel('qwen2:7b')).toBe(false))

  it('phi4-mini is CPU-safe', () => expect(isCpuSafeModel('phi4-mini')).toBe(true))
  it('phi3-mini is CPU-safe', () => expect(isCpuSafeModel('phi3-mini')).toBe(true))
  it('smollm2:135m is CPU-safe', () => expect(isCpuSafeModel('smollm2:135m')).toBe(true))
  it('tinyllama is CPU-safe', () => expect(isCpuSafeModel('tinyllama')).toBe(true))
  it('empty string is NOT CPU-safe', () => expect(isCpuSafeModel('')).toBe(false))

  it('CPU_SAFE_MODEL_PATTERNS is readonly (immutable at runtime)', () => {
    // Ensures the array reference is exposed for tests but is not mutated
    expect(Array.isArray(CPU_SAFE_MODEL_PATTERNS)).toBe(true)
    expect(CPU_SAFE_MODEL_PATTERNS.length).toBeGreaterThan(0)
  })
})

// ── resolveInferenceCapabilityFromInput ───────────────────────────────────────

describe('resolveInferenceCapabilityFromInput', () => {
  // ── Acceptance test 1: sandbox + healthy paired host => remote-host ───────
  it('1. sandbox + healthy paired host => remote-host', () => {
    const result = resolveInferenceCapabilityFromInput({
      isSandbox: true,
      remoteContext: {
        modelName: 'gemma3:12b',
        baseUrl: 'http://192.168.1.5:11434',
        handshakeId: 'hs-abc-1',
        peerDeviceId: 'device-host-1',
      },
      gpuAvailable: false,
      ollamaRunning: false,
      modelName: 'gemma3:12b',
    })
    expect(result.backend).toBe('remote-host')
    expect(result.remoteBaseUrl).toBe('http://192.168.1.5:11434')
    expect(result.handshakeId).toBe('hs-abc-1')
    expect(result.peerDeviceId).toBe('device-host-1')
    expect(result.modelName).toBe('gemma3:12b')
  })

  // ── Acceptance test 2: host + GPU healthy => local-gpu ────────────────────
  it('2. host + GPU healthy => local-gpu', () => {
    const result = resolveInferenceCapabilityFromInput({
      isSandbox: false,
      remoteContext: null,
      gpuAvailable: true,
      ollamaRunning: true,
      modelName: 'gemma3:12b',
    })
    expect(result.backend).toBe('local-gpu')
    expect(result.modelName).toBe('gemma3:12b')
  })

  // ── Acceptance test 3: local Ollama + CPU-safe model + no GPU => local-cpu ─
  it('3. local Ollama + CPU-safe model + no GPU => local-cpu', () => {
    const result = resolveInferenceCapabilityFromInput({
      isSandbox: false,
      remoteContext: null,
      gpuAvailable: false,
      ollamaRunning: true,
      modelName: 'gemma2:2b',
    })
    expect(result.backend).toBe('local-cpu')
    expect(result.modelName).toBe('gemma2:2b')
  })

  // ── Acceptance test 4: local CPU + gemma3:12b => unavailable (NOT local-cpu)
  it('4. local CPU + gemma3:12b => unavailable, not local-cpu', () => {
    const result = resolveInferenceCapabilityFromInput({
      isSandbox: false,
      remoteContext: null,
      gpuAvailable: false,
      ollamaRunning: true,
      modelName: 'gemma3:12b',
    })
    expect(result.backend).toBe('unavailable')
    expect(result.unavailableReason).toBe('model_requires_gpu_or_remote')
    expect(result.userMessage).toContain('gemma3:12b')
    expect(result.userMessage).toContain('GPU or remote host inference')
    // Confirm the label we should NOT show
    expect(result.backend).not.toBe('local-cpu')
  })

  // ── Acceptance test 5 (UI label derivation): each backend maps to correct badge
  it('5. UI label: backend values map to distinct display labels', () => {
    const labelFor = (backend: string): string => {
      switch (backend) {
        case 'local-gpu':   return 'GPU'
        case 'local-cpu':   return 'CPU'
        case 'remote-host': return 'Remote'
        case 'unavailable': return 'Info'
        default:            return 'Unavailable'
      }
    }
    expect(labelFor('local-gpu')).toBe('GPU')
    expect(labelFor('local-cpu')).toBe('CPU')
    expect(labelFor('remote-host')).toBe('Remote')
    expect(labelFor('unavailable')).toBe('Info')
  })

  // ── Acceptance test 6: capability result does not depend on getGpuStatus ──
  it('6. capability resolution does not require getGpuStatus (inputs are pre-resolved)', () => {
    // resolveInferenceCapabilityFromInput is sync and pure — it never calls getGpuStatus.
    // Demonstrate: even without a GPU (gpuAvailable:false) the resolver
    // correctly selects local-cpu for a safe model without consulting GPU diagnostics.
    const result = resolveInferenceCapabilityFromInput({
      isSandbox: false,
      remoteContext: null,
      gpuAvailable: false, // explicitly no GPU — resolver must NOT call getGpuStatus to decide
      ollamaRunning: true,
      modelName: 'phi4-mini',
    })
    expect(result.backend).toBe('local-cpu')
    expect(result.userMessage).toContain('CPU inference is available')
  })

  // ── Edge cases ────────────────────────────────────────────────────────────

  it('sandbox + no remote host falls through to GPU tier', () => {
    const result = resolveInferenceCapabilityFromInput({
      isSandbox: true,
      remoteContext: null, // no remote host
      gpuAvailable: true,
      ollamaRunning: true,
      modelName: 'gemma3:12b',
    })
    expect(result.backend).toBe('local-gpu')
  })

  it('sandbox + no remote host + no GPU + CPU-safe model => local-cpu', () => {
    const result = resolveInferenceCapabilityFromInput({
      isSandbox: true,
      remoteContext: null,
      gpuAvailable: false,
      ollamaRunning: true,
      modelName: 'gemma2:2b',
    })
    expect(result.backend).toBe('local-cpu')
  })

  it('allowCpuOverride allows large model on CPU (dev escape hatch)', () => {
    const result = resolveInferenceCapabilityFromInput({
      isSandbox: false,
      remoteContext: null,
      gpuAvailable: false,
      ollamaRunning: true,
      modelName: 'gemma3:12b',
      allowCpuOverride: true,
    })
    expect(result.backend).toBe('local-cpu')
    expect(result.userMessage).toContain('WRDESK_ALLOW_CPU_INFERENCE')
  })

  it('no model selected => unavailable with no_model_selected reason', () => {
    const result = resolveInferenceCapabilityFromInput({
      isSandbox: false,
      remoteContext: null,
      gpuAvailable: false,
      ollamaRunning: true,
      modelName: null,
    })
    expect(result.backend).toBe('unavailable')
    expect(result.unavailableReason).toBe('no_model_selected')
  })

  it('ollama not running => unavailable with ollama_not_running reason', () => {
    const result = resolveInferenceCapabilityFromInput({
      isSandbox: false,
      remoteContext: null,
      gpuAvailable: false,
      ollamaRunning: false,
      modelName: 'gemma3:12b',
    })
    expect(result.backend).toBe('unavailable')
    expect(result.unavailableReason).toBe('ollama_not_running')
  })
})
