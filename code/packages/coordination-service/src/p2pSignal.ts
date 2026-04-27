/**
 * P2P WebRTC signaling over coordination relay (no BEAP capsules / no inbox).
 *
 * Wire shape must stay aligned with the Electron client’s `buildP2pSignalBody` in
 * `apps/electron-vite-project/electron/main/internalInference/p2pSignalRelayPost.ts`
 * (same `schema_version`, max per-type signaling TTL, and candidate handling).
 */

import { randomUUID } from 'crypto'

export const P2P_SIGNAL_TYPES = [
  'p2p_inference_offer',
  'p2p_inference_answer',
  'p2p_inference_ice',
  'p2p_inference_close',
  'p2p_inference_error',
  /** Host AI: authenticated relay envelope for the peer sandbox before first direct HTTP (bootstrap). */
  'p2p_host_ai_direct_beap_ad',
] as const
export type P2pSignalType = (typeof P2P_SIGNAL_TYPES)[number]

export const P2P_SIGNAL_SCHEMA_VERSION = 1
export const P2P_SIGNAL_MAX_BODY_BYTES = 16_384

/** User-content / BEAP-inbox keys that must never appear in a p2p_signal body. */
const FORBIDDEN_TOP_LEVEL_KEYS = new Set(['prompt', 'messages', 'completion', 'document', 'capsule'])

export type P2pSignalRejectReason =
  | 'invalid_json'
  | 'schema_version'
  | 'signal_type'
  | 'field_required'
  | 'forbidden_field'
  | 'ice_ttl'
  | 'signaling_ttl'
  | 'expired'
  | 'size'

export type P2pSignalParseOk = {
  ok: true
  payload: Record<string, unknown>
  signalType: P2pSignalType
  handshakeId: string
  correlationId: string
  sessionId: string
  senderDeviceId: string
  receiverDeviceId: string
  createdAt: string
  expiresAt: string
  sdp: string | undefined
  candidate: string | undefined
  rawBodyUtf8: string
}

export type P2pSignalParseFail = { ok: false; reason: P2pSignalRejectReason; httpStatus: number }

function parseIso(s: string): number | null {
  const t = Date.parse(s)
  return Number.isNaN(t) ? null : t
}

/**
 * Accept strict wire version 1 only, but tolerate loose serializers:
 * `1`, `1.0`, `"1"`, `"01"`, `"1.0"`, `"1.000"` (reject `"1.1"`, `2`, etc.).
 */
function coerceSchemaVersion(p: Record<string, unknown>): P2pSignalParseFail | null {
  const v = p.schema_version
  let ok = false
  if (typeof v === 'number' && Number.isFinite(v) && v === P2P_SIGNAL_SCHEMA_VERSION) {
    ok = true
  } else if (typeof v === 'string') {
    const t = v.trim()
    if (t) {
      if (/^[0-9]+$/.test(t)) {
        ok = Number(t) === P2P_SIGNAL_SCHEMA_VERSION
      } else if (/^1(?:\.0+)?$/.test(t)) {
        ok = true
      }
    }
  }
  if (!ok) {
    return { ok: false, reason: 'schema_version', httpStatus: 400 }
  }
  p.schema_version = P2P_SIGNAL_SCHEMA_VERSION
  return null
}

/**
 * Candidate is an opaque UTF-8 string on the wire (JSON text of RTCIceCandidateInit).
 * Also accept a JSON object and stringify it so callers may send nested sdpMid: null,
 * end-of-trickle `candidate: ""`, optional usernameFragment / relatedAddress / relatedPort, etc.
 */
function coerceCandidateField(p: Record<string, unknown>): P2pSignalParseFail | null {
  if (!('candidate' in p)) return null
  const c = p.candidate
  if (c === null || c === undefined) {
    delete p.candidate
    return null
  }
  if (typeof c === 'string') {
    p.candidate = c
    return null
  }
  if (typeof c === 'object' && !Array.isArray(c)) {
    try {
      p.candidate = JSON.stringify(c)
    } catch {
      return { ok: false, reason: 'invalid_json', httpStatus: 400 }
    }
    return null
  }
  return { ok: false, reason: 'field_required', httpStatus: 400 }
}

/**
 * Wire validation only — no registry / auth (caller enforces).
 */
export function tryParseP2pSignalRequest(
  body: string,
  maxBytes: number,
): P2pSignalParseOk | P2pSignalParseFail {
  const enc = new TextEncoder().encode(body)
  if (enc.length > maxBytes) {
    return { ok: false, reason: 'size', httpStatus: 413 }
  }
  let p: Record<string, unknown>
  try {
    p = JSON.parse(body) as Record<string, unknown>
  } catch {
    return { ok: false, reason: 'invalid_json', httpStatus: 400 }
  }
  if (p === null || typeof p !== 'object' || Array.isArray(p)) {
    return { ok: false, reason: 'invalid_json', httpStatus: 400 }
  }
  for (const k of Object.keys(p)) {
    if (FORBIDDEN_TOP_LEVEL_KEYS.has(k)) {
      return { ok: false, reason: 'forbidden_field', httpStatus: 400 }
    }
  }
  const schemaErr = coerceSchemaVersion(p)
  if (schemaErr) return schemaErr
  const candErr = coerceCandidateField(p)
  if (candErr) return candErr
  const st = p.signal_type
  if (typeof st !== 'string' || !P2P_SIGNAL_TYPES.includes(st as P2pSignalType)) {
    return { ok: false, reason: 'signal_type', httpStatus: 400 }
  }
  const signalType = st as P2pSignalType
  const need = (k: string): string | null => (typeof p[k] === 'string' && p[k]!.toString().trim() ? p[k]!.toString().trim() : null)
  const handshakeId = need('handshake_id')
  const correlationId = need('correlation_id')
  const sessionId = need('session_id')
  const senderDeviceId = need('sender_device_id')
  const receiverDeviceId = need('receiver_device_id')
  const createdAt = need('created_at')
  const expiresAt = need('expires_at')
  if (!handshakeId || !correlationId || !sessionId || !senderDeviceId || !receiverDeviceId || !createdAt || !expiresAt) {
    return { ok: false, reason: 'field_required', httpStatus: 400 }
  }
  const sdp = typeof p.sdp === 'string' && p.sdp.length > 0 ? p.sdp : undefined
  /** Includes `""` for end-of-trickle envelopes after `coerceCandidateField`. */
  const candidate = typeof p.candidate === 'string' ? p.candidate : undefined
  const c0 = parseIso(createdAt)
  const c1 = parseIso(expiresAt)
  if (c0 == null || c1 == null) {
    return { ok: false, reason: 'field_required', httpStatus: 400 }
  }
  const now = Date.now()
  if (c1 < now) {
    return { ok: false, reason: 'expired', httpStatus: 400 }
  }
  const ttl = c1 - c0
  if (ttl <= 0) {
    return { ok: false, reason: 'expired', httpStatus: 400 }
  }
  if (signalType === 'p2p_host_ai_direct_beap_ad') {
    if (ttl < 60_000 || ttl > 600_000) {
      return { ok: false, reason: 'signaling_ttl', httpStatus: 400 }
    }
    const ep = typeof p.endpoint_url === 'string' ? p.endpoint_url.trim() : ''
    if (!ep) {
      return { ok: false, reason: 'field_required', httpStatus: 400 }
    }
    try {
      void new URL(ep)
    } catch {
      return { ok: false, reason: 'field_required', httpStatus: 400 }
    }
    const adSeq = p.ad_seq
    if (typeof adSeq !== 'number' || !Number.isInteger(adSeq) || adSeq < 0) {
      return { ok: false, reason: 'field_required', httpStatus: 400 }
    }
    if (p.owner_role != null && p.owner_role !== 'host') {
      return { ok: false, reason: 'field_required', httpStatus: 400 }
    }
  } else if (signalType === 'p2p_inference_ice') {
    if (ttl > 120_000) {
      return { ok: false, reason: 'ice_ttl', httpStatus: 400 }
    }
  } else {
    if (ttl > 120_000) {
      return { ok: false, reason: 'signaling_ttl', httpStatus: 400 }
    }
  }
  return {
    ok: true,
    payload: p,
    signalType,
    handshakeId,
    correlationId,
    sessionId,
    senderDeviceId,
    receiverDeviceId,
    createdAt,
    expiresAt,
    sdp,
    candidate,
    rawBodyUtf8: body,
  }
}

export function p2pSignalMessageId(): string {
  return randomUUID()
}
