/**
 * Poll mail-fetcher supervisor on REMOTE_EDGE replicas (30s interval).
 *
 * SSH credentials are kept in memory briefly after a migration action so background
 * polls can merge remote `degraded` / `active` without re-prompting every 30s.
 * Full reboot recovery deliver_key flow is P4.5.8.
 */

import { loadEdgeTierSettings, isEdgeTierActiveForRouting } from '../../edge-tier/settings.js'
import { connectReplicaActionSsh, findEdgeReplica } from '../../edge-tier/replicaActions.js'
import { registerCredentialClearer, zeroizeBuffer } from '../../security/zeroize.js'
import { emailGateway } from '../gateway.js'
import { mailFetcherGetAccountStatus } from './mailFetcherRemote.js'
import type { EdgeFetchMigrationInput, EdgeFetchSshCredentials, MailFetcherRemoteState } from './types.js'
import { notifyEdgeFetchStateChanged } from './events.js'

const POLL_MS = 30_000
const SSH_SESSION_TTL_MS = 10 * 60_000

interface CachedSshSession {
  readonly replicaId: string
  readonly sshUser: string
  readonly sshPort: number
  readonly sshKey: Buffer
  readonly passphrase?: Buffer
  readonly expiresAt: number
}

let pollTimer: ReturnType<typeof setInterval> | null = null
const sshSessions = new Map<string, CachedSshSession>()

registerCredentialClearer(() => clearSupervisorSshSessions())

function zeroizeCachedSession(session: CachedSshSession): void {
  zeroizeBuffer(session.sshKey)
  zeroizeBuffer(session.passphrase)
}

function removeCachedSession(replicaId: string): void {
  const key = replicaId.toLowerCase()
  const hit = sshSessions.get(key)
  if (hit) {
    zeroizeCachedSession(hit)
    sshSessions.delete(key)
  }
}

export function rememberSupervisorSshSession(replicaId: string, creds: EdgeFetchSshCredentials): void {
  removeCachedSession(replicaId)
  sshSessions.set(replicaId.toLowerCase(), {
    replicaId,
    sshUser: creds.sshUser,
    sshPort: creds.sshPort,
    sshKey: Buffer.from(creds.sshKey, 'utf8'),
    passphrase: creds.passphrase ? Buffer.from(creds.passphrase, 'utf8') : undefined,
    expiresAt: Date.now() + SSH_SESSION_TTL_MS,
  })
}

export function clearSupervisorSshSessions(): void {
  for (const session of sshSessions.values()) {
    zeroizeCachedSession(session)
  }
  sshSessions.clear()
}

function getCachedSession(replicaId: string): CachedSshSession | null {
  const key = replicaId.toLowerCase()
  const hit = sshSessions.get(key)
  if (!hit) return null
  if (Date.now() > hit.expiresAt) {
    removeCachedSession(replicaId)
    return null
  }
  return hit
}

/** Tests only — inspect cached credential buffers. */
export function _getSupervisorCachedSessionForTest(replicaId: string): CachedSshSession | null {
  return sshSessions.get(replicaId.toLowerCase()) ?? null
}

/** Tests only — force cache eviction (zero-and-drop). */
export function _expireSupervisorSessionForTest(replicaId: string): void {
  removeCachedSession(replicaId)
}

export async function refreshEdgeFetchRemoteStatus(replicaId: string, creds: EdgeFetchSshCredentials): Promise<void> {
  const replica = findEdgeReplica(replicaId)
  const sshKey = Buffer.from(creds.sshKey, 'utf8')
  const passphrase = creds.passphrase ? Buffer.from(creds.passphrase, 'utf8') : undefined
  try {
    const ssh = await connectReplicaActionSsh(replica, {
      replicaId,
      sshUser: creds.sshUser,
      sshPort: creds.sshPort,
      sshKey,
      passphrase,
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
  } finally {
    zeroizeBuffer(sshKey)
    zeroizeBuffer(passphrase)
  }
}

async function pollTick(): Promise<void> {
  const settings = loadEdgeTierSettings()
  if (!isEdgeTierActiveForRouting(settings) || settings.replicas.length === 0) return

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
      await refreshEdgeFetchRemoteStatus(replicaId, {
        sshUser: session.sshUser,
        sshPort: session.sshPort,
        sshKey: session.sshKey.toString('utf8'),
        passphrase: session.passphrase?.toString('utf8'),
      })
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
