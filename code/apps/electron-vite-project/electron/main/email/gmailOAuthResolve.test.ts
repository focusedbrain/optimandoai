import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./googleOAuthBuiltin', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./googleOAuthBuiltin')>()
  return {
    ...actual,
    resolveBuiltinGoogleOAuthClientWithMeta: vi.fn(),
    isBuiltinGmailOAuthConfigured: vi.fn(),
    logOAuthDiagnostic: vi.fn(),
    assertBuiltinPublicClientMatchesShippedResource: vi.fn(),
  }
})

vi.mock('./credentials', () => ({
  getCredentialsForOAuth: vi.fn(),
}))

import * as googleOAuthBuiltin from './googleOAuthBuiltin'
import {
  resolveBuiltinGoogleOAuthClientWithMeta,
  assertBuiltinPublicClientMatchesShippedResource,
  isBuiltinGmailOAuthConfigured,
  logOAuthDiagnostic,
} from './googleOAuthBuiltin'
import { getCredentialsForOAuth } from './credentials'
import {
  resolveGmailOAuthForConnect,
  isBuiltinGmailOAuthAvailable,
  defaultGmailOAuthCredentialSource,
} from './gmailOAuthResolve'

function builtinMeta(
  clientId: string,
  overrides?: Partial<import('./googleOAuthBuiltin').BuiltinGoogleOAuthClientResolution>,
): import('./googleOAuthBuiltin').BuiltinGoogleOAuthClientResolution {
  return {
    clientId,
    sourceKind: 'packaged_resource_file',
    sourcePath: 'C:\\fake\\google-oauth-client-id.txt',
    sourceName: 'google-oauth-client-id.txt',
    isBuiltinAppOwned: true,
    fromBuildTimeInline: false,
    fromPackagedResourceFile: true,
    ...overrides,
  }
}

describe('resolveGmailOAuthForConnect', () => {
  beforeEach(() => {
    vi.mocked(resolveBuiltinGoogleOAuthClientWithMeta).mockReset()
    vi.mocked(resolveBuiltinGoogleOAuthClientWithMeta).mockReturnValue(null)
    vi.mocked(getCredentialsForOAuth).mockReset()
    vi.mocked(getCredentialsForOAuth).mockResolvedValue(null)
    vi.mocked(assertBuiltinPublicClientMatchesShippedResource).mockReset()
    vi.mocked(assertBuiltinPublicClientMatchesShippedResource).mockImplementation(() => {})
    vi.mocked(isBuiltinGmailOAuthConfigured).mockReset()
    vi.mocked(isBuiltinGmailOAuthConfigured).mockReturnValue(false)
    vi.mocked(logOAuthDiagnostic).mockClear()
  })

  it('builtin_public sets clientSecret when paired Desktop secret is resolved', async () => {
    const spy = vi
      .spyOn(googleOAuthBuiltin, 'resolveBuiltinGoogleOAuthClientSecret')
      .mockReturnValue('GOCSPX-paired-desktop-secret-xyz')
    try {
      vi.mocked(isBuiltinGmailOAuthConfigured).mockReturnValue(true)
      vi.mocked(resolveBuiltinGoogleOAuthClientWithMeta).mockReturnValue(
        builtinMeta('builtin.apps.googleusercontent.com'),
      )
      const r = await resolveGmailOAuthForConnect('builtin_public')
      expect(r.clientSecret).toBe('GOCSPX-paired-desktop-secret-xyz')
      expect(r.authMode).toBe('pkce')
    } finally {
      spy.mockRestore()
    }
  })

  it('builtin_public always uses built-in client id and ignores user-stored id', async () => {
    vi.mocked(isBuiltinGmailOAuthConfigured).mockReturnValue(true)
    vi.mocked(resolveBuiltinGoogleOAuthClientWithMeta).mockReturnValue(
      builtinMeta('builtin.apps.googleusercontent.com'),
    )
    vi.mocked(getCredentialsForOAuth).mockResolvedValue({
      clientId: 'user-web.apps.googleusercontent.com',
      clientSecret: '',
    })
    const r = await resolveGmailOAuthForConnect('builtin_public')
    expect(r.credentialSourceUsed).toBe('builtin_public')
    expect(r.authMode).toBe('pkce')
    expect(r.resolution).toBe('builtin')
    expect(r.clientId).toBe('builtin.apps.googleusercontent.com')
    expect(r.clientSecret).toBeUndefined()
    expect(r.builtinClientResolution?.sourceKind).toBe('packaged_resource_file')
    expect(assertBuiltinPublicClientMatchesShippedResource).toHaveBeenCalledTimes(1)
    expect(vi.mocked(resolveBuiltinGoogleOAuthClientWithMeta)).toHaveBeenCalledWith({
      forStandardGmailConnect: true,
    })
  })

  it('builtin_public logs gmail_oauth_resolve with pkce, builtin packaged source, not user-stored', async () => {
    vi.mocked(isBuiltinGmailOAuthConfigured).mockReturnValue(true)
    vi.mocked(resolveBuiltinGoogleOAuthClientWithMeta).mockReturnValue(
      builtinMeta('builtin.apps.googleusercontent.com'),
    )
    await resolveGmailOAuthForConnect('builtin_public')
    expect(vi.mocked(logOAuthDiagnostic)).toHaveBeenCalledWith(
      'gmail_standard_connect_oauth_source',
      expect.objectContaining({
        winningBuiltinSourceKind: 'packaged_resource_file',
        gmailOAuthCredentialSource: 'builtin_public',
        authMode: 'pkce',
      }),
    )
    expect(vi.mocked(logOAuthDiagnostic)).toHaveBeenCalledWith(
      'gmail_oauth_resolve',
      expect.objectContaining({
        credentialSource: 'builtin_public',
        authMode: 'pkce',
        resolution: 'builtin',
        builtinSourceKind: 'packaged_resource_file',
        builtinFromPackagedResourceFile: true,
        usesUserStoredOAuthClient: false,
      }),
    )
  })

  it('builtin_public throws when built-in client is not configured', async () => {
    vi.mocked(resolveBuiltinGoogleOAuthClientWithMeta).mockReturnValue(null)
    await expect(resolveGmailOAuthForConnect('builtin_public')).rejects.toThrow(/not configured/)
    expect(assertBuiltinPublicClientMatchesShippedResource).not.toHaveBeenCalled()
  })

  it('developer_saved prefers user legacy client id + secret', async () => {
    vi.mocked(getCredentialsForOAuth).mockResolvedValue({
      clientId: 'user.apps.googleusercontent.com',
      clientSecret: 'secret',
    })
    const r = await resolveGmailOAuthForConnect('developer_saved')
    expect(r.credentialSourceUsed).toBe('developer_saved')
    expect(r.authMode).toBe('legacy_secret')
    expect(r.resolution).toBe('developer_legacy_secret')
    expect(r.clientId).toContain('user.apps')
    expect(r.clientSecret).toBe('secret')
    expect(r.builtinClientResolution).toBeUndefined()
    expect(assertBuiltinPublicClientMatchesShippedResource).not.toHaveBeenCalled()
  })

  it('developer_saved uses PKCE when only client id is stored (developer)', async () => {
    vi.mocked(getCredentialsForOAuth).mockResolvedValue({
      clientId: 'pub.apps.googleusercontent.com',
    })
    const r = await resolveGmailOAuthForConnect('developer_saved')
    expect(r.credentialSourceUsed).toBe('developer_saved')
    expect(r.authMode).toBe('pkce')
    expect(r.resolution).toBe('developer_pkce')
    expect(r.clientSecret).toBeUndefined()
    expect(assertBuiltinPublicClientMatchesShippedResource).not.toHaveBeenCalled()
  })

  it('developer_saved uses builtin client when no user creds', async () => {
    vi.mocked(resolveBuiltinGoogleOAuthClientWithMeta).mockReturnValue(
      builtinMeta('builtin.apps.googleusercontent.com'),
    )
    vi.mocked(isBuiltinGmailOAuthConfigured).mockReturnValue(true)
    const r = await resolveGmailOAuthForConnect('developer_saved')
    expect(r.authMode).toBe('pkce')
    expect(r.resolution).toBe('builtin')
    expect(r.clientId).toBe('builtin.apps.googleusercontent.com')
    expect(assertBuiltinPublicClientMatchesShippedResource).not.toHaveBeenCalled()
  })

  it('omitted argument uses builtin_public when builtin is configured (ignores stale user id-only)', async () => {
    vi.mocked(isBuiltinGmailOAuthConfigured).mockReturnValue(true)
    vi.mocked(resolveBuiltinGoogleOAuthClientWithMeta).mockReturnValue(
      builtinMeta('builtin.apps.googleusercontent.com'),
    )
    vi.mocked(getCredentialsForOAuth).mockResolvedValue({
      clientId: 'stale-dev.apps.googleusercontent.com',
    })
    const r = await resolveGmailOAuthForConnect()
    expect(r.credentialSourceUsed).toBe('builtin_public')
    expect(r.authMode).toBe('pkce')
    expect(r.resolution).toBe('builtin')
    expect(r.clientId).toBe('builtin.apps.googleusercontent.com')
    expect(r.clientSecret).toBeUndefined()
    expect(assertBuiltinPublicClientMatchesShippedResource).toHaveBeenCalled()
  })

  it('omitted argument uses developer_saved path when builtin is not configured', async () => {
    vi.mocked(isBuiltinGmailOAuthConfigured).mockReturnValue(false)
    vi.mocked(resolveBuiltinGoogleOAuthClientWithMeta).mockReturnValue(null)
    vi.mocked(getCredentialsForOAuth).mockResolvedValue({
      clientId: 'onlydev.apps.googleusercontent.com',
    })
    const r = await resolveGmailOAuthForConnect()
    expect(r.credentialSourceUsed).toBe('developer_saved')
    expect(r.authMode).toBe('pkce')
    expect(r.resolution).toBe('developer_pkce')
    expect(r.clientId).toBe('onlydev.apps.googleusercontent.com')
    expect(assertBuiltinPublicClientMatchesShippedResource).not.toHaveBeenCalled()
  })

  it('explicit developer_saved still uses stored id-only for PKCE when builtin exists', async () => {
    vi.mocked(resolveBuiltinGoogleOAuthClientWithMeta).mockReturnValue(
      builtinMeta('builtin.apps.googleusercontent.com'),
    )
    vi.mocked(isBuiltinGmailOAuthConfigured).mockReturnValue(true)
    vi.mocked(getCredentialsForOAuth).mockResolvedValue({
      clientId: 'advanced.apps.googleusercontent.com',
    })
    const r = await resolveGmailOAuthForConnect('developer_saved')
    expect(r.credentialSourceUsed).toBe('developer_saved')
    expect(r.resolution).toBe('developer_pkce')
    expect(r.clientId).toBe('advanced.apps.googleusercontent.com')
    expect(assertBuiltinPublicClientMatchesShippedResource).not.toHaveBeenCalled()
  })

  it('throws when nothing is configured (developer_saved)', async () => {
    await expect(resolveGmailOAuthForConnect('developer_saved')).rejects.toThrow(/not configured/)
  })
})

describe('defaultGmailOAuthCredentialSource', () => {
  beforeEach(() => {
    vi.mocked(isBuiltinGmailOAuthConfigured).mockReset()
  })

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
  beforeEach(() => {
    vi.mocked(isBuiltinGmailOAuthConfigured).mockReset()
  })

  it('reflects builtin id', () => {
    vi.mocked(isBuiltinGmailOAuthConfigured).mockReturnValue(true)
    expect(isBuiltinGmailOAuthAvailable()).toBe(true)
  })
})
