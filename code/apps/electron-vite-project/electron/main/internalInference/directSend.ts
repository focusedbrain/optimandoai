/**
 * Direct HTTP to peer `p2p_endpoint` only — no coordination relay, no outbound_capsule_queue.
 * Does not log request/response bodies (metadata only via callers).
 */

import { InternalInferenceErrorCode } from './errors'
import { endpointHostOnly, logInternalInferenceEvent } from './logging'
import type { InternalServiceMessageType } from './types'

const DIRECT_SEND_TIMEOUT_MS = 30_000

export type DirectServiceSendResult = { ok: true; status: number } | { ok: false; code: string; error: string }

/**
 * POST JSON to counterparty /beap/ingest with handshake Bearer and X-BEAP-Handshake.
 * Mirrors p2pTransport `sendCapsuleViaHttp` transport shape without [RELAY-POST] body logging.
 */
export async function postServiceEnvelopeDirect(
  body: object,
  targetEndpoint: string,
  handshakeId: string,
  bearerToken: string | null | undefined,
  logMeta: {
    request_id: string
    sender_device_id: string
    target_device_id: string
    message_type: InternalServiceMessageType
  },
): Promise<DirectServiceSendResult> {
  const trimmed = typeof targetEndpoint === 'string' ? targetEndpoint.trim() : ''
  if (!trimmed) {
    return { ok: false, code: InternalInferenceErrorCode.HOST_DIRECT_P2P_UNAVAILABLE, error: 'missing target' }
  }

  const json = JSON.stringify(body)
  const t0 = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DIRECT_SEND_TIMEOUT_MS)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-BEAP-Handshake': handshakeId,
  }
  if (bearerToken?.trim()) {
    headers['Authorization'] = `Bearer ${bearerToken.trim()}`
  }

  try {
    const response = await fetch(trimmed, {
      method: 'POST',
      headers,
      body: json,
      signal: controller.signal,
    })
    clearTimeout(timeout)
    const duration_ms = Date.now() - t0
    /** Direct-only internal inference: 200 only — not 202 “queued on relay” or other 2xx. */
    if (!response.ok || response.status !== 200) {
      logInternalInferenceEvent(
        'send',
        {
          request_id: logMeta.request_id,
          handshake_id: handshakeId,
          sender_device_id: logMeta.sender_device_id,
          target_device_id: logMeta.target_device_id,
          message_type: logMeta.message_type,
          direct_endpoint_host: endpointHostOnly(trimmed),
          duration_ms,
        },
        trimmed,
      )
      return {
        ok: false,
        code: InternalInferenceErrorCode.HOST_DIRECT_P2P_UNAVAILABLE,
        error: `HTTP ${response.status}`,
      }
    }
    logInternalInferenceEvent(
      'send',
      {
        request_id: logMeta.request_id,
        handshake_id: handshakeId,
        sender_device_id: logMeta.sender_device_id,
        target_device_id: logMeta.target_device_id,
        message_type: logMeta.message_type,
        direct_endpoint_host: endpointHostOnly(trimmed),
        duration_ms,
      },
      trimmed,
    )
    return { ok: true, status: response.status }
  } catch (e: any) {
    clearTimeout(timeout)
    const name = e?.name === 'AbortError' ? InternalInferenceErrorCode.REQUEST_TIMEOUT : InternalInferenceErrorCode.HOST_DIRECT_P2P_UNAVAILABLE
    const errMsg = e?.message ?? String(e)
    logInternalInferenceEvent(
      'send',
      {
        request_id: logMeta.request_id,
        handshake_id: handshakeId,
        sender_device_id: logMeta.sender_device_id,
        target_device_id: logMeta.target_device_id,
        message_type: logMeta.message_type,
        direct_endpoint_host: endpointHostOnly(trimmed),
        duration_ms: Date.now() - t0,
      },
      trimmed,
    )
    return { ok: false, code: name, error: errMsg }
  }
}
