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
import {
  mapWslIssueToPhase,
  podmanCodeHeadline,
  podmanCodeSummary,
  wslIssueHeadline,
  wslIssueSummary,
} from './podmanSetupCopy.js'
import { getPodmanSetupRunSnapshot } from './podmanSetupRunState.js'
import { getWslStatusCache } from './podmanWslStatusCache.js'

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
): PodmanTerminalAction {
  switch (phase) {
    case 'need_restart':
      return 'restart'
    case 'need_virtualization':
      return 'enable_virtualization'
    case 'need_operator_install':
      return plat === 'linux' ? 'operator_install' : 'manual'
    case 'need_package':
    case 'need_machine_init':
    case 'need_machine_start':
    case 'need_engine':
      return plat === 'win32' || plat === 'darwin' ? 'one_click' : 'operator_install'
    default:
      return 'none'
  }
}

export interface PodmanSetupStatusSnapshot {
  required: boolean
  probePending: boolean
  code: PodmanSetupErrorCode | null
  /** English-only status for display — never raw OS output. */
  statusMessage: string | null
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
  if (plat !== 'linux' || !code) return null
  if (runDetail?.includes('operator must run')) return runDetail
  if (code === 'not_installed') return buildLinuxOperatorInstruction(detectLinuxDistroHint())
  if (code === 'engine_unhealthy') return buildLinuxEngineOperatorInstruction()
  return null
}

function applyWindowsWslDisplay(
  plat: NodeJS.Platform,
  setupPhase: PodmanSetupPhase,
  headline: string,
  summary: string,
): { setupPhase: PodmanSetupPhase; headline: string; summary: string; statusMessage: string | null } {
  if (plat !== 'win32') {
    return { setupPhase, headline, summary, statusMessage: null }
  }
  const wsl = getWslStatusCache()
  if (!wsl || wsl.issue === 'ready') {
    return { setupPhase, headline, summary, statusMessage: null }
  }
  if (wsl.rebootRequired && setupPhase !== 'need_restart') {
    return {
      setupPhase: 'need_restart',
      headline: 'Restart required to continue',
      summary:
        'Windows needs a restart before Podman setup can finish. After restarting, open WR Desk again — setup will continue automatically.',
      statusMessage: null,
    }
  }
  const wslPhase = mapWslIssueToPhase(wsl.issue)
  const mergedPhase =
    setupPhase === 'need_machine_init' || setupPhase === 'need_machine_start'
      ? setupPhase
      : wslPhase === 'need_virtualization'
        ? 'need_virtualization'
        : wslPhase === 'need_package' &&
            (setupPhase === 'need_package' ||
              setupPhase === 'need_engine' ||
              setupPhase === 'need_machine_init' ||
              setupPhase === 'need_machine_start')
          ? 'need_package'
          : setupPhase

  if (wsl.issue !== 'ready' && mergedPhase === 'need_package') {
    return {
      setupPhase: mergedPhase,
      headline: wslIssueHeadline(wsl.issue),
      summary: wslIssueSummary(wsl.issue),
      statusMessage: null,
    }
  }
  if (wsl.issue === 'virtualization_disabled') {
    return {
      setupPhase: 'need_virtualization',
      headline: wslIssueHeadline(wsl.issue),
      summary: wslIssueSummary(wsl.issue),
      statusMessage: null,
    }
  }
  return { setupPhase, headline, summary, statusMessage: null }
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
  else if (run.setupFailure?.kind === 'operator_instruction' && plat === 'linux') {
    setupPhase = 'need_operator_install'
  }

  const failureActive = run.setupFailure && !run.setupRunning

  let headline =
    failureActive && run.setupFailure
      ? run.setupFailure.message
      : run.setupFailure?.kind === 'restart_required'
        ? run.setupFailure.message
        : code
          ? podmanCodeHeadline(code, plat)
          : setupPhaseHeadline(setupPhase)
  let summary =
    failureActive && run.setupFailure?.detail
      ? run.setupFailure.detail
      : run.setupFailure?.kind === 'restart_required' && run.setupFailure.detail
        ? run.setupFailure.detail
        : code
          ? podmanCodeSummary(code, plat)
          : setupPhaseSummary(setupPhase, plat)

  const wslDisplay = failureActive
    ? { setupPhase, headline, summary, statusMessage: null as string | null }
    : applyWindowsWslDisplay(plat, setupPhase, headline, summary)
  setupPhase = wslDisplay.setupPhase
  headline = wslDisplay.headline
  summary = wslDisplay.summary

  const operatorInstruction = resolveOperatorInstruction(plat, code, run.setupFailure?.detail)
  const terminalAction = resolveTerminalAction(setupPhase, plat)
  const needsSetup = setupPhase !== 'checking' && setupPhase !== 'ready'

  const blockedOneClick =
    setupPhase === 'need_restart' ||
    setupPhase === 'need_virtualization' ||
    (setupPhase === 'need_operator_install' && plat === 'linux')

  const canOneClickSetup =
    needsSetup &&
    !run.setupRunning &&
    !blockedOneClick &&
    (plat === 'win32' || plat === 'darwin') &&
    install.canAutoInstall

  const englishStatus = wslDisplay.statusMessage

  return {
    required: err != null,
    probePending,
    code,
    statusMessage: englishStatus,
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
