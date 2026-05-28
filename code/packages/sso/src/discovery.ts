import type { OidcConfig } from './types.js'

const CACHE_TTL_MS = 60 * 60 * 1000

export interface OidcDiscovery {
  authorization_endpoint: string
  token_endpoint: string
  end_session_endpoint?: string
  jwks_uri: string
  issuer: string
  revocation_endpoint?: string
  userinfo_endpoint?: string
}

export interface DiscoveryError {
  ok: false
  code: 'NETWORK_ERROR' | 'INVALID_RESPONSE' | 'MISSING_FIELDS' | 'ISSUER_MISMATCH'
  message: string
  details?: string
}

export interface DiscoverySuccess {
  ok: true
  discovery: OidcDiscovery
}

export type DiscoveryResult = DiscoverySuccess | DiscoveryError

const cacheByIssuer = new Map<string, { discovery: OidcDiscovery; at: number }>()

export function clearDiscoveryCacheForIssuer(issuer?: string): void {
  if (!issuer) {
    cacheByIssuer.clear()
    return
  }
  cacheByIssuer.delete(issuer.replace(/\/$/, ''))
}

export async function fetchDiscovery(
  config: OidcConfig,
  forceRefresh = false,
): Promise<DiscoveryResult> {
  const issuer = config.issuer.replace(/\/$/, '')
  const cached = cacheByIssuer.get(issuer)
  if (!forceRefresh && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { ok: true, discovery: cached.discovery }
  }

  const discoveryUrl = `${issuer}/.well-known/openid-configuration`

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10_000)
    const response = await fetch(discoveryUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    if (!response.ok) {
      return {
        ok: false,
        code: 'NETWORK_ERROR',
        message: 'Failed to fetch OIDC configuration',
        details: `HTTP ${response.status}: ${response.statusText}`,
      }
    }

    let raw: Record<string, unknown>
    try {
      raw = (await response.json()) as Record<string, unknown>
    } catch {
      return {
        ok: false,
        code: 'INVALID_RESPONSE',
        message: 'Invalid OIDC discovery response',
        details: 'Response is not valid JSON',
      }
    }

    const required = ['authorization_endpoint', 'token_endpoint', 'jwks_uri', 'issuer']
    const missing = required.filter((f) => !raw[f])
    if (missing.length > 0) {
      return {
        ok: false,
        code: 'MISSING_FIELDS',
        message: 'OIDC discovery response missing required fields',
        details: `Missing: ${missing.join(', ')}`,
      }
    }

    if (raw.issuer !== issuer) {
      return {
        ok: false,
        code: 'ISSUER_MISMATCH',
        message: 'OIDC issuer does not match expected value',
        details: `Expected: ${issuer}, Got: ${raw.issuer}`,
      }
    }

    const discovery: OidcDiscovery = {
      authorization_endpoint: raw.authorization_endpoint as string,
      token_endpoint: raw.token_endpoint as string,
      jwks_uri: raw.jwks_uri as string,
      issuer: raw.issuer as string,
      end_session_endpoint: raw.end_session_endpoint as string | undefined,
      revocation_endpoint: raw.revocation_endpoint as string | undefined,
      userinfo_endpoint: raw.userinfo_endpoint as string | undefined,
    }

    cacheByIssuer.set(issuer, { discovery, at: Date.now() })
    return { ok: true, discovery }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        ok: false,
        code: 'NETWORK_ERROR',
        message: 'OIDC discovery request timed out',
        details: 'Request took longer than 10 seconds',
      }
    }
    return {
      ok: false,
      code: 'NETWORK_ERROR',
      message: 'Failed to connect to identity provider',
      details: msg,
    }
  }
}

export async function getOidcDiscovery(config: OidcConfig): Promise<OidcDiscovery> {
  const result = await fetchDiscovery(config)
  if (!result.ok) {
    throw new Error(`${result.message}${result.details ? `: ${result.details}` : ''}`)
  }
  return result.discovery
}

export function getCachedDiscovery(config: OidcConfig): OidcDiscovery | null {
  const issuer = config.issuer.replace(/\/$/, '')
  const cached = cacheByIssuer.get(issuer)
  if (!cached || Date.now() - cached.at >= CACHE_TTL_MS) return null
  return cached.discovery
}
