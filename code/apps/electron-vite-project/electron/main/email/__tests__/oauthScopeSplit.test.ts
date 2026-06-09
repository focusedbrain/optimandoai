/**
 * Prompt 2 — OAuth scope-split isolation proofs (the A2 model).
 *
 * Invariants under test (file:line refs are to oauthScopes.ts):
 *   - sandbox READ client has read scope and NOT send/modify;
 *   - host SEND client has send and NOT read/modify;
 *   - single-machine 'all' bundle is unchanged (read + modify + send);
 *   - IMAP role→credential mapping (send→smtp, read→imap).
 */

import { describe, test, expect } from 'vitest'
import {
  resolveOAuthScopes,
  resolveOAuthScopeString,
  scopeSetCanSend,
  scopeSetCanRead,
  scopeSetCanModify,
  imapCredentialFieldForRole,
  GMAIL_READ_SCOPES,
  GMAIL_SEND_SCOPES,
  GMAIL_ALL_SCOPES,
  OUTLOOK_READ_SCOPES,
  OUTLOOK_SEND_SCOPES,
  OUTLOOK_ALL_SCOPES,
} from '../oauthScopes'

describe('Gmail scope split', () => {
  test('sandbox READ client: can read, CANNOT send, CANNOT modify', () => {
    expect(scopeSetCanRead(GMAIL_READ_SCOPES)).toBe(true)
    expect(scopeSetCanSend(GMAIL_READ_SCOPES)).toBe(false)
    expect(scopeSetCanModify(GMAIL_READ_SCOPES)).toBe(false)
    expect(GMAIL_READ_SCOPES).toEqual(['https://www.googleapis.com/auth/gmail.readonly'])
  })

  test('host SEND client: can send, CANNOT read, CANNOT modify', () => {
    expect(scopeSetCanSend(GMAIL_SEND_SCOPES)).toBe(true)
    expect(scopeSetCanRead(GMAIL_SEND_SCOPES)).toBe(false)
    expect(scopeSetCanModify(GMAIL_SEND_SCOPES)).toBe(false)
    expect(GMAIL_SEND_SCOPES).toEqual(['https://www.googleapis.com/auth/gmail.send'])
  })

  test("single-machine 'all' bundle is unchanged (read + modify + send)", () => {
    expect(GMAIL_ALL_SCOPES).toEqual([
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/gmail.send',
    ])
    expect(scopeSetCanRead(GMAIL_ALL_SCOPES)).toBe(true)
    expect(scopeSetCanSend(GMAIL_ALL_SCOPES)).toBe(true)
  })

  test('resolver maps role → set', () => {
    expect(resolveOAuthScopes('gmail', 'read')).toBe(GMAIL_READ_SCOPES)
    expect(resolveOAuthScopes('gmail', 'send')).toBe(GMAIL_SEND_SCOPES)
    expect(resolveOAuthScopes('gmail', 'all')).toBe(GMAIL_ALL_SCOPES)
    // default role is 'all' (single-machine unchanged)
    expect(resolveOAuthScopes('gmail')).toBe(GMAIL_ALL_SCOPES)
  })
})

describe('Outlook / Graph scope split', () => {
  test('sandbox READ client: Mail.Read, NOT Mail.Send, NOT Mail.ReadWrite', () => {
    expect(OUTLOOK_READ_SCOPES).toContain('https://graph.microsoft.com/Mail.Read')
    expect(OUTLOOK_READ_SCOPES).not.toContain('https://graph.microsoft.com/Mail.Send')
    expect(OUTLOOK_READ_SCOPES).not.toContain('https://graph.microsoft.com/Mail.ReadWrite')
    expect(scopeSetCanSend(OUTLOOK_READ_SCOPES)).toBe(false)
    expect(scopeSetCanModify(OUTLOOK_READ_SCOPES)).toBe(false)
    expect(scopeSetCanRead(OUTLOOK_READ_SCOPES)).toBe(true)
  })

  test('host SEND client: Mail.Send, NOT Mail.Read, NOT Mail.ReadWrite', () => {
    expect(OUTLOOK_SEND_SCOPES).toContain('https://graph.microsoft.com/Mail.Send')
    expect(OUTLOOK_SEND_SCOPES).not.toContain('https://graph.microsoft.com/Mail.Read')
    expect(OUTLOOK_SEND_SCOPES).not.toContain('https://graph.microsoft.com/Mail.ReadWrite')
    expect(scopeSetCanSend(OUTLOOK_SEND_SCOPES)).toBe(true)
    expect(scopeSetCanRead(OUTLOOK_SEND_SCOPES)).toBe(false)
    expect(scopeSetCanModify(OUTLOOK_SEND_SCOPES)).toBe(false)
  })

  test('both narrow sets keep identity/refresh base scopes', () => {
    for (const set of [OUTLOOK_READ_SCOPES, OUTLOOK_SEND_SCOPES]) {
      expect(set).toContain('offline_access')
      expect(set).toContain('openid')
      expect(set).toContain('https://graph.microsoft.com/User.Read')
    }
  })

  test("single-machine 'all' bundle is unchanged (Mail.Read + ReadWrite + Send)", () => {
    expect(OUTLOOK_ALL_SCOPES).toContain('https://graph.microsoft.com/Mail.Read')
    expect(OUTLOOK_ALL_SCOPES).toContain('https://graph.microsoft.com/Mail.ReadWrite')
    expect(OUTLOOK_ALL_SCOPES).toContain('https://graph.microsoft.com/Mail.Send')
  })

  test('scope string is space-joined', () => {
    expect(resolveOAuthScopeString('microsoft365', 'read')).toBe(OUTLOOK_READ_SCOPES.join(' '))
  })
})

describe('IMAP role → credential mapping', () => {
  test('send→smtp, read→imap, all→both', () => {
    expect(imapCredentialFieldForRole('send')).toBe('smtp')
    expect(imapCredentialFieldForRole('read')).toBe('imap')
    expect(imapCredentialFieldForRole('all')).toBe('both')
  })
})
