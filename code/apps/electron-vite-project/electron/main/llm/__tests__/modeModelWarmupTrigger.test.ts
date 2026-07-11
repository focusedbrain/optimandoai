import { afterEach, describe, expect, it, vi } from 'vitest'

const isEffectiveSandboxNodeMock = vi.fn()
const getModeByIdMock = vi.fn()
const resolveStrategyMock = vi.fn()
const warmModelMock = vi.fn()
const getHandshakeDbMock = vi.fn()
const resolveDeclaredModelMock = vi.fn()

vi.mock('../../internalInference/dbAccess', () => ({
  getHandshakeDbForInternalInference: () => getHandshakeDbMock(),
}))

vi.mock('../resolveDeclaredModelAvailability', () => ({
  resolveDeclaredLocalOllamaModel: (m: string, o: string) => resolveDeclaredModelMock(m, o),
}))

vi.mock('../../sandbox/sandboxOutboundPolicy', () => ({
  isEffectiveSandboxNode: (db: unknown) => isEffectiveSandboxNodeMock(db),
}))

vi.mock('../../customModes/customModesStore', () => ({
  getModeById: (id: string) => getModeByIdMock(id),
}))

vi.mock('../adaptiveWarmupStrategy', () => ({
  resolveAdaptiveWarmupStrategy: () => resolveStrategyMock(),
}))

vi.mock('../warmModel', () => ({
  warmModel: (...args: unknown[]) => warmModelMock(...args),
}))

describe('modeModelWarmupTrigger', () => {
  afterEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('skips empty-slot modes (no modelName)', async () => {
    isEffectiveSandboxNodeMock.mockReturnValue(false)
    getHandshakeDbMock.mockResolvedValue({})
    getModeByIdMock.mockReturnValue({ id: 'built-in:scam-watchdog', modelName: '' })
    resolveStrategyMock.mockResolvedValue({ kind: 'warm_on_trigger', maxResident: 1 })

    const { scheduleModeModelWarmOnTrigger } = await import('../modeModelWarmupTrigger')
    scheduleModeModelWarmOnTrigger('built-in:scam-watchdog', 'speech_bubble')
    await new Promise((r) => setTimeout(r, 10))
    expect(warmModelMock).not.toHaveBeenCalled()
  })

  it('fires warmModel for allocated mode on speech bubble', async () => {
    isEffectiveSandboxNodeMock.mockReturnValue(false)
    getHandshakeDbMock.mockResolvedValue({})
    getModeByIdMock.mockReturnValue({ id: 'custom:x', modelName: 'llama:8b' })
    resolveDeclaredModelMock.mockResolvedValue({
      ok: true,
      requestedModel: 'llama:8b',
      actualModel: 'llama:8b',
      fellBack: false,
    })
    resolveStrategyMock.mockResolvedValue({ kind: 'warm_on_trigger', maxResident: 1 })
    warmModelMock.mockResolvedValue({ ok: true, ms: 42 })
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { scheduleModeModelWarmOnTrigger } = await import('../modeModelWarmupTrigger')
    scheduleModeModelWarmOnTrigger('custom:x', 'speech_bubble')
    await new Promise((r) => setTimeout(r, 20))

    expect(resolveDeclaredModelMock).toHaveBeenCalledWith('llama:8b', 'mode_warmup_trigger')
    expect(warmModelMock).toHaveBeenCalledWith('llama:8b')
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes('trigger=speech_bubble'))).toBe(true)
    logSpy.mockRestore()
  })

  it('warms the resolved active model, not a stale declared tag', async () => {
    isEffectiveSandboxNodeMock.mockReturnValue(false)
    getHandshakeDbMock.mockResolvedValue({})
    getModeByIdMock.mockReturnValue({ id: 'custom:y', modelName: 'gemma4:12b-it-q8_0' })
    resolveDeclaredModelMock.mockResolvedValue({
      ok: true,
      requestedModel: 'gemma4:12b-it-q8_0',
      actualModel: 'gemma-4-12B-it-Q4_K_M',
      fellBack: true,
      reason: 'not_installed',
    })
    resolveStrategyMock.mockResolvedValue({ kind: 'warm_on_trigger', maxResident: 1 })
    warmModelMock.mockResolvedValue({ ok: true, ms: 42 })

    const { scheduleModeModelWarmOnTrigger } = await import('../modeModelWarmupTrigger')
    scheduleModeModelWarmOnTrigger('custom:y', 'interval')
    await new Promise((r) => setTimeout(r, 20))

    expect(warmModelMock).toHaveBeenCalledWith('gemma-4-12B-it-Q4_K_M')
  })

  it('skips warmup when no model resolves (no_active_model)', async () => {
    isEffectiveSandboxNodeMock.mockReturnValue(false)
    getHandshakeDbMock.mockResolvedValue({})
    getModeByIdMock.mockReturnValue({ id: 'custom:z', modelName: 'ghost:1b' })
    resolveDeclaredModelMock.mockResolvedValue({
      ok: false,
      requestedModel: 'ghost:1b',
      error: 'not installed',
      reason: 'no_active_model',
    })

    const { scheduleModeModelWarmOnTrigger } = await import('../modeModelWarmupTrigger')
    scheduleModeModelWarmOnTrigger('custom:z', 'interval')
    await new Promise((r) => setTimeout(r, 20))

    expect(warmModelMock).not.toHaveBeenCalled()
  })
})
