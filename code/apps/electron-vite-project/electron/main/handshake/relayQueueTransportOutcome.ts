/**
 * Maps coordination HTTP 200/202 to queue/IPC result fields — no network, no Node crypto imports.
 * Kept separate from p2pTransport so unit tests can import without the Electron main dependency graph.
 */

export type RelayDeliveryMode = 'pushed_live' | 'queued_recipient_offline'

/** Minimal success shape from `sendCapsuleViaHttpWithAuth` / `sendCapsuleViaHttp` */
export type SendCapsuleSuccessShape = {
  success: true
  statusCode?: number
  coordinationRelayDelivery?: RelayDeliveryMode
}

export type CoordinationQueueTransportOutcome = {
  delivered: boolean
  queued: boolean
  code: 'DELIVERED_LIVE' | 'QUEUED_RECIPIENT_OFFLINE'
  coordinationRelayDelivery?: RelayDeliveryMode
  relayTransportAccepted: boolean
  http_status?: number
}

/**
 * - 200 + pushed_live → `delivered` true, `code` DELIVERED_LIVE
 * - 202 + queued_recipient_offline → `delivered` false, `queued` true; relay still accepted (`relayTransportAccepted`)
 * - Direct 200 (no `coordinationRelayDelivery`) → DELIVERED_LIVE
 */
export function mapSendResultToQueueOutcome(result: SendCapsuleSuccessShape): CoordinationQueueTransportOutcome {
  if (result.coordinationRelayDelivery === 'queued_recipient_offline') {
    return {
      delivered: false,
      queued: true,
      code: 'QUEUED_RECIPIENT_OFFLINE',
      coordinationRelayDelivery: 'queued_recipient_offline',
      relayTransportAccepted: true,
      http_status: result.statusCode,
    }
  }
  if (result.coordinationRelayDelivery === 'pushed_live') {
    return {
      delivered: true,
      queued: false,
      code: 'DELIVERED_LIVE',
      coordinationRelayDelivery: 'pushed_live',
      relayTransportAccepted: true,
      http_status: result.statusCode,
    }
  }
  return {
    delivered: true,
    queued: false,
    code: 'DELIVERED_LIVE',
    relayTransportAccepted: true,
    http_status: result.statusCode,
  }
}
