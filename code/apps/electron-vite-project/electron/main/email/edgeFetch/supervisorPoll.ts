/**
 * Poll mail-fetcher supervisor on REMOTE_EDGE replicas (30s interval).
 *
 * SSH credentials are kept in memory briefly after a migration action so background
 * polls can merge remote `degraded` / `active` without re-prompting every 30s.
 * Full reboot recovery deliver_key flow is P4.5.8.
 */

import { loadEdgeTierSettings } from '../../edge-tier/settings.js'
import { connectReplicaActionSsh, findEdgeReplica } from '../../edge-tier/replicaActions.js'
import { emailGateway } from '../gateway.js'
import { mailFetcherGetAccountStatus } from './mailFetcherRemote.js'
import type { EdgeFetchMigrationInput, EdgeFetchSshCredentials, MailFetcherRemoteState } from './types.js'
import { notifyEdgeFetchStateChanged } from './events.js'

const POLL_MS = 30_000
const SSH_SESSION_TTL_MS = 10 * 60_000

interface CachedSshSession extends EdgeFetchSshCredentials {
  readonly replicaId: string
  readonly expiresAt: number
}

let pollTimer: ReturnType<typeof setInterval> | null = null
const sshSessions = new Map<string, CachedSshSession>()

export function rememberSupervisorSshSession(replicaId: string, creds: EdgeFetchSshCredentials): void {
  sshSessions.set(replicaId.toLowerCase(), {
    replicaId,
    sshUser: creds.sshUser,
    sshPort: creds.sshPort,
    sshKey: creds.sshKey,
    passphrase: creds.passphrase,
    expiresAt: Date.now() + SSH_SESSION_TTL_MS,
  })
}

export function clearSupervisorSshSessions(): void {
  sshSessions.clear()
}

function getCachedSession(replicaId: string): CachedSshSession | null {
  const hit = sshSessions.get(replicaId.toLowerCase())
  if (!hit) return null
  if (Date.now() > hit.expiresAt) {
    sshSessions.delete(replicaId.toLowerCase())
    return null
  }
  return hit
}

export async function refreshEdgeFetchRemoteStatus(replicaId: string, creds: EdgeFetchSshCredentials): Promise<void> {
  const replica = findEdgeReplica(replicaId)
  const ssh = await connectReplicaActionSsh(replica, {
    replicaId,
    sshUser: creds.sshUser,
    sshPort: creds.sshPort,
    sshKey: creds.sshKey,
    passphrase: creds.passphrase,
  })
  try {
    const remoteAccounts = await mailFetcherGetAccountStatus(ssh)
    const byId = new Map(remoteAccounts.map((a) => [a.account_id, a]))
    for (const row of emailGateway.listAccountsSync()) {
      const meta = row.edgeFetch
      if (!meta || meta.replicaId.toLowerCase() !== replicaId.toLowerCase()) continue
      if (meta.state === 'migrating' || meta.state === 'migrating_back') continue
      const remote = byId.get(row.id)
      const cfg = emailGateway.getAccountConfig(row.id)
      if (!cfg) continue
      const remoteState = (remote?.state ?? 'stopped') as MailFetcherRemoteState
      const nextLocal =
        remoteState === 'active'
          ? 'active'
          : remoteState === 'degraded'
            ? 'degraded'
            : remoteState === 'awaiting_key'
              ? 'awaiting_key'
              : meta.state
      await emailGateway.updateAccount(row.id, {
        edgeFetch: {
          ...meta,
          state: nextLocal,
          remoteState,
          lastError: remote?.last_error ?? meta.lastError,
          lastRemoteSyncAt: new Date().toISOString(),
          updatedAt: Date.now(),
        },
      })
    }
    notifyEdgeFetchStateChanged()
  } finally {
    await ssh.disconnect()
  }
}

async function pollTick(): Promise<void> {
  const settings = loadEdgeTierSettings()
  if (!settings.enabled || settings.replicas.length === 0) return

  const accounts = emailGateway.listAccountsSync()
  const replicaIds = new Set(
    accounts
      .map((a) => a.edgeFetch?.replicaId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  )
  if (replicaIds.size === 0) return

  for (const replicaId of replicaIds) {
    const session = getCachedSession(replicaId)
    if (!session) continue
    try {
      await refreshEdgeFetchRemoteStatus(replicaId, session)
    } catch {
      /* best-effort background poll */
    }
  }
}

export function startEdgeFetchSupervisorPoll(): void {
  if (pollTimer) return
  pollTimer = setInterval(() => {
    void pollTick()
  }, POLL_MS)
}

export function stopEdgeFetchSupervisorPoll(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

/** Manual refresh from UI (user supplies SSH key). */
export async function manualRefreshEdgeFetchStatus(input: EdgeFetchMigrationInput): Promise<void> {
  rememberSupervisorSshSession(input.replicaId, input)
  await refreshEdgeFetchRemoteStatus(input.replicaId, input)
}
