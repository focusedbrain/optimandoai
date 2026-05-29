/**
 * Shared Podman setup status for IPC + renderer broadcast.
 */

import type { PodmanSetupErrorCode } from './podmanDetect.js'
import { getPodSetupErrorRef, isPodmanProbeComplete } from './podStatus.js'
import { getInstallActionsForPlatform } from './podmanInstallRunner.js'
import {
  buildLinuxEngineOperatorInstruction,
  buildLinuxOperatorInstruction,
  detectLinuxDistroHint,
} from './linuxDistroDetect.js'
import { getPodmanSetupRunSnapshot } from './podmanSetupRunState.js'

export type PodmanSetupPhase =
  | 'checking'
  | 'need_package'
  | 'need_machine_init'
  | 'need_machine_start'
  | 'need_engine'
  | 'need_operator_install'
  | 'need_restart'
  | 'need_virtualization'
  | 'ready'

export type PodmanTerminalAction =
  | 'none'
  | 'one_click'
  | 'restart'
  | 'operator_install'
  | 'enable_virtualization'
  | 'manual'

export function derivePodmanSetupPhase(
  probePending: boolean,
  code: PodmanSetupErrorCode | null,
  plat: NodeJS.Platform = process.platform,
): PodmanSetupPhase {
  if (probePending) return 'checking'
  if (!code) return 'ready'
  if (plat === 'linux' && code === 'not_installed') return 'need_operator_install'
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
    case 'need_operator_install':
      return 'Operator action required'
    case 'need_restart':
      return 'Restart required to continue'
    case 'need_virtualization':
      return 'Enable virtualization to continue'
    case 'ready':
      return 'Podman is ready'
  }
}

export function setupPhaseSummary(phase: PodmanSetupPhase, plat: NodeJS.Platform): string {
  switch (phase) {
    case 'checking':
      return 'WR Desk uses container isolation as a core security measure. Verifying Podman on this computer…'
    case 'need_package':
      return plat === 'win32'
        ? 'Podman on Windows uses WSL2. One click installs WSL (if needed), Podman, and starts secure isolation.'
        : 'WR Desk uses container isolation as a core security measure. One click installs Podman on this Mac.'
    case 'need_machine_init':
    case 'need_machine_start':
      return 'Podman is installed. One click will finish setup and start secure isolation.'
    case 'need_engine':
      return plat === 'linux'
        ? 'Podman is present but the engine is not responding on this server.'
        : 'Podman is present but not responding. Try setup again or restart Podman Desktop.'
    case 'need_operator_install':
      return 'WR Desk requires Podman for security isolation. This server needs a one-time install by your operator.'
    case 'need_restart':
      return 'Windows needs a restart before Podman setup can finish.'
    case 'need_virtualization':
      return 'Podman on Windows requires WSL2, which needs hardware virtualization enabled.'
    case 'ready':
      return ''
  }
}

export function resolveTerminalAction(
  phase: PodmanSetupPhase,
  plat: NodeJS.Platform,
  canAuto: boolean,
): PodmanTerminalAction {
  switch (phase) {
    case 'need_restart':
      return 'restart'
    case 'need_virtualization':
      return 'enable_virtualization'
    case 'need_operator_install':
      return 'operator_install'
    case 'need_package':
    case 'need_machine_init':
    case 'need_machine_start':
      if ((plat === 'win32' || plat === 'darwin') && canAuto) return 'one_click'
      return 'manual'
    case 'need_engine':
      return plat === 'linux' ? 'operator_install' : canAuto ? 'one_click' : 'manual'
    default:
      return 'none'
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
  terminalAction: PodmanTerminalAction
  operatorInstruction: string | null
  canOneClickSetup: boolean
  oneClickLabel: string
  setupRunning: boolean
  setupStep: string
  setupStepLabel: string
  setupFailure: { kind?: string; message: string; detail?: string } | null
  showPackageInstall: boolean
  showMachineSteps: boolean
  install: ReturnType<typeof getInstallActionsForPlatform>
  machineInitCommand: string
  machineStartCommand: string
}

function resolveOperatorInstruction(
  plat: NodeJS.Platform,
  code: PodmanSetupErrorCode | null,
  runDetail: string | undefined,
): string | null {
  if (runDetail?.includes('operator must run')) return runDetail
  if (plat !== 'linux' || !code) return null
  if (code === 'not_installed') return buildLinuxOperatorInstruction(detectLinuxDistroHint())
  if (code === 'engine_unhealthy') return buildLinuxEngineOperatorInstruction()
  return null
}

export function buildPodmanSetupStatusSnapshot(): PodmanSetupStatusSnapshot {
  const err = getPodSetupErrorRef()
  const probePending = !isPodmanProbeComplete()
  const plat = process.platform
  const install = getInstallActionsForPlatform(plat)
  const code = err?.code ?? null
  const run = getPodmanSetupRunSnapshot()

  let setupPhase = derivePodmanSetupPhase(probePending, code, plat)
  if (run.setupFailure?.kind === 'restart_required') setupPhase = 'need_restart'
  else if (run.setupFailure?.kind === 'virtualization') setupPhase = 'need_virtualization'
  else if (run.setupFailure?.kind === 'operator_instruction') setupPhase = 'need_operator_install'

  const operatorInstruction = resolveOperatorInstruction(plat, code, run.setupFailure?.detail)
  const terminalAction = resolveTerminalAction(setupPhase, plat, install.canAutoInstall)
  const needsSetup = setupPhase !== 'checking' && setupPhase !== 'ready'

  const canOneClickSetup =
    terminalAction === 'one_click' &&
    needsSetup &&
    !run.setupRunning &&
    (plat === 'win32' || plat === 'darwin')

  const headline =
    run.setupFailure?.kind === 'restart_required'
      ? run.setupFailure.message
      : setupPhaseHeadline(setupPhase)
  const summary =
    run.setupFailure?.kind === 'restart_required' && run.setupFailure.detail
      ? run.setupFailure.detail
      : setupPhaseSummary(setupPhase, plat)

  return {
    required: err != null,
    probePending,
    code,
    userMessage: err?.userMessage ?? null,
    platform: plat,
    setupPhase,
    headline,
    summary,
    terminalAction,
    operatorInstruction,
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
