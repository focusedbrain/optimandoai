/**
 * Structured line when coordination rejects `/beap/p2p-signal` with 400 (schema / validation).
 * Use with coordination `P2P_SIGNAL_REJECTED` body `{ error, reason }`.
 */

import { P2P_SIGNAL_WIRE_SCHEMA_VERSION } from './p2pSignalWireSchemaVersion'
import { redactIdForLog } from './internalInferenceLogRedact'

export type HostAiP2pSignalSchemaRejectKind = 'offer' | 'answer' | 'ice' | 'host_ai_direct_beap_ad'

/**
 * [HOST_AI_SIGNAL_SCHEMA_REJECTED] — one JSON line; safe for production (no SDP/ICE dumps).
 */
export function logHostAiSignalSchemaRejected(p: {
  handshake_id: string
  local_device_id: string
  peer_device_id: string
  source: 'p2p_signal_coordination_post'
  request_body_json: string
  response_body_text: string
  kind: HostAiP2pSignalSchemaRejectKind
}): void {
  let receivedType: string | null = null
  let receivedVersion: string | number | null = null
  let receivedKeys: string[] = []
  let rejectionPath = 'parse_failed'
  try {
    const o = JSON.parse(p.request_body_json) as Record<string, unknown>
    receivedKeys = Object.keys(o).sort()
    if (typeof o.signal_type === 'string') {
      receivedType = o.signal_type
    }
    const v = o.schema_version
    if (v !== undefined && v !== null) {
      receivedVersion = v as string | number
    }
  } catch {
    receivedKeys = []
  }
  try {
    const r = JSON.parse(p.response_body_text) as { reason?: unknown; error?: unknown }
    if (r && typeof r === 'object') {
      if (typeof r.reason === 'string' && r.reason.trim()) {
        rejectionPath = r.reason.trim()
      } else if (typeof r.error === 'string' && r.error.trim()) {
        rejectionPath = r.error.trim()
      }
    }
  } catch {
    const t = p.response_body_text.trim()
    rejectionPath = t.length > 240 ? `${t.slice(0, 240)}…` : t || 'empty_response_body'
  }
  const line = {
    handshake_id: p.handshake_id,
    local_device_id: p.local_device_id,
    peer_device_id: redactIdForLog(p.peer_device_id),
    source: p.source,
    expected_schema_version: P2P_SIGNAL_WIRE_SCHEMA_VERSION,
    received_type: receivedType,
    received_version: receivedVersion,
    received_keys: receivedKeys,
    rejection_path: rejectionPath,
    kind: p.kind,
  }
  console.log(`[HOST_AI_SIGNAL_SCHEMA_REJECTED] ${JSON.stringify(line)}`)
}
