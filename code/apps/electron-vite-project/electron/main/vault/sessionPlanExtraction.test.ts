/**
 * Tests: dual-token plan extraction and tier resolution.
 *
 * Verifies that plan is correctly detected from either id_token or access_token,
 * and that plan always overrides role fallback.
 */

import { describe, it, expect } from 'vitest'
import { extractUserInfoFromTokens } from '../../../src/auth/session'
import { resolveTier } from '../../../src/auth/capabilities'

/** Build a minimal JWT from payload (no signature verification in decode) */
function makeJwt(payload: Record<string, unknown>): string {
  const header = { alg: 'RS256', typ: 'JWT' }
  const parts = [
    Buffer.from(JSON.stringify(header)).toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    'signature',
  ]
  return parts.join('.')
}

/** Base payload for identity claims */
const BASE_PAYLOAD = {
  sub: 'test-user-123',
  email: 'test@example.com',
  name: 'Test User',
  iss: 'https://auth.wrdesk.com/realms/wrdesk',
}

describe('extractUserInfoFromTokens + resolveTier', () => {
  it('Scenario A: id_token has no plan, access_token has wrdesk_plan=publisher, roles=["pro"] → tier=publisher', () => {
    const idPayload = {
      ...BASE_PAYLOAD,
      realm_access: { roles: ['pro'] },
      resource_access: { 'wrdesk-orchestrator': { roles: ['pro'] } },
    }
    const accessPayload = {
      ...BASE_PAYLOAD,
      wrdesk_plan: 'publisher',
      realm_access: { roles: ['pro'] },
      resource_access: { 'wrdesk-orchestrator': { roles: ['pro'] } },
    }
    const tokens = {
      access_token: makeJwt(accessPayload),
      id_token: makeJwt(idPayload),
    }
    const userInfo = extractUserInfoFromTokens(tokens)
    expect(userInfo).not.toBeNull()
    expect(userInfo!.wrdesk_plan).toBe('publisher')
    const tier = resolveTier(userInfo!.wrdesk_plan, userInfo!.roles || [], userInfo!.sso_tier)
    expect(tier).toBe('publisher')
  })

  it('Scenario B: id_token has wrdesk_plan=publisher, roles=["pro"] → tier=publisher', () => {
    const idPayload = {
      ...BASE_PAYLOAD,
      wrdesk_plan: 'publisher',
      realm_access: { roles: ['pro'] },
      resource_access: { 'wrdesk-orchestrator': { roles: ['pro'] } },
    }
    const tokens = {
      access_token: makeJwt({ ...BASE_PAYLOAD, realm_access: { roles: ['pro'] } }),
      id_token: makeJwt(idPayload),
    }
    const userInfo = extractUserInfoFromTokens(tokens)
    expect(userInfo).not.toBeNull()
    expect(userInfo!.wrdesk_plan).toBe('publisher')
    const tier = resolveTier(userInfo!.wrdesk_plan, userInfo!.roles || [], userInfo!.sso_tier)
    expect(tier).toBe('publisher')
  })

  it('Scenario B (SSO fallback): plan missing, roles=["publisher"] → tier=publisher', () => {
    const payload = {
      ...BASE_PAYLOAD,
      realm_access: { roles: ['publisher'] },
      resource_access: { 'wrdesk-orchestrator': { roles: ['publisher'] } },
    }
    const tokens = {
      access_token: makeJwt(payload),
      id_token: makeJwt(payload),
    }
    const userInfo = extractUserInfoFromTokens(tokens)
    expect(userInfo).not.toBeNull()
    expect(userInfo!.wrdesk_plan).toBeUndefined()
    expect(userInfo!.sso_tier).toBe('publisher')
    const tier = resolveTier(userInfo!.wrdesk_plan, userInfo!.roles || [], userInfo!.sso_tier)
    expect(tier).toBe('publisher')
  })

  it('Scenario C: no plan claim, roles=["pro"] → tier=pro', () => {
    const payload = {
      ...BASE_PAYLOAD,
      realm_access: { roles: ['pro'] },
      resource_access: { 'wrdesk-orchestrator': { roles: ['pro'] } },
    }
    const tokens = {
      access_token: makeJwt(payload),
      id_token: makeJwt(payload),
    }
    const userInfo = extractUserInfoFromTokens(tokens)
    expect(userInfo).not.toBeNull()
    expect(userInfo!.wrdesk_plan).toBeUndefined()
    const tier = resolveTier(userInfo!.wrdesk_plan, userInfo!.roles || [], userInfo!.sso_tier)
    expect(tier).toBe('pro')
  })

  it('Scenario D: plan="pro" roles=["publisher"] → tier=publisher (higher tier wins)', () => {
    const payload = {
      ...BASE_PAYLOAD,
      wrdesk_plan: 'pro',
      realm_access: { roles: ['publisher'] },
      resource_access: { 'wrdesk-orchestrator': { roles: ['publisher'] } },
    }
    const tokens = {
      access_token: makeJwt(payload),
      id_token: makeJwt(payload),
    }
    const userInfo = extractUserInfoFromTokens(tokens)
    expect(userInfo).not.toBeNull()
    expect(userInfo!.wrdesk_plan).toBe('pro')
    expect(userInfo!.sso_tier).toBe('publisher')
    const tier = resolveTier(userInfo!.wrdesk_plan, userInfo!.roles || [], userInfo!.sso_tier)
    expect(tier).toBe('publisher')
  })

  it('Scenario E: plan=enterprise → tier=enterprise', () => {
    const payload = {
      ...BASE_PAYLOAD,
      wrdesk_plan: 'enterprise',
      realm_access: { roles: ['pro'] },
    }
    const tokens = {
      access_token: makeJwt(payload),
      id_token: makeJwt(payload),
    }
    const userInfo = extractUserInfoFromTokens(tokens)
    expect(userInfo).not.toBeNull()
    expect(userInfo!.wrdesk_plan).toBe('enterprise')
    const tier = resolveTier(userInfo!.wrdesk_plan, userInfo!.roles || [], userInfo!.sso_tier)
    expect(tier).toBe('enterprise')
  })

  it('access_token plan overrides id_token when both have plan (access has publisher)', () => {
    const idPayload = {
      ...BASE_PAYLOAD,
      wrdesk_plan: 'pro',
      realm_access: { roles: ['pro'] },
    }
    const accessPayload = {
      ...BASE_PAYLOAD,
      wrdesk_plan: 'publisher',
      realm_access: { roles: ['pro'] },
    }
    const tokens = {
      access_token: makeJwt(accessPayload),
      id_token: makeJwt(idPayload),
    }
    const userInfo = extractUserInfoFromTokens(tokens)
    expect(userInfo!.wrdesk_plan).toBe('publisher')
    expect(resolveTier(userInfo!.wrdesk_plan, userInfo!.roles || [], userInfo!.sso_tier)).toBe('publisher')
  })

  it('supports wrdesk-plan (hyphen) claim name', () => {
    const payload = {
      ...BASE_PAYLOAD,
      'wrdesk-plan': 'publisher',
      realm_access: { roles: ['pro'] },
    }
    const tokens = {
      access_token: makeJwt(payload),
      id_token: makeJwt({ ...BASE_PAYLOAD, realm_access: { roles: ['pro'] } }),
    }
    const userInfo = extractUserInfoFromTokens(tokens)
    expect(userInfo!.wrdesk_plan).toBe('publisher')
    expect(resolveTier(userInfo!.wrdesk_plan, userInfo!.roles || [], userInfo!.sso_tier)).toBe('publisher')
  })

  it('merges and deduplicates roles from both tokens', () => {
    const idPayload = {
      ...BASE_PAYLOAD,
      wrdesk_plan: 'publisher',
      realm_access: { roles: ['pro', 'publisher'] },
    }
    const accessPayload = {
      ...BASE_PAYLOAD,
      wrdesk_plan: 'publisher',
      realm_access: { roles: ['pro', 'publisher'] },
      resource_access: { 'wrdesk-orchestrator': { roles: ['publisher'] } },
    }
    const tokens = {
      access_token: makeJwt(accessPayload),
      id_token: makeJwt(idPayload),
    }
    const userInfo = extractUserInfoFromTokens(tokens)
    expect(userInfo!.roles).toContain('pro')
    expect(userInfo!.roles).toContain('publisher')
    expect(userInfo!.roles!.length).toBe(new Set([...userInfo!.roles!]).size)
  })

  it('works with access_token only (no id_token)', () => {
    const payload = {
      ...BASE_PAYLOAD,
      wrdesk_plan: 'publisher',
      realm_access: { roles: ['pro'] },
    }
    const tokens = {
      access_token: makeJwt(payload),
    }
    const userInfo = extractUserInfoFromTokens(tokens)
    expect(userInfo).not.toBeNull()
    expect(userInfo!.wrdesk_plan).toBe('publisher')
    expect(resolveTier(userInfo!.wrdesk_plan, userInfo!.roles || [], userInfo!.sso_tier)).toBe('publisher')
  })
})
