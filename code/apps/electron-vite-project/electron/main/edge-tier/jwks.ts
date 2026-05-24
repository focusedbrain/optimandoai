/**
 * Keycloak JWKS fetch + cache — Phase 3 (P3.8).
 *
 * Preloaded into LOCAL_VERIFY verifier via KEYCLOAK_JWKS_JSON (P3.5 trade-off).
 * Refreshed on app start and on verification failure.
 */

import { fetchDiscovery } from '../../../src/auth/discovery.js'
import {
  loadEdgeTierSettings,
  saveEdgeTierSettings,
  type EdgeTierSettings,
} from './settings.js'

export interface JwksJson {
  keys: Record<string, unknown>[]
}

export function parseJwksResponse(body: unknown): JwksJson {
  if (typeof body !== 'object' || body === null || !Array.isArray((body as JwksJson).keys)) {
    throw new Error('Invalid JWKS: expected { keys: [...] }')
  }
  return body as JwksJson
}

/** Fetch JWKS from Keycloak discovery `jwks_uri`. */
export async function fetchJwks(): Promise<JwksJson> {
  const discovery = await fetchDiscovery()
  if (!discovery.ok) {
    throw new Error(`OIDC discovery failed: ${discovery.message}`)
  }
  const jwksUri = discovery.discovery.jwks_uri
  const res = await fetch(jwksUri)
  if (!res.ok) {
    throw new Error(`JWKS fetch failed: HTTP ${res.status}`)
  }
  const json = (await res.json()) as unknown
  return parseJwksResponse(json)
}

export function getCachedJwksJson(settings?: EdgeTierSettings): string | null {
  const s = settings ?? loadEdgeTierSettings()
  return s.cached_jwks_json ?? null
}

export async function refreshJwksCache(settings?: EdgeTierSettings): Promise<string> {
  const current = settings ?? loadEdgeTierSettings()
  const jwks = await fetchJwks()
  const json = JSON.stringify(jwks)
  const next: EdgeTierSettings = {
    ...current,
    cached_jwks_json: json,
    cached_jwks_fetched_at: new Date().toISOString(),
  }
  saveEdgeTierSettings(next)
  return json
}

/** Called on app start / vault unlock when edge tier may be enabled. */
export async function refreshJwksOnStartup(): Promise<string | null> {
  try {
    return await refreshJwksCache()
  } catch (err) {
    console.warn('[EDGE_TIER] JWKS refresh on startup failed:', (err as Error).message ?? err)
    return getCachedJwksJson()
  }
}

/** Called when LOCAL_VERIFY attestation verification fails (stale JWKS). */
export async function refreshJwksOnVerificationFailure(): Promise<string | null> {
  console.log('[EDGE_TIER] Refreshing JWKS after verification failure')
  try {
    return await refreshJwksCache()
  } catch (err) {
    console.error('[EDGE_TIER] JWKS refresh failed:', (err as Error).message ?? err)
    return null
  }
}
