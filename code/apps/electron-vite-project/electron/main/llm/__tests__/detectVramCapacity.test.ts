import { afterEach, describe, expect, it, vi } from 'vitest'

const hardwareDetectMock = vi.fn()

vi.mock('../hardware', () => ({
  hardwareService: {
    detect: () => hardwareDetectMock(),
  },
}))

vi.mock('../../customModes/customModesStore', () => ({
  listModes: () => [],
}))

describe('detectVramCapacity', () => {
  afterEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('returns maxResident=2 when GPU VRAM fits default + largest mode', async () => {
    hardwareDetectMock.mockResolvedValue({
      gpuAvailable: true,
      gpuVramGb: 24,
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          models: [
            { name: 'gemma:12b', size: 8 * 1024 ** 3 },
            { name: 'llama:8b', size: 5 * 1024 ** 3 },
          ],
        }),
      }),
    )

    const { estimateMaxResidentModels } = await import('../detectVramCapacity')
    const max = await estimateMaxResidentModels({
      defaultModelId: 'gemma:12b',
      extraModelIds: ['llama:8b'],
    })
    expect(max).toBe(2)
  })

  it('returns maxResident=1 when VRAM is tight', async () => {
    hardwareDetectMock.mockResolvedValue({
      gpuAvailable: true,
      gpuVramGb: 6,
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          models: [
            { name: 'gemma:12b', size: 8 * 1024 ** 3 },
            { name: 'llama:8b', size: 8 * 1024 ** 3 },
          ],
        }),
      }),
    )

    const { estimateMaxResidentModels } = await import('../detectVramCapacity')
    const max = await estimateMaxResidentModels({
      defaultModelId: 'gemma:12b',
      extraModelIds: ['llama:8b'],
    })
    expect(max).toBe(1)
  })
})
