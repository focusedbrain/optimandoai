/**
 * Relay HTTP 200 vs 202 → queue/IPC semantics (no p2pTransport / crypto load).
 */
import { describe, test, expect } from 'vitest'
import {
  mapSendResultToQueueOutcome,
  type SendCapsuleSuccessShape,
} from '../relayQueueTransportOutcome'

describe('mapSendResultToQueueOutcome', () => {
  test('HTTP 200 pushed_live → peer live + DELIVERED_LIVE', () => {
    const r: SendCapsuleSuccessShape = {
      success: true,
      statusCode: 200,
      coordinationRelayDelivery: 'pushed_live',
    }
    const o = mapSendResultToQueueOutcome(r)
    expect(o.delivered).toBe(true)
    expect(o.queued).toBe(false)
    expect(o.code).toBe('DELIVERED_LIVE')
    expect(o.relayTransportAccepted).toBe(true)
    expect(o.coordinationRelayDelivery).toBe('pushed_live')
  })

  test('HTTP 202 queued_recipient_offline → not peer delivered, transport ok', () => {
    const r: SendCapsuleSuccessShape = {
      success: true,
      statusCode: 202,
      coordinationRelayDelivery: 'queued_recipient_offline',
    }
    const o = mapSendResultToQueueOutcome(r)
    expect(o.delivered).toBe(false)
    expect(o.queued).toBe(true)
    expect(o.code).toBe('QUEUED_RECIPIENT_OFFLINE')
    expect(o.relayTransportAccepted).toBe(true)
    expect(o.coordinationRelayDelivery).toBe('queued_recipient_offline')
  })

  test('direct HTTP 200 (no coordinationRelayDelivery) → DELIVERED_LIVE', () => {
    const r: SendCapsuleSuccessShape = { success: true, statusCode: 200 }
    const o = mapSendResultToQueueOutcome(r)
    expect(o.delivered).toBe(true)
    expect(o.code).toBe('DELIVERED_LIVE')
    expect(o.relayTransportAccepted).toBe(true)
    expect(o.coordinationRelayDelivery).toBeUndefined()
  })
})
