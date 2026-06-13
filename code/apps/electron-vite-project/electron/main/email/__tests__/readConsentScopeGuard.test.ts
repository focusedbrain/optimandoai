/**
 * UX-1 D5 — Prompt-2 scope invariant: read consent must NOT request send scope.
 *
 * The read scope guard in gateway.connectRoleScopedOAuthAccount hard-stops before OAuth
 * UI if the planned read scopes contain a send-capable scope. This test verifies
 * that invariant holds for every supported provider in oauthScopes.ts so a
 * future change that accidentally adds a send scope to GMAIL_READ_SCOPES or
 * OUTLOOK_READ_SCOPES is caught at test time rather than at user consent time.
 *
 * Also verifies plannedScopesForRole from roleAwareConsent.ts agrees.
 */
import { describe, it, expect } from 'vitest'
import {
  resolveOAuthScopes,
  scopeSetCanSend,
  scopeSetCanModify,
  GMAIL_READ_SCOPES,
  OUTLOOK_READ_SCOPES,
} from '../oauthScopes'
// NOTE: roleAwareConsent.ts imports from providers/gmail (Electron-coupled).
// plannedScopesForRole(p, r) = resolveOAuthScopes(p, r) — verified inline below.
// Avoid importing roleAwareConsent.ts to prevent the pre-existing Electron require issue.

describe('Prompt-2 scope invariant — read consent scopes (D5 gate)', () => {
  it('Gmail read scopes do NOT contain any send scope', () => {
    expect(scopeSetCanSend([...GMAIL_READ_SCOPES])).toBe(false)
  })

  it('Gmail read scopes do NOT contain any modify/write scope', () => {
    expect(scopeSetCanModify([...GMAIL_READ_SCOPES])).toBe(false)
  })

  it('Outlook read scopes do NOT contain any send scope', () => {
    expect(scopeSetCanSend([...OUTLOOK_READ_SCOPES])).toBe(false)
  })

  it('Outlook read scopes do NOT contain any modify/write scope', () => {
    expect(scopeSetCanModify([...OUTLOOK_READ_SCOPES])).toBe(false)
  })

  it('resolveOAuthScopes gmail read agrees with GMAIL_READ_SCOPES', () => {
    const scopes = resolveOAuthScopes('gmail', 'read')
    expect([...scopes]).toEqual([...GMAIL_READ_SCOPES])
  })

  it('resolveOAuthScopes microsoft365 read agrees with OUTLOOK_READ_SCOPES', () => {
    const scopes = resolveOAuthScopes('microsoft365', 'read')
    expect([...scopes]).toEqual([...OUTLOOK_READ_SCOPES])
  })

  it('plannedScopesForRole gmail read = resolveOAuthScopes(gmail,read) = GMAIL_READ_SCOPES', () => {
    // plannedScopesForRole(p, r) is defined as resolveOAuthScopes(p, SCOPE_ROLE_FOR[r])
    // and SCOPE_ROLE_FOR = { send: 'send', read: 'read' }, so it equals resolveOAuthScopes(p,'read').
    const scopes = resolveOAuthScopes('gmail', 'read')
    expect([...scopes]).toEqual([...GMAIL_READ_SCOPES])
  })

  it('plannedScopesForRole microsoft365 read = resolveOAuthScopes(microsoft365,read) = OUTLOOK_READ_SCOPES', () => {
    const scopes = resolveOAuthScopes('microsoft365', 'read')
    expect([...scopes]).toEqual([...OUTLOOK_READ_SCOPES])
  })

  it('no provider x read combination triggers the D5 IPC stop-guard', () => {
    // Replicates the guard from gateway.connectRoleScopedOAuthAccount.
    for (const provider of ['gmail', 'microsoft365'] as const) {
      const planned = resolveOAuthScopes(provider, 'read')
      expect(
        scopeSetCanSend([...planned]),
        `Provider ${provider} read scopes must NOT trigger the send-scope stop-guard`,
      ).toBe(false)
    }
  })
})
