/**
 * VM reboot recovery — automatic mail-fetcher key re-delivery (P4.5.8).
 *
 * Polls each healthy replica every 60s. When mail-fetcher reports awaiting_key,
 * unwraps the VMK-wrapped account key and calls /accounts/deliver_key over SSH.
 */

import { parseAccountKeyHex, zeroizeBuffer } from '@repo/email-fetch'
import { emailGateway } from '../email/gateway.js'
import { connectReplicaActionSsh } from './replicaActions.js'
import type { ReplicaActionSshRunner } from './replicaActions.js'
import type { EdgeTierPodVault } from './podLifecycle.js'
import { loadEdgeTierSettings, type EdgeReplica } from './settings.js'
import { getCachedReplicaHealth } from './dashboard.js'
import {
  AccountKeyUnwrapError,
  VaultLockedError,
  hasWrappedAccountKey,
  isVaultAvailableForAccountKeys,
  loadAccountKeyHex,
} from './accountKeyStorage.js'
import { hasReplicaSshCredentials, loadReplicaSshCredentials } from './replicaSshStorage.js'
import { appendEdgeRecoveryAudit } from './verificationAudit.js'
import { notifyRecoveryEvent } from './recoveryNotify.js'
import { notifyEdgeVerificationsUpdated } from './ipc.js'
import { notifyEdgeFetchStateChanged } from '../email/edgeFetch/events.js'
import { deliverQuarantineKeyToReplica } from './quarantineDeliver.js'
import {
  mailFetcherGetAccountStatus,
  mailFetcherRemoteRequest,
} from '../email/edgeFetch/mailFetcherRemote.js'
import type { MailFetcherAccountStatusWire } from '../email/edgeFetch/types.js'

export const REBOOT_RECOVERY_POLL_MS = 60_000

export interface RebootRecoveryDeps {
  connectSsh: (
    replica: EdgeReplica,
    replicaId: string,
    creds: { sshUser: string; sshPort: number; sshKey: string; passphrase?: string },
  ) => Promise<ReplicaActionSshRunner>
  getAccountStatus: (ssh: ReplicaActionSshRunner) => Promise<MailFetcherAccountStatusWire[]>
  deliverKey: (
    ssh: ReplicaActionSshRunner,
    accountId: string,
    accountKeyHex: string,
  ) => Promise<{ ok: boolean; status: number; error?: string }>
  now: () => number
}

const defaultDeps: RebootRecoveryDeps = {
  async connectSsh(replica, replicaId, creds) {
    return connectReplicaActionSsh(replica, {
      replicaId,
      sshUser: creds.sshUser,
      sshPort: creds.sshPort,
      sshKey: creds.sshKey,
      passphrase: creds.passphrase,
    })
  },
  getAccountStatus: mailFetcherGetAccountStatus,
  async deliverKey(ssh, accountId, accountKeyHex) {
    const res = await mailFetcherRemoteRequest(ssh, 'POST', '/accounts/deliver_key', {
      account_id: accountId,
      account_key: accountKeyHex,
    })
    return {
      ok: res.status === 200,
      status: res.status,
      error: res.status !== 200 ? String(res.json.error ?? `HTTP ${res.status}`) : undefined,
    }
  },
  now: () => Date.now(),
}

let _vault: EdgeTierPodVault | null = null
let _deps: RebootRecoveryDeps = defaultDeps
let _pollTimer: ReturnType<typeof setInterval> | null = null
const _vaultLockedNotified = new Set<string>()

export function initRebootRecovery(vault: EdgeTierPodVault): void {
  _vault = vault
}

export function _setRebootRecoveryDepsForTest(deps: Partial<RebootRecoveryDeps> | null): void {
  _deps = deps ? { ...defaultDeps, ...deps } : defaultDeps
}

export function _resetRebootRecoveryForTest(): void {
  stopRebootRecoveryPolling()
  _vault = null
  _deps = defaultDeps
  _vaultLockedNotified.clear()
}

export function startRebootRecoveryPolling(): void {
  if (_pollTimer) return
  void runRebootRecoveryCycle()
  _pollTimer = setInterval(() => {
    void runRebootRecoveryCycle()
  }, REBOOT_RECOVERY_POLL_MS)
}

export function stopRebootRecoveryPolling(): void {
  if (_pollTimer) {
    clearInterval(_pollTimer)
    _pollTimer = null
  }
}

export async function runRebootRecoveryCycle(): Promise<void> {
  const vault = _vault
  if (!vault) return

  const settings = loadEdgeTierSettings()
  if (!settings.enabled || settings.replicas.length === 0) return

  const edgeAccounts = emailGateway.listAccountsSync().filter((a) => {
    const st = a.edgeFetch?.state
    return st && st !== 'not_on_edge' && st !== 'migrating' && st !== 'migrating_back'
  })
  if (edgeAccounts.length === 0) return

  for (const replica of settings.replicas) {
    await recoverReplica(replica, vault)
  }
}

async function recoverReplica(replica: EdgeReplica, vault: EdgeTierPodVault): Promise<void> {
  const replicaId = replica.edge_pod_id
  const health = getCachedReplicaHealth(replicaId)
  if (health !== 'healthy') {
    return
  }

  const ownedAccounts = emailGateway.listAccountsSync().filter(
    (a) => a.edgeFetch?.replicaId?.toLowerCase() === replicaId.toLowerCase(),
  )
  if (ownedAccounts.length === 0) return

  if (!hasReplicaSshCredentials(replicaId)) {
    return
  }

  if (!isVaultAvailableForAccountKeys(vault)) {
    for (const row of ownedAccounts) {
      await handleVaultLocked(row.id, row.email, replicaId)
    }
    return
  }

  let sshCreds
  try {
    sshCreds = loadReplicaSshCredentials(replicaId, vault)
  } catch (err) {
    if (err instanceof VaultLockedError) {
      for (const row of ownedAccounts) {
        await handleVaultLocked(row.id, row.email, replicaId)
      }
    }
    return
  }
  if (!sshCreds) return

  let ssh: ReplicaActionSshRunner | null = null
  try {
    ssh = await _deps.connectSsh(replica, replicaId, sshCreds)
    const remoteAccounts = await _deps.getAccountStatus(ssh)
    const awaiting = remoteAccounts.filter((a) => a.state === 'awaiting_key')

    await deliverQuarantineKeyToReplica(ssh, replicaId, vault).catch((err) => {
      console.warn(
        `[EDGE_RECOVERY] quarantine key delivery failed replica=${replicaId}:`,
        err instanceof Error ? err.message : err,
      )
    })

    for (const remote of awaiting) {
      await deliverKeyForAccount(replicaId, remote.account_id, ssh, vault)
    }

    await syncRemoteStates(replicaId, remoteAccounts)
  } catch (err) {
    console.warn(
      `[EDGE_RECOVERY] replica ${replicaId} poll failed:`,
      err instanceof Error ? err.message : err,
    )
  } finally {
    await ssh?.disconnect()
  }
}

async function handleVaultLocked(
  accountId: string,
  email: string,
  replicaId: string,
): Promise<void> {
  const cfg = emailGateway.getAccountConfig(accountId)
  if (!cfg?.edgeFetch) return

  await emailGateway.updateAccount(accountId, {
    edgeFetch: {
      ...cfg.edgeFetch,
      state: 'awaiting_key',
      remoteState: 'awaiting_key',
      updatedAt: _deps.now(),
    },
  })

  const notifyKey = `${accountId}:vault_locked`
  if (!_vaultLockedNotified.has(notifyKey)) {
    _vaultLockedNotified.add(notifyKey)
    const message = `Edge account ${email} is waiting for vault unlock to resume email fetching.`
    notifyRecoveryEvent({
      accountId,
      email,
      message,
      kind: 'vault_locked',
    })
    appendEdgeRecoveryAudit({
      edge_pod_id: replicaId,
      account_id: accountId,
      result: 'vault_locked_waiting',
    })
    notifyEdgeVerificationsUpdated()
  }
  notifyEdgeFetchStateChanged()
}

async function deliverKeyForAccount(
  replicaId: string,
  accountId: string,
  ssh: ReplicaActionSshRunner,
  vault: EdgeTierPodVault,
): Promise<void> {
  const cfg = emailGateway.getAccountConfig(accountId)
  if (!cfg?.edgeFetch || !hasWrappedAccountKey(accountId)) return

  let accountKeyHex: string | null = null
  let accountKeyBuf: Buffer | undefined
  try {
    accountKeyHex = loadAccountKeyHex(accountId, vault)
    if (!accountKeyHex) return

    accountKeyBuf = parseAccountKeyHex(accountKeyHex)
    const result = await _deps.deliverKey(ssh, accountId, accountKeyHex)
    if (!result.ok) {
      console.warn(
        `[EDGE_RECOVERY] deliver_key failed account=${accountId} status=${result.status} err=${result.error}`,
      )
      return
    }

    _vaultLockedNotified.delete(`${accountId}:vault_locked`)

    await emailGateway.updateAccount(accountId, {
      edgeFetch: {
        ...cfg.edgeFetch,
        state: 'active',
        remoteState: 'active',
        lastError: undefined,
        lastRemoteSyncAt: new Date().toISOString(),
        updatedAt: _deps.now(),
      },
    })

    appendEdgeRecoveryAudit({
      edge_pod_id: replicaId,
      account_id: accountId,
      result: 'key_redelivered_after_restart',
    })
    notifyRecoveryEvent({
      accountId,
      email: cfg.email,
      message: `Email fetching for ${cfg.email} resumed on the edge after replica restart.`,
      kind: 'key_redelivered',
    })
    notifyEdgeVerificationsUpdated()
    notifyEdgeFetchStateChanged()
  } catch (err) {
    if (err instanceof VaultLockedError) {
      await handleVaultLocked(accountId, cfg.email, replicaId)
      return
    }
    if (err instanceof AccountKeyUnwrapError) {
      await emailGateway.updateAccount(accountId, {
        edgeFetch: {
          ...cfg.edgeFetch,
          state: 'degraded',
          remoteState: 'degraded',
          lastError: 'Stored account key could not be unwrapped — re-migrate this account.',
          updatedAt: _deps.now(),
        },
      })
      notifyRecoveryEvent({
        accountId,
        email: cfg.email,
        message: `Edge account ${cfg.email} needs re-migration (vault key may have changed).`,
        kind: 'unwrap_failed',
      })
      appendEdgeRecoveryAudit({
        edge_pod_id: replicaId,
        account_id: accountId,
        result: 'unwrap_failed_degraded',
      })
      notifyEdgeVerificationsUpdated()
      notifyEdgeFetchStateChanged()
    }
  } finally {
    if (accountKeyBuf) zeroizeBuffer(accountKeyBuf)
  }
}

async function syncRemoteStates(
  replicaId: string,
  remoteAccounts: MailFetcherAccountStatusWire[],
): Promise<void> {
  const byId = new Map(remoteAccounts.map((a) => [a.account_id, a]))
  for (const row of emailGateway.listAccountsSync()) {
    const meta = row.edgeFetch
    if (!meta || meta.replicaId.toLowerCase() !== replicaId.toLowerCase()) continue
    if (meta.state === 'migrating' || meta.state === 'migrating_back') continue
    const remote = byId.get(row.id)
    if (!remote) continue
    if (remote.state === meta.remoteState && remote.state === meta.state) continue
    const cfg = emailGateway.getAccountConfig(row.id)
    if (!cfg?.edgeFetch) continue
    const nextLocal =
      remote.state === 'active'
        ? 'active'
        : remote.state === 'degraded'
          ? 'degraded'
          : remote.state === 'awaiting_key'
            ? 'awaiting_key'
            : meta.state
    await emailGateway.updateAccount(row.id, {
      edgeFetch: {
        ...cfg.edgeFetch,
        state: nextLocal,
        remoteState: remote.state,
        lastError: remote.last_error ?? cfg.edgeFetch.lastError,
        lastRemoteSyncAt: new Date().toISOString(),
        updatedAt: _deps.now(),
      },
    })
  }
  notifyEdgeFetchStateChanged()
}
