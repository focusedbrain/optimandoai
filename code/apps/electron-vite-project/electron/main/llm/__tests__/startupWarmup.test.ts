import { afterEach, describe, expect, it, vi } from 'vitest'

const isEffectiveSandboxNodeMock = vi.fn()
const resolveStrategyMock = vi.fn()
const warmModelMock = vi.fn()
const getHandshakeDbMock = vi.fn()
const resolveAiMock = vi.fn()

vi.mock('../../internalInference/dbAccess', () => ({
  getHandshakeDbForInternalInference: () => getHandshakeDbMock(),
}))

vi.mock('../../sandbox/sandboxOutboundPolicy', () => ({
  isEffectiveSandboxNode: (db: unknown) => isEffectiveSandboxNodeMock(db),
}))

vi.mock('../adaptiveWarmupStrategy', () => ({
  resolveAdaptiveWarmupStrategy: () => resolveStrategyMock(),
}))

vi.mock('../warmModel', () => ({
  warmModel: (...args: unknown[]) => warmModelMock(...args),
}))

vi.mock('../resolveAiExecutionContext', () => ({
  resolveAiExecutionContextForLlm: () => resolveAiMock(),
}))

describe('startupWarmup', () => {
  afterEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    const mod = await import('../startupWarmup')
    mod._resetStartupWarmupScheduleForTests()
  })

  it('skips host warmup on effective sandbox node', async () => {
    isEffectiveSandboxNodeMock.mockReturnValue(true)
    getHandshakeDbMock.mockResolvedValue({})
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { runStartupWarmup } = await import('../startupWarmup')
    await runStartupWarmup()

    expect(resolveStrategyMock).not.toHaveBeenCalled()
    expect(warmModelMock).not.toHaveBeenCalled()
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes('effective_sandbox_node'))).toBe(true)
    logSpy.mockRestore()
  })

  it('initializes strategy and warms default via warmModel on host', async () => {
    isEffectiveSandboxNodeMock.mockReturnValue(false)
    getHandshakeDbMock.mockResolvedValue({})
    resolveStrategyMock.mockResolvedValue({ kind: 'two_resident', maxResident: 2 })
    warmModelMock.mockResolvedValue({ ok: true, ms: 100 })
    resolveAiMock.mockResolvedValue({
      ok: true,
      ctx: { lane: 'local', model: 'llama3.1:8b' },
    })
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { runStartupWarmup } = await import('../startupWarmup')
    await runStartupWarmup()

    expect(resolveStrategyMock).toHaveBeenCalled()
    expect(warmModelMock).toHaveBeenCalledWith('llama3.1:8b')
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes('warmed in 100ms'))).toBe(true)
    logSpy.mockRestore()
  })
})
