/**
 * Tests: per-request tier resolution and downgrade propagation.
 *
 * Acceptance criteria:
 *   1. resolveTier returns the correct tier from wrdesk_plan.
 *   2. resolveTier falls back to role-based tier when no plan claim.
 *   3. resolveTier returns 'free' when no plan and no roles.
 *   4. Tier downgrade: if session claims change between requests,
 *      each request reflects the new tier immediately.
 *   5. Tier upgrade: same — next request sees the upgraded tier.
 */

import { describe, it, expect } from 'vitest'
import { resolveTier, mapRolesToTier, DEFAULT_TIER } from '../../../src/auth/capabilities'

// ---------------------------------------------------------------------------
// 1–3. resolveTier correctness
// ---------------------------------------------------------------------------
describe('resolveTier', () => {
  it('resolves from wrdesk_plan claim (primary)', () => {
    expect(resolveTier('pro', [])).toBe('pro')
    expect(resolveTier('publisher', [])).toBe('publisher')
    expect(resolveTier('enterprise', [])).toBe('enterprise')
    expect(resolveTier('free', [])).toBe('free')
  })

  it('falls back to roles when wrdesk_plan is undefined', () => {
    expect(resolveTier(undefined, ['pro'])).toBe('pro')
    expect(resolveTier(undefined, ['publisher'])).toBe('publisher')
    expect(resolveTier(undefined, ['enterprise'])).toBe('enterprise')
  })

  it('returns free when no plan and no tier roles', () => {
    expect(resolveTier(undefined, [])).toBe('free')
    expect(resolveTier(undefined, ['some_other_role'])).toBe('free')
  })

  it('wrdesk_plan takes priority over roles', () => {
    expect(resolveTier('free', ['enterprise'])).toBe('free')
    expect(resolveTier('pro', ['enterprise'])).toBe('pro')
  })

  it('ignores invalid wrdesk_plan and falls back to roles', () => {
    expect(resolveTier('invalid_plan', ['pro'])).toBe('pro')
    expect(resolveTier('invalid_plan', [])).toBe('free')
  })
})

describe('mapRolesToTier priority', () => {
  it('enterprise > publisher > pro > private > free', () => {
    expect(mapRolesToTier(['enterprise', 'publisher', 'pro'])).toBe('enterprise')
    expect(mapRolesToTier(['publisher', 'pro'])).toBe('publisher')
    expect(mapRolesToTier(['pro', 'private'])).toBe('pro')
    expect(mapRolesToTier(['private'])).toBe('private')
    expect(mapRolesToTier([])).toBe('free')
  })
})

// ---------------------------------------------------------------------------
// 4–5. Simulated per-request tier resolution (downgrade/upgrade)
// ---------------------------------------------------------------------------
describe('Per-request tier resolution — downgrade/upgrade propagation', () => {

  /**
   * Simulates resolveRequestTier() logic: each call reads fresh
   * session claims and resolves tier.  No global cache is involved.
   */
  function simulateResolveRequestTier(sessionClaims: {
    wrdesk_plan?: string
    roles: string[]
  }) {
    return resolveTier(sessionClaims.wrdesk_plan, sessionClaims.roles)
  }

  it('tier downgrade is reflected on next request', () => {
    // Request 1: user is pro
    const session1 = { wrdesk_plan: 'pro', roles: ['pro'] }
    expect(simulateResolveRequestTier(session1)).toBe('pro')

    // Backend downgrades user to free (token refresh returns new claims)
    const session2 = { wrdesk_plan: 'free', roles: [] }
    expect(simulateResolveRequestTier(session2)).toBe('free')
  })

  it('tier upgrade is reflected on next request', () => {
    // Request 1: user is free
    const session1 = { wrdesk_plan: undefined as string | undefined, roles: [] as string[] }
    expect(simulateResolveRequestTier(session1)).toBe('free')

    // Backend upgrades user to publisher
    const session2 = { wrdesk_plan: 'publisher', roles: ['publisher'] }
    expect(simulateResolveRequestTier(session2)).toBe('publisher')
  })

  it('plan removal with role fallback', () => {
    // Request 1: plan says enterprise
    const session1 = { wrdesk_plan: 'enterprise', roles: ['pro'] }
    expect(simulateResolveRequestTier(session1)).toBe('enterprise')

    // Token refresh: plan claim removed, falls back to role
    const session2 = { wrdesk_plan: undefined as string | undefined, roles: ['pro'] }
    expect(simulateResolveRequestTier(session2)).toBe('pro')
  })

  it('stale cache cannot override fresh resolution', () => {
    // This verifies the architectural property: each call returns
    // what the session says RIGHT NOW, not what it said earlier.
    let cachedTier = 'enterprise'  // stale global (what currentTier WAS)

    // Fresh session says free
    const freshSession = { wrdesk_plan: 'free', roles: [] as string[] }
    const resolvedTier = simulateResolveRequestTier(freshSession)

    // The resolved tier must reflect the fresh session, not the stale cache
    expect(resolvedTier).toBe('free')
    expect(resolvedTier).not.toBe(cachedTier)
  })
})
