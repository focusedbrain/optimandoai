import { afterEach, describe, expect, it, vi } from 'vitest'

const estimateMaxResidentModelsMock = vi.fn()
const resolveAiMock = vi.fn()

vi.mock('../detectVramCapacity', () => ({
  estimateMaxResidentModels: (...args: unknown[]) => estimateMaxResidentModelsMock(...args),
}))

vi.mock('../resolveAiExecutionContext', () => ({
  resolveAiExecutionContextForLlm: () => resolveAiMock(),
}))

describe('adaptiveWarmupStrategy', () => {
  afterEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    const mod = await import('../adaptiveWarmupStrategy')
    mod._resetAdaptiveWarmupStrategyForTests()
  })

  it('selects two_resident when estimate >= 2', async () => {
    resolveAiMock.mockResolvedValue({
      ok: true,
      ctx: { lane: 'local', model: 'gemma:12b' },
    })
    estimateMaxResidentModelsMock.mockResolvedValue(2)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { resolveAdaptiveWarmupStrategy, getAdaptiveKeepAlive } = await import(
      '../adaptiveWarmupStrategy'
    )
    const s = await resolveAdaptiveWarmupStrategy()
    expect(s.kind).toBe('two_resident')
    expect(s.maxResident).toBe(2)
    expect(getAdaptiveKeepAlive()).toBe('15m')
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes('strategy=two_resident maxResident=2'))).toBe(
      true,
    )
    logSpy.mockRestore()
  })

  it('selects warm_on_trigger when estimate is 1', async () => {
    resolveAiMock.mockResolvedValue({
      ok: true,
      ctx: { lane: 'local', model: 'gemma:12b' },
    })
    estimateMaxResidentModelsMock.mockResolvedValue(1)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { resolveAdaptiveWarmupStrategy, getAdaptiveKeepAlive } = await import(
      '../adaptiveWarmupStrategy'
    )
    const s = await resolveAdaptiveWarmupStrategy()
    expect(s.kind).toBe('warm_on_trigger')
    expect(s.maxResident).toBe(1)
    expect(getAdaptiveKeepAlive()).toBe('2m')
    expect(
      logSpy.mock.calls.some((c) => String(c[0]).includes('strategy=warm_on_trigger maxResident=1')),
    ).toBe(true)
    logSpy.mockRestore()
  })
})
