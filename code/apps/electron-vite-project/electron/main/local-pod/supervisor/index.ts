/**
 * Host pod supervisor — local Podman health, replacement, teardown (Stream A — A5).
 */

import {
  containersForPodName,
  type LocalPodContainerSpec,
} from './containers.js'
import {
  getHostPodSupervisorState,
  setHostPodSupervisorHealthy,
  setHostPodReplacementExhausted,
  setHostPodHaltedByAnomaly,
  clearHostPodSupervisorHaltForRetry,
} from './hostPodState.js'
import {
  inspectContainerState,
  probeContainerHealthLocal,
  restartContainerLocal,
  stopPodLocal,
} from './podmanLocal.js'
import {
  checkReplacementAllowed,
  recordReplacement,
  isReplacementExhausted,
  clearReplacementBudgetForPod,
  LOCAL_POD_MAX_REPLACEMENTS,
} from './replacementBudget.js'
import { pickupLocalDiagnosticReports } from './reportPickupLocal.js'
import { pickupLocalQuarantineEntries } from './quarantinePickupLocal.js'
import { notifyLocalPodSupervisorIssue } from '../notify.js'

export const LOCAL_POD_HEALTH_PROBE_INTERVAL_MS = 5_000
export const LOCAL_POD_HEALTH_PROBE_TIMEOUT_MS = 3_000
export const LOCAL_POD_STUCK_HEALTH_THRESHOLD = 3

const consecutiveFailures = new Map<string, number>()

let _pollTimer: ReturnType<typeof setInterval> | null = null
let _activePodName: string | null = null
let _stopPodFn: (() => Promise<void>) | null = null
const _replacing = new Set<string>()

function probeKey(podName: string, role: string): string {
  return `${podName}:${role}`
}

function recordProbeOutcome(podName: string, role: string, healthy: boolean): boolean {
  const key = probeKey(podName, role)
  if (healthy) {
    consecutiveFailures.delete(key)
    return false
  }
  const next = (consecutiveFailures.get(key) ?? 0) + 1
  consecutiveFailures.set(key, next)
  return next >= LOCAL_POD_STUCK_HEALTH_THRESHOLD
}

export function resetLocalSupervisorProbeState(podName?: string, role?: string): void {
  if (!podName) {
    consecutiveFailures.clear()
    return
  }
  if (role) {
    consecutiveFailures.delete(probeKey(podName, role))
    return
  }
  const prefix = `${podName}:`
  for (const k of consecutiveFailures.keys()) {
    if (k.startsWith(prefix)) consecutiveFailures.delete(k)
  }
}

export {
  getHostPodSupervisorState,
  clearHostPodSupervisorHaltForRetry,
  setHostPodSupervisorHealthy,
} from './hostPodState.js'

export function startLocalPodSupervisor(
  podName: string,
  stopPod: () => Promise<void>,
): void {
  stopLocalPodSupervisor()
  _activePodName = podName
  _stopPodFn = stopPod
  setHostPodSupervisorHealthy()
  clearReplacementBudgetForPod(podName)
  console.log(`[LOCAL_POD_SUPERVISOR] Started for pod ${podName}`)

  void pollOnce()
  _pollTimer = setInterval(() => {
    void pollOnce()
  }, LOCAL_POD_HEALTH_PROBE_INTERVAL_MS)
  _pollTimer.unref?.()
}

export function stopLocalPodSupervisor(): void {
  if (_pollTimer) {
    clearInterval(_pollTimer)
    _pollTimer = null
  }
  _activePodName = null
  _stopPodFn = null
  _replacing.clear()
  consecutiveFailures.clear()
}

async function pollOnce(): Promise<void> {
  const podName = _activePodName
  if (!podName || getHostPodSupervisorState() !== 'healthy') return

  const specs = containersForPodName(podName)
  const nowMs = Date.now()

  for (const spec of specs) {
    await pollContainer(podName, spec, nowMs)
  }

  await syncHostPodReadyAfterPoll(podName)

  if (specs.some((s) => s.role === 'depackager')) {
    const dep = specs.find((s) => s.role === 'depackager')
    if (dep) {
      try {
        const n = await pickupLocalQuarantineEntries(dep.containerName)
        if (n > 0) {
          console.log(`[LOCAL_POD_SUPERVISOR] Picked up ${n} quarantine entries`)
        }
      } catch {
        /* non-fatal */
      }
    }
  }
}

async function syncHostPodReadyAfterPoll(podName: string): Promise<void> {
  if (getHostPodSupervisorState() !== 'healthy') return

  try {
    const { checkRequiredPodContainersReady } = await import('../podContainerCompleteness.js')
    const { invalidateHostPodReadyCache, probeHostPodReady } = await import(
      '../../ingestion/edgeProbe.js'
    )
    const complete = await checkRequiredPodContainersReady(podName)
    if (!complete.ok) {
      invalidateHostPodReadyCache()
      try {
        const { refreshIngestionMode } = await import('../../ingestion/ingestionModeService.js')
        void refreshIngestionMode(true)
      } catch {
        /* optional */
      }
      return
    }
    await probeHostPodReady(true)
  } catch {
    /* tests / optional ingestion */
  }
}

async function pollContainer(
  podName: string,
  spec: LocalPodContainerSpec,
  nowMs: number,
): Promise<void> {
  if (getHostPodSupervisorState() !== 'healthy') return

  const lockKey = probeKey(podName, spec.role)
  if (_replacing.has(lockKey)) return

  if (isReplacementExhausted(podName, spec.role)) {
    return
  }

  const state = await inspectContainerState(spec.containerName)
  if (state === 'running') {
    const healthy = await probeContainerHealthLocal(
      spec.containerName,
      spec.port,
      LOCAL_POD_HEALTH_PROBE_TIMEOUT_MS,
    )
    const stuck = recordProbeOutcome(podName, spec.role, healthy)
    if (stuck) {
      console.log(
        `[LOCAL_POD_SUPERVISOR] Stuck health on ${spec.role} — replacing container`,
      )
      await replaceContainer(podName, spec, nowMs, 'stuck_health')
    }
    return
  }

  if (state === 'exited' || state === 'missing') {
    console.log(
      `[LOCAL_POD_SUPERVISOR] Container ${spec.role} state=${state} — replacing`,
    )
    await replaceContainer(podName, spec, nowMs, state)
  }
}

async function replaceContainer(
  podName: string,
  spec: LocalPodContainerSpec,
  nowMs: number,
  reason: string,
): Promise<void> {
  const lockKey = probeKey(podName, spec.role)
  if (_replacing.has(lockKey)) return

  const allowance = checkReplacementAllowed(podName, spec.role, nowMs)
  if (!allowance.allowed) {
    if (allowance.newlyExhausted) {
      await teardownPod(
        `Automatic recovery paused after ${LOCAL_POD_MAX_REPLACEMENTS} replacements for ${spec.role}.`,
        'replacement_exhausted',
      )
    }
    return
  }

  _replacing.add(lockKey)
  try {
    const reports = await pickupLocalDiagnosticReports(spec.containerName)
    for (const r of reports) {
      if (r.isEscalation) {
        await teardownPod(
          `Serious anomaly during verification (${r.filename}).`,
          'halted_by_anomaly',
        )
        return
      }
    }

    const ok = await restartContainerLocal(spec.containerName)
    if (ok) {
      recordReplacement(podName, spec.role, nowMs)
      resetLocalSupervisorProbeState(podName, spec.role)
      console.log(
        `[LOCAL_POD_SUPERVISOR] Replaced ${spec.role} (${reason})`,
      )
    } else {
      console.warn(`[LOCAL_POD_SUPERVISOR] Replace failed for ${spec.role}`)
    }
  } finally {
    _replacing.delete(lockKey)
  }
}

async function teardownPod(message: string, kind: 'replacement_exhausted' | 'halted_by_anomaly'): Promise<void> {
  console.error(`[LOCAL_POD_SUPERVISOR] Pod teardown: ${message}`)
  if (kind === 'halted_by_anomaly') {
    setHostPodHaltedByAnomaly(message)
  } else {
    setHostPodReplacementExhausted(message)
  }

  stopLocalPodSupervisor()

  if (_stopPodFn) {
    try {
      await _stopPodFn()
    } catch (err) {
      console.warn('[LOCAL_POD_SUPERVISOR] stopPod error:', (err as Error).message)
    }
  } else if (_activePodName) {
    await stopPodLocal(_activePodName)
  }

  notifyLocalPodSupervisorIssue(message)

  try {
    const { invalidateHostPodReadyCache, refreshIngestionMode } = await import(
      '../../ingestion/edgeProbe.js'
    )
    invalidateHostPodReadyCache()
    void refreshIngestionMode(true)
  } catch {
    /* optional */
  }
}

/** User retry from UI — clears halt and budget; caller must restart pod. */
export function userRetryLocalPodSupervisor(): void {
  if (_activePodName) {
    clearReplacementBudgetForPod(_activePodName)
  }
  clearHostPodSupervisorHaltForRetry()
}

export function _resetLocalPodSupervisorForTest(): void {
  stopLocalPodSupervisor()
  clearHostPodSupervisorHaltForRetry()
  clearReplacementBudgetForPod('beap-pod')
}
