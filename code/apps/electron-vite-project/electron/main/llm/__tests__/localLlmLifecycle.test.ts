import { afterEach, describe, expect, it, vi } from 'vitest'

const isSandboxModeMock = vi.fn(() => false)
const enableSupervisionMock = vi.fn()
const ensureManagedMock = vi.fn(async () => ({ ok: true, running: true }))
const shutdownMock = vi.fn(async () => undefined)

vi.mock('../../orchestrator/orchestratorModeStore', () => ({
  isSandboxMode: () => isSandboxModeMock(),
}))

vi.mock('../local-llm-manager', () => ({
  localLlmManager: {
    enableSupervision: () => enableSupervisionMock(),
    ensureManagedServerRunning: (...args: unknown[]) => ensureManagedMock(...args),
    shutdownManagedServer: (...args: unknown[]) => shutdownMock(...args),
  },
}))

describe('localLlmLifecycle', () => {
  afterEach(() => {
    vi.clearAllMocks()
    isSandboxModeMock.mockReturnValue(false)
  })

  it('initHostLocalLlmLifecycle enables supervision on host', async () => {
    const { initHostLocalLlmLifecycle } = await import('../localLlmLifecycle')
    const r = await initHostLocalLlmLifecycle({ phase: 'test' })
    expect(enableSupervisionMock).toHaveBeenCalled()
    expect(ensureManagedMock).toHaveBeenCalledWith({ reason: 'test' })
    expect(r.ok).toBe(true)
  })

  it('initHostLocalLlmLifecycle skips sandbox', async () => {
    isSandboxModeMock.mockReturnValue(true)
    const { initHostLocalLlmLifecycle } = await import('../localLlmLifecycle')
    const r = await initHostLocalLlmLifecycle({ phase: 'test' })
    expect(ensureManagedMock).not.toHaveBeenCalled()
    expect(r.reason).toBe('sandbox_mode')
  })

  it('shutdownHostLocalLlmLifecycle stops managed server on host', async () => {
    const { shutdownHostLocalLlmLifecycle } = await import('../localLlmLifecycle')
    await shutdownHostLocalLlmLifecycle({ phase: 'before_quit' })
    expect(shutdownMock).toHaveBeenCalledWith('before_quit')
  })
})
