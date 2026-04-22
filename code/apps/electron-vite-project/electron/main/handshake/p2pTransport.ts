/**
 * P2P HTTP Transport — Outbound capsule delivery to counterparty's ingestion endpoint.
 *
 * Sends context-sync capsules via HTTP POST to the counterparty's configured
 * p2p_endpoint (e.g. https://host:port/api/ingestion/ingest).
 *
 * Does NOT throw — returns { success, error } for queue/retry handling.
 */

/** Direct source import: Vitest + `@repo/ingestion-core` index alias can yield incomplete exports for this module. */
import { isCoordinationRelayNativeBeap } from '../../../../../packages/ingestion-core/src/beapDetection.ts'
import { getInstanceId } from '../orchestrator/orchestratorModeStore'
import {
  applyContextSyncInternalRoutingFromRecord,
  validateCoordinationInternalPayloadBeforePost,
  formatLocalInternalRelayValidationJson,
} from './internalRelayOutboundGuards'

const TIMEOUT_MS = 30_000

/**
 * Handshake relay envelopes (top-level `capsule_type`) — must match the server's
 * `RELAY_ALLOWED_TYPES` at packages/coordination-service/src/server.ts.
 *
 * `'initiate'` is conditionally allowed: the server accepts it only for
 * internal (same-principal) handshakes whose registered route resolves both
 * device ids. Cross-user initiates are rejected with 400
 * `initiate_external_not_allowed`. We list `'initiate'` here regardless because
 * this client-side set determines whether we *attempt* a relay POST at all;
 * the server is the source of truth for the per-capsule decision.
 *
 * Keep this set, `COORDINATION_RELAY_ALLOWED_CAPSULE_TYPES` below, and
 * server.ts:RELAY_ALLOWED_TYPES synchronised.
 */
const RELAY_HANDSHAKE_CAPSULE_TYPES = new Set(['accept', 'context_sync', 'refresh', 'revoke', 'initiate'])

/**
 * Relay accepts these when not a native message package — exact mirror of
 * coordination-service `RELAY_ALLOWED_TYPES` (server.ts:380-392). Used by
 * `coordinationRelayContractSatisfied` to short-circuit doomed POSTs.
 *
 * `'initiate'` is conditionally allowed by the server (same-principal only with
 * resolved routing); the client-side contract checker only validates shape, not
 * routing, so listing it here is correct — the server-side `initiate`-specific
 * guard rejects cross-user / unrouted attempts with 400/404.
 *
 * Keep this list, `RELAY_HANDSHAKE_CAPSULE_TYPES` above, and
 * server.ts:RELAY_ALLOWED_TYPES synchronised.
 */
export const COORDINATION_RELAY_ALLOWED_CAPSULE_TYPES = ['accept', 'context_sync', 'refresh', 'revoke', 'initiate'] as const

/**
 * True iff coordination `/beap/capsule` would accept this body (same rules as coordination-service):
 * either `isCoordinationRelayNativeBeap` (native wire) or `capsule_type` in the four allowed strings.
 */
export function coordinationRelayContractSatisfied(parsed: unknown): boolean {
  if (isCoordinationRelayNativeBeap(parsed)) return true
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return false
  const o = parsed as Record<string, unknown>
  const ct = typeof o.capsule_type === 'string' ? o.capsule_type.trim() : ''
  return (COORDINATION_RELAY_ALLOWED_CAPSULE_TYPES as readonly string[]).includes(ct)
}

/**
 * Summarizes outbound JSON body shape for logs (no values beyond keys / booleans).
 * Aligns with coordination `/beap/capsule`: accepts either a BEAP message package
 * (`header`+`metadata`+`envelope`|`payload`|`payloadEnc`|`innerEnvelopeCiphertext`, no top-level `capsule_type`) or a
 * capsule envelope (`capsule_type` in accept|context_sync|refresh|revoke).
 */
export type OutboundInternalWireLogSummary = {
  /** Declared handshake_type when valid; otherwise null even if routing fields exist */
  handshake_type: 'internal' | 'standard' | null
  has_sender_device_id: boolean
  has_receiver_device_id: boolean
  has_sender_device_role: boolean
  has_receiver_device_role: boolean
  has_sender_computer_name: boolean
  has_receiver_computer_name: boolean
}

function summarizeInternalWireForLogs(o: Record<string, unknown>): OutboundInternalWireLogSummary | undefined {
  const routingKeys = [
    'handshake_type',
    'sender_device_id',
    'receiver_device_id',
    'sender_device_role',
    'receiver_device_role',
    'sender_computer_name',
    'receiver_computer_name',
  ] as const
  if (!routingKeys.some((k) => k in o)) return undefined

  const ht = o.handshake_type
  const handshake_type: 'internal' | 'standard' | null =
    ht === 'internal' || ht === 'standard' ? ht : null

  const nz = (v: unknown): boolean => typeof v === 'string' && v.trim().length > 0

  return {
    handshake_type,
    has_sender_device_id: nz(o.sender_device_id),
    has_receiver_device_id: nz(o.receiver_device_id),
    has_sender_device_role: o.sender_device_role === 'host' || o.sender_device_role === 'sandbox',
    has_receiver_device_role: o.receiver_device_role === 'host' || o.receiver_device_role === 'sandbox',
    has_sender_computer_name: nz(o.sender_computer_name),
    has_receiver_computer_name: nz(o.receiver_computer_name),
  }
}

export function describeOutboundPayloadForLogs(capsule: unknown): {
  value_kind: 'object' | 'other'
  top_level_keys: string[]
  has_top_level_handshake_id: boolean
  has_capsule_type_key: boolean
  looks_like_beap_message_package: boolean
  looks_like_relay_capsule_envelope: boolean
  has_message_header_receiver_binding_handshake_id: boolean
  /** Present when any internal / coordination routing field exists on the envelope */
  internal_wire?: OutboundInternalWireLogSummary
} {
  if (!capsule || typeof capsule !== 'object' || Array.isArray(capsule)) {
    return {
      value_kind: 'other',
      top_level_keys: [],
      has_top_level_handshake_id: false,
      has_capsule_type_key: false,
      looks_like_beap_message_package: false,
      looks_like_relay_capsule_envelope: false,
      has_message_header_receiver_binding_handshake_id: false,
    }
  }
  const o = capsule as Record<string, unknown>
  const keys = Object.keys(o).sort()
  const has_top_level_handshake_id = typeof o.handshake_id === 'string' && o.handshake_id.trim().length > 0
  const has_capsule_type_key = 'capsule_type' in o
  const capsuleType = typeof o.capsule_type === 'string' ? o.capsule_type : ''
  const looks_like_beap_message_package = isCoordinationRelayNativeBeap(o)
  const RELAY = new Set(['accept', 'context_sync', 'refresh', 'revoke'])
  const looks_like_relay_capsule_envelope = has_capsule_type_key && RELAY.has(capsuleType)
  let has_message_header_receiver_binding_handshake_id = false
  if (o.header && typeof o.header === 'object' && !Array.isArray(o.header)) {
    const h = o.header as Record<string, unknown>
    const rb = h.receiver_binding
    if (rb && typeof rb === 'object' && !Array.isArray(rb)) {
      const id = (rb as Record<string, unknown>).handshake_id
      has_message_header_receiver_binding_handshake_id = typeof id === 'string' && id.trim().length > 0
    }
  }
  const internal_wire = summarizeInternalWireForLogs(o)
  return {
    value_kind: 'object',
    top_level_keys: keys.slice(0, 48),
    has_top_level_handshake_id,
    has_capsule_type_key,
    looks_like_beap_message_package,
    looks_like_relay_capsule_envelope,
    has_message_header_receiver_binding_handshake_id,
    ...(internal_wire ? { internal_wire } : {}),
  }
}

/**
 * Sanitized outbound POST diagnostics for UI/IPC (no auth headers, no raw capsule body).
 * Keep in sync with `OutboundRequestDebugSnapshot` in extension `handshakeRpc.ts`.
 */
export interface OutboundRequestDebugSnapshot {
  route: 'coordination' | 'direct'
  url: string
  method: 'POST'
  content_type: string
  content_length_bytes: number
  body_type: 'json_string'
  top_level_keys: string[]
  body_looks_double_encoded: boolean
  request_shape: ReturnType<typeof describeOutboundPayloadForLogs>
  /** HTTP status when a response was received; 0 if the request failed before that */
  http_status: number
  response_body_snippet?: string
  /** Present when fetch failed before an HTTP response */
  transport_error?: string
  /** Summarizes canon A.3.042 / A.3.054 inner encrypted chunk counts (no raw bytes). */
  canon_chunking_summary?: {
    payload_enc_chunk_count?: number
    artefact_encrypted_chunk_total?: number
    note?: string
  }
  /** Coordination relay uses a single JSON POST per send (full wire package). */
  coordination_single_post_json?: boolean
  /**
   * Coordination `/beap/capsule` routing: server resolves `handshake_id` from the top-level string
   * or from `header.receiver_binding.handshake_id` on BEAP message packages (ingestion-core).
   */
  expected_coordination_routing_keys?: string[]
  /** Top-level keys missing for coordination routing (e.g. `handshake_id` when not inferable). */
  missing_coordination_top_level_fields?: string[]
  /** Wire BEAP vs handshake relay envelope (coordination path). */
  coordination_source_format?: 'beap_wire_message_package' | 'handshake_relay_envelope'
  /** How the relay classifies the POST after normalization. */
  coordination_normalized_shape?: 'relay_native_beap_wire' | 'relay_handshake_capsule'
  /** Inferred relay / ingestion label (wire → message_package bypass). */
  derived_relay_capsule_type?: string | null
  /** True when the payload matches coordination relay expectations for its class (prefer relay_validator_contract_matches). */
  relay_envelope_matches_expectations?: boolean
  /** Canonical coordination field name (matches coordination-service). */
  relay_capsule_type_field_name?: 'capsule_type'
  /** From the final serialized JSON body — whether `capsule_type` exists as a key. */
  serialized_capsule_type_field_present?: boolean
  /** From the final serialized JSON body — string value, or null if absent / non-string. */
  serialized_capsule_type_value?: string | null
  /** True iff the final JSON body satisfies coordination-service gate (isCoordinationRelayNativeBeap or allowed capsule_type). */
  relay_validator_contract_matches?: boolean
  /** When server returns capsule_type_not_allowed, parsed hint from detail (no secrets). */
  relay_allowed_types_from_response?: string
}

/** Coordination `/beap/capsule` only: 200 = WebSocket push to recipient, 202 = stored for later. */
export type CoordinationRelayDelivery = 'pushed_live' | 'queued_recipient_offline'

export interface SendCapsuleResult {
  success: boolean
  error?: string
  statusCode?: number
  /** Coordination relay: set when success — distinguishes live push vs offline queue. */
  coordinationRelayDelivery?: CoordinationRelayDelivery
  /** From HTTP Retry-After (seconds), when present */
  retryAfterSec?: number
  /** Sanitized non-OK response body fragment for debugging (no secrets). */
  responseBodySnippet?: string
  /** Structured request/response diagnostics for terminal failures and debugging */
  outboundDebug?: OutboundRequestDebugSnapshot
  /** Internal relay guards blocked the coordination POST before fetch */
  localRelayValidationFailed?: boolean
  localRelayValidation?: {
    phase: 'coordination_pre_http'
    invariant: string
    message: string
    missing_fields: string[]
  }
}

/** Top-level JSON keys of the serialized request body (no values). */
export function extractTopLevelKeysFromJsonBody(bodyUtf8: string): string[] {
  const t = bodyUtf8.trim()
  if (!t) return []
  try {
    let parsed: unknown = JSON.parse(t)
    if (typeof parsed === 'string') {
      try {
        parsed = JSON.parse(parsed)
      } catch {
        return []
      }
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.keys(parsed as Record<string, unknown>)
        .sort()
        .slice(0, 48)
    }
  } catch {
    return []
  }
  return []
}

/** True if the wire body is a JSON string containing another JSON object (double-encoding). */
export function detectBodyLooksDoubleEncoded(bodyUtf8: string): boolean {
  const t = bodyUtf8.trim()
  if (!t.startsWith('"')) return false
  try {
    const first = JSON.parse(t) as unknown
    if (typeof first !== 'string') return false
    const second = JSON.parse(first) as unknown
    return second !== null && typeof second === 'object'
  } catch {
    return false
  }
}

/**
 * Coordination `/beap/capsule`: merge queue `handshake_id`, strip null/empty `capsule_type`
 * (JSON `capsule_type: null` breaks relay message-package detection — key exists but type is not a string).
 */
export function buildCoordinationCapsulePostBody(capsule: object, queueHandshakeId: string): object {
  const id = queueHandshakeId?.trim()
  const o = { ...(capsule as Record<string, unknown>) }
  if (id) o.handshake_id = id
  const ct = o.capsule_type
  if (ct === null || ct === undefined) delete o.capsule_type
  if (typeof ct === 'string' && ct.trim() === '') delete o.capsule_type
  return o
}

/** DEBUG: classify outbound object for coordination relay (no secrets). */
export function describeCoordinationRelayNormalization(capsule: object): {
  coordination_source_format: 'beap_wire_message_package' | 'handshake_relay_envelope'
  coordination_normalized_shape: 'relay_native_beap_wire' | 'relay_handshake_capsule'
  derived_relay_capsule_type: string | null
  relay_envelope_matches_expectations: boolean
} {
  const o = capsule as Record<string, unknown>
  const ct = typeof o.capsule_type === 'string' ? o.capsule_type.trim() : ''
  if (ct && RELAY_HANDSHAKE_CAPSULE_TYPES.has(ct)) {
    return {
      coordination_source_format: 'handshake_relay_envelope',
      coordination_normalized_shape: 'relay_handshake_capsule',
      derived_relay_capsule_type: ct,
      relay_envelope_matches_expectations: coordinationRelayContractSatisfied(o),
    }
  }
  const wireOk = isCoordinationRelayNativeBeap(o)
  return {
    coordination_source_format: 'beap_wire_message_package',
    coordination_normalized_shape: 'relay_native_beap_wire',
    derived_relay_capsule_type: wireOk ? 'message_package' : null,
    relay_envelope_matches_expectations: coordinationRelayContractSatisfied(o),
  }
}

/**
 * Parse the exact JSON the relay receives (handles outer JSON-string double-wrap like extractTopLevelKeys).
 * Returns null if not a JSON object.
 */
export function parseCoordinationWireJsonBody(bodyUtf8: string): Record<string, unknown> | null {
  try {
    let v: unknown = JSON.parse(bodyUtf8.trim())
    if (typeof v === 'string') {
      v = JSON.parse(v)
    }
    if (v == null || typeof v !== 'object' || Array.isArray(v)) return null
    return v as Record<string, unknown>
  } catch {
    return null
  }
}

/** Strict wire analysis — must match what coordination-service parses from the POST body. */
export function analyzeSerializedCoordinationContract(bodyUtf8: string): {
  relay_capsule_type_field_name: 'capsule_type'
  serialized_capsule_type_field_present: boolean
  serialized_capsule_type_value: string | null
  relay_validator_contract_matches: boolean
} {
  const o = parseCoordinationWireJsonBody(bodyUtf8)
  if (!o) {
    return {
      relay_capsule_type_field_name: 'capsule_type',
      serialized_capsule_type_field_present: false,
      serialized_capsule_type_value: null,
      relay_validator_contract_matches: false,
    }
  }
  const raw = o.capsule_type
  const serialized_capsule_type_field_present = 'capsule_type' in o
  const serialized_capsule_type_value = typeof raw === 'string' ? raw : null
  return {
    relay_capsule_type_field_name: 'capsule_type',
    serialized_capsule_type_field_present,
    serialized_capsule_type_value,
    relay_validator_contract_matches: coordinationRelayContractSatisfied(o),
  }
}

/** Parse relay error body for allowed-types hint (sanitized). */
export function parseRelayCapsuleTypeNotAllowedHint(snippet: string): string | undefined {
  const t = (snippet || '').trim()
  if (!t.includes('capsule_type_not_allowed')) return undefined
  try {
    const j = JSON.parse(t) as { detail?: string }
    const d = j.detail
    if (typeof d === 'string' && d.length > 0 && d.length < 800) return d
  } catch {
    const m = t.match(/Relay accepts:\s*([^\n}]+)/)
    if (m) return m[1].trim()
  }
  return undefined
}

/** Safe diagnostics: which coordination routing keys are expected / missing (no secrets). */
export function analyzeCoordinationRoutingCompliance(capsule: unknown): {
  expected_coordination_routing_keys: string[]
  missing_coordination_top_level_fields: string[]
} {
  const expected_coordination_routing_keys = ['handshake_id']
  const shape = describeOutboundPayloadForLogs(capsule)
  const missing: string[] = []
  if (!shape.has_top_level_handshake_id && !shape.has_message_header_receiver_binding_handshake_id) {
    missing.push('handshake_id')
  }
  return { expected_coordination_routing_keys, missing_coordination_top_level_fields: missing }
}

/** Summarizes canon inner encrypted chunking (A.3.042 / A.3.054) for DEBUG UI — no raw ciphertext. */
export function summarizeCanonChunkingForOutboundDebug(capsule: unknown): NonNullable<
  OutboundRequestDebugSnapshot['canon_chunking_summary']
> {
  const note =
    'Canon A.3.042/A.3.054: inner fields use encrypted chunks; coordination relay sends one JSON POST per send.'
  if (!capsule || typeof capsule !== 'object' || Array.isArray(capsule)) {
    return { note }
  }
  const o = capsule as Record<string, unknown>
  const pe = o.payloadEnc
  let payload_enc_chunk_count: number | undefined
  if (pe && typeof pe === 'object' && !Array.isArray(pe)) {
    const ch = (pe as { chunking?: { count?: number } }).chunking
    if (ch?.count != null) payload_enc_chunk_count = ch.count
    else if (Array.isArray((pe as { chunks?: unknown[] }).chunks)) {
      payload_enc_chunk_count = (pe as { chunks: unknown[] }).chunks.length
    }
  }
  let artefact_encrypted_chunk_total = 0
  const arts = o.artefactsEnc
  if (Array.isArray(arts)) {
    for (const a of arts) {
      if (a && typeof a === 'object' && 'chunking' in a) {
        const c = (a as { chunking?: { count?: number } }).chunking
        if (c?.count) artefact_encrypted_chunk_total += c.count
      }
    }
  }
  return {
    note,
    ...(payload_enc_chunk_count != null ? { payload_enc_chunk_count } : {}),
    ...(artefact_encrypted_chunk_total > 0 ? { artefact_encrypted_chunk_total } : {}),
  }
}

export function buildOutboundRequestDebugSnapshot(
  route: 'coordination' | 'direct',
  targetUrl: string,
  capsule: object,
  bodyUtf8: string,
  contentType: string,
  httpStatus: number,
  responseSnippet: string | undefined,
  transportError?: string,
): OutboundRequestDebugSnapshot {
  const ct = (contentType || '').trim() || 'application/json'
  const coordinationHint =
    route === 'coordination' ? analyzeCoordinationRoutingCompliance(capsule) : null
  const relayNorm = route === 'coordination' ? describeCoordinationRelayNormalization(capsule) : null
  const serializedRelay = route === 'coordination' ? analyzeSerializedCoordinationContract(bodyUtf8) : null
  const relayHint =
    route === 'coordination' && responseSnippet
      ? parseRelayCapsuleTypeNotAllowedHint(responseSnippet)
      : undefined
  const relayMatchesWire =
    serializedRelay != null ? serializedRelay.relay_validator_contract_matches : relayNorm?.relay_envelope_matches_expectations
  return {
    route,
    url: targetUrl,
    method: 'POST',
    content_type: ct,
    content_length_bytes: Buffer.byteLength(bodyUtf8, 'utf8'),
    body_type: 'json_string',
    top_level_keys: extractTopLevelKeysFromJsonBody(bodyUtf8),
    body_looks_double_encoded: detectBodyLooksDoubleEncoded(bodyUtf8),
    request_shape: describeOutboundPayloadForLogs(capsule),
    http_status: httpStatus,
    canon_chunking_summary: summarizeCanonChunkingForOutboundDebug(capsule),
    ...(route === 'coordination' ? { coordination_single_post_json: true as const } : {}),
    ...(coordinationHint
      ? {
          expected_coordination_routing_keys: coordinationHint.expected_coordination_routing_keys,
          missing_coordination_top_level_fields: coordinationHint.missing_coordination_top_level_fields,
        }
      : {}),
    ...(relayNorm
      ? {
          coordination_source_format: relayNorm.coordination_source_format,
          coordination_normalized_shape: relayNorm.coordination_normalized_shape,
          derived_relay_capsule_type: relayNorm.derived_relay_capsule_type,
        }
      : {}),
    ...(serializedRelay
      ? {
          relay_capsule_type_field_name: serializedRelay.relay_capsule_type_field_name,
          serialized_capsule_type_field_present: serializedRelay.serialized_capsule_type_field_present,
          serialized_capsule_type_value: serializedRelay.serialized_capsule_type_value,
          relay_validator_contract_matches: serializedRelay.relay_validator_contract_matches,
        }
      : {}),
    ...(relayNorm || serializedRelay
      ? {
          relay_envelope_matches_expectations:
            relayMatchesWire !== undefined ? relayMatchesWire : relayNorm?.relay_envelope_matches_expectations,
        }
      : {}),
    ...(relayHint ? { relay_allowed_types_from_response: relayHint } : {}),
    ...(responseSnippet && responseSnippet.length > 0 ? { response_body_snippet: responseSnippet } : {}),
    ...(transportError ? { transport_error: transportError } : {}),
  }
}

function logOutboundRequestFailureDiagnostics(
  snapshot: OutboundRequestDebugSnapshot,
): void {
  console.info(
    '[P2P-OUTBOUND]',
    JSON.stringify({
      event: 'outbound_request_diagnostics',
      ...snapshot,
    }),
  )
}

/** Truncate and redact patterns that may appear in JSON error bodies; never log raw tokens. */
export function sanitizeHttpResponseBodyForLogs(text: string, maxLen = 400): string {
  if (!text || typeof text !== 'string') return ''
  let s = text
    .replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [redacted]')
    .replace(/\baccess_token["':\s]+[^"'\s,}\]]+/gi, 'access_token=[redacted]')
    .replace(/\brefresh_token["':\s]+[^"'\s,}\]]+/gi, 'refresh_token=[redacted]')
    .replace(/\bpassword["':\s]+[^"'\s,}\]]+/gi, 'password=[redacted]')
  if (s.length > maxLen) s = s.slice(0, maxLen) + '…'
  return s.trim()
}

function parseRetryAfterSeconds(response: Response): number | undefined {
  const raw = response.headers.get('retry-after')
  if (!raw) return undefined
  const n = parseInt(raw.trim(), 10)
  if (!Number.isNaN(n) && n >= 0) return n
  return undefined
}

/**
 * POST a capsule to the wrdesk.com Coordination Service.
 * Uses OIDC token for auth. The service looks up the handshake in its registry.
 *
 * @param capsule - Serializable capsule object (will be JSON.stringify'd)
 * @param coordinationUrl - Base URL e.g. https://coordination.wrdesk.com (will append /beap/capsule)
 * @param oidcToken - OIDC access token for Authorization: Bearer
 * @param queueHandshakeId - Handshake id for this outbound row; merged as top-level `handshake_id` for coordination routing
 */
export async function sendCapsuleViaCoordination(
  capsule: object,
  coordinationUrl: string,
  oidcToken: string,
  queueHandshakeId: string,
  db?: any,
): Promise<SendCapsuleResult> {
  const base = coordinationUrl.replace(/\/$/, '')
  const targetEndpoint = `${base}/beap/capsule`
  const payload = buildCoordinationCapsulePostBody(capsule, queueHandshakeId) as Record<string, unknown>
  // Same-account (internal) relay routing uses initiator_device_id / acceptor_device_id; the service
  // needs sender_device_id on the POST body to pick the correct peer when userIds match.
  let senderDeviceId: string | undefined
  try {
    const id = getInstanceId()?.trim()
    if (id) senderDeviceId = id
  } catch {
    /* Vitest / non-Electron: orchestrator store may be unavailable */
  }
  if (senderDeviceId) payload.sender_device_id = senderDeviceId

  if (db) {
    applyContextSyncInternalRoutingFromRecord(db, queueHandshakeId, payload)
    const v = validateCoordinationInternalPayloadBeforePost(db, queueHandshakeId, payload)
    if (!v.ok) {
      const errJson = formatLocalInternalRelayValidationJson({
        phase: 'coordination_pre_http',
        invariant: v.invariant,
        message: v.message,
        missing_fields: v.missing_fields,
      })
      const bodyUtf8 = JSON.stringify(payload)
      const snapshot = buildOutboundRequestDebugSnapshot(
        'coordination',
        targetEndpoint,
        payload,
        bodyUtf8,
        'application/json',
        0,
        undefined,
        errJson,
      )
      logOutboundRequestFailureDiagnostics(snapshot)
      console.warn('[P2P] Coordination send blocked by local internal relay validation', queueHandshakeId)
      return {
        success: false,
        error: errJson,
        localRelayValidationFailed: true,
        localRelayValidation: {
          phase: 'coordination_pre_http',
          invariant: v.invariant,
          message: v.message,
          missing_fields: v.missing_fields,
        },
        outboundDebug: snapshot,
      }
    }
  }

  console.log('[OUTBOUND-DEBUG] Sending capsule with sender_device_id:', senderDeviceId ?? '(none)', 'handshake:', queueHandshakeId)
  return sendCapsuleViaHttpWithAuth(payload, targetEndpoint, oidcToken)
}

async function sendCapsuleViaHttpWithAuth(
  capsule: object,
  targetEndpoint: string,
  bearerToken: string,
): Promise<SendCapsuleResult> {
  const body = JSON.stringify(capsule)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${bearerToken.trim()}`,
  }

  try {
    const response = await fetch(targetEndpoint, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    })

    clearTimeout(timeout)

    const responseText = await response.text()
    console.log('[RELAY-POST] URL:', targetEndpoint)
    console.log('[RELAY-POST] Body:', JSON.stringify(capsule, null, 2))
    console.log('[RELAY-POST] Response status:', response.status)
    console.log('[RELAY-POST] Response body:', responseText.slice(0, 8000))

    console.log('[HANDSHAKE-DEBUG] Sending to relay:', targetEndpoint, 'status:', response.status)

    if (response.status === 200) {
      console.log('[P2P] Coordination delivery OK (live push)', { endpoint: targetEndpoint, status: response.status })
      return {
        success: true,
        statusCode: 200,
        coordinationRelayDelivery: 'pushed_live',
      }
    }
    if (response.status === 202) {
      console.log('[P2P] Coordination delivery OK (recipient offline, queued)', {
        endpoint: targetEndpoint,
        status: response.status,
      })
      return {
        success: true,
        statusCode: 202,
        coordinationRelayDelivery: 'queued_recipient_offline',
      }
    }

    const retryAfterSec = parseRetryAfterSeconds(response)
    console.warn('[P2P] Coordination delivery failed', { endpoint: targetEndpoint, status: response.status })
    let responseBodySnippet: string | undefined
    if (!response.ok) {
      responseBodySnippet = sanitizeHttpResponseBodyForLogs(responseText)
      console.log('[P2P-DEBUG] Error body:', responseBodySnippet)
    }
    const snapshot = buildOutboundRequestDebugSnapshot(
      'coordination',
      targetEndpoint,
      capsule,
      body,
      headers['Content-Type'] ?? 'application/json',
      response.status,
      responseBodySnippet,
    )
    logOutboundRequestFailureDiagnostics(snapshot)
    const errMsg = `HTTP ${response.status}`
    return {
      success: false,
      error: errMsg,
      statusCode: response.status,
      outboundDebug: snapshot,
      ...(retryAfterSec !== undefined && { retryAfterSec }),
      ...(responseBodySnippet && { responseBodySnippet }),
    }
  } catch (err: any) {
    clearTimeout(timeout)
    const errMsg = err?.message ?? err?.name ?? String(err)
    console.warn('[P2P] Coordination delivery error', { endpoint: targetEndpoint, error: errMsg })
    const snapshot = buildOutboundRequestDebugSnapshot(
      'coordination',
      targetEndpoint,
      capsule,
      body,
      'application/json',
      0,
      undefined,
      errMsg,
    )
    logOutboundRequestFailureDiagnostics(snapshot)
    return { success: false, error: errMsg, outboundDebug: snapshot }
  }
}

/**
 * POST a capsule to the target ingestion endpoint.
 *
 * @param capsule - Serializable capsule object (will be JSON.stringify'd)
 * @param targetEndpoint - Full URL e.g. https://host:port/beap/ingest
 * @param handshakeId - For logging and X-BEAP-Handshake header
 * @param bearerToken - Counterparty's p2p auth token for Authorization: Bearer
 */
export async function sendCapsuleViaHttp(
  capsule: object,
  targetEndpoint: string,
  handshakeId: string,
  bearerToken?: string | null,
): Promise<SendCapsuleResult> {
  if (!targetEndpoint || typeof targetEndpoint !== 'string') {
    return { success: false, error: 'targetEndpoint is required' }
  }
  const trimmed = targetEndpoint.trim()
  if (trimmed.length === 0) {
    return { success: false, error: 'targetEndpoint is required' }
  }

  const body = JSON.stringify(capsule)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

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
      body,
      signal: controller.signal,
    })

    clearTimeout(timeout)

    const responseText = await response.text()
    console.log('[RELAY-POST] URL:', trimmed)
    try {
      console.log('[RELAY-POST] Body:', JSON.stringify(JSON.parse(body), null, 2))
    } catch {
      console.log('[RELAY-POST] Body:', body.slice(0, 8000))
    }
    console.log('[RELAY-POST] Response status:', response.status)
    console.log('[RELAY-POST] Response body:', responseText.slice(0, 8000))

    console.log('[HANDSHAKE-DEBUG] Sending to relay:', trimmed, 'status:', response.status)

    if (response.status === 200) {
      console.log('[P2P] Context-sync delivered', { handshake_id: handshakeId, endpoint: trimmed })
      return { success: true }
    }

    const retryAfterSec = parseRetryAfterSeconds(response)
    console.warn('[P2P] Context-sync delivery failed', { handshake_id: handshakeId, endpoint: trimmed, status: response.status })
    const responseBodySnippet = sanitizeHttpResponseBodyForLogs(responseText)
    const snapshot = buildOutboundRequestDebugSnapshot(
      'direct',
      trimmed,
      capsule,
      body,
      headers['Content-Type'] ?? 'application/json',
      response.status,
      responseBodySnippet.length > 0 ? responseBodySnippet : undefined,
    )
    logOutboundRequestFailureDiagnostics(snapshot)
    const errMsg = `HTTP ${response.status}`
    return {
      success: false,
      error: errMsg,
      statusCode: response.status,
      outboundDebug: snapshot,
      ...(retryAfterSec !== undefined && { retryAfterSec }),
      ...(responseBodySnippet.length > 0 && { responseBodySnippet }),
    }
  } catch (err: any) {
    clearTimeout(timeout)
    const errMsg = err?.message ?? err?.name ?? String(err)
    console.warn('[P2P] Context-sync delivery error', { handshake_id: handshakeId, endpoint: trimmed, error: errMsg })
    const snapshot = buildOutboundRequestDebugSnapshot(
      'direct',
      trimmed,
      capsule,
      body,
      'application/json',
      0,
      undefined,
      errMsg,
    )
    logOutboundRequestFailureDiagnostics(snapshot)
    return { success: false, error: errMsg, outboundDebug: snapshot }
  }
}
