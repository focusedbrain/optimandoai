/**
 * Edge fetch migration — move account to / from REMOTE_EDGE mail-fetcher.
 */

import { gmailProvider } from '../providers/gmail.js'
import { outlookProvider } from '../providers/outlook.js'
import { resolveGmailOAuthForConnect, defaultGmailOAuthCredentialSource } from '../gmailOAuthResolve.js'
import { emailGateway } from '../gateway.js'
import type { EmailAccountConfig } from '../types.js'
import { connectReplicaActionSsh, findEdgeReplica } from '../../edge-tier/replicaActions.js'
import type { ReplicaActionSshRunner } from '../../edge-tier/replicaActions.js'
import {
  encryptAccountCredentialBundle,
  mapProviderToEmailFetch,
  WRAPPED_ACCOUNT_KEY_PLACEHOLDER,
} from './credentialBundle.js'
import { mailFetcherRemoteRequest } from './mailFetcherRemote.js'
import type { EdgeFetchMigrationInput, EdgeFetchSshCredentials } from './types.js'
import { notifyEdgeFetchStateChanged } from './events.js'
import { rememberSupervisorSshSession } from './supervisorPoll.js'

async function withReplicaSsh<T>(
  replicaId: string,
  creds: EdgeFetchSshCredentials,
  fn: (ssh: ReplicaActionSshRunner) => Promise<T>,
): Promise<T> {
  const replica = findEdgeReplica(replicaId)
  const ssh = await connectReplicaActionSsh(replica, {
    replicaId,
    sshUser: creds.sshUser,
    sshPort: creds.sshPort,
    sshKey: creds.sshKey,
    passphrase: creds.passphrase,
  })
  try {
    return await fn(ssh)
  } finally {
    await ssh.disconnect()
  }
}

async function refreshOAuthForAccount(accountId: string): Promise<EmailAccountConfig> {
  const row = emailGateway.getAccountConfig(accountId)
  if (!row) throw new Error('Account not found')

  if (row.provider === 'gmail') {
    const resolved = await resolveGmailOAuthForConnect(defaultGmailOAuthCredentialSource())
    const tokens = await gmailProvider.startOAuthFlow(row.email, resolved)
    const oauth: NonNullable<EmailAccountConfig['oauth']> = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      scope: typeof tokens.scope === 'string' ? tokens.scope : row.oauth?.scope ?? '',
      oauthClientId: resolved.clientId,
      gmailRefreshUsesSecret: resolved.authMode === 'legacy_secret',
      ...(tokens.gmailOAuthClientSecret?.trim() || resolved.clientSecret
        ? {
            gmailOAuthClientSecret:
              tokens.gmailOAuthClientSecret?.trim() || String(resolved.clientSecret ?? '').trim(),
          }
        : {}),
    }
    await emailGateway.updateAccount(accountId, { oauth, status: 'active', lastError: undefined })
  } else if (row.provider === 'microsoft365') {
    const { oauth, email } = await outlookProvider.startOAuthFlow()
    await emailGateway.updateAccount(accountId, {
      oauth,
      email: email || row.email,
      status: 'active',
      lastError: undefined,
    })
  } else {
    throw new Error('Only Gmail and Microsoft 365 support edge fetch migration')
  }

  const updated = emailGateway.getAccountConfig(accountId)
  if (!updated) throw new Error('Account disappeared after OAuth')
  return updated
}

async function setEdgeFetchMeta(
  accountId: string,
  patch: Partial<NonNullable<EmailAccountConfig['edgeFetch']>>,
): Promise<void> {
  const row = emailGateway.getAccountConfig(accountId)
  if (!row) throw new Error('Account not found')
  const prev = row.edgeFetch
  const next = {
    replicaId: patch.replicaId ?? prev?.replicaId ?? '',
    state: patch.state ?? prev?.state ?? 'not_on_edge',
    remoteState: patch.remoteState ?? prev?.remoteState,
    lastError: patch.lastError,
    lastRemoteSyncAt: patch.lastRemoteSyncAt ?? prev?.lastRemoteSyncAt,
    updatedAt: Date.now(),
  } as NonNullable<EmailAccountConfig['edgeFetch']>
  if (!next.lastError) delete (next as { lastError?: string }).lastError
  if (!next.remoteState) delete (next as { remoteState?: string }).remoteState
  if (next.state === 'not_on_edge') {
    await emailGateway.updateAccount(accountId, { edgeFetch: undefined })
  } else {
    await emailGateway.updateAccount(accountId, { edgeFetch: next })
  }
  notifyEdgeFetchStateChanged()
}

async function transferToMailFetcher(
  ssh: ReplicaActionSshRunner,
  account: EmailAccountConfig,
): Promise<void> {
  const fetchProvider = mapProviderToEmailFetch(account.provider)
  if (!fetchProvider) throw new Error('Unsupported provider for edge fetch')

  const { encryptedBundle, accountKeyHex } = encryptAccountCredentialBundle(account)
  const start = await mailFetcherRemoteRequest(ssh, 'POST', '/accounts/start', {
    account_id: account.id,
    provider: fetchProvider,
    encrypted_bundle: encryptedBundle,
    wrapped_account_key: WRAPPED_ACCOUNT_KEY_PLACEHOLDER,
  })
  if (start.status !== 200) {
    throw new Error(String(start.json.error ?? `start failed (${start.status})`))
  }

  await setEdgeFetchMeta(account.id, { state: 'awaiting_key', remoteState: 'awaiting_key' })

  const deliver = await mailFetcherRemoteRequest(ssh, 'POST', '/accounts/deliver_key', {
    account_id: account.id,
    account_key: accountKeyHex,
  })
  if (deliver.status !== 200) {
    throw new Error(String(deliver.json.error ?? `deliver_key failed (${deliver.status})`))
  }
}

export async function migrateAccountToEdge(input: EdgeFetchMigrationInput): Promise<void> {
  const accountId = input.accountId.trim()
  if (!accountId) throw new Error('accountId required')

  const row = emailGateway.getAccountConfig(accountId)
  if (!row) throw new Error('Account not found')

  await setEdgeFetchMeta(accountId, {
    replicaId: input.replicaId,
    state: 'migrating',
    lastError: undefined,
  })

  rememberSupervisorSshSession(input.replicaId, input)

  try {
    const refreshed = await refreshOAuthForAccount(accountId)
    await withReplicaSsh(input.replicaId, input, async (ssh) => {
      await transferToMailFetcher(ssh, refreshed)
    })

    await emailGateway.setProcessingPaused(accountId, true)
    await setEdgeFetchMeta(accountId, {
      replicaId: input.replicaId,
      state: 'active',
      remoteState: 'active',
      lastError: undefined,
      lastRemoteSyncAt: new Date().toISOString(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await setEdgeFetchMeta(accountId, {
      replicaId: input.replicaId,
      state: 'not_on_edge',
      lastError: message,
    })
    throw err
  }
}

export async function reauthorizeEdgeAccount(input: EdgeFetchMigrationInput): Promise<void> {
  await migrateAccountToEdge(input)
  await setEdgeFetchMeta(input.accountId, {
    replicaId: input.replicaId,
    state: 'active',
    remoteState: 'active',
    lastError: undefined,
  })
}

export async function migrateAccountBackToDesktop(input: EdgeFetchMigrationInput): Promise<void> {
  const accountId = input.accountId.trim()
  const row = emailGateway.getAccountConfig(accountId)
  if (!row?.edgeFetch?.replicaId) throw new Error('Account is not on the edge')

  const replicaId = row.edgeFetch.replicaId
  await setEdgeFetchMeta(accountId, { state: 'migrating_back' })
  rememberSupervisorSshSession(replicaId, input)

  try {
    await withReplicaSsh(replicaId, input, async (ssh) => {
      const stop = await mailFetcherRemoteRequest(ssh, 'POST', '/accounts/stop', {
        account_id: accountId,
      })
      if (stop.status !== 200) {
        throw new Error(String(stop.json.error ?? `stop failed (${stop.status})`))
      }
    })

    await setEdgeFetchMeta(accountId, { state: 'not_on_edge' })

    const cfg = emailGateway.getAccountConfig(accountId)
    if (cfg) {
      try {
        const test = await emailGateway.testConnection(accountId)
        if (!test.success) {
          await refreshOAuthForAccount(accountId)
        }
      } catch {
        await refreshOAuthForAccount(accountId)
      }
      await emailGateway.setProcessingPaused(accountId, false)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await setEdgeFetchMeta(accountId, { state: 'degraded', lastError: message })
    throw err
  }
}

export function broadcastEdgeFetchAccounts(): void {
  notifyEdgeFetchStateChanged()
}
