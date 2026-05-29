/**
 * Shared Podman setup status for IPC + renderer broadcast.
 */

import type { PodmanSetupErrorCode } from './podmanDetect.js'
import { getPodSetupErrorRef, isPodmanProbeComplete } from './podStatus.js'
import { getInstallActionsForPlatform } from './podmanInstallRunner.js'
import { getPodmanSetupRunSnapshot } from './podmanSetupRunState.js'

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
    case 'need_machine_start':
      return 'Finish Podman setup'
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
      return 'WR Desk uses container isolation as a core security measure. That requires Podman — install it once on this computer.'
    case 'need_machine_init':
    case 'need_machine_start':
      return 'Podman is installed. One click will finish setup and start secure isolation — no extra steps.'
    case 'need_engine':
      return 'Podman is present but not responding. Restart Podman Desktop (or your computer), then try setup again.'
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
  canOneClickSetup: boolean
  oneClickLabel: string
  setupRunning: boolean
  setupStep: string
  setupStepLabel: string
  setupFailure: { message: string; detail?: string } | null
  /** @deprecated use canOneClickSetup — kept for IPC compatibility */
  showPackageInstall: boolean
  /** @deprecated one-click flow — kept for IPC compatibility */
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
  const run = getPodmanSetupRunSnapshot()
  const needsSetup = setupPhase !== 'checking' && setupPhase !== 'ready'
  const canOneClickSetup =
    needsSetup && (install.canAutoInstall || setupPhase === 'need_engine' || plat === 'linux')

  return {
    required: err != null,
    probePending,
    code,
    userMessage: err?.userMessage ?? null,
    platform: plat,
    setupPhase,
    headline: setupPhaseHeadline(setupPhase),
    summary: setupPhaseSummary(setupPhase),
    canOneClickSetup,
    oneClickLabel: install.installLabel,
    setupRunning: run.setupRunning,
    setupStep: run.setupStep,
    setupStepLabel: run.setupStepLabel,
    setupFailure: run.setupFailure,
    showPackageInstall: setupPhase === 'need_package',
    showMachineSteps:
      setupPhase === 'need_machine_init' || setupPhase === 'need_machine_start',
    install,
    machineInitCommand: 'podman machine init --cpus 2 --memory 4096 --disk-size 100',
    machineStartCommand: 'podman machine start',
  }
}
