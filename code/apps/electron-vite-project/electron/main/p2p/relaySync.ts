/**
 * Relay Sync — Register handshakes with remote relay or wrdesk.com Coordination Service.
 *
 * When use_coordination: register with coordination service (OIDC auth).
 * When relay_mode=remote: register with own relay (Bearer secret).
 */

import { getP2PConfig } from './p2pConfig'

/** Decode JWT payload for debug — returns aud value or null */
function decodeJwtAud(token: string): string | string[] | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const json = Buffer.from(parts[1], 'base64url').toString('utf8')
    const payload = JSON.parse(json) as Record<string, unknown>
    return (payload.aud as string | string[] | null) ?? null
  } catch {
    return null
  }
}

export async function registerHandshakeWithRelay(
  db: any,
  handshakeId: string,
  expectedToken: string,
  counterpartyEmail: string,
  getOidcToken?: () => Promise<string | null>,
  handshakeDetails?: {
    initiator_user_id: string
    acceptor_user_id: string
    initiator_email?: string
    acceptor_email?: string
  },
): Promise<{ success: boolean; error?: string }> {
  if (!db) return { success: false, error: 'No database' }

  const config = getP2PConfig(db)
  if (config.relay_mode === 'disabled') {
    return { success: true }
  }

  if (config.use_coordination && getOidcToken && handshakeDetails) {
    const token = await getOidcToken()
    const coordUrl = config.coordination_url?.trim()
    if (!token?.trim() || !coordUrl) {
      return { success: false, error: !token ? 'No OIDC token' : 'Coordination URL not configured' }
    }
    const aud = decodeJwtAud(token)
    console.log('[P2P-DEBUG] Register handshake — token aud:', aud ?? '(absent) — relay expects COORD_OIDC_AUDIENCE to match')
    const base = coordUrl.replace(/\/$/, '')
    const registerUrl = `${base}/beap/register-handshake`
    try {
      const res = await fetch(registerUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          handshake_id: handshakeId,
          initiator_user_id: handshakeDetails.initiator_user_id,
          acceptor_user_id: handshakeDetails.acceptor_user_id,
          initiator_email: handshakeDetails.initiator_email ?? undefined,
          acceptor_email: handshakeDetails.acceptor_email ?? undefined,
        }),
      })
      if (!res.ok) {
        const text = await res.text()
        console.error('[Coordination] Register handshake failed:', res.status, text)
        console.log('[P2P-DEBUG] Register failed — handshake_id:', handshakeId, 'status:', res.status, 'body:', text)
        return { success: false, error: res.status === 401 ? 'Auth failed' : `HTTP ${res.status}` }
      }
      console.log('[P2P-DEBUG] Register handshake OK:', handshakeId)
      return { success: true }
    } catch (err: any) {
      const msg = err?.message ?? String(err)
      console.error('[Coordination] Register handshake error:', msg)
      return { success: false, error: msg }
    }
  }

  if (config.relay_mode === 'local') {
    return { success: true }
  }

  const relayUrl = config.relay_url?.trim()
  const authSecret = config.relay_auth_secret?.trim()
  if (!relayUrl || !authSecret) {
    return { success: false, error: 'Relay URL or auth secret not configured' }
  }

  const registerUrl = relayUrl.replace(/\/ingest\/?$/, '/register-handshake')
  if (registerUrl === relayUrl) {
    return { success: false, error: 'relay_url must end with /ingest' }
  }

  try {
    const res = await fetch(registerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authSecret}`,
      },
      body: JSON.stringify({
        handshake_id: handshakeId,
        expected_token: expectedToken,
        counterparty_email: counterpartyEmail,
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      console.error('[Relay] Register handshake failed:', res.status, text)
      return { success: false, error: res.status === 401 ? 'Relay auth failed' : `HTTP ${res.status}` }
    }

    return { success: true }
  } catch (err: any) {
    const msg = err?.message ?? String(err)
    console.error('[Relay] Register handshake error:', msg)
    return { success: false, error: msg }
  }
}
