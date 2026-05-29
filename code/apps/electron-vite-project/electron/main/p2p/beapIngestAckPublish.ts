/**
 * Sender-facing BEAP ingest ack over coordination WebSocket (decoupled from coordinationWs.ts).
 */

import type { ReasonCode } from '../vault/capabilityBroker'

let _coordinationWsJsonSender: ((payload: Record<string, unknown>) => boolean) | null = null

export function setCoordinationBeapIngestAckSender(
  fn: ((payload: Record<string, unknown>) => boolean) | null,
): void {
  _coordinationWsJsonSender = fn
}

export function publishBeapIngestAckOverCoordinationRelay(opts: {
  relayId: string
  handshakeId: string
  rowId: string
  status?: 'ok' | 'error'
  reasonCode?: ReasonCode
  retryable?: boolean
}): void {
  if (!_coordinationWsJsonSender) return
  const ok = _coordinationWsJsonSender({
    type: 'beap_ingest_ack',
    relay_id: opts.relayId,
    handshake_id: opts.handshakeId,
    row_id: opts.rowId,
    status: opts.status ?? 'ok',
    ...(opts.reasonCode ? { reason_code: opts.reasonCode } : {}),
    ...(opts.retryable === true ? { retryable: true } : {}),
  })
  if (ok) {
    console.log(
      `[BEAP_DELIVERY] coordination_ingest_ack_published relayId=${opts.relayId} handshake=${opts.handshakeId} rowId=${opts.rowId} status=${opts.status ?? 'ok'} reason=${opts.reasonCode ?? 'none'}`,
    )
  } else {
    console.warn(
      `[BEAP_DELIVERY] coordination_ingest_ack_publish_failed relayId=${opts.relayId} handshake=${opts.handshakeId} rowId=${opts.rowId}`,
    )
  }
}
