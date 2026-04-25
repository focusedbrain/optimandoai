/**
 * Inbound p2p_signal frames from the coordination WebSocket (not BEAP capsules, not inbox).
 * Phase 3: validate + log + route to session stub; no ingestion pipeline.
 */

import { redactIdForLog } from './internalInferenceLogRedact'
import { maybeHandleP2pInferenceRelaySignal } from './p2pSessionManagerStub'

const FORBIDDEN_KEYS = new Set(['prompt', 'messages', 'completion', 'document', 'capsule'])

const SIGNAL_TYPES = new Set([
  'p2p_inference_offer',
  'p2p_inference_answer',
  'p2p_inference_ice',
  'p2p_inference_close',
  'p2p_inference_error',
])

type P2pSignalDrop = 'forbidden_key' | 'schema' | 'type' | 'field' | 'expired' | 'ttl' | 'parse' | 'stale'

/** Reject `created_at` too far in the past (defense in depth vs relay `expires_at`). */
const MAX_P2P_SIGNAL_AGE_MS = 120_000

function parseIso(s: unknown): number | null {
  if (typeof s !== 'string' || !s.trim()) return null
  const t = Date.parse(s)
  return Number.isNaN(t) ? null : t
}

/**
 * @returns true if the message was a p2p_signal and handled (consumed) — do not process as capsule
 */
export function tryHandleCoordinationP2pSignal(
  msg: Record<string, unknown>,
  relayMessageId: string,
): boolean {
  if (msg.type !== 'p2p_signal') {
    return false
  }
  if (typeof msg.id !== 'string' || !msg.id.trim() || !msg.payload || typeof msg.payload !== 'object' || Array.isArray(msg.payload)) {
    const hid = extractHandshakeId(msg)
    logDropped(hid, 'parse', relayMessageId)
    return true
  }
  const p = msg.payload as Record<string, unknown>
  for (const k of Object.keys(p)) {
    if (FORBIDDEN_KEYS.has(k)) {
      logDropped(p.handshake_id, 'forbidden_key', relayMessageId)
      return true
    }
  }
  if (p.schema_version !== 1) {
    logDropped(p.handshake_id, 'schema', relayMessageId)
    return true
  }
  const st = p.signal_type
  if (typeof st !== 'string' || !SIGNAL_TYPES.has(st)) {
    logDropped(p.handshake_id, 'type', relayMessageId)
    return true
  }
  for (const k of ['correlation_id', 'session_id', 'handshake_id', 'sender_device_id', 'receiver_device_id', 'created_at', 'expires_at'] as const) {
    if (typeof p[k] !== 'string' || !p[k]!.toString().trim()) {
      logDropped(p.handshake_id, 'field', relayMessageId)
      return true
    }
  }
  const c0 = parseIso(p.created_at)
  const c1 = parseIso(p.expires_at)
  if (c0 == null || c1 == null) {
    logDropped(p.handshake_id, 'field', relayMessageId)
    return true
  }
  const now = Date.now()
  if (c1 < now) {
    logDropped(p.handshake_id, 'expired', relayMessageId)
    return true
  }
  if (now - c0 > MAX_P2P_SIGNAL_AGE_MS) {
    logDropped(p.handshake_id, 'stale', relayMessageId)
    return true
  }
  const ttl = c1 - c0
  if (ttl <= 0) {
    logDropped(p.handshake_id, 'expired', relayMessageId)
    return true
  }
  if (p.signal_type === 'p2p_inference_ice') {
    if (ttl > 30_000) {
      logDropped(p.handshake_id, 'ttl', relayMessageId)
      return true
    }
  } else if (ttl > 60_000) {
    logDropped(p.handshake_id, 'ttl', relayMessageId)
    return true
  }
  const hid = typeof p.handshake_id === 'string' ? p.handshake_id : ''
  const session = typeof p.session_id === 'string' ? p.session_id : ''
  if (p.signal_type === 'p2p_inference_answer') {
    console.log(`[P2P_SIGNAL] answer_received handshake=${hid} session=${redactIdForLog(session)}`)
  }
  console.log(
    `[P2P_SIGNAL] received handshake=${hid} signal=${p.signal_type} session=${redactIdForLog(session)}`,
  )
  void maybeHandleP2pInferenceRelaySignal({
    relayMessageId,
    raw: p,
  })
  return true
}

function extractHandshakeId(msg: Record<string, unknown>): string {
  const p = msg.payload
  if (p && typeof p === 'object' && !Array.isArray(p) && typeof (p as any).handshake_id === 'string') {
    return (p as any).handshake_id
  }
  return ''
}

function logDropped(
  handshake: unknown,
  reason: P2pSignalDrop,
  relayMessageId: string,
): void {
  const h = typeof handshake === 'string' && handshake ? handshake : '(unknown)'
  console.log(`[P2P_SIGNAL] dropped handshake=${h} reason=${reason} relay_message_id=${relayMessageId}`)
}
