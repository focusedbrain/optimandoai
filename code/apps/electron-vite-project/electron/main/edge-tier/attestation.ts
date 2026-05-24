/**
 * SSO attestation for edge pods — Phase 3 (P3.8).
 *
 * Decision 6 (Phase 3): OAuth 2.0 Token Exchange (RFC 8693) against Keycloak.
 * Keycloak must expose a token-exchange client/audience that returns a JWT with:
 *   sub, pod_id, edge_pubkey
 *
 * Dev stub: set BEAP_ATTESTATION_STUB=1 to mint a local HS256 JWT (tests/CI only).
 */

import { createHmac } from 'node:crypto'
import { oidc } from '../../../src/auth/oidcConfig.js'

export interface SsoAttestationResult {
  jwt: string
}

const TOKEN_EXCHANGE_GRANT = 'urn:ietf:params:oauth:grant-type:token-exchange'
const ACCESS_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:access_token'
/** Keycloak audience for BEAP edge attestation tokens (configure in realm). */
const ATTESTATION_AUDIENCE = 'beap-edge-attestation'

function normalizePublicKeyClaim(publicKeyHex: string): string {
  const trimmed = publicKeyHex.trim()
  return trimmed.startsWith('ed25519:') ? trimmed : `ed25519:${trimmed}`
}

/**
 * Request an SSO attestation JWT binding podId + edge public key to the user's sub.
 */
export async function requestSsoAttestation(
  publicKeyHex: string,
  podId: string,
  ssoToken: string,
): Promise<SsoAttestationResult> {
  if (!ssoToken || ssoToken.trim().length === 0) {
    throw new Error('SSO access token is required for attestation')
  }
  if (process.env['BEAP_ATTESTATION_STUB'] === '1') {
    return { jwt: mintStubAttestationJwt(publicKeyHex, podId, ssoToken) }
  }

  const tokenUrl = `${oidc.issuer.replace(/\/$/, '')}/protocol/openid-connect/token`
  const body = new URLSearchParams({
    grant_type: TOKEN_EXCHANGE_GRANT,
    client_id: oidc.clientId,
    subject_token: ssoToken,
    subject_token_type: ACCESS_TOKEN_TYPE,
    requested_token_type: ACCESS_TOKEN_TYPE,
    audience: ATTESTATION_AUDIENCE,
    // Keycloak custom parameters for attestation binding (map in Phase 4 wizard)
    edge_pod_id: podId,
    edge_pubkey: normalizePublicKeyClaim(publicKeyHex),
  })

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  const text = await res.text()
  if (!res.ok) {
    throw new Error(`Keycloak token exchange failed (${res.status}): ${text.slice(0, 200)}`)
  }

  let json: Record<string, unknown>
  try {
    json = JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error('Keycloak token exchange returned non-JSON response')
  }

  const jwt =
    (typeof json.access_token === 'string' && json.access_token) ||
    (typeof json.id_token === 'string' && json.id_token) ||
    null
  if (!jwt) {
    throw new Error('Keycloak token exchange did not return access_token')
  }
  return { jwt }
}

/** Smoke/dev only — NOT production Keycloak. */
function mintStubAttestationJwt(publicKeyHex: string, podId: string, ssoToken: string): string {
  const sub = decodeJwtSub(ssoToken) ?? 'stub-user'
  const keyBytes = Buffer.alloc(32, 9)
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: 'beap-stub' })).toString(
    'base64url',
  )
  const now = Math.floor(Date.now() / 1000)
  const payload = Buffer.from(
    JSON.stringify({
      sub,
      pod_id: podId,
      edge_pubkey: normalizePublicKeyClaim(publicKeyHex),
      iss: 'beap-attestation-stub',
      exp: now + 86400,
      iat: now,
    }),
  ).toString('base64url')
  const data = `${header}.${payload}`
  const sig = createHmac('sha256', keyBytes).update(data).digest('base64url')
  return `${data}.${sig}`
}

function decodeJwtSub(token: string): string | null {
  try {
    const parts = token.split('.')
    if (parts.length < 2) return null
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as {
      sub?: string
    }
    return typeof payload.sub === 'string' ? payload.sub : null
  } catch {
    return null
  }
}
