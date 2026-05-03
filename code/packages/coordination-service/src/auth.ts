/**
 * Coordination Service — OIDC token validation via auth.wrdesk.com
 * Fail-close: rejects on JWKS/storage failure. No fallback authentication.
 */

import * as jose from 'jose'
import { createHash } from 'node:crypto'
import type { StoreAdapter } from './store.js'
import { resolveRelayTier } from './tierResolution.js'

// Production startup guard — refuse to run with TEST_MODE in production
if (process.env.COORD_TEST_MODE === '1') {
  if (process.env.NODE_ENV === 'production') {
    console.error('FATAL: COORD_TEST_MODE is enabled in production. Refusing to start.')
    process.exit(1)
  }
  console.warn('⚠️  TEST_MODE active — auth is bypassed. Do not use in production.')
}

export interface ValidatedIdentity {
  userId: string
  email: string
  tier: string
}

const CACHE_TTL_MS = 5 * 60 * 1000

/**
 * Increment when the tier-resolution algorithm changes.
 * Old cache rows hash to unreachable keys and expire naturally via TTL;
 * no DB migration or operational coordination is needed at deploy time.
 * Exported so tests can verify the versioning invariant.
 */
export const RESOLVER_VERSION = 2

export interface AuthAdapter {
  extractBearerToken(authHeader: string | undefined): string | null
  validateOidcToken(token: string): Promise<ValidatedIdentity | null>
  checkJwksHealth(): Promise<boolean>
}

export function createAuth(
  store: StoreAdapter,
  config: { oidc_issuer: string; oidc_jwks_url: string; oidc_audience: string | null },
): AuthAdapter {
  let jwksCache: jose.JWTVerifyGetKey | null = null

  async function fetchJwks(jwksUrl: string): Promise<jose.JWTVerifyGetKey> {
    const res = await fetch(jwksUrl)
    if (!res.ok) throw new Error('Failed to fetch JWKS')
    const jwks = await res.json()
    return jose.createRemoteJWKSet(new URL(jwksUrl)) as unknown as jose.JWTVerifyGetKey
  }

  async function getJwks(jwksUrl: string): Promise<jose.JWTVerifyGetKey> {
    if (!jwksCache) jwksCache = await fetchJwks(jwksUrl)
    return jwksCache
  }

  function tokenHash(token: string): string {
    return createHash('sha256').update(`v${RESOLVER_VERSION}:${token}`).digest('hex')
  }

  function getCachedIdentity(tokenHashVal: string): ValidatedIdentity | null {
    try {
      const db = store.getDb()
      const row = db.prepare(
        `SELECT user_id, email, tier FROM coordination_token_cache
         WHERE token_hash = ? AND expires_at > ?`,
      ).get(tokenHashVal, new Date().toISOString()) as { user_id: string; email: string; tier: string } | undefined
      if (!row) return null
      return { userId: row.user_id, email: row.email, tier: row.tier }
    } catch {
      return null
    }
  }

  function cacheIdentity(hash: string, identity: ValidatedIdentity, ttlMs: number): void {
    const db = store.getDb()
    const now = new Date()
    const expires = new Date(now.getTime() + ttlMs).toISOString()
    db.prepare(
      `INSERT INTO coordination_token_cache (token_hash, user_id, email, tier, validated_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(token_hash) DO UPDATE SET user_id=excluded.user_id, email=excluded.email, tier=excluded.tier, validated_at=excluded.validated_at, expires_at=excluded.expires_at`,
    ).run(hash, identity.userId, identity.email, identity.tier, now.toISOString(), expires)
  }

  return {
    extractBearerToken(authHeader: string | undefined): string | null {
      if (!authHeader?.startsWith('Bearer ')) return null
      return authHeader.slice(7).trim() || null
    },

    async validateOidcToken(token: string): Promise<ValidatedIdentity | null> {
      if (process.env.COORD_TEST_MODE === '1' && token.startsWith('test-')) {
        const parts = token.slice(5).split('-')
        const userId = parts[0] || 'test-user'
        const tier = parts[1] || 'pro'
        return { userId, email: `${userId}@test.com`, tier }
      }

      const hash = tokenHash(token)
      const cached = getCachedIdentity(hash)
      if (cached) return cached

      try {
        const JWKS = await getJwks(config.oidc_jwks_url)
        const verifyOptions: jose.JWTVerifyOptions = { issuer: config.oidc_issuer }
        if (config.oidc_audience?.trim()) verifyOptions.audience = config.oidc_audience.trim()
        const { payload } = await jose.jwtVerify(token, JWKS, verifyOptions)

        const sub = payload.sub
        const email = typeof payload.email === 'string' ? payload.email : (payload.email as string[])?.[0] ?? ''
        const tier = resolveRelayTier(payload as Record<string, unknown>)

        if (!sub || typeof sub !== 'string') return null

        const identity: ValidatedIdentity = {
          userId: sub,
          email: email || (payload.preferred_username as string) || sub,
          tier,
        }

        cacheIdentity(hash, identity, CACHE_TTL_MS)
        return identity
      } catch {
        return null
      }
    },

    async checkJwksHealth(): Promise<boolean> {
      if (process.env.COORD_TEST_MODE === '1') return true
      try {
        await getJwks(config.oidc_jwks_url)
        return true
      } catch {
        return false
      }
    },
  }
}
