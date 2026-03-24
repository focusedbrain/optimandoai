import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./googleOAuthBuiltin', () => ({
  getBuiltinGmailOAuthClientId: vi.fn(),
  isBuiltinGmailOAuthConfigured: vi.fn(),
}))

vi.mock('./credentials', () => ({
  getCredentialsForOAuth: vi.fn(),
}))

import { getBuiltinGmailOAuthClientId, isBuiltinGmailOAuthConfigured } from './googleOAuthBuiltin'
import { getCredentialsForOAuth } from './credentials'
import { resolveGmailOAuthForConnect, isBuiltinGmailOAuthAvailable } from './gmailOAuthResolve'

describe('resolveGmailOAuthForConnect', () => {
  beforeEach(() => {
    vi.mocked(getBuiltinGmailOAuthClientId).mockReturnValue(null)
    vi.mocked(getCredentialsForOAuth).mockResolvedValue(null)
  })

  it('prefers user legacy client id + secret', async () => {
    vi.mocked(getCredentialsForOAuth).mockResolvedValue({
      clientId: 'user.apps.googleusercontent.com',
      clientSecret: 'secret',
    })
    const r = await resolveGmailOAuthForConnect()
    expect(r.authMode).toBe('legacy_secret')
    expect(r.clientId).toContain('user.apps')
    expect(r.clientSecret).toBe('secret')
  })

  it('uses PKCE when only client id is stored (developer)', async () => {
    vi.mocked(getCredentialsForOAuth).mockResolvedValue({
      clientId: 'pub.apps.googleusercontent.com',
    })
    const r = await resolveGmailOAuthForConnect()
    expect(r.authMode).toBe('pkce')
    expect(r.clientSecret).toBeUndefined()
  })

  it('uses builtin client when no user creds', async () => {
    vi.mocked(getBuiltinGmailOAuthClientId).mockReturnValue('builtin.apps.googleusercontent.com')
    vi.mocked(isBuiltinGmailOAuthConfigured).mockReturnValue(true)
    const r = await resolveGmailOAuthForConnect()
    expect(r.authMode).toBe('pkce')
    expect(r.clientId).toBe('builtin.apps.googleusercontent.com')
  })

  it('throws when nothing is configured', async () => {
    await expect(resolveGmailOAuthForConnect()).rejects.toThrow(/not configured/)
  })
})

describe('isBuiltinGmailOAuthAvailable', () => {
  it('reflects builtin id', () => {
    vi.mocked(isBuiltinGmailOAuthConfigured).mockReturnValue(true)
    expect(isBuiltinGmailOAuthAvailable()).toBe(true)
  })
})
