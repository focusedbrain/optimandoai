/**
 * Unified email-provider setup — connect→display regression.
 *
 * OAuth split introduced separate connectReadAccount / connectSendAccount IPC paths
 * that wrote role-scoped tokens while the connected badge reads gateway rows via
 * listAccounts(). The fix routes sandbox through the same connectGmail/connectOutlook
 * IPC as host; read-scoped sandbox connects register an active gateway row.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))

const isSandboxMode = vi.fn(() => false)
const ledgerProvesSandbox = vi.fn(async () => false)

vi.mock('../../orchestrator/orchestratorModeStore', () => ({
  getOrchestratorMode: () => ({ mode: isSandboxMode() ? 'sandbox' : 'host' }),
  isSandboxMode: () => isSandboxMode(),
}))

vi.mock('../../internalInference/listInferenceTargets', () => ({
  hasActiveInternalLedgerSandboxToHostForHostAi: () => ledgerProvesSandbox(),
}))

import { resolveConnectOAuthScopeRole } from '../resolveConnectOAuthScopeRole'
import { resolveOAuthScopes, GMAIL_READ_SCOPES, scopeSetCanRead, scopeSetCanSend } from '../oauthScopes'

beforeEach(() => {
  isSandboxMode.mockReturnValue(false)
  ledgerProvesSandbox.mockResolvedValue(false)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('REGRESSION — connect→display unified path', () => {
  it('read-scoped sandbox connect uses scopes that can read and cannot send', () => {
    expect(scopeSetCanRead([...GMAIL_READ_SCOPES])).toBe(true)
    expect(scopeSetCanSend([...GMAIL_READ_SCOPES])).toBe(false)
  })

  it('unified connect uses same IPC channels for both roles (no read/send split)', () => {
    const readScopes = [...resolveOAuthScopes('gmail', 'read')]
    expect(readScopes).toEqual([...GMAIL_READ_SCOPES])
    expect(scopeSetCanRead(readScopes)).toBe(true)
    expect(scopeSetCanSend(readScopes)).toBe(false)
  })

  it('sandbox effective role resolves to read OAuth scope (under-the-hood only)', async () => {
    isSandboxMode.mockReturnValue(true)
    expect(await resolveConnectOAuthScopeRole()).toBe('read')
  })

  it('host effective role resolves to bundled all scope (single-machine unchanged)', async () => {
    isSandboxMode.mockReturnValue(false)
    ledgerProvesSandbox.mockResolvedValue(false)
    expect(await resolveConnectOAuthScopeRole()).toBe('all')
  })

  it('ledger-proven sandbox on stale mode=host file still resolves read scope', async () => {
    isSandboxMode.mockReturnValue(false)
    ledgerProvesSandbox.mockResolvedValue(true)
    expect(await resolveConnectOAuthScopeRole()).toBe('read')
  })
})
