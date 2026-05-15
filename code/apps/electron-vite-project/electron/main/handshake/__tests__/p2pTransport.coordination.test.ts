import { describe, test, expect, vi, afterEach } from 'vitest'
import * as handshakeDb from '../db'
import type { HandshakeRecord } from '../types'
import { sendCapsuleViaCoordination } from '../p2pTransport'

describe('sendCapsuleViaCoordination — relay HTTP semantics', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  test('HTTP 200 → coordinationRelayDelivery pushed_live', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        status: 200,
        ok: true,
        headers: new Headers(),
        text: async () => '',
      })),
    )
    const r = await sendCapsuleViaCoordination(
      { header: { a: 1 }, metadata: { b: 2 }, payload: 'eA==' },
      'https://coord.example',
      'oidc-token',
      'hs-1',
    )
    expect(r.success).toBe(true)
    expect(r.statusCode).toBe(200)
    expect(r.coordinationRelayDelivery).toBe('pushed_live')
  })

  test('HTTP 202 → coordinationRelayDelivery queued_recipient_offline', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        status: 202,
        ok: true,
        headers: new Headers(),
        text: async () => '',
      })),
    )
    const r = await sendCapsuleViaCoordination(
      { header: { a: 1 }, metadata: { b: 2 }, payload: 'eA==' },
      'https://coord.example',
      'oidc-token',
      'hs-1',
    )
    expect(r.success).toBe(true)
    expect(r.statusCode).toBe(202)
    expect(r.coordinationRelayDelivery).toBe('queued_recipient_offline')
  })

  test('with db: internal context_sync with complete record — wire fields auto-filled, fetch is called', async () => {
    // Phase B change: applyContextSyncInternalRoutingFromRecord auto-fills sender/receiver
    // wire fields from the DB record. With a complete record, validation passes and fetch is
    // called (pre-Phase-B: caller had to supply wire fields; missing fields blocked before fetch).
    const fetchMock = vi.fn().mockResolvedValue({ status: 500, ok: false, headers: new Headers(), text: async () => 'err' })
    vi.stubGlobal('fetch', fetchMock)
    const spy = vi.spyOn(handshakeDb, 'getHandshakeRecord').mockReturnValue({
      handshake_id: 'hs-int',
      handshake_type: 'internal',
      local_role: 'initiator',
      initiator_coordination_device_id: 'dev-i',
      acceptor_coordination_device_id: 'dev-a',
      internal_coordination_identity_complete: true,
      initiator_device_role: 'host',
      acceptor_device_role: 'sandbox',
      initiator_device_name: 'Host',
      acceptor_device_name: 'Sandbox',
    } as HandshakeRecord)

    const r = await sendCapsuleViaCoordination(
      { capsule_type: 'context_sync', handshake_id: 'hs-int', schema_version: 2 },
      'https://coord.example',
      'oidc-token',
      'hs-int',
      {},
    )

    spy.mockRestore()
    // Wire fields are auto-filled from the record → validation passes → fetch is called.
    expect(fetchMock).toHaveBeenCalled()
    expect(r.success).toBe(false)
  })
})
