import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../providers/outlook', () => ({ OutlookProvider: class OutlookProvider {} }))
vi.mock('../providers/gmail', () => ({ GmailProvider: class GmailProvider {} }))
vi.mock('../credentials', () => ({
  getCredentialsForOAuth: vi.fn(async () => null),
}))
vi.mock('../googleOAuthBuiltin', () => ({
  resolveBuiltinGoogleOAuthClientWithMeta: vi.fn(() => null),
  resolveBuiltinGoogleOAuthClientSecret: vi.fn(() => null),
}))

const saveRoleScopedTokens = vi.hoisted(() => vi.fn())
const loadRoleScopedTokens = vi.hoisted(() =>
  vi.fn(() => ({
    accountId: 'acc-read',
    role: 'read' as const,
    clientId: 'envelope-client',
    grantedScope: 'https://www.googleapis.com/auth/gmail.readonly',
    tokens: {
      accessToken: 'old-access',
      refreshToken: 'refresh',
      expiresAt: 1,
      scope: 'https://www.googleapis.com/auth/gmail.readonly',
    },
    savedAt: 0,
  })),
)

vi.mock('../roleScopedTokenStore', () => ({
  loadRoleScopedTokens,
  saveRoleScopedTokens,
}))

import {
  oauthConfigFromRoleScopedReadRecord,
  resolveOauthForSandboxReadFetch,
  wireSandboxReadProviderTokenRefresh,
} from '../sandboxEmailFetch'
import type { RoleScopedTokenRecord } from '../roleScopedTokenStore'
import { getCredentialsForOAuth } from '../credentials'
import {
  resolveBuiltinGoogleOAuthClientSecret,
  resolveBuiltinGoogleOAuthClientWithMeta,
} from '../googleOAuthBuiltin'

describe('sandbox read oauth wiring', () => {
  beforeEach(() => {
    saveRoleScopedTokens.mockClear()
    loadRoleScopedTokens.mockClear()
    vi.mocked(getCredentialsForOAuth).mockReset()
    vi.mocked(getCredentialsForOAuth).mockResolvedValue(null)
    vi.mocked(resolveBuiltinGoogleOAuthClientWithMeta).mockReset()
    vi.mocked(resolveBuiltinGoogleOAuthClientWithMeta).mockReturnValue(null)
    vi.mocked(resolveBuiltinGoogleOAuthClientSecret).mockReset()
    vi.mocked(resolveBuiltinGoogleOAuthClientSecret).mockReturnValue(null)
  })

  it('oauthConfigFromRoleScopedReadRecord prefers tokens.oauthClientId then envelope clientId', () => {
    const fromToken: RoleScopedTokenRecord = {
      accountId: 'a',
      role: 'read',
      tokens: {
        accessToken: 'x',
        refreshToken: 'r',
        expiresAt: 999,
        oauthClientId: 'token-client',
      },
      savedAt: 0,
    }
    expect(oauthConfigFromRoleScopedReadRecord(fromToken).oauthClientId).toBe('token-client')

    const fromEnvelope: RoleScopedTokenRecord = {
      accountId: 'a',
      role: 'read',
      clientId: 'envelope-only',
      tokens: { accessToken: 'x', refreshToken: 'r', expiresAt: 999 },
      savedAt: 0,
    }
    expect(oauthConfigFromRoleScopedReadRecord(fromEnvelope).oauthClientId).toBe('envelope-only')
  })

  it('wireSandboxReadProviderTokenRefresh persists refreshed tokens to role=read', () => {
    const provider = { onTokenRefresh: undefined as undefined | ((t: {
      accessToken: string
      refreshToken: string
      expiresAt: number
    }) => void) }
    wireSandboxReadProviderTokenRefresh('acc-read', provider as never)
    expect(provider.onTokenRefresh).toBeTypeOf('function')
    provider.onTokenRefresh!({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      expiresAt: 9_999_999,
    })
    expect(saveRoleScopedTokens).toHaveBeenCalledWith(
      'acc-read',
      'read',
      expect.objectContaining({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        expiresAt: 9_999_999,
      }),
      expect.objectContaining({ clientId: 'envelope-client' }),
    )
  })

  it('resolveOauthForSandboxReadFetch uses local gmail credentials with legacy secret fields', async () => {
    vi.mocked(getCredentialsForOAuth).mockResolvedValue({
      clientId: 'dev-client',
      clientSecret: 'dev-secret',
    })
    const record: RoleScopedTokenRecord = {
      accountId: 'acc',
      role: 'read',
      tokens: { accessToken: 'x', refreshToken: 'r', expiresAt: 1 },
      savedAt: 0,
    }
    const oauth = await resolveOauthForSandboxReadFetch('acc', record, 'gmail')
    expect(oauth.oauthClientId).toBe('dev-client')
    expect(oauth.gmailRefreshUsesSecret).toBe(true)
    expect(oauth.gmailOAuthClientSecret).toBe('dev-secret')
  })

  it('resolveOauthForSandboxReadFetch falls back to builtin gmail client on dedicated sandbox', async () => {
    vi.mocked(resolveBuiltinGoogleOAuthClientWithMeta).mockReturnValue({
      clientId: 'builtin-client.apps.googleusercontent.com',
      sourceKind: 'packaged_resource',
      sourceName: 'test',
      fromBuildTimeInline: false,
      fromPackagedResourceFile: true,
    } as never)
    vi.mocked(resolveBuiltinGoogleOAuthClientSecret).mockReturnValue('builtin-secret')
    const record: RoleScopedTokenRecord = {
      accountId: 'acc',
      role: 'read',
      tokens: { accessToken: 'x', refreshToken: 'r', expiresAt: 1 },
      savedAt: 0,
    }
    const oauth = await resolveOauthForSandboxReadFetch('acc', record, 'gmail')
    expect(oauth.oauthClientId).toBe('builtin-client.apps.googleusercontent.com')
    expect(oauth.gmailOAuthClientSecret).toBe('builtin-secret')
    expect(oauth.gmailRefreshUsesSecret).toBe(false)
  })
})
