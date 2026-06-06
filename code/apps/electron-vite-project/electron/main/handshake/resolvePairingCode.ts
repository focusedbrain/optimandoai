/**
 * Resolve a peer's 6-digit internal pairing code to its orchestrator instance id
 * (== relay device id) via the coordination service.
 *
 * Why this exists: internal initiates that traverse the coordination relay must
 * carry a `receiver_device_id` on the wire and register an `acceptor_device_id`
 * so the relay's same-principal initiate guard
 * (`coordination-service/src/server.ts` initiate block) can resolve a route.
 * The renderer only knows the peer by its 6-digit pairing code, so the main
 * process resolves the code → peer `instance_id` here, scoped to the caller's
 * own account (the server never leaks instance ids across accounts).
 *
 * Fail-open: any failure (offline, code unregistered, 404) returns `null`; the
 * caller falls back to out-of-band delivery (email/file) exactly as before.
 * This function performs no DB writes and is side-effect free.
 */

import { getP2PConfig } from '../p2p/p2pConfig'

const SIX_DIGITS = /^\d{6}$/

export interface ResolvedPairingPeer {
  instance_id: string
  device_name?: string
}

export async function resolvePairingCodeViaCoordination(
  db: any,
  pairingCode: string,
  getOidcToken: () => Promise<string | null>,
): Promise<ResolvedPairingPeer | null> {
  const code = typeof pairingCode === 'string' ? pairingCode.trim() : ''
  if (!SIX_DIGITS.test(code)) return null
  if (!db) return null

  const config = getP2PConfig(db)
  if (!config.use_coordination) return null
  const coordUrl = config.coordination_url?.trim()
  if (!coordUrl) return null

  let token: string | null
  try {
    token = await getOidcToken()
  } catch {
    return null
  }
  if (!token?.trim()) return null

  const base = coordUrl.replace(/\/$/, '')
  const url = `${base}/api/coordination/resolve-pairing-code?code=${encodeURIComponent(code)}`

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      // 404 (unknown / cross-account), 400, 401, 503 — all fail-open to out-of-band.
      console.log('[PAIRING-RESOLVE] non-200 — falling back to out-of-band', { status: res.status })
      return null
    }
    const body = (await res.json()) as { instance_id?: unknown; device_name?: unknown }
    const instanceId = typeof body.instance_id === 'string' ? body.instance_id.trim() : ''
    if (!instanceId) return null
    return {
      instance_id: instanceId,
      device_name: typeof body.device_name === 'string' ? body.device_name : undefined,
    }
  } catch (e) {
    console.log('[PAIRING-RESOLVE] request failed — falling back to out-of-band', {
      error: e instanceof Error ? e.message : String(e),
    })
    return null
  }
}
