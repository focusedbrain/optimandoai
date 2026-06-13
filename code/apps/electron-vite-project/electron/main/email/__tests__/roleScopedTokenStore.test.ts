/**
 * Prompt 2 — role-scoped token storage proofs (the A2 split).
 *
 *   - send-client and read-client tokens live in SEPARATE files keyed by role;
 *   - a node holding one role's file cannot obtain the other's;
 *   - each client is INDEPENDENTLY revocable;
 *   - tokens are persisted via the encryption path (not plaintext on disk).
 *
 * The secure-storage encryption is mocked with a reversible transform so the test
 * is hermetic; we still assert the on-disk bytes are NOT the raw token (INV-5).
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() } }))

// Reversible "encryption" — prefix-tag + base64 so the stored bytes differ from
// the plaintext token (lets us assert no plaintext leaks to disk).
vi.mock('../secure-storage', () => {
  class SecureStorageUnavailableError extends Error {
    code = 'SECURE_STORAGE_UNAVAILABLE' as const
  }
  const enc = (v: string | undefined) => 'ENC:' + Buffer.from(v ?? '', 'utf8').toString('base64')
  const dec = (v: string | undefined) => {
    if (!v) return ''
    return Buffer.from(v.replace(/^ENC:/, ''), 'base64').toString('utf8')
  }
  return {
    SecureStorageUnavailableError,
    encryptOAuthTokens: (t: any) => ({
      accessToken: enc(t.accessToken),
      refreshToken: enc(t.refreshToken),
      expiresAt: t.expiresAt,
      scope: t.scope ?? '',
      oauthClientId: t.oauthClientId,
      _encrypted: true,
    }),
    decryptOAuthTokens: (s: any) => ({
      accessToken: dec(s.accessToken),
      refreshToken: dec(s.refreshToken),
      expiresAt: s.expiresAt,
      scope: s.scope,
      oauthClientId: s.oauthClientId,
    }),
  }
})

import {
  saveRoleScopedTokens,
  loadRoleScopedTokens,
  hasRoleScopedTokens,
  deleteRoleScopedTokens,
  migrateRoleScopedTokens,
  listRoleScopedTokenRoles,
  __setRoleTokenStoreBaseDirForTests,
} from '../roleScopedTokenStore'

let dir: string
const ACCOUNT = 'acct-123@example.com'

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roletok-'))
  __setRoleTokenStoreBaseDirForTests(dir)
})

afterEach(() => {
  __setRoleTokenStoreBaseDirForTests(null)
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

describe('role-scoped token storage', () => {
  test('send and read tokens are stored in separate files and round-trip', () => {
    saveRoleScopedTokens(
      ACCOUNT,
      'send',
      { accessToken: 'SEND-ACCESS', refreshToken: 'SEND-REFRESH', expiresAt: 111, scope: 'https://graph.microsoft.com/Mail.Send' },
      { clientId: 'send-client', grantedScope: 'https://graph.microsoft.com/Mail.Send' },
    )
    saveRoleScopedTokens(
      ACCOUNT,
      'read',
      { accessToken: 'READ-ACCESS', refreshToken: 'READ-REFRESH', expiresAt: 222, scope: 'https://graph.microsoft.com/Mail.Read' },
      { clientId: 'read-client', grantedScope: 'https://graph.microsoft.com/Mail.Read' },
    )

    const files = fs.readdirSync(dir).sort()
    expect(files.length).toBe(2)
    expect(files.some((f) => f.endsWith('__send.json'))).toBe(true)
    expect(files.some((f) => f.endsWith('__read.json'))).toBe(true)

    const send = loadRoleScopedTokens(ACCOUNT, 'send')!
    const read = loadRoleScopedTokens(ACCOUNT, 'read')!
    expect(send.tokens.accessToken).toBe('SEND-ACCESS')
    expect(send.clientId).toBe('send-client')
    expect(read.tokens.accessToken).toBe('READ-ACCESS')
    expect(read.clientId).toBe('read-client')
    // The two clients hold DIFFERENT tokens.
    expect(send.tokens.refreshToken).not.toBe(read.tokens.refreshToken)
  })

  test('plaintext token bytes never hit disk (encryption path used)', () => {
    saveRoleScopedTokens(ACCOUNT, 'read', {
      accessToken: 'ya29.PLAINTEXT-SECRET',
      refreshToken: '1//PLAINTEXT-REFRESH',
      expiresAt: 1,
    })
    const file = fs.readdirSync(dir).find((f) => f.endsWith('__read.json'))!
    const raw = fs.readFileSync(path.join(dir, file), 'utf8')
    expect(raw).not.toContain('ya29.PLAINTEXT-SECRET')
    expect(raw).not.toContain('1//PLAINTEXT-REFRESH')
  })

  test('each client is independently revocable', () => {
    saveRoleScopedTokens(ACCOUNT, 'send', { accessToken: 'S', refreshToken: 'S', expiresAt: 1 })
    saveRoleScopedTokens(ACCOUNT, 'read', { accessToken: 'R', refreshToken: 'R', expiresAt: 1 })
    expect(listRoleScopedTokenRoles(ACCOUNT).sort()).toEqual(['read', 'send'])

    // Revoke ONLY the read client.
    expect(deleteRoleScopedTokens(ACCOUNT, 'read')).toBe(true)
    expect(hasRoleScopedTokens(ACCOUNT, 'read')).toBe(false)
    // Send client is untouched.
    expect(hasRoleScopedTokens(ACCOUNT, 'send')).toBe(true)
    expect(loadRoleScopedTokens(ACCOUNT, 'send')!.tokens.accessToken).toBe('S')
    expect(listRoleScopedTokenRoles(ACCOUNT)).toEqual(['send'])

    // Revoking a missing role is a no-op.
    expect(deleteRoleScopedTokens(ACCOUNT, 'read')).toBe(false)
  })

  test('load returns null when a role has no stored token', () => {
    expect(loadRoleScopedTokens('nobody', 'send')).toBeNull()
    expect(hasRoleScopedTokens('nobody', 'read')).toBe(false)
  })

  test('migrateRoleScopedTokens moves read token to winner and removes loser file', () => {
    saveRoleScopedTokens('loser', 'read', { accessToken: 'R', refreshToken: 'R', expiresAt: 2 })
    expect(migrateRoleScopedTokens('loser', 'winner', 'read')).toBe(true)
    expect(hasRoleScopedTokens('loser', 'read')).toBe(false)
    expect(hasRoleScopedTokens('winner', 'read')).toBe(true)
    expect(loadRoleScopedTokens('winner', 'read')!.tokens.accessToken).toBe('R')
  })
})
