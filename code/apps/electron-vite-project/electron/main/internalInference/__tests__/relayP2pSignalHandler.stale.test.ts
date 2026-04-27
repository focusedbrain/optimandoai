import { beforeEach, describe, expect, test, vi } from 'vitest'
import { tryHandleCoordinationP2pSignal } from '../relayP2pSignalHandler'

const maybeHandle = vi.fn()
vi.mock('../p2pSessionManagerStub', () => ({
  maybeHandleP2pInferenceRelaySignal: (...a: unknown[]) => maybeHandle(...a),
}))

describe('relayP2pSignalHandler stale created_at', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    maybeHandle.mockClear()
  })

  test('accepts WebRTC offer when created_at is old but expires_at is still valid (TTL trusts expires_at)', () => {
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
          sdp: 'v=0\r\n',
        },
      } as any,
      'r1',
    )
    expect(handled).toBe(true)
    expect(maybeHandle).toHaveBeenCalledTimes(1)
    const out = log.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(out).toContain('[HOST_AI_SIGNAL_TTL]')
    expect(out).toContain('"decision":"allow"')
    log.mockRestore()
  })

  test('accepts offer/answer-like TTL window up to 120s (matches outbound p2pSignalRelayPost)', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const now = Date.now()
    const created = new Date(now - 1_000).toISOString()
    const expires = new Date(now + 119_000).toISOString()
    const handled = tryHandleCoordinationP2pSignal(
      {
        type: 'p2p_signal',
        id: 'm2',
        payload: {
          schema_version: 1,
          signal_type: 'p2p_inference_offer',
          correlation_id: 'c2',
          session_id: 's2',
          handshake_id: 'h2',
          sender_device_id: 'a',
          receiver_device_id: 'b',
          created_at: created,
          expires_at: expires,
          sdp: 'v=0\r\n',
        },
      } as any,
      'r2',
    )
    expect(handled).toBe(true)
    expect(maybeHandle).toHaveBeenCalledTimes(1)
    const out = log.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(out).toContain('"decision":"allow"')
    log.mockRestore()
  })

  test('accepts schema_version string "1.0" (in sync with coordination-service coerceSchemaVersion)', () => {
    const now = Date.now()
    const created = new Date(now).toISOString()
    const expires = new Date(now + 20_000).toISOString()
    const handled = tryHandleCoordinationP2pSignal(
      {
        type: 'p2p_signal',
        id: 'm1',
        payload: {
          schema_version: '1.0',
          signal_type: 'p2p_inference_ice',
          correlation_id: 'c1',
          session_id: 's1',
          handshake_id: 'h1',
          sender_device_id: 'a',
          receiver_device_id: 'b',
          created_at: created,
          expires_at: expires,
          candidate: '',
        },
      } as any,
      'r1',
    )
    expect(handled).toBe(true)
    expect(maybeHandle).toHaveBeenCalledTimes(1)
    const raw = (maybeHandle.mock.calls[0][0] as { raw: Record<string, unknown> }).raw
    expect(raw.schema_version).toBe(1)
  })
})
