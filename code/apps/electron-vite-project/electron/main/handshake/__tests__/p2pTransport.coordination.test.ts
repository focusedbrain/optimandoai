import { describe, test, expect, vi, afterEach } from 'vitest'
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
})
