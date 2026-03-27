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

export interface SendCapsuleResult {
  success: boolean
  error?: string
  statusCode?: number
  /** From HTTP Retry-After (seconds), when present */
  retryAfterSec?: number
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

    const errMsg = `HTTP ${response.status}`
    const retryAfterSec = parseRetryAfterSeconds(response)
    console.warn('[P2P] Coordination delivery failed', { endpoint: targetEndpoint, status: response.status })
    if (!response.ok) {
      const errBody = await response.text()
      console.log('[P2P-DEBUG] Error body:', errBody)
    }
    return {
      success: false,
      error: errMsg,
      statusCode: response.status,
      ...(retryAfterSec !== undefined && { retryAfterSec }),
    }
  } catch (err: any) {
    clearTimeout(timeout)
    const errMsg = err?.message ?? err?.name ?? String(err)
    console.warn('[P2P] Coordination delivery error', { endpoint: targetEndpoint, error: errMsg })
    return { success: false, error: errMsg }
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

    const errMsg = `HTTP ${response.status}`
    const retryAfterSec = parseRetryAfterSeconds(response)
    console.warn('[P2P] Context-sync delivery failed', { handshake_id: handshakeId, endpoint: trimmed, status: response.status })
    return {
      success: false,
      error: errMsg,
      statusCode: response.status,
      ...(retryAfterSec !== undefined && { retryAfterSec }),
    }
  } catch (err: any) {
    clearTimeout(timeout)
    const errMsg = err?.message ?? err?.name ?? String(err)
    console.warn('[P2P] Context-sync delivery error', { handshake_id: handshakeId, endpoint: trimmed, error: errMsg })
    return { success: false, error: errMsg }
  }
}
