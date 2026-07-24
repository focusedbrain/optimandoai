import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getGpuStatusMock = vi.fn()
const getGpuInferenceStatusRemoteMock = vi.fn()

vi.mock('../gpuStatus', () => ({
  clearGpuStatusCache: vi.fn(),
  getGpuStatus: () => getGpuStatusMock(),
  getGpuInferenceStatusRemote: (a: string, b: string) => getGpuInferenceStatusRemoteMock(a, b),
}))

import {
  InferenceUnavailableError,
  assertGpuInferenceAvailable,
  assertGpuInferenceAvailableForRemoteOllama,
  isGpuInferenceAvailable,
} from '../inferenceGate'

describe('inferenceGate', () => {
  const prevCpu = process.env.WRDESK_ALLOW_CPU_INFERENCE

  beforeEach(() => {
    delete process.env.WRDESK_ALLOW_CPU_INFERENCE
    getGpuStatusMock.mockReset()
    getGpuInferenceStatusRemoteMock.mockReset()
  })

  afterEach(() => {
    if (prevCpu === undefined) delete process.env.WRDESK_ALLOW_CPU_INFERENCE
    else process.env.WRDESK_ALLOW_CPU_INFERENCE = prevCpu
  })

  it('assertGpuInferenceAvailable resolves when GpuStatus.available', async () => {
    getGpuStatusMock.mockResolvedValue({
      available: true,
      reason: null,
      detail: {},
      userMessage: 'GPU inference is available.',
      technicalSummary: '{}',
    })
    await expect(assertGpuInferenceAvailable()).resolves.toBeUndefined()
  })

  it('assertGpuInferenceAvailable throws InferenceUnavailableError when blocked', async () => {
    getGpuStatusMock.mockResolvedValue({
      available: false,
      reason: 'MODEL_TOO_LARGE_FOR_GPU',
      detail: {},
      userMessage: 'too big',
      technicalSummary: '{}',
    })
    await expect(assertGpuInferenceAvailable()).rejects.toMatchObject({
      name: 'InferenceUnavailableError',
      reason: 'MODEL_TOO_LARGE_FOR_GPU',
      userMessage: 'too big',
    })
  })

  it('respects WRDESK_ALLOW_CPU_INFERENCE=1 without consulting GpuStatus', async () => {
    process.env.WRDESK_ALLOW_CPU_INFERENCE = '1'
    await assertGpuInferenceAvailable()
    expect(getGpuStatusMock).not.toHaveBeenCalled()
  })

  it('isGpuInferenceAvailable is non-throwing', async () => {
    getGpuStatusMock.mockResolvedValue({
      available: false,
      reason: 'UNKNOWN',
      detail: {},
      userMessage: 'bad',
      technicalSummary: '{}',
    })
    await expect(isGpuInferenceAvailable()).resolves.toBe(false)

    getGpuStatusMock.mockResolvedValue({
      available: true,
      reason: null,
      detail: {},
      userMessage: 'ok',
      technicalSummary: '{}',
    })
    await expect(isGpuInferenceAvailable()).resolves.toBe(true)
  })

  it('routes remote probes through getGpuInferenceStatusRemote', async () => {
    getGpuInferenceStatusRemoteMock.mockResolvedValue({
      available: false,
      reason: 'PARTIAL_GPU_OFFLOAD',
      detail: {},
      userMessage: 'partial offload',
      technicalSummary: '{}',
    })

    await expect(
      assertGpuInferenceAvailableForRemoteOllama('http://lan:8080', 'mistral:latest'),
    ).rejects.toBeInstanceOf(InferenceUnavailableError)
    expect(getGpuInferenceStatusRemoteMock).toHaveBeenCalledWith('http://lan:8080', 'mistral:latest')
  })
})
