/**
 * Keycloak JWT validation for the network-facing orchestrator inference API.
 * Security-critical: signature, issuer, expiry (with skew), and audience are enforced.
 */

import type { NextFunction, Request, Response } from 'express'
import {
  createRemoteJWKSet,
  errors,
  jwtVerify,
  type JWTPayload,
} from 'jose'
import { oidc } from '../../../src/auth/oidcConfig'

/** Expected access-token signing algorithms (Keycloak defaults to RS256; PS256 may appear). */
const ALLOWED_ALGORITHMS = ['RS256', 'PS256'] as const

const JWKS_TTL_MS = 60 * 60 * 1000
const CLOCK_TOLERANCE_SEC = 30

const ISSUER = oidc.issuer
const EXPECTED_AUDIENCE = oidc.clientId

declare global {
  namespace Express {
    interface Request {
      /** Decoded JWT payload after successful `createJwtMiddleware` verification. */
      user?: OrchestratorJwtUser
    }
  }
}

/** Claims we read for authorization helpers (matches typical Keycloak access tokens). */
export interface OrchestratorJwtUser extends JWTPayload {
  sub?: string
  scope?: string
  realm_access?: { roles?: string[] }
}

interface OpenIdDiscoveryDocument {
  jwks_uri?: string
}

let jwksGetter: ReturnType<typeof createRemoteJWKSet> | null = null
let jwksLoadedAt = 0
let jwksLastError: string | null = null

function mapVerifyError(err: unknown): string {
  if (err instanceof errors.JWTExpired) return 'token_expired'
  if (err instanceof errors.JWTClaimValidationFailed) {
    const msg = err.message || ''
    if (/issuer/i.test(msg)) return 'issuer_mismatch'
    if (/audience/i.test(msg)) return 'invalid_audience'
    return 'claim_validation_failed'
  }
  if (err instanceof errors.JWSSignatureVerificationFailed) return 'signature_verification_failed'
  if (err instanceof errors.JWTInvalid) return 'malformed_token'
  if (err instanceof errors.JOSEError) return 'jwt_processing_error'
  return 'verification_failed'
}

async function fetchJwksUri(): Promise<string> {
  const discoveryUrl = `${ISSUER.replace(/\/$/, '')}/.well-known/openid-configuration`
  const res = await fetch(discoveryUrl, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    throw new Error(`openid_configuration_http_${res.status}`)
  }
  const doc = (await res.json()) as OpenIdDiscoveryDocument
  if (typeof doc.jwks_uri !== 'string' || !doc.jwks_uri) {
    throw new Error('missing_jwks_uri')
  }
  return doc.jwks_uri
}

/**
 * Load or rotate JWKS (1-hour TTL). On refresh failure, keeps previous keys if any; clears on initial failure.
 */
async function refreshJwksKeys(): Promise<void> {
  try {
    const jwksUri = await fetchJwksUri()
    jwksGetter = createRemoteJWKSet(new URL(jwksUri), {
      cooldownDuration: 30_000,
    })
    jwksLoadedAt = Date.now()
    jwksLastError = null
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    jwksLastError = message
    console.error('[jwtAuth] JWKS load failed:', message)
    if (jwksGetter) {
      // Keep existing keys; reset TTL so we do not refetch on every request until the next interval.
      jwksLoadedAt = Date.now()
    } else {
      console.error('[jwtAuth] No signing keys available yet; inference JWT routes will return 503')
    }
  }
}

async function ensureJwksReady(): Promise<boolean> {
  if (!jwksGetter) {
    await refreshJwksKeys()
    return jwksGetter != null
  }
  if (Date.now() - jwksLoadedAt >= JWKS_TTL_MS) {
    await refreshJwksKeys()
  }
  return jwksGetter != null
}

/**
 * Returns Express middleware that validates Bearer JWTs from Keycloak.
 * JWKS is loaded on first request (or when expired per 1h TTL). Startup never throws on discovery failure.
 */
export async function createJwtMiddleware(): Promise<(req: Request, res: Response, next: NextFunction) => void> {
  void refreshJwksKeys()

  return async function jwtAuthMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    const auth = req.headers.authorization
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) {
      console.warn('[jwtAuth] Rejected: missing Authorization bearer')
      res.status(401).json({ error: 'missing_token' })
      return
    }
    const token = auth.slice('Bearer '.length).trim()
    if (!token) {
      console.warn('[jwtAuth] Rejected: empty bearer token')
      res.status(401).json({ error: 'missing_token' })
      return
    }

    const ready = await ensureJwksReady()
    if (!ready || !jwksGetter) {
      console.warn('[jwtAuth] Rejected: JWKS unavailable', jwksLastError || '')
      res.status(503).json({ error: 'jwks_unavailable' })
      return
    }

    try {
      const { payload } = await jwtVerify(token, jwksGetter, {
        issuer: ISSUER,
        audience: EXPECTED_AUDIENCE,
        algorithms: [...ALLOWED_ALGORITHMS],
        clockTolerance: CLOCK_TOLERANCE_SEC,
      })

      req.user = payload as OrchestratorJwtUser
      const sub = typeof payload.sub === 'string' ? payload.sub : '(no sub)'
      console.log('[jwtAuth] Verified JWT', { sub, action: 'jwt_verified', path: req.path })
      next()
    } catch (err) {
      const detail = mapVerifyError(err)
      console.warn('[jwtAuth] Rejected:', detail)
      res.status(401).json({ error: 'invalid_token', detail })
    }
  }
}

/**
 * Middleware factory: requires a scope string in `scope` (space-separated) or in `realm_access.roles`.
 * Must run after `createJwtMiddleware`.
 */
export function requireScope(scope: string): (req: Request, res: Response, next: NextFunction) => void {
  return function scopeMiddleware(req: Request, res: Response, next: NextFunction): void {
    const user = req.user
    if (!user) {
      console.warn('[jwtAuth] requireScope: no user on request')
      res.status(401).json({ error: 'missing_token' })
      return
    }

    const fromScope =
      typeof user.scope === 'string'
        ? user.scope.split(/\s+/).filter(Boolean)
        : []

    const fromRoles = Array.isArray(user.realm_access?.roles) ? user.realm_access!.roles! : []

    const hasScope = fromScope.includes(scope) || fromRoles.includes(scope)
    if (!hasScope) {
      const sub = typeof user.sub === 'string' ? user.sub : '(no sub)'
      console.warn('[jwtAuth] Forbidden: missing scope', { sub, scope })
      res.status(403).json({ error: 'forbidden', detail: 'insufficient_scope' })
      return
    }

    next()
  }
}
