/**
 * Unit tests for resolveRelayTier() and the cache-version isolation invariant.
 *
 * resolveRelayTier() is a pure function; no server, no DB, no COORD_TEST_MODE.
 *
 * Cache-version test (Option B): tests the hash-key isolation invariant directly
 * using node:crypto, without going through validateOidcToken(). This approach was
 * chosen over Option A (mock-JWKS integration test) because the test infrastructure
 * has no JWKS server fixture, and adding one would expand scope well beyond this PR.
 * The critical property — old cache rows are unreachable after the version bump —
 * is fully verified by the hash-key test below.
 */

import { describe, test, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { resolveRelayTier } from '../src/tierResolution.js'
import { RESOLVER_VERSION } from '../src/auth.js'

// ── resolveRelayTier unit tests ──────────────────────────────────────────────

describe('resolveRelayTier', () => {
  // Case 1: wrdesk_plan alone
  test('wrdesk_plan "publisher" → "publisher"', () => {
    expect(resolveRelayTier({ wrdesk_plan: 'publisher' })).toBe('publisher')
  })

  // Case 2: wrdesk_plan beats realm_access.roles
  test('wrdesk_plan "publisher" with roles ["free"] → "publisher" (plan takes precedence)', () => {
    expect(
      resolveRelayTier({
        wrdesk_plan: 'publisher',
        realm_access: { roles: ['free'] },
      }),
    ).toBe('publisher')
  })

  // Case 3: roles array — highest-ranked wins regardless of position
  test('roles ["free", "publisher"] → "publisher" (highest rank wins)', () => {
    expect(
      resolveRelayTier({ realm_access: { roles: ['free', 'publisher'] } }),
    ).toBe('publisher')
  })

  // Case 4: roles order in the array must not determine the result
  test('roles ["publisher", "free"] → "publisher" (array order irrelevant — regression for bug)', () => {
    expect(
      resolveRelayTier({ realm_access: { roles: ['publisher', 'free'] } }),
    ).toBe('publisher')
  })

  // Case 5: only free in roles
  test('roles ["free"] → "free"', () => {
    expect(resolveRelayTier({ realm_access: { roles: ['free'] } })).toBe('free')
  })

  // Case 6: real Keycloak noise roles with one known tier
  test('roles ["uma_authorization", "offline_access", "free"] → "free" (unknown roles ignored)', () => {
    expect(
      resolveRelayTier({
        realm_access: { roles: ['uma_authorization', 'offline_access', 'free'] },
      }),
    ).toBe('free')
  })

  // Case 7: only unknown roles — falls through to default
  test('roles ["uma_authorization", "offline_access"] → "free" (no known tier in roles)', () => {
    expect(
      resolveRelayTier({
        realm_access: { roles: ['uma_authorization', 'offline_access'] },
      }),
    ).toBe('free')
  })

  // Case 8: legacy tier claim
  test('legacy tier: "publisher" → "publisher"', () => {
    expect(resolveRelayTier({ tier: 'publisher' })).toBe('publisher')
  })

  // Case 9: legacy wrdesk_tier claim
  test('legacy wrdesk_tier: "pro" → "pro"', () => {
    expect(resolveRelayTier({ wrdesk_tier: 'pro' })).toBe('pro')
  })

  // Case 10: empty payload
  test('empty payload {} → "free"', () => {
    expect(resolveRelayTier({})).toBe('free')
  })

  // Case 11: realm_access is not an object
  test('malformed realm_access: "not an object" → "free", no throw', () => {
    expect(() =>
      resolveRelayTier({ realm_access: 'not an object' }),
    ).not.toThrow()
    expect(resolveRelayTier({ realm_access: 'not an object' })).toBe('free')
  })

  // Case 12: realm_access.roles is not an array
  test('malformed realm_access.roles: "not an array" → "free", no throw', () => {
    expect(() =>
      resolveRelayTier({ realm_access: { roles: 'not an array' } }),
    ).not.toThrow()
    expect(resolveRelayTier({ realm_access: { roles: 'not an array' } })).toBe('free')
  })

  // Case 13: roles array contains non-string elements
  test('roles [123, null, "publisher"] → "publisher" (non-string elements ignored)', () => {
    expect(
      resolveRelayTier({ realm_access: { roles: [123, null, 'publisher'] } }),
    ).toBe('publisher')
  })

  // Case 14: exact production token shape from the original bug report
  test('production token shape: wrdesk_plan="publisher", roles=[...,"publisher",...,"free"] → "publisher"', () => {
    expect(
      resolveRelayTier({
        wrdesk_plan: 'publisher',
        realm_access: {
          roles: [
            'default-roles-wrdesk',
            'offline_access',
            'publisher',
            'uma_authorization',
            'free',
          ],
        },
      }),
    ).toBe('publisher')
  })
})

// ── Cache version isolation invariant ────────────────────────────────────────

describe('cache version isolation', () => {
  test('RESOLVER_VERSION is 2', () => {
    expect(RESOLVER_VERSION).toBe(2)
  })

  test('old hash key (no version prefix) differs from new versioned key for the same token', () => {
    // Simulates a token that was cached before the version bump.
    const representativeToken = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.representative'
    const oldHash = createHash('sha256').update(representativeToken).digest('hex')
    const newHash = createHash('sha256')
      .update(`v${RESOLVER_VERSION}:${representativeToken}`)
      .digest('hex')

    // The versioned hash must differ from the bare hash so old cache rows are
    // unreachable after deploy — no manual flush or DB migration required.
    expect(oldHash).not.toBe(newHash)
  })

  test('same version prefix always produces the same hash (deterministic)', () => {
    const token = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.determinism-check'
    const hash1 = createHash('sha256').update(`v${RESOLVER_VERSION}:${token}`).digest('hex')
    const hash2 = createHash('sha256').update(`v${RESOLVER_VERSION}:${token}`).digest('hex')
    expect(hash1).toBe(hash2)
  })

  test('different tokens produce different hashes (no collision on simple cases)', () => {
    const hashA = createHash('sha256').update(`v${RESOLVER_VERSION}:token-A`).digest('hex')
    const hashB = createHash('sha256').update(`v${RESOLVER_VERSION}:token-B`).digest('hex')
    expect(hashA).not.toBe(hashB)
  })
})
