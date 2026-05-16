import { describe, it, expect } from 'vitest'
import {
  isCpuSafeModel,
  resolveInferenceCapabilityFromInput,
  CPU_SAFE_MODEL_PATTERNS,
} from '../inferenceCapabilityResolver'

// ── isCpuSafeModel ────────────────────────────────────────────────────────────

describe('isCpuSafeModel', () => {
  it('gemma2:2b is CPU-safe', () => expect(isCpuSafeModel('gemma2:2b')).toBe(true))
  it('gemma:1b is CPU-safe',  () => expect(isCpuSafeModel('gemma:1b')).toBe(true))
  it('gemma3:2b is CPU-safe (small variant)', () => expect(isCpuSafeModel('gemma3:2b')).toBe(true))

  // Hard rule: gemma3:12b must NOT be CPU-safe
  it('gemma3:12b is NOT CPU-safe', () => expect(isCpuSafeModel('gemma3:12b')).toBe(false))
  it('gemma3:27b is NOT CPU-safe', () => expect(isCpuSafeModel('gemma3:27b')).toBe(false))
  it('llama3.1:8b is NOT CPU-safe', () => expect(isCpuSafeModel('llama3.1:8b')).toBe(false))
  it('mistral:7b is NOT CPU-safe', () => expect(isCpuSafeModel('mistral:7b')).toBe(false))

  it('qwen2:0.5b is CPU-safe',  () => expect(isCpuSafeModel('qwen2:0.5b')).toBe(true))
  it('qwen2:1.5b is CPU-safe',  () => expect(isCpuSafeModel('qwen2:1.5b')).toBe(true))
  it('qwen2:7b is NOT CPU-safe', () => expect(isCpuSafeModel('qwen2:7b')).toBe(false))

  it('phi4-mini is CPU-safe',   () => expect(isCpuSafeModel('phi4-mini')).toBe(true))
  it('phi3-mini is CPU-safe',   () => expect(isCpuSafeModel('phi3-mini')).toBe(true))
  it('smollm2:135m is CPU-safe', () => expect(isCpuSafeModel('smollm2:135m')).toBe(true))
  it('tinyllama is CPU-safe',   () => expect(isCpuSafeModel('tinyllama')).toBe(true))
  it('empty string is NOT CPU-safe', () => expect(isCpuSafeModel('')).toBe(false))

  it('CPU_SAFE_MODEL_PATTERNS is a non-empty readonly array', () => {
    expect(Array.isArray(CPU_SAFE_MODEL_PATTERNS)).toBe(true)
    expect(CPU_SAFE_MODEL_PATTERNS.length).toBeGreaterThan(0)
  })
})

// ── resolveInferenceCapabilityFromInput ───────────────────────────────────────

describe('resolveInferenceCapabilityFromInput — 6 acceptance criteria', () => {

  // Acceptance 1: sandbox + healthy paired host + GPU => remote-host, hostHardware:gpu
  it('1. sandbox + healthy paired host (GPU) => remote-host, hardware:gpu', () => {
    const r = resolveInferenceCapabilityFromInput({
      isSandbox: true,
      remoteContext: {
        modelName: 'gemma3:12b',
        baseUrl: 'http://192.168.1.5:11434',
        handshakeId: 'hs-1',
        peerDeviceId: 'win-host-1',
      },
      gpuAvailable: true,   // host GPU probe returned true
      ollamaRunning: false,
      modelName: 'gemma3:12b',
    })
    expect(r.backend).toBe('remote-host')
    expect(r.hostHardware).toBe('gpu')
    expect(r.remoteBaseUrl).toBe('http://192.168.1.5:11434')
    expect(r.handshakeId).toBe('hs-1')
    expect(r.userMessage).toContain('Host GPU inference is available')
  })

  // Acceptance 1b: sandbox + healthy paired host + CPU-safe model => remote-host, hostHardware:cpu
  it('1b. sandbox + healthy paired host (CPU, small model) => remote-host, hardware:cpu', () => {
    const r = resolveInferenceCapabilityFromInput({
      isSandbox: true,
      remoteContext: { modelName: 'gemma2:2b', baseUrl: 'http://192.168.1.5:11434' },
      gpuAvailable: false,  // host GPU probe: no GPU
      ollamaRunning: false,
      modelName: 'gemma2:2b',
    })
    expect(r.backend).toBe('remote-host')
    expect(r.hostHardware).toBe('cpu')
    expect(r.userMessage).toContain('Host CPU inference')
  })

  // Acceptance 2: host + GPU healthy => local-gpu, hardware:gpu
  it('2. host + GPU healthy => local-gpu, hardware:gpu', () => {
    const r = resolveInferenceCapabilityFromInput({
      isSandbox: false,
      remoteContext: null,
      gpuAvailable: true,
      ollamaRunning: true,
      modelName: 'gemma3:12b',
    })
    expect(r.backend).toBe('local-gpu')
    expect(r.hostHardware).toBe('gpu')
    expect(r.modelName).toBe('gemma3:12b')
  })

  // Acceptance 3: local Ollama + CPU-safe model + no GPU => local-cpu, hardware:cpu
  it('3. local Ollama + CPU-safe model + no GPU => local-cpu, hardware:cpu', () => {
    const r = resolveInferenceCapabilityFromInput({
      isSandbox: false,
      remoteContext: null,
      gpuAvailable: false,
      ollamaRunning: true,
      modelName: 'gemma2:2b',
    })
    expect(r.backend).toBe('local-cpu')
    expect(r.hostHardware).toBe('cpu')
    expect(r.modelName).toBe('gemma2:2b')
  })

  // Acceptance 4: local CPU + gemma3:12b => unavailable (NOT local-cpu)
  it('4. local CPU + gemma3:12b => unavailable, NOT local-cpu', () => {
    const r = resolveInferenceCapabilityFromInput({
      isSandbox: false,
      remoteContext: null,
      gpuAvailable: false,
      ollamaRunning: true,
      modelName: 'gemma3:12b',
    })
    expect(r.backend).toBe('unavailable')
    expect(r.backend).not.toBe('local-cpu')
    expect(r.hostHardware).toBe('unknown')
    expect(r.unavailableReason).toBe('model_requires_gpu_or_remote')
    expect(r.userMessage).toContain('gemma3:12b')
    expect(r.userMessage).toContain('GPU or remote host inference')
  })

  // Acceptance 5: badge label derivation — no "Remote" label
  it('5. badge label: GPU/CPU/Info/Unavailable — no Remote label', () => {
    const label = (r: ReturnType<typeof resolveInferenceCapabilityFromInput>): string => {
      if (r.backend === 'unavailable') {
        return r.unavailableReason ? 'Info' : 'Unavailable'
      }
      // Both local and remote paths use hostHardware for the label
      if (r.hostHardware === 'gpu')  return 'GPU'
      if (r.hostHardware === 'cpu')  return 'CPU'
      return 'Info'  // unknown hardware
    }

    // remote-host + GPU => "GPU" (not "Remote")
    expect(label(resolveInferenceCapabilityFromInput({
      isSandbox: true,
      remoteContext: { modelName: 'gemma3:12b', baseUrl: 'http://host:11434' },
      gpuAvailable: true, ollamaRunning: false, modelName: 'gemma3:12b',
    }))).toBe('GPU')

    // remote-host + CPU => "CPU" (not "Remote")
    expect(label(resolveInferenceCapabilityFromInput({
      isSandbox: true,
      remoteContext: { modelName: 'gemma2:2b', baseUrl: 'http://host:11434' },
      gpuAvailable: false, ollamaRunning: false, modelName: 'gemma2:2b',
    }))).toBe('CPU')

    // local-gpu => "GPU"
    expect(label(resolveInferenceCapabilityFromInput({
      isSandbox: false, remoteContext: null,
      gpuAvailable: true, ollamaRunning: true, modelName: 'gemma3:12b',
    }))).toBe('GPU')

    // local-cpu => "CPU"
    expect(label(resolveInferenceCapabilityFromInput({
      isSandbox: false, remoteContext: null,
      gpuAvailable: false, ollamaRunning: true, modelName: 'gemma2:2b',
    }))).toBe('CPU')

    // unavailable with reason => "Info"
    expect(label(resolveInferenceCapabilityFromInput({
      isSandbox: false, remoteContext: null,
      gpuAvailable: false, ollamaRunning: true, modelName: 'gemma3:12b',
    }))).toBe('Info')
  })

  // Acceptance 6: resolver is pure — does not depend on getGpuStatus()
  it('6. pure function: CPU-safe model picks local-cpu without consulting getGpuStatus', () => {
    // resolveInferenceCapabilityFromInput is sync and takes pre-resolved inputs.
    // No mocks needed — it literally cannot call getGpuStatus.
    const r = resolveInferenceCapabilityFromInput({
      isSandbox: false,
      remoteContext: null,
      gpuAvailable: false,
      ollamaRunning: true,
      modelName: 'phi4-mini',
    })
    expect(r.backend).toBe('local-cpu')
    expect(r.hostHardware).toBe('cpu')
  })
})

// ── Edge cases ────────────────────────────────────────────────────────────────

describe('resolveInferenceCapabilityFromInput — edge cases', () => {
  it('sandbox + no remote host falls through to GPU tier', () => {
    const r = resolveInferenceCapabilityFromInput({
      isSandbox: true, remoteContext: null,
      gpuAvailable: true, ollamaRunning: true, modelName: 'gemma3:12b',
    })
    expect(r.backend).toBe('local-gpu')
    expect(r.hostHardware).toBe('gpu')
  })

  it('allowCpuOverride permits large model on CPU', () => {
    const r = resolveInferenceCapabilityFromInput({
      isSandbox: false, remoteContext: null,
      gpuAvailable: false, ollamaRunning: true,
      modelName: 'gemma3:12b', allowCpuOverride: true,
    })
    expect(r.backend).toBe('local-cpu')
    expect(r.hostHardware).toBe('cpu')
    expect(r.userMessage).toContain('WRDESK_ALLOW_CPU_INFERENCE')
  })

  it('no model selected => unavailable/no_model_selected', () => {
    const r = resolveInferenceCapabilityFromInput({
      isSandbox: false, remoteContext: null,
      gpuAvailable: false, ollamaRunning: true, modelName: null,
    })
    expect(r.backend).toBe('unavailable')
    expect(r.unavailableReason).toBe('no_model_selected')
  })

  it('ollama not running => unavailable/ollama_not_running', () => {
    const r = resolveInferenceCapabilityFromInput({
      isSandbox: false, remoteContext: null,
      gpuAvailable: false, ollamaRunning: false, modelName: 'gemma3:12b',
    })
    expect(r.backend).toBe('unavailable')
    expect(r.unavailableReason).toBe('ollama_not_running')
  })

  it('remote-host + unknown hardware (no GPU, large model) => hostHardware:unknown', () => {
    const r = resolveInferenceCapabilityFromInput({
      isSandbox: true,
      remoteContext: { modelName: 'gemma3:12b', baseUrl: 'http://host:11434' },
      gpuAvailable: false,
      ollamaRunning: false,
      modelName: 'gemma3:12b',
    })
    expect(r.backend).toBe('remote-host')
    expect(r.hostHardware).toBe('unknown')
  })
})
