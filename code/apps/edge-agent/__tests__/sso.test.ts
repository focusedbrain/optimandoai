import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  clearPendingLoginsForTests,
  completeLogin,
  persistTokens,
  startLogin,
} from '../src/sso/session.js'
import { AgentStorage } from '../src/storage.js'

vi.mock('@repo/sso', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/sso')>()
  return {
    ...actual,
    prepareAuthorizationRequest: vi.fn(async () => ({
      authorizationUrl: 'https://idp.example/auth?state=test-state',
      codeVerifier: 'verifier',
      state: 'test-state',
      nonce: 'test-nonce',
    })),
    exchangeAuthorizationCode: vi.fn(async () => ({
      access_token: 'at',
      refresh_token: 'rt',
      id_token: makeFakeIdToken({ sub: 'sub-1', email: 'a@b.c' }),
      expires_in: 3600,
      token_type: 'Bearer',
    })),
  }
})

function makeFakeIdToken(claims: Record<string, string>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `${header}.${payload}.sig`
}

describe('agent SSO session', () => {
  let dir: string

  beforeEach(() => {
    clearPendingLoginsForTests()
    dir = mkdtempSync(join(tmpdir(), 'edge-sso-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test('startLogin stores pending state', async () => {
    const pending = await startLogin()
    expect(pending.authorizationUrl).toContain('idp.example')
    expect(pending.state).toBe('test-state')
  })

  test('completeLogin persists tokens and profile', async () => {
    await startLogin()
    const storage = new AgentStorage(dir)
    await completeLogin(storage, { code: 'code', state: 'test-state' })
    const state = await storage.loadState()
    expect(state.ssoSub).toBe('sub-1')
    expect(state.ssoEmail).toBe('a@b.c')
    expect(state.accessToken).toBe('at')
    expect(state.refreshToken).toBe('rt')
  })

  test('persistTokens updates expiry', async () => {
    const storage = new AgentStorage(dir)
    await persistTokens(storage, {
      access_token: 'x',
      refresh_token: 'y',
      id_token: makeFakeIdToken({ sub: 's' }),
      expires_in: 60,
      token_type: 'Bearer',
    })
    const state = await storage.loadState()
    expect(state.tokenExpiresAt).toBeGreaterThan(Date.now())
  })
})
