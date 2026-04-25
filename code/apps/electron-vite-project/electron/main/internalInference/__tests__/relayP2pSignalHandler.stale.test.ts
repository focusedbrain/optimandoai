import { beforeEach, describe, expect, test, vi } from 'vitest'
import { tryHandleCoordinationP2pSignal } from '../relayP2pSignalHandler'

vi.mock('../p2pSessionManagerStub', () => ({
  maybeHandleP2pInferenceRelaySignal: vi.fn(),
}))

describe('relayP2pSignalHandler stale created_at', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('drops signal when created_at is too old (even if expires_at is valid)', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const now = Date.now()
    const created = new Date(now - 125_000).toISOString()
    const expires = new Date(now + 60_000).toISOString()
    const handled = tryHandleCoordinationP2pSignal(
      {
        type: 'p2p_signal',
        id: 'm1',
        payload: {
          schema_version: 1,
          signal_type: 'p2p_inference_offer',
          correlation_id: 'c1',
          session_id: 's1',
          handshake_id: 'h1',
          sender_device_id: 'a',
          receiver_device_id: 'b',
          created_at: created,
          expires_at: expires,
        },
      } as any,
      'r1',
    )
    expect(handled).toBe(true)
    const out = log.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(out).toContain('dropped')
    expect(out).toContain('stale')
    log.mockRestore()
  })
})
