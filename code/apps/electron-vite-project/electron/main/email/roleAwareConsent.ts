/**
 * Prompt 2 — role-aware OAuth consent entry points (the A2 split).
 *
 * Two independent client consents per account:
 *   - SEND client → initiated in the HOST role (`connectSendClient`). Narrow send
 *     scope only. Token stored under role 'send'.
 *   - READ client → initiated in the SANDBOX role (`connectReadClient`). Narrow
 *     read-only scope. Token stored under role 'read'.
 *
 * The two consents produce two independently-revocable tokens stored in SEPARATE
 * role-keyed files (`roleScopedTokenStore`); neither node can read the other's.
 *
 * Prompt-4 boundary: sandbox read scopes are requested in main via
 * resolveConnectOAuthScopeRole when the unified EmailConnectWizard runs on a
 * sandbox-role node. connectReadClient remains for gateway + tests.
 *
 * INV-2: the resulting tokens are persisted node-locally and never travel over a
 * `critical_job_*` payload. INV-5: only non-secret metadata is returned/logged.
 */

import { GmailProvider } from './providers/gmail'
import { OutlookProvider } from './providers/outlook'
import { isEffectiveSandboxNode } from './resolveConnectOAuthScopeRole'
import { saveRoleScopedTokens, type TokenRole } from './roleScopedTokenStore'
import { resolveOAuthScopes, scopeSetCanSend, scopeSetCanRead, type OAuthScopeRole } from './oauthScopes'
import type { OAuthTokens } from './secure-storage'

export type ConsentRole = TokenRole // 'send' | 'read'
export type ConsentProvider = 'gmail' | 'microsoft365'

export interface RoleConsentResult {
  accountId: string
  provider: ConsentProvider
  role: ConsentRole
  email?: string
  clientId?: string
  /** Space-joined scope string actually granted (audit only — never a token). */
  grantedScope?: string
  expiresAt: number
}

/** OAuth flow output shared by both providers (the secret-bearing tokens). */
interface FlowTokens {
  oauth: OAuthTokens | null | undefined
  email?: string
}

/**
 * Injectable OAuth-flow runners (default: the real providers). Tests inject a fake
 * runner to exercise role-correctness without launching a browser.
 */
export interface ConsentDeps {
  gmailFlow?: (email: string | undefined, scopeRole: OAuthScopeRole) => Promise<FlowTokens>
  outlookFlow?: (scopeRole: OAuthScopeRole) => Promise<FlowTokens>
}

const SCOPE_ROLE_FOR: Record<ConsentRole, OAuthScopeRole> = { send: 'send', read: 'read' }

async function defaultGmailFlow(email: string | undefined, scopeRole: OAuthScopeRole): Promise<FlowTokens> {
  const p = new GmailProvider()
  const oauth = await p.startOAuthFlow(email, undefined, scopeRole)
  return { oauth, email }
}

async function defaultOutlookFlow(scopeRole: OAuthScopeRole): Promise<FlowTokens> {
  const p = new OutlookProvider()
  const r = await p.startOAuthFlow(scopeRole)
  return { oauth: r.oauth, email: r.email }
}

/**
 * Run a role-scoped consent for an account and persist the resulting token under
 * its role. Requests ONLY the narrow scope for the role (send or read). Returns
 * non-secret metadata; throws if no tokens are produced.
 */
export async function runRoleScopedConsent(
  params: { accountId: string; provider: ConsentProvider; role: ConsentRole; email?: string },
  deps: ConsentDeps = {},
): Promise<RoleConsentResult> {
  const scopeRole = SCOPE_ROLE_FOR[params.role]

  let result: FlowTokens
  if (params.provider === 'gmail') {
    const flow = deps.gmailFlow ?? defaultGmailFlow
    result = await flow(params.email, scopeRole)
  } else {
    const flow = deps.outlookFlow ?? defaultOutlookFlow
    result = await flow(scopeRole)
  }

  const oauth = result.oauth
  if (!oauth || !oauth.accessToken) {
    throw new Error(`Role consent produced no tokens (provider=${params.provider} role=${params.role})`)
  }

  // Defense in depth: a 'read' consent must never come back with a send grant and
  // vice versa. If the provider returned a wider grant than the role allows, fail
  // closed rather than persist an over-scoped token.
  const grantedScopes = (oauth.scope ?? '').split(/\s+/).filter(Boolean)
  if (grantedScopes.length > 0) {
    if (params.role === 'read' && scopeSetCanSend(grantedScopes)) {
      throw new Error(`Read consent returned a SEND scope — refusing to store (account=${params.accountId})`)
    }
    if (params.role === 'send' && scopeSetCanRead(grantedScopes)) {
      // The host send client should not hold read scope for the multi-machine case.
      console.warn(
        `[RoleConsent] send consent returned a read scope (account=${params.accountId}); storing send token but read is unexpected for A2`,
      )
    }
  }

  const tokens: OAuthTokens = {
    accessToken: oauth.accessToken,
    refreshToken: oauth.refreshToken,
    expiresAt: oauth.expiresAt,
    scope: oauth.scope,
    oauthClientId: oauth.oauthClientId,
  }
  saveRoleScopedTokens(params.accountId, params.role, tokens, {
    clientId: oauth.oauthClientId,
    grantedScope: oauth.scope,
  })

  return {
    accountId: params.accountId,
    provider: params.provider,
    role: params.role,
    email: result.email ?? params.email,
    clientId: oauth.oauthClientId,
    grantedScope: oauth.scope,
    expiresAt: oauth.expiresAt,
  }
}

/**
 * HOST entry point: initiate the SEND consent. Send capability belongs to the host
 * node; refuse if this instance is persisted as a sandbox.
 */
export async function connectSendClient(
  params: { accountId: string; provider: ConsentProvider; email?: string },
  deps?: ConsentDeps,
): Promise<RoleConsentResult> {
  // Effective sandbox (ledger-authoritative): a ledger-proven sandbox whose
  // orchestrator-mode.json still says 'host' (no sync-back on accept) must also be
  // refused — not mode-only. Send capability belongs to the host node.
  if (await isEffectiveSandboxNode()) {
    throw new Error('Send consent must be initiated on the HOST node (A2: host = send-only).')
  }
  return runRoleScopedConsent({ ...params, role: 'send' }, deps)
}

/**
 * SANDBOX entry point: initiate the READ consent. Narrow read-only scopes only.
 * Used by gateway read-scoped connect (resolveConnectOAuthScopeRole) and tests.
 */
export async function connectReadClient(
  params: { accountId: string; provider: ConsentProvider; email?: string },
  deps?: ConsentDeps,
): Promise<RoleConsentResult> {
  return runRoleScopedConsent({ ...params, role: 'read' }, deps)
}

/** Audit helper: the scope set a role WOULD request for a provider (no side effects). */
export function plannedScopesForRole(provider: ConsentProvider, role: ConsentRole): readonly string[] {
  return resolveOAuthScopes(provider, SCOPE_ROLE_FOR[role])
}
