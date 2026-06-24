/**
 * GpuInferenceBarBadge.tsx — label mapping tests (Host GPU variant).
 */

import { describe, it, expect } from 'vitest'
import { resolveInferenceCapabilityFromInput } from '../../electron/main/inference/inferenceCapabilityResolver'

type InferenceCapabilityForUi = {
  backend: 'remote-host' | 'local-gpu' | 'local-cpu' | 'unavailable'
  hostHardware: 'gpu' | 'cpu' | 'unknown'
  unavailableReason?: string
}

type BadgeVariant = 'loading' | 'gpu' | 'hostGpu' | 'cpu' | 'info' | 'unavailable'

function toVariant(cap: InferenceCapabilityForUi): BadgeVariant {
  if (cap.backend === 'remote-host') {
    if (cap.hostHardware === 'gpu') return 'hostGpu'
    if (cap.hostHardware === 'cpu') return 'cpu'
    return 'info'
  }
  if (cap.hostHardware === 'gpu') return 'gpu'
  if (cap.hostHardware === 'cpu') return 'cpu'
  return cap.unavailableReason ? 'info' : 'unavailable'
}

const LABEL: Record<BadgeVariant, string> = {
  loading: 'Checking…',
  gpu: 'GPU',
  hostGpu: 'Host GPU',
  cpu: 'CPU',
  info: 'Info',
  unavailable: 'Unavailable',
}

describe('GpuInferenceBarBadge label mapping', () => {
  it('sandbox remote-host + gpu → Host GPU', () => {
    const cap = resolveInferenceCapabilityFromInput({
      isSandbox: true,
      remoteContext: { modelName: 'gemma3:12b', baseUrl: null, handshakeId: 'h1' },
      gpuAvailable: true,
      ollamaRunning: false,
      modelName: 'gemma3:12b',
    })
    expect(cap.backend).toBe('remote-host')
    expect(cap.hostHardware).toBe('gpu')
    expect(LABEL[toVariant(cap)]).toBe('Host GPU')
  })

  it('local gpu still shows GPU', () => {
    const cap = resolveInferenceCapabilityFromInput({
      isSandbox: false,
      remoteContext: null,
      gpuAvailable: true,
      ollamaRunning: true,
      modelName: 'gemma3:12b',
    })
    expect(LABEL[toVariant(cap)]).toBe('GPU')
  })

  it('remote-host unknown hardware still Info', () => {
    const cap = resolveInferenceCapabilityFromInput({
      isSandbox: true,
      remoteContext: { modelName: 'gemma3:12b' },
      gpuAvailable: false,
      ollamaRunning: false,
      modelName: 'gemma3:12b',
    })
    expect(LABEL[toVariant(cap)]).toBe('Info')
  })
})
