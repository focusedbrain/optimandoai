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
import {
  resolveGmailOAuthForConnect,
  isBuiltinGmailOAuthAvailable,
  defaultGmailOAuthCredentialSource,
} from './gmailOAuthResolve'

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

  it('omitted argument uses builtin_public when builtin is configured (ignores stale user id-only)', async () => {
    vi.mocked(getBuiltinGmailOAuthClientId).mockReturnValue('builtin.apps.googleusercontent.com')
    vi.mocked(isBuiltinGmailOAuthConfigured).mockReturnValue(true)
    vi.mocked(getCredentialsForOAuth).mockResolvedValue({
      clientId: 'stale-dev.apps.googleusercontent.com',
    })
    const r = await resolveGmailOAuthForConnect()
    expect(r.authMode).toBe('pkce')
    expect(r.resolution).toBe('builtin')
    expect(r.clientId).toBe('builtin.apps.googleusercontent.com')
    expect(r.clientSecret).toBeUndefined()
  })

  it('omitted argument uses developer_saved path when builtin is not configured', async () => {
    vi.mocked(isBuiltinGmailOAuthConfigured).mockReturnValue(false)
    vi.mocked(getBuiltinGmailOAuthClientId).mockReturnValue(null)
    vi.mocked(getCredentialsForOAuth).mockResolvedValue({
      clientId: 'onlydev.apps.googleusercontent.com',
    })
    const r = await resolveGmailOAuthForConnect()
    expect(r.authMode).toBe('pkce')
    expect(r.resolution).toBe('developer_pkce')
    expect(r.clientId).toBe('onlydev.apps.googleusercontent.com')
  })

  it('explicit developer_saved still uses stored id-only for PKCE when builtin exists', async () => {
    vi.mocked(getBuiltinGmailOAuthClientId).mockReturnValue('builtin.apps.googleusercontent.com')
    vi.mocked(isBuiltinGmailOAuthConfigured).mockReturnValue(true)
    vi.mocked(getCredentialsForOAuth).mockResolvedValue({
      clientId: 'advanced.apps.googleusercontent.com',
    })
    const r = await resolveGmailOAuthForConnect('developer_saved')
    expect(r.resolution).toBe('developer_pkce')
    expect(r.clientId).toBe('advanced.apps.googleusercontent.com')
  })

  it('throws when nothing is configured (developer_saved)', async () => {
    await expect(resolveGmailOAuthForConnect('developer_saved')).rejects.toThrow(/not configured/)
  })
})

describe('defaultGmailOAuthCredentialSource', () => {
  it('returns builtin_public when build has a built-in client id', () => {
    vi.mocked(isBuiltinGmailOAuthConfigured).mockReturnValue(true)
    expect(defaultGmailOAuthCredentialSource()).toBe('builtin_public')
  })

  it('returns developer_saved when built-in client is not configured', () => {
    vi.mocked(isBuiltinGmailOAuthConfigured).mockReturnValue(false)
    expect(defaultGmailOAuthCredentialSource()).toBe('developer_saved')
  })
})

describe('isBuiltinGmailOAuthAvailable', () => {
  it('reflects builtin id', () => {
    vi.mocked(isBuiltinGmailOAuthConfigured).mockReturnValue(true)
    expect(isBuiltinGmailOAuthAvailable()).toBe(true)
  })
})
