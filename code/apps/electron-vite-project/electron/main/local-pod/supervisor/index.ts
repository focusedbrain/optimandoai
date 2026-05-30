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
import { pollContainerHealthOutcome } from '../containerHealth.js'
import {
  inspectContainerState,
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
import { isBeapImagePresent, restoreBeapPodImage } from '../imageDigestVerify.js'
import { LOCAL_POD_HEALTH_PROBE_TIMEOUT_MS } from '../podConstants.js'

export { LOCAL_POD_HEALTH_PROBE_TIMEOUT_MS } from '../podConstants.js'

export const LOCAL_POD_HEALTH_PROBE_INTERVAL_MS = 5_000
export const LOCAL_POD_STUCK_HEALTH_THRESHOLD = 3

/** When this many required containers are missing, individual replace cannot recover. */
const FULL_RESTART_MISSING_THRESHOLD = 2

const consecutiveFailures = new Map<string, number>()

let _pollTimer: ReturnType<typeof setInterval> | null = null
let _activePodName: string | null = null
let _stopPodFn: (() => Promise<void>) | null = null
let _restartPodFn: (() => Promise<void>) | null = null
let _fullRestartInFlight = false
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
  restartPod: () => Promise<void>,
): void {
  stopLocalPodSupervisor()
  _activePodName = podName
  _stopPodFn = stopPod
  _restartPodFn = restartPod
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
  _restartPodFn = null
  _fullRestartInFlight = false
  _replacing.clear()
  consecutiveFailures.clear()
}

async function scheduleFullPodRestart(reason: string): Promise<void> {
  const podName = _activePodName
  if (!podName || _fullRestartInFlight || !_restartPodFn) return

  _fullRestartInFlight = true
  stopLocalPodSupervisor()
  console.log(`[LOCAL_POD_SUPERVISOR] Full pod restart: ${reason}`)

  try {
    if (!(await isBeapImagePresent())) {
      await restoreBeapPodImage()
    }
    clearReplacementBudgetForPod(podName)
    clearHostPodSupervisorHaltForRetry()
    await _restartPodFn()
  } catch (err) {
    console.warn(
      `[LOCAL_POD_SUPERVISOR] Full restart failed: ${(err as Error).message ?? err}`,
    )
  } finally {
    _fullRestartInFlight = false
  }
}

async function pollOnce(): Promise<void> {
  const podName = _activePodName
  if (!podName || getHostPodSupervisorState() !== 'healthy') return

  const { ensurePodmanMachineRunningForPodOps } = await import('../podmanMachineRecovery.js')
  if (!(await ensurePodmanMachineRunningForPodOps())) {
    console.warn('[LOCAL_POD_SUPERVISOR] Podman machine unavailable — waiting for auto-recovery')
    return
  }

  const { podExistsLocally } = await import('../podReconcile.js')
  if (!(await podExistsLocally(podName))) {
    await scheduleFullPodRestart('pod_missing')
    return
  }

  const specs = containersForPodName(podName)
  const nowMs = Date.now()
  let missingCount = 0

  for (const spec of specs) {
    const state = await inspectContainerState(spec.containerName)
    if (state === 'missing') {
      missingCount++
    }
    await pollContainer(podName, spec, nowMs)
  }

  if (missingCount >= FULL_RESTART_MISSING_THRESHOLD) {
    await scheduleFullPodRestart(`containers_missing count=${missingCount}`)
    return
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
    const outcome = await pollContainerHealthOutcome(
      spec.containerName,
      spec.port,
      LOCAL_POD_HEALTH_PROBE_TIMEOUT_MS,
    )
    if (outcome === 'ok') {
      recordProbeOutcome(podName, spec.role, true)
      return
    }
    if (outcome === 'inconclusive') {
      return
    }
    const stuck = recordProbeOutcome(podName, spec.role, false)
    if (stuck) {
      console.log(
        `[LOCAL_POD_SUPERVISOR] Stuck health on ${spec.role} — replacing container`,
      )
      await replaceContainer(podName, spec, nowMs, 'stuck_health')
    }
    return
  }

  if (state === 'exited' || state === 'missing' || state === 'unknown') {
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
      await scheduleFullPodRestart(
        `replacement budget exhausted for ${spec.role}`,
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
      const { resetContainerHealthStreak } = await import('../containerHealth.js')
      resetContainerHealthStreak(spec.containerName)
      console.log(
        `[LOCAL_POD_SUPERVISOR] Replaced ${spec.role} (${reason})`,
      )
    } else {
      console.warn(`[LOCAL_POD_SUPERVISOR] Replace failed for ${spec.role}`)
      await scheduleFullPodRestart(`replace_failed role=${spec.role}`)
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

/** Machine watchdog — machine recovered after WSL idle stop; pods must be reconciled. */
export async function scheduleFullPodRestartFromWatchdog(reason: string): Promise<void> {
  await scheduleFullPodRestart(reason)
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
