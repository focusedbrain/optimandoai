/**
 * Honest BEAP ingest + relay-transport ack policy.
 *
 * Relay transport ack (sendAckFn) is only sent after successful inbox delivery.
 * Sender-facing beap_ingest_ack is always published with status ok|error.
 */

import { randomUUID } from 'node:crypto'
import type { ReasonCode } from '../vault/capabilityBroker'
import type { P2PInlineResult } from '../email/beapEmailIngestion'
import { publishBeapIngestAckOverCoordinationRelay } from './beapIngestAckPublish'
import { postPeerDeliveryAckToSender } from './peerDeliveryAck'

export function mapBeapIngestFailureToReasonCode(
  error: string,
  partial?: Pick<P2PInlineResult, 'reasonCode' | 'retryable'>,
): { reasonCode: ReasonCode; retryable: boolean } {
  if (partial?.reasonCode) {
    return {
      reasonCode: partial.reasonCode,
      retryable: partial.retryable ?? false,
    }
  }
  const e = error.toLowerCase()
  if (e.includes('missing_x25519') || e.includes('decrypt') || e.includes('depackage')) {
    return { reasonCode: 'decrypt_failed', retryable: false }
  }
  if (e.includes('quarantine') || e.includes('validator rejected')) {
    return { reasonCode: 'quarantined', retryable: false }
  }
  if (
    e.includes('outer_vault_not_ready') ||
    e.includes('outer_vault_unavailable') ||
    e.includes('vault_not_ready') ||
    e.includes('vault_unavailable') ||
    e.includes('legacy_requires_claim') ||
    e.includes('vault_unclaimed')
  ) {
    return { reasonCode: 'inner_vault_locked', retryable: true }
  }
  if (e.includes('validator unavailable') || e.includes('not running (call start()')) {
    return { reasonCode: 'validator_unhealthy', retryable: true }
  }
  if (e.includes('start_failed') || e.includes('not_ready_after_start')) {
    return { reasonCode: 'validator_unhealthy', retryable: true }
  }
  if (e.includes('key_provider') || e.includes('key provider')) {
    return { reasonCode: 'key_provider_unbound', retryable: true }
  }
  if (e.includes('validator') || e.includes('validation service')) {
    return { reasonCode: 'validator_unhealthy', retryable: true }
  }
  if (e.includes('ledger_db')) {
    return { reasonCode: 'ledger_db_unavailable', retryable: true }
  }
  if (
    e.includes('pod_required') ||
    e.includes('host_pod_starting') ||
    e.includes('held_blocked') ||
    e.includes('validation pod unavailable')
  ) {
    return { reasonCode: 'validator_unhealthy', retryable: true }
  }
  return { reasonCode: 'processing_failed', retryable: false }
}

export function rejectionReasonToReasonCode(rejectionReason: string): ReasonCode {
  const r = rejectionReason.toLowerCase()
  if (r.includes('missing_x25519') || r.includes('decrypt') || r.includes('depackage')) {
    return 'decrypt_failed'
  }
  if (r.includes('validator')) return 'validator_unhealthy'
  if (r.includes('vault')) return 'inner_vault_locked'
  return 'quarantined'
}

export type RelayBeapIngestFinalizeInput = {
  logTag: 'COORDINATION_WS' | 'RELAY_PULL'
  relayId: string
  handshakeId: string
  db: unknown
  result: P2PInlineResult | null
  thrownMessage?: string
  sendAckFn: (ids: string[]) => void
}

/**
 * Apply relay + sender ack policy for one BEAP message ingest attempt.
 */
export function finalizeRelayBeapIngest(input: RelayBeapIngestFinalizeInput): void {
  const { logTag, relayId, handshakeId, db, sendAckFn } = input
  const ackRowId = input.result?.rowId ?? randomUUID()

  if (input.thrownMessage) {
    const { reasonCode, retryable } = mapBeapIngestFailureToReasonCode(input.thrownMessage)
    console.error(`[${logTag}] ingest_threw relayId=${relayId} handshake=${handshakeId} reason=${reasonCode}`, input.thrownMessage)
    publishBeapIngestAckOverCoordinationRelay({
      relayId,
      handshakeId,
      rowId: ackRowId,
      status: 'error',
      reasonCode,
      retryable,
    })
    console.log(
      `[${logTag}] relay_ack_withheld relayId=${relayId} reason=${reasonCode} retryable=${retryable} ingest_ack=published`,
    )
    return
  }

  const r = input.result
  if (!r) {
    const { reasonCode, retryable } = mapBeapIngestFailureToReasonCode('processing_failed')
    publishBeapIngestAckOverCoordinationRelay({
      relayId,
      handshakeId,
      rowId: ackRowId,
      status: 'error',
      reasonCode,
      retryable,
    })
    console.log(`[${logTag}] relay_ack_withheld relayId=${relayId} reason=${reasonCode} ingest_ack=published`)
    return
  }

  if (r.outcome === 'inbox') {
    console.log(`[${logTag}] ingest_inbox relayId=${relayId} handshake=${handshakeId} rowId=${r.rowId}`)
    if (r.rowId) {
      publishBeapIngestAckOverCoordinationRelay({
        relayId,
        handshakeId,
        rowId: r.rowId,
        status: 'ok',
      })
      postPeerDeliveryAckToSender(db as any, handshakeId, r.rowId)
    }
    console.log(`[${logTag}] relay_ack_sent relayId=${relayId} reason=ok retryable=false outcome=inbox`)
    sendAckFn([relayId])
    return
  }

  if (r.outcome === 'quarantine') {
    const reasonCode = r.reasonCode ?? rejectionReasonToReasonCode(r.error ?? 'quarantined')
    console.warn(
      `[${logTag}] ingest_quarantine relayId=${relayId} handshake=${handshakeId} rowId=${r.rowId} reason=${reasonCode}`,
    )
    publishBeapIngestAckOverCoordinationRelay({
      relayId,
      handshakeId,
      rowId: ackRowId,
      status: 'error',
      reasonCode,
      retryable: r.retryable ?? false,
    })
    console.log(
      `[${logTag}] relay_ack_withheld relayId=${relayId} reason=${reasonCode} retryable=false outcome=quarantine ingest_ack=published`,
    )
    return
  }

  const failReason = r.error ?? 'processing_failed'
  const failCode = r.reasonCode ?? mapBeapIngestFailureToReasonCode(failReason, r).reasonCode
  const failRetryable = r.retryable ?? mapBeapIngestFailureToReasonCode(failReason, r).retryable
  console.warn(`[${logTag}] ingest_failed relayId=${relayId} handshake=${handshakeId} reason=${failCode}`, failReason)
  publishBeapIngestAckOverCoordinationRelay({
    relayId,
    handshakeId,
    rowId: ackRowId,
    status: 'error',
    reasonCode: failCode,
    retryable: failRetryable,
  })
  console.log(
    `[${logTag}] relay_ack_withheld relayId=${relayId} reason=${failCode} retryable=${failRetryable} ingest_ack=published`,
  )
}
