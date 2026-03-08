/**
 * Coordination Service — OIDC token validation via auth.wrdesk.com
 */

import * as jose from 'jose'

// Production startup guard — refuse to run with TEST_MODE in production
if (process.env.COORD_TEST_MODE === '1') {
  if (process.env.NODE_ENV === 'production') {
    console.error('FATAL: COORD_TEST_MODE is enabled in production. Refusing to start.')
    process.exit(1)
  }
  console.warn('⚠️  TEST_MODE active — auth is bypassed. Do not use in production.')
}

import { createHash } from 'node:crypto'
import { getDb } from './store.js'

export interface ValidatedIdentity {
  userId: string
  email: string
  tier: string
}

const CACHE_TTL_MS = 5 * 60 * 1000

async function fetchJwks(jwksUrl: string): Promise<jose.JWTVerifyGetKey> {
  const res = await fetch(jwksUrl)
  if (!res.ok) throw new Error('Failed to fetch JWKS')
  const jwks = await res.json()
  return jose.createRemoteJWKSet(new URL(jwksUrl)) as unknown as jose.JWTVerifyGetKey
}

let jwksCache: jose.JWTVerifyGetKey | null = null

async function getJwks(jwksUrl: string): Promise<jose.JWTVerifyGetKey> {
  if (!jwksCache) jwksCache = await fetchJwks(jwksUrl)
  return jwksCache
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function getCachedIdentity(tokenHash: string): ValidatedIdentity | null {
  const db = getDb()
  if (!db) return null
  const row = db.prepare(
    `SELECT user_id, email, tier FROM coordination_token_cache
     WHERE token_hash = ? AND expires_at > ?`,
  ).get(tokenHash, new Date().toISOString()) as { user_id: string; email: string; tier: string } | undefined
  if (!row) return null
  return { userId: row.user_id, email: row.email, tier: row.tier }
}

function cacheIdentity(hash: string, identity: ValidatedIdentity, ttlMs: number): void {
  const db = getDb()
  if (!db) return
  const now = new Date()
  const expires = new Date(now.getTime() + ttlMs).toISOString()
  db.prepare(
    `INSERT INTO coordination_token_cache (token_hash, user_id, email, tier, validated_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(token_hash) DO UPDATE SET user_id=excluded.user_id, email=excluded.email, tier=excluded.tier, validated_at=excluded.validated_at, expires_at=excluded.expires_at`,
  ).run(hash, identity.userId, identity.email, identity.tier, now.toISOString(), expires)
}

export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null
  return authHeader.slice(7).trim() || null
}

export async function validateOidcToken(
  token: string,
  issuer: string,
  jwksUrl: string,
  audience?: string | null,
): Promise<ValidatedIdentity | null> {
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
    const JWKS = await getJwks(jwksUrl)
    const verifyOptions: jose.JWTVerifyOptions = { issuer }
    if (audience?.trim()) verifyOptions.audience = audience.trim()
    const { payload } = await jose.jwtVerify(token, JWKS, verifyOptions);

    const sub = payload.sub
    const email = typeof payload.email === 'string' ? payload.email : (payload.email as string[])?.[0] ?? ''
    const tier = typeof payload.tier === 'string' ? payload.tier : (payload.wrdesk_tier as string) ?? 'free'

    if (!sub || typeof sub !== 'string') return null

    const identity: ValidatedIdentity = {
      userId: sub,
      email: email || (payload.preferred_username as string) || sub,
      tier: tier || 'free',
    }

    cacheIdentity(hash, identity, CACHE_TTL_MS)
    return identity
  } catch {
    return null
  }
}
