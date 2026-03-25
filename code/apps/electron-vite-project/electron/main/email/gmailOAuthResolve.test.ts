import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./googleOAuthBuiltin', () => ({
  getBuiltinGmailOAuthClientId: vi.fn(),
  isBuiltinGmailOAuthConfigured: vi.fn(),
  logOAuthDiagnostic: vi.fn(),
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

  it('builtin_public always uses built-in client id and ignores user-stored id', async () => {
    vi.mocked(getBuiltinGmailOAuthClientId).mockReturnValue('builtin.apps.googleusercontent.com')
    vi.mocked(getCredentialsForOAuth).mockResolvedValue({
      clientId: 'user-web.apps.googleusercontent.com',
      clientSecret: '',
    })
    const r = await resolveGmailOAuthForConnect('builtin_public')
    expect(r.authMode).toBe('pkce')
    expect(r.resolution).toBe('builtin')
    expect(r.clientId).toBe('builtin.apps.googleusercontent.com')
    expect(r.clientSecret).toBeUndefined()
  })

  it('builtin_public throws when built-in client is not configured', async () => {
    vi.mocked(getBuiltinGmailOAuthClientId).mockReturnValue(null)
    await expect(resolveGmailOAuthForConnect('builtin_public')).rejects.toThrow(/not configured/)
  })

  it('developer_saved prefers user legacy client id + secret', async () => {
    vi.mocked(getCredentialsForOAuth).mockResolvedValue({
      clientId: 'user.apps.googleusercontent.com',
      clientSecret: 'secret',
    })
    const r = await resolveGmailOAuthForConnect('developer_saved')
    expect(r.authMode).toBe('legacy_secret')
    expect(r.resolution).toBe('developer_legacy_secret')
    expect(r.clientId).toContain('user.apps')
    expect(r.clientSecret).toBe('secret')
  })

  it('developer_saved uses PKCE when only client id is stored (developer)', async () => {
    vi.mocked(getCredentialsForOAuth).mockResolvedValue({
      clientId: 'pub.apps.googleusercontent.com',
    })
    const r = await resolveGmailOAuthForConnect('developer_saved')
    expect(r.authMode).toBe('pkce')
    expect(r.resolution).toBe('developer_pkce')
    expect(r.clientSecret).toBeUndefined()
  })

  it('developer_saved uses builtin client when no user creds', async () => {
    vi.mocked(getBuiltinGmailOAuthClientId).mockReturnValue('builtin.apps.googleusercontent.com')
    vi.mocked(isBuiltinGmailOAuthConfigured).mockReturnValue(true)
    const r = await resolveGmailOAuthForConnect('developer_saved')
    expect(r.authMode).toBe('pkce')
    expect(r.resolution).toBe('builtin')
    expect(r.clientId).toBe('builtin.apps.googleusercontent.com')
  })

  it('defaults to developer_saved when argument omitted', async () => {
    vi.mocked(getBuiltinGmailOAuthClientId).mockReturnValue('builtin.apps.googleusercontent.com')
    vi.mocked(isBuiltinGmailOAuthConfigured).mockReturnValue(true)
    const r = await resolveGmailOAuthForConnect()
    expect(r.clientId).toBe('builtin.apps.googleusercontent.com')
    expect(r.resolution).toBe('builtin')
  })

  it('throws when nothing is configured (developer_saved)', async () => {
    await expect(resolveGmailOAuthForConnect('developer_saved')).rejects.toThrow(/not configured/)
  })
})

describe('isBuiltinGmailOAuthAvailable', () => {
  it('reflects builtin id', () => {
    vi.mocked(isBuiltinGmailOAuthConfigured).mockReturnValue(true)
    expect(isBuiltinGmailOAuthAvailable()).toBe(true)
  })
})
