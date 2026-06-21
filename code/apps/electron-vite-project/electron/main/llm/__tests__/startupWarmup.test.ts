import { afterEach, describe, expect, it, vi } from 'vitest'

const isEffectiveSandboxNodeMock = vi.fn()
const resolveAiExecutionContextForLlmMock = vi.fn()
const isRunningMock = vi.fn()
const chatMock = vi.fn()
const getHandshakeDbMock = vi.fn()

vi.mock('../../internalInference/dbAccess', () => ({
  getHandshakeDbForInternalInference: () => getHandshakeDbMock(),
}))

vi.mock('../../sandbox/sandboxOutboundPolicy', () => ({
  isEffectiveSandboxNode: (db: unknown) => isEffectiveSandboxNodeMock(db),
}))

vi.mock('../resolveAiExecutionContext', () => ({
  resolveAiExecutionContextForLlm: () => resolveAiExecutionContextForLlmMock(),
}))

vi.mock('../ollama-manager', () => ({
  ollamaManager: {
    isRunning: () => isRunningMock(),
    chat: (...args: unknown[]) => chatMock(...args),
  },
}))

describe('startupWarmup', () => {
  afterEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('skips host warmup on effective sandbox node', async () => {
    isEffectiveSandboxNodeMock.mockReturnValue(true)
    getHandshakeDbMock.mockResolvedValue({})
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { runStartupWarmup } = await import('../startupWarmup')
    await runStartupWarmup()

    expect(chatMock).not.toHaveBeenCalled()
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes('effective_sandbox_node'))).toBe(true)
    logSpy.mockRestore()
  })

  it('warms local default model on host node', async () => {
    isEffectiveSandboxNodeMock.mockReturnValue(false)
    getHandshakeDbMock.mockResolvedValue({})
    isRunningMock.mockResolvedValue(true)
    resolveAiExecutionContextForLlmMock.mockResolvedValue({
      ok: true,
      ctx: { lane: 'local', model: 'llama3.1:8b' },
    })
    chatMock.mockResolvedValue({ content: 'ok', model: 'llama3.1:8b', done: true })
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { runStartupWarmup } = await import('../startupWarmup')
    await runStartupWarmup()

    expect(chatMock).toHaveBeenCalledWith('llama3.1:8b', [{ role: 'user', content: 'ok' }])
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes('warmed in'))).toBe(true)
    logSpy.mockRestore()
  })
})
