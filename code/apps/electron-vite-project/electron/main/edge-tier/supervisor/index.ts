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
import { pickupQuarantineEntries } from './quarantinePickup.js'
import { reportStorageFilename, getReport } from './reportStore.js'
import { cleanupLocalQuarantine, getLocalQuarantineRetentionDays } from './quarantineStore.js'
import { deliverQuarantineKeyToReplica } from '../quarantineDeliver.js'
import { notifyDashboardUpdated } from '../dashboard.js'
import { inspectContainerStatus, replaceContainer, buildContainerIdCommand } from './replace.js'
import { buildKillContainerCommand } from '../ssh/deploy.js'
import {
  HEALTH_PROBE_INTERVAL_MS,
  HEALTH_PROBE_TIMEOUT_MS,
  probeContainerHealth,
  recordHealthProbeOutcome,
  resetHealthProbeState,
  _resetStuckDetectionForTest,
} from './supervisorPoll.js'
import { getSupervisorSigningPublicKeyClaim } from './supervisorSigningKey.js'
import { storeSupervisorStuckReport } from './supervisorStuckReport.js'
import {
  checkReplacementAllowed,
  isReplacementExhausted,
  recordReplacementCompleted,
  observeContainerRunning,
  observeContainerNotRunning,
  storeReplacementBudgetNotification,
  getReplacementBudgetNotifications,
  resumeAutomaticRecovery,
  clearReplacementBudgetOnNuclearReset,
  _resetReplacementBudgetForTest,
  MAX_REPLACEMENTS,
  WINDOW_SECONDS,
  type ReplacementBudgetNotification,
} from './replacementBudget.js'
import { notifyReplacementBudgetExhausted } from './replacementBudgetNotify.js'

export { getReplacementBudgetNotifications, resumeAutomaticRecovery, clearReplacementBudgetOnNuclearReset, _resetReplacementBudgetForTest }
export { resetHealthProbeState } from './supervisorPoll.js'
export type { ReplacementBudgetNotification }
export { HEALTH_PROBE_INTERVAL_MS, HEALTH_PROBE_TIMEOUT_MS, STUCK_THRESHOLD_CONSECUTIVE_FAILURES } from './supervisorPoll.js'

export const SUPERVISOR_POLL_INTERVAL_MS = HEALTH_PROBE_INTERVAL_MS

export type ContainerHealthState =
  | 'running'
  | 'exited'
  | 'missing'
  | 'unknown'
  | 'unreachable'
  | 'replacement_exhausted'

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
  probeContainerHealth: typeof probeContainerHealth
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
  probeContainerHealth,
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
  _resetReplacementBudgetForTest()
  _resetStuckDetectionForTest()
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

  cleanupLocalQuarantine(getLocalQuarantineRetentionDays(settings.quarantine_retention_days))

  const replicaStatuses: ReplicaSupervisorStatus[] = []
  for (const replica of settings.replicas) {
    replicaStatuses.push(await pollReplica(replica, vault))
  }
  _status = { ..._status, replicas: replicaStatuses }
  notifyDashboardUpdated()
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
      const nowMs = _deps.now()
      let state = await _deps.inspectStatus(ssh, spec.containerName)

      if (isReplacementExhausted(replicaId, spec.role)) {
        state = 'replacement_exhausted'
        resetHealthProbeState(replicaId, spec.role)
      } else if (state === 'running') {
        observeContainerRunning(replicaId, spec.role, nowMs)
      } else if (state === 'exited' || state === 'missing') {
        observeContainerNotRunning(replicaId, spec.role)
        resetHealthProbeState(replicaId, spec.role)
      } else {
        resetHealthProbeState(replicaId, spec.role)
      }

      containers.push({
        role: spec.role,
        container_name: spec.containerName,
        state,
        last_checked_at: checkedAt,
      })

      if (state === 'running') {
        const healthy = await _deps.probeContainerHealth(ssh, spec, HEALTH_PROBE_TIMEOUT_MS)
        const probeOutcome = recordHealthProbeOutcome(replicaId, spec.role, healthy)
        if (probeOutcome.isStuck) {
          const lockKey = `${replicaId}:${spec.role}`
          if (!_replacing.has(lockKey)) {
            _replacing.add(lockKey)
            try {
              await handleStuckContainer(replica, spec.role, spec.containerName, ssh, vault, nowMs)
            } finally {
              _replacing.delete(lockKey)
              resetHealthProbeState(replicaId, spec.role)
            }
          }
        }
      }

      if (state === 'replacement_exhausted') continue
      if (state !== 'exited') continue

      const allowance = checkReplacementAllowed(replicaId, spec.role, nowMs)
      if (!allowance.allowed) {
        if (allowance.reason === 'budget_exhausted' && allowance.newly_exhausted) {
          const notification = storeReplacementBudgetNotification(replicaId, spec.role, nowMs)
          appendSupervisorAudit({
            event: 'replacement_budget_exhausted',
            replica_id: replicaId,
            container_role: spec.role,
            success: false,
            reason: `max_${MAX_REPLACEMENTS}_in_${WINDOW_SECONDS}s`,
          })
          notifyReplacementBudgetExhausted(notification)
          notifyDashboardUpdated()
        }
        const exhaustedIndex = containers.length - 1
        containers[exhaustedIndex] = {
          ...containers[exhaustedIndex]!,
          state: 'replacement_exhausted',
        }
        continue
      }

      const lockKey = `${replicaId}:${spec.role}`
      if (_replacing.has(lockKey)) continue
      _replacing.add(lockKey)

      try {
        await handleExitedContainer(replica, spec.role, spec.containerName, ssh, vault, nowMs)
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

async function handleStuckContainer(
  replica: EdgeReplica,
  role: RemoteEdgeContainerRole,
  containerName: string,
  ssh: ReplicaActionSshRunner,
  vault: EdgeTierPodVault,
  nowMs: number,
): Promise<void> {
  const replicaId = replica.edge_pod_id

  const allowance = checkReplacementAllowed(replicaId, role, nowMs)
  if (!allowance.allowed) {
    if (allowance.reason === 'budget_exhausted' && allowance.newly_exhausted) {
      const notification = storeReplacementBudgetNotification(replicaId, role, nowMs)
      appendSupervisorAudit({
        event: 'replacement_budget_exhausted',
        replica_id: replicaId,
        container_role: role,
        success: false,
        reason: `max_${MAX_REPLACEMENTS}_in_${WINDOW_SECONDS}s`,
      })
      notifyReplacementBudgetExhausted(notification)
      notifyDashboardUpdated()
    }
    return
  }

  const idResult = await ssh.run(buildContainerIdCommand(containerName))
  const containerIdShort =
    idResult.stdout.trim().replace(/^sha256:/, '').slice(0, 12) || 'unknown'

  const supervisorPublicKeyClaim = getSupervisorSigningPublicKeyClaim(vault)
  const storedReport = storeSupervisorStuckReport(
    {
      replica,
      role,
      containerIdShort,
      previousUptimeSeconds: 0,
      vault,
      now: () => new Date(_deps.now()),
    },
    supervisorPublicKeyClaim,
  )
  const reportFilename = storedReport.stored && storedReport.filename
    ? reportStorageFilename(replicaId, storedReport.filename)
    : undefined

  await ssh.run(buildKillContainerCommand(containerName))

  const result = await _deps.replaceContainer(
    {
      replica,
      containerRole: role,
      ssh,
      vault,
      queuePosition: 0,
    },
    { healthTimeoutMs: 60_000, healthPollMs: 100 },
  )

  if (result.success) {
    recordReplacementCompleted(replicaId, role, nowMs, true)
    if (result.escalated_to_pod) {
      appendSupervisorAudit({
        event: 'pod_replaced',
        replica_id: replicaId,
        container_role: role,
        report_filename: reportFilename,
        duration_ms: result.replacement_duration_ms,
        success: true,
        reason: result.pod_escalation_reason ?? 'stuck_health_probe',
      })
    } else {
      await deliverQuarantineKeyToReplica(ssh, replicaId, vault).catch((err) => {
        console.warn(
          `[SUPERVISOR] quarantine key re-delivery failed replica=${replicaId}:`,
          err instanceof Error ? err.message : err,
        )
      })
      appendSupervisorAudit({
        event: 'container_replaced',
        replica_id: replicaId,
        container_role: role,
        report_filename: reportFilename,
        duration_ms: result.replacement_duration_ms,
        success: true,
        reason: 'stuck_health_probe',
      })
    }
  } else {
    recordReplacementCompleted(replicaId, role, nowMs, false)
    appendSupervisorAudit({
      event: result.escalated_to_pod ? 'pod_replaced_failed' : 'container_replaced_failed',
      replica_id: replicaId,
      container_role: role,
      report_filename: reportFilename,
      success: false,
      reason: result.reason,
    })
  }
}

async function handleExitedContainer(
  replica: EdgeReplica,
  role: RemoteEdgeContainerRole,
  containerName: string,
  ssh: ReplicaActionSshRunner,
  vault: EdgeTierPodVault,
  nowMs: number,
): Promise<void> {
  const replicaId = replica.edge_pod_id
  const pickup = await _deps.pickupReports(ssh, replicaId, replica.edge_public_key, containerName)
  const storedReports = pickup.reports.filter((r) => r.storeResult.stored)
  const storedReport = storedReports[0]
  const reportFilename = storedReport
    ? reportStorageFilename(replicaId, storedReport.filename)
    : undefined

  if (storedReports.length > 0) {
    const reportContents = storedReports
      .map((r) => getReport(replicaId, r.filename) ?? '')
      .filter(Boolean)
    const quarantinePickup = await pickupQuarantineEntries(
      ssh,
      replicaId,
      containerName,
      reportContents,
    )
    for (const entry of quarantinePickup.entries) {
      appendSupervisorAudit({
        event: 'message_quarantined',
        replica_id: replicaId,
        container_role: entry.failed_container_role,
        message_hash: entry.hash,
        envelope_from: entry.envelope_from,
        success: true,
      })
    }
    notifyDashboardUpdated()
  }

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
    recordReplacementCompleted(replicaId, role, nowMs, true)
    if (result.escalated_to_pod) {
      appendSupervisorAudit({
        event: 'pod_replaced',
        replica_id: replicaId,
        container_role: role,
        report_filename: reportFilename,
        duration_ms: result.replacement_duration_ms,
        success: true,
        reason: result.pod_escalation_reason,
      })
    } else {
      await deliverQuarantineKeyToReplica(ssh, replicaId, vault).catch((err) => {
        console.warn(
          `[SUPERVISOR] quarantine key re-delivery failed replica=${replicaId}:`,
          err instanceof Error ? err.message : err,
        )
      })
      appendSupervisorAudit({
        event: 'container_replaced',
        replica_id: replicaId,
        container_role: role,
        report_filename: reportFilename,
        duration_ms: result.replacement_duration_ms,
        success: true,
      })
    }
  } else {
    recordReplacementCompleted(replicaId, role, nowMs, false)
    appendSupervisorAudit({
      event: result.escalated_to_pod ? 'pod_replaced_failed' : 'container_replaced_failed',
      replica_id: replicaId,
      container_role: role,
      report_filename: reportFilename,
      success: false,
      reason: result.reason,
    })
  }
}
