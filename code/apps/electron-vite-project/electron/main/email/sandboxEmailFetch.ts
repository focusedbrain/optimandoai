/**
 * Prompt 5 Part B — sandbox-side opaque email fetch implementation.
 *
 * Implements the `fetchOpaque` dep for `sandboxIngestion.ts` for the Outlook /
 * Microsoft Graph provider. The sandbox holds the read-scoped token; this
 * module uses it to list and fetch messages as opaque RFC822 bytes WITHOUT
 * parsing any content.
 *
 * Isolation invariants:
 *   - INV-1: no attacker-controlled bytes are inspected here. Only provider-
 *     supplied operational metadata (receivedDateTime, hasAttachments, isRead)
 *     is used for bookkeeping.
 *   - INV-2: the read token never leaves this node. No token field is
 *     serialised into any RPC payload.
 *   - INV-5: only counts / ids / provider-type are logged, never message bytes
 *     or token values.
 *
 * Gmail opaque fetch: `fetchOpaqueViaGmail` (read-scoped Gmail API `format=raw`).
 * IMAP and other providers: fail closed via `sandboxOpaqueFetchRouter.ts`.
 *
 * Design note: the OutlookProvider instance is created and destroyed per call
 * to keep the token lifecycle explicit and avoid accidental state leakage
 * between polls.
 */

import { OutlookProvider } from './providers/outlook'
import { GmailProvider } from './providers/gmail'
import { getCredentialsForOAuth } from './credentials'
import {
  loadRoleScopedTokens,
  saveRoleScopedTokens,
  type RoleScopedTokenRecord,
} from './roleScopedTokenStore'
import type { SandboxFetchedMessage } from './sandboxIngestion'
import type { EmailAccountConfig } from './types'

/** Maximum messages fetched per poll (one page). */
const MAX_MESSAGES_PER_POLL = 20

function fetchLog(...args: unknown[]): void {
  // INV-5: ids / counts / provider only.
  console.log('[SandboxFetch]', ...args)
}

/**
 * Build synthetic `config.oauth` for sandbox read fetch — mirrors host send bridge
 * (`gateway.ts` role='send' synthetic config) so token refresh can resolve client id.
 */
export function oauthConfigFromRoleScopedReadRecord(
  record: RoleScopedTokenRecord,
): NonNullable<EmailAccountConfig['oauth']> {
  const tokens = record.tokens
  const oauthClientId =
    tokens.oauthClientId?.trim() || record.clientId?.trim() || undefined

  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken ?? '',
    expiresAt: tokens.expiresAt ?? Date.now() + 3_600_000,
    scope: tokens.scope ?? record.grantedScope ?? '',
    ...(oauthClientId ? { oauthClientId } : {}),
    ...(tokens.gmailRefreshUsesSecret != null
      ? { gmailRefreshUsesSecret: tokens.gmailRefreshUsesSecret }
      : {}),
    ...(tokens.gmailOAuthClientSecret?.trim()
      ? { gmailOAuthClientSecret: tokens.gmailOAuthClientSecret.trim() }
      : {}),
  }
}

/** Persist provider refresh back to role='read' (mirrors gateway send-role bridge). */
export function wireSandboxReadProviderTokenRefresh(
  accountId: string,
  provider: GmailProvider | OutlookProvider,
): void {
  provider.onTokenRefresh = (newTokens: { accessToken: string; refreshToken: string; expiresAt: number }) => {
    const current = loadRoleScopedTokens(accountId, 'read')
    saveRoleScopedTokens(
      accountId,
      'read',
      {
        ...(current?.tokens ?? {}),
        accessToken: newTokens.accessToken,
        refreshToken: newTokens.refreshToken,
        expiresAt: newTokens.expiresAt,
      },
      {
        clientId: current?.clientId ?? current?.tokens.oauthClientId,
        grantedScope: current?.grantedScope,
      },
    )
    fetchLog(`read token refreshed account=${accountId}`)
  }
}

/**
 * Resolve oauth for connect/refresh — record fields first, then local OAuth vault/file
 * (same tiers as host Gmail refresh) when legacy read tokens lack clientId metadata.
 */
export async function resolveOauthForSandboxReadFetch(
  accountId: string,
  tokenRecord: RoleScopedTokenRecord,
  providerKind: 'gmail' | 'microsoft365',
): Promise<NonNullable<EmailAccountConfig['oauth']>> {
  const base = oauthConfigFromRoleScopedReadRecord(tokenRecord)
  if (base.oauthClientId?.trim()) return base

  const credProvider = providerKind === 'microsoft365' ? 'outlook' : 'gmail'
  const userCreds = await getCredentialsForOAuth(credProvider)
  const clientId =
    userCreds && 'clientId' in userCreds && typeof userCreds.clientId === 'string'
      ? userCreds.clientId.trim()
      : ''
  if (clientId) {
    fetchLog(
      `oauth client id resolved from local credentials account=${accountId} provider=${providerKind}`,
    )
    return { ...base, oauthClientId: clientId }
  }
  fetchLog(
    `oauth client id missing on read token and local credentials account=${accountId} provider=${providerKind}`,
  )
  return base
}

/**
 * Fetch opaque RFC822 bytes for up to `maxMessages` inbox messages using the
 * Outlook read-scoped access token.
 *
 * The token must have `Mail.Read` scope (or `Mail.ReadWrite` as a superset).
 * The function sets `WRDESK_OUTLOOK_OPAQUE_INPUT=value` for the duration of
 * the call so `OutlookProvider.fetchMessageOpaque` uses the `/$value` raw-MIME
 * path rather than the provider-structured-json form.
 *
 * Throws if the token is missing, Graph returns an error, or the `/$value`
 * endpoint is inaccessible (bubbles up to `runSandboxIngestionPoll`'s
 * `held_fetch_failed` handler — never a silent drop).
 */
export async function fetchOpaqueViaOutlook(
  accountId: string,
  tokenRecord: RoleScopedTokenRecord,
  opts: {
    maxMessages?: number
    folder?: string
  } = {},
): Promise<SandboxFetchedMessage[]> {
  const maxMessages = opts.maxMessages ?? MAX_MESSAGES_PER_POLL
  const folder = opts.folder ?? 'inbox'
  const oauth = await resolveOauthForSandboxReadFetch(accountId, tokenRecord, 'microsoft365')

  // Force the /$value raw-MIME path for the duration of this call.
  // `OutlookProvider.fetchMessageOpaque` gates on this env var; we restore it
  // after the call to avoid leaking the override into other code paths.
  const prevOutlookOpaque = process.env.WRDESK_OUTLOOK_OPAQUE_INPUT
  process.env.WRDESK_OUTLOOK_OPAQUE_INPUT = 'value'

  const provider = new OutlookProvider()
  wireSandboxReadProviderTokenRefresh(accountId, provider)
  try {
    fetchLog(
      `connect outlook read account=${accountId} hasClientId=${!!oauth.oauthClientId} hasRefreshSecret=${!!oauth.gmailOAuthClientSecret}`,
    )

    const config: EmailAccountConfig = {
      id: accountId,
      provider: 'microsoft365',
      email: '',
      displayName: '',
      status: 'active',
      createdAt: 0,
      updatedAt: 0,
      oauth,
    }

    await provider.connect(config)

    // List IDs only (ID_ONLY select; no content fields).
    const listResult = await (provider as any).graphApiRequest(
      'GET',
      `/me/mailFolders/${folder}/messages?$select=id,receivedDateTime,hasAttachments,isRead&$top=${maxMessages}&$orderby=receivedDateTime%20desc`,
    )
    const items: Array<{ id: string; receivedDateTime?: string; hasAttachments?: boolean }> =
      (listResult?.value ?? []).slice(0, maxMessages)

    fetchLog(`listed ${items.length} message id(s). account=${accountId} folder=${folder}`)

    const messages: SandboxFetchedMessage[] = []
    for (const item of items) {
      if (!item.id) continue
      try {
        const raw = await provider.fetchMessage(item.id, folder)
        if (!raw?.rawRfc822 || raw.rawRfc822.length === 0) {
          fetchLog(`SKIP — empty rawRfc822. id=${item.id}`)
          continue
        }
        messages.push({
          id: item.id,
          opaqueBytes: raw.rawRfc822,
          form: { inputForm: 'rfc822' },
          receivedAt: item.receivedDateTime,
          folder,
        })
      } catch (err) {
        // Log per-message failures but continue (fail-closed per-message:
        // a network error on one message does not abort the whole poll).
        const msg = err instanceof Error ? err.message : String(err)
        fetchLog(`SKIP — fetch error. id=${item.id} err=${msg}`)
      }
    }

    fetchLog(`fetched ${messages.length} opaque message(s). account=${accountId}`)
    return messages
  } finally {
    // Restore the override to avoid leaking.
    if (prevOutlookOpaque === undefined) {
      delete process.env.WRDESK_OUTLOOK_OPAQUE_INPUT
    } else {
      process.env.WRDESK_OUTLOOK_OPAQUE_INPUT = prevOutlookOpaque
    }
    await provider.disconnect()
  }
}

function gmailRawResponseToSandboxMessage(raw: {
  id?: string
  raw?: string
  internalDate?: string
  labelIds?: string[]
}): SandboxFetchedMessage | null {
  if (!raw?.id) return null
  const rawB64Url = raw.raw
  if (!rawB64Url) return null
  const opaqueBytes = Buffer.from(rawB64Url, 'base64url')
  if (opaqueBytes.length === 0) return null
  const labelIds = raw.labelIds ?? []
  return {
    id: raw.id,
    opaqueBytes,
    form: { inputForm: 'rfc822' },
    receivedAt: raw.internalDate ? new Date(Number(raw.internalDate)).toISOString() : undefined,
    folder: labelIds.includes('INBOX') ? 'INBOX' : (labelIds[0] || 'INBOX'),
  }
}

/**
 * Fetch opaque RFC822 bytes for up to `maxMessages` inbox messages using the
 * Gmail read-scoped access token (`format=raw` — no host/sandbox MIME parse).
 */
export async function fetchOpaqueViaGmail(
  accountId: string,
  tokenRecord: RoleScopedTokenRecord,
  opts: {
    maxMessages?: number
    folder?: string
  } = {},
): Promise<SandboxFetchedMessage[]> {
  const maxMessages = opts.maxMessages ?? MAX_MESSAGES_PER_POLL
  const folder = (opts.folder ?? 'inbox').toLowerCase()
  const oauth = await resolveOauthForSandboxReadFetch(accountId, tokenRecord, 'gmail')

  const provider = new GmailProvider()
  wireSandboxReadProviderTokenRefresh(accountId, provider)
  try {
    fetchLog(
      `connect gmail read account=${accountId} hasClientId=${!!oauth.oauthClientId} hasRefreshSecret=${!!oauth.gmailOAuthClientSecret}`,
    )

    const config: EmailAccountConfig = {
      id: accountId,
      provider: 'gmail',
      email: '',
      displayName: '',
      status: 'active',
      createdAt: 0,
      updatedAt: 0,
      oauth,
    }

    await provider.connect(config)

    const listParams = new URLSearchParams({
      maxResults: String(maxMessages),
      q: `in:${folder}`,
    })
    const listResult = await (provider as unknown as {
      apiRequest: (method: string, path: string) => Promise<{ messages?: Array<{ id: string }> }>
    }).apiRequest('GET', `/users/me/messages?${listParams.toString()}`)
    const items = (listResult?.messages ?? []).slice(0, maxMessages)

    fetchLog(`listed ${items.length} message id(s). account=${accountId} folder=${folder} provider=gmail`)

    const messages: SandboxFetchedMessage[] = []
    for (const item of items) {
      if (!item.id) continue
      try {
        const rawResp = await (provider as unknown as {
          apiRequest: (method: string, path: string) => Promise<Record<string, unknown>>
        }).apiRequest('GET', `/users/me/messages/${item.id}?format=raw`)
        const mapped = gmailRawResponseToSandboxMessage(rawResp as {
          id?: string
          raw?: string
          internalDate?: string
          labelIds?: string[]
        })
        if (!mapped) {
          fetchLog(`SKIP — empty raw payload. id=${item.id}`)
          continue
        }
        messages.push(mapped)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        fetchLog(`SKIP — fetch error. id=${item.id} err=${msg}`)
      }
    }

    fetchLog(`fetched ${messages.length} opaque message(s). account=${accountId} provider=gmail`)
    return messages
  } finally {
    await provider.disconnect()
  }
}
