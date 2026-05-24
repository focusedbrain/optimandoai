/**
 * BEAP pod supervisor — container replacement and diagnostic report pickup (P5.4).
 */

import { connectReplicaActionSsh } from '../replicaActions.js'
import type { ReplicaActionSshRunner } from '../replicaActions.js'
import type { EdgeTierPodVault } from '../podLifecycle.js'
import { loadEdgeTierSettings, type EdgeReplica } from '../settings.js'
import {
  hasReplicaSshCredentials,
  loadReplicaSshCredentials,
} from '../replicaSshStorage.js'
import { VaultLockedError } from '../accountKeyStorage.js'
import { appendSupervisorAudit } from './auditLog.js'
import { REMOTE_EDGE_SUPERVISOR_CONTAINERS, type RemoteEdgeContainerRole } from './containers.js'
import { pickupDiagnosticReports } from './reportPickup.js'
import { reportStorageFilename } from './reportStore.js'
import { inspectContainerStatus, replaceContainer } from './replace.js'

export const SUPERVISOR_POLL_INTERVAL_MS = 10_000

export type ContainerHealthState = 'running' | 'exited' | 'missing' | 'unknown' | 'unreachable'

export interface ContainerStatusEntry {
  role: RemoteEdgeContainerRole
  container_name: string
  state: ContainerHealthState
  last_checked_at: string
}

export interface ReplicaSupervisorStatus {
  replica_id: string
  reachable: boolean
  unreachable_reason?: string
  containers: ContainerStatusEntry[]
  last_poll_at: string | null
}

export interface SupervisorStatus {
  running: boolean
  poll_interval_ms: number
  replicas: ReplicaSupervisorStatus[]
}

export interface SupervisorDeps {
  connectSsh: (
    replica: EdgeReplica,
    replicaId: string,
    creds: { sshUser: string; sshPort: number; sshKey: string; passphrase?: string },
  ) => Promise<ReplicaActionSshRunner>
  replaceContainer: typeof replaceContainer
  pickupReports: typeof pickupDiagnosticReports
  inspectStatus: typeof inspectContainerStatus
  now: () => number
}

const defaultDeps: SupervisorDeps = {
  async connectSsh(replica, replicaId, creds) {
    return connectReplicaActionSsh(replica, {
      replicaId,
      sshUser: creds.sshUser,
      sshPort: creds.sshPort,
      sshKey: creds.sshKey as unknown as Buffer,
      passphrase: creds.passphrase as unknown as Buffer | undefined,
    })
  },
  replaceContainer,
  pickupReports: pickupDiagnosticReports,
  inspectStatus: inspectContainerStatus,
  now: () => Date.now(),
}

let _vault: EdgeTierPodVault | null = null
let _deps: SupervisorDeps = defaultDeps
let _pollTimer: ReturnType<typeof setInterval> | null = null
let _status: SupervisorStatus = {
  running: false,
  poll_interval_ms: SUPERVISOR_POLL_INTERVAL_MS,
  replicas: [],
}
const _replacing = new Set<string>()

export function initPodSupervisor(vault: EdgeTierPodVault): void {
  _vault = vault
}

export function _setSupervisorDepsForTest(deps: Partial<SupervisorDeps> | null): void {
  _deps = deps ? { ...defaultDeps, ...deps } : defaultDeps
}

export function _resetPodSupervisorForTest(): void {
  stopPodSupervisor()
  _vault = null
  _deps = defaultDeps
  _status = {
    running: false,
    poll_interval_ms: SUPERVISOR_POLL_INTERVAL_MS,
    replicas: [],
  }
  _replacing.clear()
}

export class PodSupervisor {
  start(): void {
    startPodSupervisor()
  }

  stop(): void {
    stopPodSupervisor()
  }

  getStatus(): SupervisorStatus {
    return getPodSupervisorStatus()
  }
}

export function startPodSupervisor(): void {
  if (_pollTimer) return
  _status = { ..._status, running: true }
  void runSupervisorPollCycle()
  _pollTimer = setInterval(() => {
    void runSupervisorPollCycle()
  }, SUPERVISOR_POLL_INTERVAL_MS)
}

export function stopPodSupervisor(): void {
  if (_pollTimer) {
    clearInterval(_pollTimer)
    _pollTimer = null
  }
  _status = { ..._status, running: false }
}

export function getPodSupervisorStatus(): SupervisorStatus {
  return {
    running: _status.running,
    poll_interval_ms: _status.poll_interval_ms,
    replicas: _status.replicas.map((r) => ({
      ...r,
      containers: r.containers.map((c) => ({ ...c })),
    })),
  }
}

export async function runSupervisorPollCycle(): Promise<void> {
  const vault = _vault
  if (!vault) return

  const settings = loadEdgeTierSettings()
  if (!settings.enabled || settings.replicas.length === 0) {
    _status = { ..._status, replicas: [] }
    return
  }

  const replicaStatuses: ReplicaSupervisorStatus[] = []
  for (const replica of settings.replicas) {
    replicaStatuses.push(await pollReplica(replica, vault))
  }
  _status = { ..._status, replicas: replicaStatuses }
}

async function pollReplica(
  replica: EdgeReplica,
  vault: EdgeTierPodVault,
): Promise<ReplicaSupervisorStatus> {
  const replicaId = replica.edge_pod_id
  const checkedAt = new Date(_deps.now()).toISOString()
  const base: ReplicaSupervisorStatus = {
    replica_id: replicaId,
    reachable: true,
    containers: REMOTE_EDGE_SUPERVISOR_CONTAINERS.map((spec) => ({
      role: spec.role,
      container_name: spec.containerName,
      state: 'unknown' as ContainerHealthState,
      last_checked_at: checkedAt,
    })),
    last_poll_at: checkedAt,
  }

  if (!hasReplicaSshCredentials(replicaId)) {
    return { ...base, reachable: false, unreachable_reason: 'no_ssh_credentials' }
  }

  let sshCreds
  try {
    sshCreds = loadReplicaSshCredentials(replicaId, vault)
  } catch (err) {
    if (err instanceof VaultLockedError) {
      return { ...base, reachable: false, unreachable_reason: 'vault_locked' }
    }
    return { ...base, reachable: false, unreachable_reason: 'ssh_credentials_load_failed' }
  }
  if (!sshCreds) {
    return { ...base, reachable: false, unreachable_reason: 'no_ssh_credentials' }
  }

  let ssh: ReplicaActionSshRunner | null = null
  try {
    ssh = await _deps.connectSsh(replica, replicaId, sshCreds)
    const containers: ContainerStatusEntry[] = []

    for (const spec of REMOTE_EDGE_SUPERVISOR_CONTAINERS) {
      const state = await _deps.inspectStatus(ssh, spec.containerName)
      containers.push({
        role: spec.role,
        container_name: spec.containerName,
        state,
        last_checked_at: checkedAt,
      })

      if (state !== 'exited') continue

      const lockKey = `${replicaId}:${spec.role}`
      if (_replacing.has(lockKey)) continue
      _replacing.add(lockKey)

      try {
        await handleExitedContainer(replica, spec.role, spec.containerName, ssh, vault)
      } finally {
        _replacing.delete(lockKey)
      }
    }

    return { ...base, containers }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    const isNetwork =
      /timeout|timed out|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|network/i.test(reason)

    if (isNetwork) {
      appendSupervisorAudit({
        event: 'container_unreachable',
        replica_id: replicaId,
        container_role: '*',
        success: false,
        reason,
      })
      return {
        ...base,
        reachable: false,
        unreachable_reason: reason,
        containers: base.containers.map((c) => ({ ...c, state: 'unreachable' })),
      }
    }

    console.warn(`[SUPERVISOR] replica ${replicaId} poll failed:`, reason)
    return { ...base, reachable: false, unreachable_reason: reason }
  } finally {
    await ssh?.disconnect()
  }
}

async function handleExitedContainer(
  replica: EdgeReplica,
  role: RemoteEdgeContainerRole,
  containerName: string,
  ssh: ReplicaActionSshRunner,
  vault: EdgeTierPodVault,
): Promise<void> {
  const replicaId = replica.edge_pod_id
  const pickup = await _deps.pickupReports(ssh, replicaId, replica.edge_public_key, containerName)
  const storedReport = pickup.reports.find((r) => r.storeResult.stored)
  const reportFilename = storedReport
    ? reportStorageFilename(replicaId, storedReport.filename)
    : undefined

  const queuePosition = 0

  const result = await _deps.replaceContainer(
    {
      replica,
      containerRole: role,
      ssh,
      vault,
      queuePosition,
    },
    { healthTimeoutMs: 60_000, healthPollMs: 100 },
  )

  if (result.success) {
    appendSupervisorAudit({
      event: 'container_replaced',
      replica_id: replicaId,
      container_role: role,
      report_filename: reportFilename,
      duration_ms: result.replacement_duration_ms,
      success: true,
    })
  } else {
    appendSupervisorAudit({
      event: 'container_replaced_failed',
      replica_id: replicaId,
      container_role: role,
      report_filename: reportFilename,
      success: false,
      reason: result.reason,
    })
  }
}
