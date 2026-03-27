/**
 * P2P HTTP Transport — Outbound capsule delivery to counterparty's ingestion endpoint.
 *
 * Sends context-sync capsules via HTTP POST to the counterparty's configured
 * p2p_endpoint (e.g. https://host:port/api/ingestion/ingest).
 *
 * Does NOT throw — returns { success, error } for queue/retry handling.
 */

const TIMEOUT_MS = 30_000

/** Decode JWT payload (middle segment) for debug logging. Returns null on parse error. */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payloadB64 = parts[1]
    const padded = payloadB64 + '='.repeat((4 - (payloadB64.length % 4)) % 4)
    const json = Buffer.from(padded, 'base64url').toString('utf8')
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * Summarizes outbound JSON body shape for logs (no values beyond keys / booleans).
 * Aligns with coordination `/beap/capsule`: accepts either a BEAP message package
 * (`header`+`metadata`+`envelope`|`payload`, no top-level `capsule_type`) or a
 * capsule envelope (`capsule_type` in accept|context_sync|refresh|revoke).
 */
export function describeOutboundPayloadForLogs(capsule: unknown): {
  value_kind: 'object' | 'other'
  top_level_keys: string[]
  has_top_level_handshake_id: boolean
  has_capsule_type_key: boolean
  looks_like_beap_message_package: boolean
  looks_like_relay_capsule_envelope: boolean
  has_message_header_receiver_binding_handshake_id: boolean
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
  const looks_like_beap_message_package =
    'header' in o &&
    'metadata' in o &&
    ('envelope' in o || 'payload' in o) &&
    !has_capsule_type_key
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
  return {
    value_kind: 'object',
    top_level_keys: keys.slice(0, 48),
    has_top_level_handshake_id,
    has_capsule_type_key,
    looks_like_beap_message_package,
    looks_like_relay_capsule_envelope,
    has_message_header_receiver_binding_handshake_id,
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
}

export interface SendCapsuleResult {
  success: boolean
  error?: string
  statusCode?: number
  /** From HTTP Retry-After (seconds), when present */
  retryAfterSec?: number
  /** Sanitized non-OK response body fragment for debugging (no secrets). */
  responseBodySnippet?: string
  /** Structured request/response diagnostics for terminal failures and debugging */
  outboundDebug?: OutboundRequestDebugSnapshot
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
 */
export async function sendCapsuleViaCoordination(
  capsule: object,
  coordinationUrl: string,
  oidcToken: string,
): Promise<SendCapsuleResult> {
  const base = coordinationUrl.replace(/\/$/, '')
  const targetEndpoint = `${base}/beap/capsule`
  return sendCapsuleViaHttpWithAuth(capsule, targetEndpoint, oidcToken)
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

  // P2P-DEBUG: temporary diagnostic logging for 401 / audience investigation
  const capsuleObj = capsule as { handshake_id?: string; capsule_type?: string }
  console.log('[P2P-DEBUG] Sending capsule to:', targetEndpoint, 'handshake_id:', capsuleObj.handshake_id, 'capsule_type:', capsuleObj.capsule_type)
  console.log('[P2P-DEBUG] Auth header present:', !!headers.Authorization)
  if (bearerToken?.trim()) {
    try {
      const payload = decodeJwtPayload(bearerToken.trim())
      if (payload) {
        const aud = payload.aud
        const audStr = typeof aud === 'string' ? aud : Array.isArray(aud) ? aud.join(',') : JSON.stringify(aud)
        console.log('[P2P-DEBUG] Token aud:', audStr ?? '(absent) — relay expects COORD_OIDC_AUDIENCE to match')
      }
    } catch {
      console.log('[P2P-DEBUG] Token first 20 chars:', bearerToken.substring(0, 20))
    }
  } else {
    console.log('[P2P-DEBUG] Token: null')
  }

  try {
    const response = await fetch(targetEndpoint, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (response.status === 200 || response.status === 202) {
      console.log('[P2P] Coordination delivery OK', { endpoint: targetEndpoint, status: response.status })
      return { success: true }
    }

    const retryAfterSec = parseRetryAfterSeconds(response)
    console.warn('[P2P] Coordination delivery failed', { endpoint: targetEndpoint, status: response.status })
    let responseBodySnippet: string | undefined
    if (!response.ok) {
      const errBody = await response.text()
      responseBodySnippet = sanitizeHttpResponseBodyForLogs(errBody)
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

    if (response.status === 200) {
      console.log('[P2P] Context-sync delivered', { handshake_id: handshakeId, endpoint: trimmed })
      return { success: true }
    }

    const retryAfterSec = parseRetryAfterSeconds(response)
    console.warn('[P2P] Context-sync delivery failed', { handshake_id: handshakeId, endpoint: trimmed, status: response.status })
    const errBody = await response.text()
    const responseBodySnippet = sanitizeHttpResponseBodyForLogs(errBody)
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
