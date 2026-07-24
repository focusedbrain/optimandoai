/**
 * Phase 3: sealed relay path boundary logs — confirms sandbox eligibility + relay send (no WebRTC session).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sendSealedMock = vi.fn()

vi.mock('../hostAiSealedInferenceRelaySend', () => ({
  sendSealedHostAiInferenceRequest: (...args: unknown[]) => sendSealedMock(...args),
}))

vi.mock('../dbAccess', () => ({
  getHandshakeDbForInternalInference: vi.fn(async () => ({ id: 'db' })),
}))

vi.mock('../../handshake/db', () => ({
  getHandshakeRecord: vi.fn(() => ({
    handshake_id: 'hs-sealed',
    state: 'ACTIVE',
    handshake_type: 'internal',
    local_device_id: 'sbx-dev',
    peer_device_id: 'host-dev',
  })),
}))

vi.mock('../policy', () => ({
  assertRecordForServiceRpc: vi.fn(() => ({
    ok: true,
    record: {
      handshake_id: 'hs-sealed',
      state: 'ACTIVE',
      handshake_type: 'internal',
    },
  })),
  assertSandboxRequestToHost: vi.fn(() => ({ ok: true })),
  peerCoordinationDeviceId: vi.fn(() => 'host-dev'),
}))

describe('phase3 sealed boundary diagnostics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sendSealedMock.mockResolvedValue({
      ok: true,
      request_id: 'req-1',
      promise: Promise.resolve({
        kind: 'result',
        output: 'hello',
        model: 'test.gguf',
        duration_ms: 42,
      }),
    })
  })

  it('emits PHASE3_SEALED_BOUNDARY logs on eligible sandbox send', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { runSandboxHostInferenceChat } = await import('../sandboxHostChat')

    const res = await runSandboxHostInferenceChat({
      handshakeId: 'hs-sealed',
      messages: [{ role: 'user', content: 'ping' }],
      model: 'test.gguf',
    })

    expect(res.ok).toBe(true)
    const joined = logSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(joined).toMatch(/\[PHASE3_SEALED_BOUNDARY\] sandbox_eligible/)
    expect(joined).toMatch(/\[PHASE3_SEALED_BOUNDARY\] sandbox_response_received/)
    logSpy.mockRestore()
  })
})
