/**
 * Relay Sync — Register handshakes with remote relay.
 *
 * When host creates/accepts a handshake, register it with the relay
 * so the relay knows which tokens to expect from counterparties.
 */

import { getP2PConfig } from './p2pConfig'

export async function registerHandshakeWithRelay(
  db: any,
  handshakeId: string,
  expectedToken: string,
  counterpartyEmail: string,
): Promise<{ success: boolean; error?: string }> {
  if (!db) return { success: false, error: 'No database' }

  const config = getP2PConfig(db)
  if (config.relay_mode === 'disabled') {
    return { success: true }
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
