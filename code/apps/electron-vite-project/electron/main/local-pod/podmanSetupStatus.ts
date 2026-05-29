/**
 * Shared Podman setup status for IPC + renderer broadcast.
 */

import type { PodmanSetupErrorCode } from './podmanDetect.js'
import { getPodSetupErrorRef, isPodmanProbeComplete } from './podStatus.js'
import { getInstallActionsForPlatform } from './podmanInstallRunner.js'

export type PodmanSetupPhase =
  | 'checking'
  | 'need_package'
  | 'need_machine_init'
  | 'need_machine_start'
  | 'need_engine'
  | 'ready'

export function derivePodmanSetupPhase(
  probePending: boolean,
  code: PodmanSetupErrorCode | null,
): PodmanSetupPhase {
  if (probePending) return 'checking'
  if (!code) return 'ready'
  switch (code) {
    case 'not_installed':
      return 'need_package'
    case 'machine_not_initialized':
      return 'need_machine_init'
    case 'machine_not_running':
      return 'need_machine_start'
    case 'engine_unhealthy':
      return 'need_engine'
    case 'probe_pending':
      return 'checking'
    default:
      return 'need_engine'
  }
}

export function setupPhaseHeadline(phase: PodmanSetupPhase): string {
  switch (phase) {
    case 'checking':
      return 'Checking secure container setup…'
    case 'need_package':
      return 'Install Podman to continue'
    case 'need_machine_init':
      return 'Finish Podman setup (one-time)'
    case 'need_machine_start':
      return 'Start Podman to continue'
    case 'need_engine':
      return 'Podman needs attention'
    case 'ready':
      return 'Podman is ready'
  }
}

export function setupPhaseSummary(phase: PodmanSetupPhase): string {
  switch (phase) {
    case 'checking':
      return 'WR Desk uses container isolation as a core security measure. Verifying Podman on this computer…'
    case 'need_package':
      return 'WR Desk uses container isolation as a core security measure. That requires Podman — install it once on this computer, then continue setup here.'
    case 'need_machine_init':
      return 'Podman is installed. On Windows and Mac, create its background environment once, then start it whenever you use WR Desk.'
    case 'need_machine_start':
      return 'Podman is installed but its background environment is stopped. Start it to restore secure isolation.'
    case 'need_engine':
      return 'Podman is present but not responding. Try restarting Podman Desktop (or the Podman service), then check again.'
    case 'ready':
      return ''
  }
}

export interface PodmanSetupStatusSnapshot {
  required: boolean
  probePending: boolean
  code: PodmanSetupErrorCode | null
  userMessage: string | null
  platform: NodeJS.Platform
  setupPhase: PodmanSetupPhase
  headline: string
  summary: string
  showPackageInstall: boolean
  showMachineSteps: boolean
  install: ReturnType<typeof getInstallActionsForPlatform>
  machineInitCommand: string
  machineStartCommand: string
}

export function buildPodmanSetupStatusSnapshot(): PodmanSetupStatusSnapshot {
  const err = getPodSetupErrorRef()
  const probePending = !isPodmanProbeComplete()
  const plat = process.platform
  const install = getInstallActionsForPlatform(plat)
  const code = err?.code ?? null
  const setupPhase = derivePodmanSetupPhase(probePending, code)
  const showMachineSteps =
    setupPhase === 'need_machine_init' || setupPhase === 'need_machine_start'

  return {
    required: err != null,
    probePending,
    code,
    userMessage: err?.userMessage ?? null,
    platform: plat,
    setupPhase,
    headline: setupPhaseHeadline(setupPhase),
    summary: setupPhaseSummary(setupPhase),
    showPackageInstall: setupPhase === 'need_package',
    showMachineSteps,
    install,
    machineInitCommand: 'podman machine init',
    machineStartCommand: 'podman machine start',
  }
}
