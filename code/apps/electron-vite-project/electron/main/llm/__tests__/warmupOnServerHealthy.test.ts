/**
 * build038 event-anchored warmup tests:
 *  - warms the default model once per server-healthy generation
 *  - dedups repeat events for the same generation
 *  - warms again for a new generation (respawn / apply-restart)
 *  - skips non-local lanes without calling warmModel
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const warmModelMock = vi.fn(async () => ({ ok: true, ms: 5 }))
const resolveCtxMock = vi.fn()
let healthyListener: ((gen: number) => void) | null = null

vi.mock('../../internalInference/dbAccess', () => ({
  getHandshakeDbForInternalInference: async () => null,
}))
vi.mock('../../sandbox/sandboxOutboundPolicy', () => ({
  isEffectiveSandboxNode: () => false,
}))
vi.mock('../resolveAiExecutionContext', () => ({
  resolveAiExecutionContextForLlm: (...args: unknown[]) => resolveCtxMock(...args),
}))
vi.mock('../warmModel', () => ({
  warmModel: (...args: unknown[]) => warmModelMock(...args),
}))
vi.mock('../local-llm-manager', () => ({
  localLlmManager: {
    onServerHealthy: (cb: (gen: number) => void) => {
      healthyListener = cb
      return () => { healthyListener = null }
    },
  },
}))

import {
  initWarmupOnServerHealthy,
  _resetWarmupOnServerHealthyForTests,
} from '../warmupOnServerHealthy'

async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0))
  await new Promise((r) => setTimeout(r, 0))
}

describe('warmupOnServerHealthy', () => {
  beforeEach(() => {
    _resetWarmupOnServerHealthyForTests()
    healthyListener = null
    warmModelMock.mockClear()
    resolveCtxMock.mockReset()
    resolveCtxMock.mockResolvedValue({ ok: true, ctx: { lane: 'local', model: 'gemma-test' } })
  })

  it('registers a listener and warms the default model on server_healthy', async () => {
    await initWarmupOnServerHealthy()
    expect(healthyListener).toBeTypeOf('function')
    healthyListener!(1)
    await flush()
    expect(warmModelMock).toHaveBeenCalledTimes(1)
    expect(warmModelMock).toHaveBeenCalledWith('gemma-test')
  })

  it('dedups repeated events for the same spawn generation', async () => {
    await initWarmupOnServerHealthy()
    healthyListener!(1)
    await flush()
    healthyListener!(1)
    await flush()
    expect(warmModelMock).toHaveBeenCalledTimes(1)
  })

  it('warms again when a new generation comes up (respawn)', async () => {
    await initWarmupOnServerHealthy()
    healthyListener!(1)
    await flush()
    healthyListener!(2)
    await flush()
    expect(warmModelMock).toHaveBeenCalledTimes(2)
  })

  it('skips without warming when the resolved lane is not local', async () => {
    resolveCtxMock.mockResolvedValue({ ok: true, ctx: { lane: 'beap', model: 'remote' } })
    await initWarmupOnServerHealthy()
    healthyListener!(1)
    await flush()
    expect(warmModelMock).not.toHaveBeenCalled()
  })

  it('init is idempotent — a second init does not double-register', async () => {
    await initWarmupOnServerHealthy()
    const first = healthyListener
    await initWarmupOnServerHealthy()
    expect(healthyListener).toBe(first)
  })
})
