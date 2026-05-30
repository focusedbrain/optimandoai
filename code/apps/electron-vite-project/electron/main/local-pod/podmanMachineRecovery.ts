/**
 * Silent recovery for a provisioned-but-stopped Podman machine (Windows/macOS).
 * WSL2 idle shutdown is steady-state — not first-run setup.
 */

import { runPodmanInstallAction } from './podmanInstallRunner.js'
import { broadcastPodmanSetupState } from './podmanSetupBroadcast.js'
import type { PodmanDetectOptions, PodmanMachineProbeState } from './podmanDetect.js'

const MACHINE_START_POLL_MS = 2_000
const MACHINE_START_WAIT_MS = 120_000
const WATCHDOG_INTERVAL_MS = 30_000

let _recoveryActive = false
let _recoveryPromise: Promise<boolean> | null = null
let _watchdogTimer: ReturnType<typeof setInterval> | null = null
let _lastMachineState: PodmanMachineProbeState = 'not_applicable'

export function isPodmanMachineRecoveryActive(): boolean {
  return _recoveryActive
}

function platformRequiresMachine(platform: NodeJS.Platform): boolean {
  return platform === 'win32' || platform === 'darwin'
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function readMachineState(options?: PodmanDetectOptions): Promise<PodmanMachineProbeState> {
  const { probePodmanMachineState } = await import('./podmanDetect.js')
  return probePodmanMachineState(
    options?.execFile,
    options?.platform ?? process.platform,
  )
}

async function waitForMachineRunning(
  options: PodmanDetectOptions | undefined,
  deadlineMs: number,
): Promise<boolean> {
  const platform = options?.platform ?? process.platform
  const deadline = Date.now() + deadlineMs
  while (Date.now() < deadline) {
    const state = await readMachineState(options)
    if (state === 'running') return true
    if (state === 'none') return false
    await sleep(MACHINE_START_POLL_MS)
  }
  return false
}

async function recoverStoppedMachine(options?: PodmanDetectOptions): Promise<boolean> {
  const platform = options?.platform ?? process.platform
  if (!platformRequiresMachine(platform)) return true

  const state = await readMachineState(options)
  _lastMachineState = state
  if (state === 'running') return true
  if (state === 'none') return false

  console.log('[PODMAN_MACHINE] Provisioned machine stopped — auto-starting')
  _recoveryActive = true
  broadcastPodmanSetupState()

  try {
    const start = await runPodmanInstallAction('machine_start')
    if (!start.ok) {
      console.warn('[PODMAN_MACHINE] podman machine start failed')
      return false
    }

    const running = await waitForMachineRunning(options, MACHINE_START_WAIT_MS)
    if (running) {
      console.log('[PODMAN_MACHINE] Machine auto-start complete')
      _lastMachineState = 'running'
      const { invalidatePodmanSetupProbeCache } = await import('./podmanSetupProbe.js')
      invalidatePodmanSetupProbeCache()
      return true
    }

    console.warn('[PODMAN_MACHINE] Machine did not reach running state in time')
    return false
  } finally {
    _recoveryActive = false
    broadcastPodmanSetupState()
  }
}

/** Single-flight auto-start when a machine exists but is stopped. */
export async function runPodmanMachineAutoRecoveryIfNeeded(
  options?: PodmanDetectOptions,
): Promise<boolean> {
  if (_recoveryPromise) return _recoveryPromise

  _recoveryPromise = recoverStoppedMachine(options).finally(() => {
    _recoveryPromise = null
  })
  return _recoveryPromise
}

/** Pod supervisor / pod ops — ensure machine is up before podman exec. */
export async function ensurePodmanMachineRunningForPodOps(
  options?: PodmanDetectOptions,
): Promise<boolean> {
  return runPodmanMachineAutoRecoveryIfNeeded(options)
}

async function reconcileAfterMachineRecovery(): Promise<void> {
  const { invalidatePodmanSetupProbeCache, refreshPodmanSetupProbe } = await import(
    './podmanSetupProbe.js'
  )
  invalidatePodmanSetupProbeCache()
  await refreshPodmanSetupProbe({ force: true })

  const { getActiveLocalPodName, startLocalPodWhenSsoReady } = await import('./index.js')
  const podName = getActiveLocalPodName()
  if (podName) {
    const { scheduleFullPodRestartFromWatchdog } = await import('./supervisor/index.js')
    await scheduleFullPodRestartFromWatchdog('machine_recovered')
    return
  }

  void startLocalPodWhenSsoReady()
}

async function watchdogTick(): Promise<void> {
  const platform = process.platform
  if (!platformRequiresMachine(platform)) return

  try {
    const state = await readMachineState()
    if (state === 'running') {
      if (_lastMachineState === 'stopped') {
        _lastMachineState = 'running'
        await reconcileAfterMachineRecovery()
      } else {
        _lastMachineState = 'running'
      }
      return
    }

    if (state === 'stopped') {
      const wasRunning = _lastMachineState === 'running'
      _lastMachineState = 'stopped'
      const ok = await runPodmanMachineAutoRecoveryIfNeeded()
      if (ok && wasRunning) {
        await reconcileAfterMachineRecovery()
      } else if (ok) {
        const { invalidatePodmanSetupProbeCache, refreshPodmanSetupProbe } = await import(
          './podmanSetupProbe.js'
        )
        invalidatePodmanSetupProbeCache()
        await refreshPodmanSetupProbe({ force: true })
      }
    } else {
      _lastMachineState = state
    }
  } catch (err) {
    console.warn(
      '[PODMAN_MACHINE] Watchdog tick failed:',
      err instanceof Error ? err.message : err,
    )
  }
}

export function startPodmanMachineWatchdog(intervalMs = WATCHDOG_INTERVAL_MS): void {
  if (_watchdogTimer) return
  void watchdogTick()
  _watchdogTimer = setInterval(() => {
    void watchdogTick()
  }, intervalMs)
  _watchdogTimer.unref?.()
}

export function stopPodmanMachineWatchdog(): void {
  if (_watchdogTimer) {
    clearInterval(_watchdogTimer)
    _watchdogTimer = null
  }
}

export function resetPodmanMachineRecoveryForTest(): void {
  _recoveryActive = false
  _recoveryPromise = null
  _lastMachineState = 'not_applicable'
  stopPodmanMachineWatchdog()
}
