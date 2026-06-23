import { afterEach, describe, expect, it, vi } from 'vitest'

const isEffectiveSandboxNodeMock = vi.fn()
const getModeByIdMock = vi.fn()
const resolveStrategyMock = vi.fn()
const warmModelMock = vi.fn()
const getHandshakeDbMock = vi.fn()

vi.mock('../../internalInference/dbAccess', () => ({
  getHandshakeDbForInternalInference: () => getHandshakeDbMock(),
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
    resolveStrategyMock.mockResolvedValue({ kind: 'warm_on_trigger', maxResident: 1 })
    warmModelMock.mockResolvedValue({ ok: true, ms: 42 })
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { scheduleModeModelWarmOnTrigger } = await import('../modeModelWarmupTrigger')
    scheduleModeModelWarmOnTrigger('custom:x', 'speech_bubble')
    await new Promise((r) => setTimeout(r, 20))

    expect(warmModelMock).toHaveBeenCalledWith('llama:8b')
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes('trigger=speech_bubble'))).toBe(true)
    logSpy.mockRestore()
  })
})
