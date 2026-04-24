import { describe, test, expect } from 'vitest'
import { mapCoordinationDeliveryToMatrixMode } from '../beapSandboxCloneDeliverySemantics'

/** Matrix §10 + BEAP §3–5: HTTP/reward semantics without touching X25519 / capsule crypto. */
describe('beapSandboxCloneDeliverySemantics (regression matrix §3–5, §10)', () => {
  test('HTTP 200 + pushed_live => delivered live', () => {
    expect(
      mapCoordinationDeliveryToMatrixMode({
        success: true,
        coordinationRelayDelivery: 'pushed_live',
      }),
    ).toBe('live')
  })

  test('HTTP 202 + queued_recipient_offline => queued, not live', () => {
    expect(
      mapCoordinationDeliveryToMatrixMode({
        success: true,
        coordinationRelayDelivery: 'queued_recipient_offline',
      }),
    ).toBe('queued')
  })

  test('failed send => failed (no false live)', () => {
    expect(
      mapCoordinationDeliveryToMatrixMode({
        success: false,
        coordinationRelayDelivery: 'pushed_live',
      }),
    ).toBe('failed')
  })

  test('generic success with queued flag => queued', () => {
    expect(
      mapCoordinationDeliveryToMatrixMode({
        success: true,
        delivered: false,
        queued: true,
      }),
    ).toBe('queued')
  })

  test('internal host↔sandbox uses same mapping as normal (direction-agnostic at this layer)', () => {
    const live = mapCoordinationDeliveryToMatrixMode({
      success: true,
      coordinationRelayDelivery: 'pushed_live',
    })
    expect(live).toBe('live')
  })
})
