import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../providers/outlook', () => ({ OutlookProvider: class OutlookProvider {} }))
vi.mock('../providers/gmail', () => ({ GmailProvider: class GmailProvider {} }))
vi.mock('../credentials', () => ({
  getCredentialsForOAuth: vi.fn(async () => null),
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
  wireSandboxReadProviderTokenRefresh,
} from '../sandboxEmailFetch'
import type { RoleScopedTokenRecord } from '../roleScopedTokenStore'

describe('sandbox read oauth wiring', () => {
  beforeEach(() => {
    saveRoleScopedTokens.mockClear()
    loadRoleScopedTokens.mockClear()
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
})
