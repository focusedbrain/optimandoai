/**
 * OAuth 2.0 token exchange (RFC 8693) — edge attestation and other audiences.
 */

import { createHmac } from 'node:crypto'
import type { OidcConfig } from './types.js'

export interface TokenExchangeResult {
  readonly access_token: string
}

export interface TokenExchangeExtraParams {
  readonly edge_pod_id?: string
  readonly edge_pubkey?: string
  readonly [key: string]: string | undefined
}

const TOKEN_EXCHANGE_GRANT = 'urn:ietf:params:oauth:grant-type:token-exchange'
const ACCESS_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:access_token'

export const DEFAULT_ATTESTATION_AUDIENCE = 'beap-edge-attestation'

function normalizePublicKeyClaim(publicKeyHex: string): string {
  const trimmed = publicKeyHex.trim()
  return trimmed.startsWith('ed25519:') ? trimmed : `ed25519:${trimmed}`
}

/**
 * Exchange an SSO access token for a derived token (e.g. edge attestation JWT).
 */
export async function exchangeForAudience(
  config: OidcConfig,
  subjectToken: string,
  audience: string,
  extraParams?: TokenExchangeExtraParams,
): Promise<TokenExchangeResult> {
  if (!subjectToken.trim()) {
    throw new Error('SSO access token is required for token exchange')
  }

  const tokenUrl = `${config.issuer.replace(/\/$/, '')}/protocol/openid-connect/token`
  const body = new URLSearchParams({
    grant_type: TOKEN_EXCHANGE_GRANT,
    client_id: config.clientId,
    subject_token: subjectToken,
    subject_token_type: ACCESS_TOKEN_TYPE,
    requested_token_type: ACCESS_TOKEN_TYPE,
    audience,
  })

  if (extraParams) {
    for (const [k, v] of Object.entries(extraParams)) {
      if (v != null && v !== '') body.set(k, v)
    }
  }

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

  const access =
    (typeof json.access_token === 'string' && json.access_token) ||
    (typeof json.id_token === 'string' && json.id_token) ||
    null
  if (!access) {
    throw new Error('Keycloak token exchange did not return access_token')
  }
  return { access_token: access }
}

export async function requestEdgeAttestation(
  config: OidcConfig,
  publicKeyHex: string,
  podId: string,
  ssoAccessToken: string,
  options?: { stub?: boolean },
): Promise<{ jwt: string }> {
  if (options?.stub || process.env['BEAP_ATTESTATION_STUB'] === '1') {
    return { jwt: mintStubAttestationJwt(publicKeyHex, podId, ssoAccessToken) }
  }

  const { access_token } = await exchangeForAudience(
    config,
    ssoAccessToken,
    DEFAULT_ATTESTATION_AUDIENCE,
    {
      edge_pod_id: podId,
      edge_pubkey: normalizePublicKeyClaim(publicKeyHex),
    },
  )
  return { jwt: access_token }
}

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
