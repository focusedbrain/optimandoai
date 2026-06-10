/**
 * Prompt 2 — role-aware consent entry-point proofs (the A2 split).
 *
 *   - a READ consent requests the read-only scope and stores under role 'read';
 *   - a SEND consent requests the send-only scope and stores under role 'send';
 *   - a READ consent that comes back with a SEND grant FAILS CLOSED (never stored);
 *   - send consent is host-initiated (refused on a sandbox-mode node);
 *   - the sandbox read-consent UI entry is stubbed not-yet-reachable (Prompt 4).
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() } }))

// Providers are not exercised (flows are injected); stub their heavy graph.
vi.mock('../providers/gmail', () => ({ GmailProvider: class {} }))
vi.mock('../providers/outlook', () => ({ OutlookProvider: class {} }))

const isSandboxMode = vi.fn(() => false)
vi.mock('../../orchestrator/orchestratorModeStore', () => ({ isSandboxMode: () => isSandboxMode() }))

vi.mock('../secure-storage', () => {
  class SecureStorageUnavailableError extends Error {}
  return {
    SecureStorageUnavailableError,
    encryptOAuthTokens: (t: any) => ({ ...t, scope: t.scope ?? '', _encrypted: true }),
    decryptOAuthTokens: (s: any) => ({
      accessToken: s.accessToken,
      refreshToken: s.refreshToken,
      expiresAt: s.expiresAt,
      scope: s.scope,
      oauthClientId: s.oauthClientId,
    }),
  }
})

import {
  runRoleScopedConsent,
  connectSendClient,
  connectReadClient,
  plannedScopesForRole,
  assertSandboxReadConsentEntryReachable,
  SANDBOX_READ_CONSENT_UI_REACHABLE,
} from '../roleAwareConsent'
import { loadRoleScopedTokens, hasRoleScopedTokens, __setRoleTokenStoreBaseDirForTests } from '../roleScopedTokenStore'
import { GMAIL_READ_SCOPES, GMAIL_SEND_SCOPES } from '../oauthScopes'

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'consent-'))
  __setRoleTokenStoreBaseDirForTests(dir)
  isSandboxMode.mockReturnValue(false)
})

afterEach(() => {
  __setRoleTokenStoreBaseDirForTests(null)
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

describe('role-aware consent', () => {
  test('planned scopes per role match the canonical split', () => {
    expect(plannedScopesForRole('gmail', 'read')).toBe(GMAIL_READ_SCOPES)
    expect(plannedScopesForRole('gmail', 'send')).toBe(GMAIL_SEND_SCOPES)
  })

  test('READ consent requests read scope and stores ONLY the read token', async () => {
    let requestedRole: string | undefined
    const res = await connectReadClient(
      { accountId: 'a1', provider: 'gmail', email: 'u@x.com' },
      {
        gmailFlow: async (_email, scopeRole) => {
          requestedRole = scopeRole
          return {
            oauth: { accessToken: 'RA', refreshToken: 'RR', expiresAt: 9, scope: GMAIL_READ_SCOPES.join(' '), oauthClientId: 'read-cli' },
            email: 'u@x.com',
          }
        },
      },
    )
    expect(requestedRole).toBe('read')
    expect(res.role).toBe('read')
    expect(res.grantedScope).toBe(GMAIL_READ_SCOPES.join(' '))
    expect(hasRoleScopedTokens('a1', 'read')).toBe(true)
    expect(hasRoleScopedTokens('a1', 'send')).toBe(false)
    expect(loadRoleScopedTokens('a1', 'read')!.tokens.accessToken).toBe('RA')
  })

  test('SEND consent requests send scope and stores ONLY the send token (host)', async () => {
    let requestedRole: string | undefined
    const res = await connectSendClient(
      { accountId: 'a2', provider: 'gmail' },
      {
        gmailFlow: async (_email, scopeRole) => {
          requestedRole = scopeRole
          return { oauth: { accessToken: 'SA', refreshToken: 'SR', expiresAt: 9, scope: GMAIL_SEND_SCOPES.join(' '), oauthClientId: 'send-cli' }, email: '' }
        },
      },
    )
    expect(requestedRole).toBe('send')
    expect(res.role).toBe('send')
    expect(hasRoleScopedTokens('a2', 'send')).toBe(true)
    expect(hasRoleScopedTokens('a2', 'read')).toBe(false)
  })

  test('READ consent returning a SEND grant FAILS CLOSED (token never stored)', async () => {
    await expect(
      connectReadClient(
        { accountId: 'a3', provider: 'gmail' },
        {
          gmailFlow: async () => ({
            oauth: { accessToken: 'X', refreshToken: 'Y', expiresAt: 9, scope: 'https://www.googleapis.com/auth/gmail.send', oauthClientId: 'c' },
            email: '',
          }),
        },
      ),
    ).rejects.toThrow(/SEND scope/i)
    expect(hasRoleScopedTokens('a3', 'read')).toBe(false)
  })

  test('send consent is refused on a sandbox-mode node (host-initiated only)', async () => {
    isSandboxMode.mockReturnValue(true)
    await expect(
      connectSendClient({ accountId: 'a4', provider: 'gmail' }, { gmailFlow: async () => ({ oauth: null }) }),
    ).rejects.toThrow(/HOST node/i)
  })

  test('sandbox read-consent UI entry is reachable (Prompt 4 wired it)', () => {
    expect(SANDBOX_READ_CONSENT_UI_REACHABLE).toBe(true)
    expect(() => assertSandboxReadConsentEntryReachable()).not.toThrow()
  })
})
