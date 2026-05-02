import { describe, it, expect, vi, afterEach } from 'vitest'
import { tryParseP2pSignalRequest, P2P_SIGNAL_MAX_BODY_BYTES } from '../src/p2pSignal.ts'

function iceBase(overrides: Record<string, unknown> = {}) {
  const t0 = Date.now()
  return {
    schema_version: 1,
    signal_type: 'p2p_inference_ice',
    handshake_id: 'h1',
    correlation_id: 'c1',
    session_id: 's1',
    sender_device_id: 'dev-a',
    receiver_device_id: 'dev-b',
    created_at: new Date(t0).toISOString(),
    expires_at: new Date(t0 + 20_000).toISOString(),
    ...overrides,
  }
}

describe('tryParseP2pSignalRequest — permissive candidate / schema_version', () => {
  it('accepts schema_version as decimal string "1" and normalizes payload to number', () => {
    const body = JSON.stringify(iceBase({ schema_version: '1' }))
    const r = tryParseP2pSignalRequest(body, P2P_SIGNAL_MAX_BODY_BYTES)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.payload.schema_version).toBe(1)
    }
  })

  it('accepts schema_version as "1.0" / "1.000" (loose JSON encoders) and normalizes to 1', () => {
    for (const schema_version of ['1.0', '1.000', ' 1.0 ']) {
      const body = JSON.stringify(iceBase({ schema_version }))
      const r = tryParseP2pSignalRequest(body, P2P_SIGNAL_MAX_BODY_BYTES)
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.payload.schema_version).toBe(1)
    }
  })

  it('rejects schema_version "1.1"', () => {
    const body = JSON.stringify(iceBase({ schema_version: '1.1' }))
    const r = tryParseP2pSignalRequest(body, P2P_SIGNAL_MAX_BODY_BYTES)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('schema_version')
  })

  it('accepts top-level candidate "" (end-of-trickle envelope)', () => {
    const body = JSON.stringify(iceBase({ candidate: '' }))
    const r = tryParseP2pSignalRequest(body, P2P_SIGNAL_MAX_BODY_BYTES)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.candidate).toBe('')
      expect(r.payload.candidate).toBe('')
    }
  })

  it('accepts candidate as object (stringified) including null sdpMid and optional WebRTC fields', () => {
    const body = JSON.stringify(
      iceBase({
        candidate: {
          candidate: 'candidate:1 1 udp 2130706431 127.0.0.1 9 typ host',
          sdpMid: null,
          sdpMLineIndex: 0,
          usernameFragment: 'u',
          relatedAddress: '10.0.0.1',
          relatedPort: 12345,
        },
      }),
    )
    const r = tryParseP2pSignalRequest(body, P2P_SIGNAL_MAX_BODY_BYTES)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.payload.candidate).toContain('sdpMid')
      expect(r.candidate).toContain('null')
    }
  })

  it('rejects candidate as array', () => {
    const body = JSON.stringify(iceBase({ candidate: ['x'] as unknown }))
    const r = tryParseP2pSignalRequest(body, P2P_SIGNAL_MAX_BODY_BYTES)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('field_required')
  })
})

function beapAdBase(overrides: Record<string, unknown> = {}) {
  const t0 = Date.now()
  return {
    schema_version: 1,
    signal_type: 'p2p_host_ai_direct_beap_ad',
    handshake_id: 'h1',
    correlation_id: 'c1',
    session_id: 's1',
    sender_device_id: 'dev-a',
    receiver_device_id: 'dev-b',
    created_at: new Date(t0).toISOString(),
    expires_at: new Date(t0 + 120_000).toISOString(),
    endpoint_url: 'http://192.168.1.5:9/beap/ingest',
    ad_seq: 1,
    owner_role: 'host',
    ...overrides,
  }
}

describe('p2p_host_ai_direct_beap_ad', () => {
  it('accepts 120s ttl and endpoint_url + ad_seq', () => {
    const body = JSON.stringify(beapAdBase())
    const r = tryParseP2pSignalRequest(body, P2P_SIGNAL_MAX_BODY_BYTES)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.signalType).toBe('p2p_host_ai_direct_beap_ad')
      expect((r.payload as { endpoint_url?: string }).endpoint_url).toContain('beap/ingest')
    }
  })

  it('accepts 120s ttl for p2p_inference_offer (client buildP2pSignalBody)', () => {
    const t0 = Date.now()
    const body = JSON.stringify({
      schema_version: 1,
      signal_type: 'p2p_inference_offer',
      handshake_id: 'h1',
      correlation_id: 'c1',
      session_id: 's1',
      sender_device_id: 'a',
      receiver_device_id: 'b',
      created_at: new Date(t0).toISOString(),
      expires_at: new Date(t0 + 120_000).toISOString(),
      sdp: 'v=0',
    })
    expect(tryParseP2pSignalRequest(body, P2P_SIGNAL_MAX_BODY_BYTES).ok).toBe(true)
  })

  it('rejects ttl below 60s for beap ad', () => {
    const t0 = Date.now()
    const body = JSON.stringify(
      beapAdBase({
        created_at: new Date(t0).toISOString(),
        expires_at: new Date(t0 + 30_000).toISOString(),
      }),
    )
    const r = tryParseP2pSignalRequest(body, P2P_SIGNAL_MAX_BODY_BYTES)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('signaling_ttl')
  })
})

describe('p2p_host_ai_direct_beap_ad_request', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('accepts 60s ttl without endpoint_url', () => {
    const t0 = Date.now()
    const body = JSON.stringify({
      schema_version: 1,
      signal_type: 'p2p_host_ai_direct_beap_ad_request',
      handshake_id: 'h1',
      correlation_id: 'c1',
      session_id: 's1',
      sender_device_id: 'dev-sand',
      receiver_device_id: 'dev-host',
      created_at: new Date(t0).toISOString(),
      expires_at: new Date(t0 + 60_000).toISOString(),
      owner_role: 'sandbox',
    })
    const r = tryParseP2pSignalRequest(body, P2P_SIGNAL_MAX_BODY_BYTES)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.signalType).toBe('p2p_host_ai_direct_beap_ad_request')
  })

  it('accepts 90s ttl (Electron republish request)', () => {
    const t0 = Date.now()
    const body = JSON.stringify({
      schema_version: 1,
      signal_type: 'p2p_host_ai_direct_beap_ad_request',
      handshake_id: 'h1',
      correlation_id: 'c1',
      session_id: 's1',
      sender_device_id: 'dev-sand',
      receiver_device_id: 'dev-host',
      created_at: new Date(t0).toISOString(),
      expires_at: new Date(t0 + 90_000).toISOString(),
      owner_role: 'sandbox',
    })
    const r = tryParseP2pSignalRequest(body, P2P_SIGNAL_MAX_BODY_BYTES)
    expect(r.ok).toBe(true)
  })

  it('rejects owner_role host on request envelope', () => {
    const t0 = Date.now()
    const body = JSON.stringify({
      schema_version: 1,
      signal_type: 'p2p_host_ai_direct_beap_ad_request',
      handshake_id: 'h1',
      correlation_id: 'c1',
      session_id: 's1',
      sender_device_id: 'dev-sand',
      receiver_device_id: 'dev-host',
      created_at: new Date(t0).toISOString(),
      expires_at: new Date(t0 + 60_000).toISOString(),
      owner_role: 'host',
    })
    const r = tryParseP2pSignalRequest(body, P2P_SIGNAL_MAX_BODY_BYTES)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('field_required')
  })

  it('accepts envelope when expires_at is slightly in the past (parse clock skew grace)', () => {
    const t0 = 1_700_000_000_000
    vi.useFakeTimers({ now: t0 })
    const body = JSON.stringify({
      schema_version: 1,
      signal_type: 'p2p_host_ai_direct_beap_ad_request',
      handshake_id: 'h1',
      correlation_id: 'c1',
      session_id: 's1',
      sender_device_id: 'dev-sand',
      receiver_device_id: 'dev-host',
      created_at: new Date(t0 - 120_000).toISOString(),
      expires_at: new Date(t0 - 30_000).toISOString(),
      owner_role: 'sandbox',
    })
    const r = tryParseP2pSignalRequest(body, P2P_SIGNAL_MAX_BODY_BYTES)
    expect(r.ok).toBe(true)
  })

  it('rejects envelope when expires_at is older than parse grace', () => {
    const t0 = 1_700_000_000_000
    vi.useFakeTimers({ now: t0 })
    const body = JSON.stringify({
      schema_version: 1,
      signal_type: 'p2p_host_ai_direct_beap_ad_request',
      handshake_id: 'h1',
      correlation_id: 'c1',
      session_id: 's1',
      sender_device_id: 'dev-sand',
      receiver_device_id: 'dev-host',
      created_at: new Date(t0 - 200_000).toISOString(),
      expires_at: new Date(t0 - 90_000).toISOString(),
      owner_role: 'sandbox',
    })
    const r = tryParseP2pSignalRequest(body, P2P_SIGNAL_MAX_BODY_BYTES)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('expired')
  })
})
