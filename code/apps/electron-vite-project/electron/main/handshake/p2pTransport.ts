/**
 * P2P HTTP Transport — Outbound capsule delivery to counterparty's ingestion endpoint.
 *
 * Sends context-sync capsules via HTTP POST to the counterparty's configured
 * p2p_endpoint (e.g. https://host:port/api/ingestion/ingest).
 *
 * Does NOT throw — returns { success, error } for queue/retry handling.
 */

const TIMEOUT_MS = 30_000

export interface SendCapsuleResult {
  success: boolean
  error?: string
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
    console.warn('[P2P] Coordination delivery failed', { endpoint: targetEndpoint, status: response.status })
    return { success: false, error: errMsg }
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
    console.warn('[P2P] Context-sync delivery failed', { handshake_id: handshakeId, endpoint: trimmed, status: response.status })
    return { success: false, error: errMsg }
  } catch (err: any) {
    clearTimeout(timeout)
    const errMsg = err?.message ?? err?.name ?? String(err)
    console.warn('[P2P] Context-sync delivery error', { handshake_id: handshakeId, endpoint: trimmed, error: errMsg })
    return { success: false, error: errMsg }
  }
}
