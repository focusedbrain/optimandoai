/**
 * Assess whether this node can trash messages on the origin mailbox (Prompt 2).
 *
 * Does NOT widen OAuth scopes. Under the A2 split, sandbox read tokens and host
 * send-only tokens lack gmail.modify / Mail.ReadWrite — delete-from-origin fails closed.
 */

import { isEffectiveSandboxNode } from './resolveConnectOAuthScopeRole'
import { loadRoleScopedTokens } from './roleScopedTokenStore'
import { scopeSetCanModify } from './oauthScopes'
import type { EmailAccountConfig } from './types'

export type OriginDeleteTrashMethod =
  | 'gmail_trash'
  | 'outlook_deleted_items'
  | 'imap_move_trash'
  | 'zoho_trash'
  | 'none'

export interface OriginDeleteCapability {
  canTrashOnProvider: boolean
  blockReason?: string
  trashMethod: OriginDeleteTrashMethod
  /** Required OAuth modify scopes when blocked for OAuth providers (informational). */
  requiredScopes?: string[]
}

const GMAIL_MODIFY = 'https://www.googleapis.com/auth/gmail.modify'
const GRAPH_MAIL_READWRITE = 'https://graph.microsoft.com/Mail.ReadWrite'

function parseScopes(scope: string | undefined | null): string[] {
  return String(scope ?? '')
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function oauthTrashMethod(provider: EmailAccountConfig['provider']): OriginDeleteTrashMethod {
  switch (provider) {
    case 'gmail':
      return 'gmail_trash'
    case 'microsoft365':
      return 'outlook_deleted_items'
    case 'zoho':
      return 'zoho_trash'
    default:
      return 'none'
  }
}

/**
 * Returns whether the current node + stored credentials can call provider trash APIs.
 * Sandbox (read-only ingestion) always returns false — never widens scope.
 */
export async function assessOriginDeleteCapability(
  account: Pick<EmailAccountConfig, 'id' | 'provider' | 'oauth' | 'imap'>,
): Promise<OriginDeleteCapability> {
  const isSandbox = await isEffectiveSandboxNode()

  if (account.provider === 'imap') {
    if (isSandbox) {
      return {
        canTrashOnProvider: false,
        trashMethod: 'imap_move_trash',
        blockReason:
          'Sandbox uses read-only mail ingestion — it cannot move messages in your IMAP mailbox. Origin delete is only available on the host with full IMAP credentials.',
      }
    }
    if (!account.imap?.host?.trim()) {
      return {
        canTrashOnProvider: false,
        trashMethod: 'imap_move_trash',
        blockReason: 'IMAP credentials are not available on this device.',
      }
    }
    return { canTrashOnProvider: true, trashMethod: 'imap_move_trash' }
  }

  if (isSandbox) {
    return {
      canTrashOnProvider: false,
      trashMethod: oauthTrashMethod(account.provider),
      requiredScopes:
        account.provider === 'gmail'
          ? [GMAIL_MODIFY]
          : account.provider === 'microsoft365'
            ? [GRAPH_MAIL_READWRITE]
            : undefined,
      blockReason:
        'Sandbox OAuth is read-only (gmail.readonly / Mail.Read). Deleting from the provider requires modify scope on the host — an operator decision, not enabled here.',
    }
  }

  // Host or single-machine node
  if (account.oauth?.accessToken) {
    const scopes = parseScopes(account.oauth.scope)
    if (scopeSetCanModify(scopes)) {
      return {
        canTrashOnProvider: true,
        trashMethod: oauthTrashMethod(account.provider),
      }
    }
    return {
      canTrashOnProvider: false,
      trashMethod: oauthTrashMethod(account.provider),
      requiredScopes:
        account.provider === 'gmail'
          ? [GMAIL_MODIFY]
          : account.provider === 'microsoft365'
            ? [GRAPH_MAIL_READWRITE]
            : undefined,
      blockReason:
        'Connected OAuth scopes lack mailbox modify permission (gmail.modify or Mail.ReadWrite). Re-connect with modify scope to enable provider trash.',
    }
  }

  const sendRecord = loadRoleScopedTokens(account.id, 'send')
  if (sendRecord) {
    return {
      canTrashOnProvider: false,
      trashMethod: oauthTrashMethod(account.provider),
      requiredScopes:
        account.provider === 'gmail'
          ? [GMAIL_MODIFY]
          : account.provider === 'microsoft365'
            ? [GRAPH_MAIL_READWRITE]
            : undefined,
      blockReason:
        'Host send client is send-only (gmail.send / Mail.Send). Provider trash requires gmail.modify / Mail.ReadWrite — operator re-consent is required.',
    }
  }

  const readRecord = loadRoleScopedTokens(account.id, 'read')
  if (readRecord) {
    return {
      canTrashOnProvider: false,
      trashMethod: oauthTrashMethod(account.provider),
      blockReason: 'Only a read-only token is present on this device.',
    }
  }

  return {
    canTrashOnProvider: false,
    trashMethod: oauthTrashMethod(account.provider),
    blockReason: 'No OAuth credentials on this device for this account.',
  }
}
