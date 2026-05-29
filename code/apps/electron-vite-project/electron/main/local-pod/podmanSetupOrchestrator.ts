/**
 * One-click Podman setup — platform-aware: Windows (WSL2 + machine), macOS, Linux (operator).
 * WSL is NOT installed at runtime — manual instruction or NSIS installer only.
 */

import { clearPodmanBinCacheForTest, type PodmanSetupErrorCode } from './podmanDetect.js'
import {
  buildLinuxEngineOperatorInstruction,
  buildLinuxOperatorInstruction,
  detectLinuxDistroHint,
} from './linuxDistroDetect.js'
import {
  getInstallActionsForPlatform,
  runPodmanInstallAction,
  type PodmanCommandResult,
} from './podmanInstallRunner.js'
import { refreshPodmanSetupProbe, invalidatePodmanSetupProbeCache } from './podmanSetupProbe.js'
import { broadcastPodmanSetupState } from './podmanSetupBroadcast.js'
import {
  buildWindowsWslManualInstruction,
  unexpectedSetupErrorMessage,
  wslIssueRequiresManualInstall,
} from './podmanSetupCopy.js'
import {
  beginPodmanSetupRun,
  completePodmanSetupRun,
  failPodmanSetupRun,
  isPodmanSetupRunActive,
  resetPodmanSetupRunIdle,
  setPodmanSetupRunStep,
  type PodmanSetupRunStep,
} from './podmanSetupRunState.js'
import {
  rebootRequiredMessage,
  virtualizationRequiredMessage,
  type WslIssue,
} from './wslProbe.js'
import { getWslStatusCache, refreshWslStatusCache } from './podmanWslStatusCache.js'

export interface PodmanFullSetupResult {
  ok: boolean
  failure?: { kind?: string; message: string; detail?: string }
  lastCommand?: PodmanCommandResult
}

function clearPodmanBinCache(): void {
  clearPodmanBinCacheForTest()
}

function broadcastProgress(): void {
  broadcastPodmanSetupState()
}

function plainFailure(
  message: string,
  detail?: string,
  kind: 'error' | 'restart_required' | 'operator_instruction' | 'virtualization' = 'error',
): PodmanFullSetupResult {
  return { ok: false, failure: { kind, message, detail } }
}

function hardFailureMessage(code: PodmanSetupErrorCode | null): string {
  switch (code) {
    case 'not_installed':
      return 'Podman could not be installed automatically. See podman.io or try again after fixing prerequisites.'
    case 'machine_not_initialized':
    case 'machine_not_running':
      return 'Podman is installed but its container environment could not be started.'
    case 'engine_unhealthy':
      return 'Podman is installed but not responding.'
    default:
      return 'Podman setup did not finish.'
  }
}

function hardFailureDetail(code: PodmanSetupErrorCode | null): string {
  switch (code) {
    case 'not_installed':
      return 'Install Podman from podman.io if automatic setup cannot continue.'
    case 'machine_not_initialized':
    case 'machine_not_running':
      return 'Try setup again after WSL and Podman Desktop prerequisites are met.'
    case 'engine_unhealthy':
      return 'Restart Podman Desktop or your computer, then open WR Desk again.'
    default:
      return 'Open the install guide at podman.io if the problem persists.'
  }
}

function manualWslBlock(issue: WslIssue): PodmanFullSetupResult {
  const manual = buildWindowsWslManualInstruction(issue)
  failPodmanSetupRun({
    kind: 'operator_instruction',
    message: manual.headline,
    detail: manual.instruction,
  })
  broadcastProgress()
  return plainFailure(manual.headline, manual.instruction, 'operator_instruction')
}

/** Returns a terminal block when WSL is not ready — never spawns elevated install. */
async function checkWindowsWslPrerequisite(): Promise<PodmanFullSetupResult | null> {
  const diagnosis =
    (await refreshWslStatusCache({ force: false, reason: 'user_setup' })) ??
    getWslStatusCache()

  if (!diagnosis || diagnosis.issue === 'ready') {
    return null
  }

  if (diagnosis.issue === 'virtualization_disabled') {
    const msg = virtualizationRequiredMessage()
    failPodmanSetupRun({ kind: 'virtualization', message: msg.message, detail: msg.detail })
    broadcastProgress()
    return plainFailure(msg.message, msg.detail, 'virtualization')
  }

  if (diagnosis.rebootRequired) {
    const msg = rebootRequiredMessage('wsl_fresh_install')
    failPodmanSetupRun({ kind: 'restart_required', message: msg.message, detail: msg.detail })
    broadcastProgress()
    return plainFailure(msg.message, msg.detail, 'restart_required')
  }

  if (wslIssueRequiresManualInstall(diagnosis.issue)) {
    return manualWslBlock(diagnosis.issue)
  }

  return null
}

async function reprobe(): Promise<PodmanSetupErrorCode | null> {
  clearPodmanBinCache()
  const err = await refreshPodmanSetupProbe({ force: true, skipBroadcast: true })
  broadcastProgress()
  return err?.code ?? null
}

async function runStep(
  step: Exclude<PodmanSetupRunStep, 'idle' | 'failed' | 'complete'>,
  action: Parameters<typeof runPodmanInstallAction>[0],
): Promise<PodmanCommandResult> {
  setPodmanSetupRunStep(step)
  broadcastProgress()
  const result = await runPodmanInstallAction(action)
  broadcastProgress()
  return result
}

async function runMachinePlatformSetup(
  lastCommandRef: { current?: PodmanCommandResult },
): Promise<PodmanFullSetupResult | null> {
  let code = await reprobe()
  if (!code) return null

  if (code === 'not_installed') {
    const installActions = getInstallActionsForPlatform(process.platform)
    if (!installActions.canAutoInstall || !installActions.installAction) {
      const msg = hardFailureMessage('not_installed')
      failPodmanSetupRun({ kind: 'error', message: msg, detail: installActions.manualHint })
      broadcastProgress()
      return plainFailure(msg, installActions.manualHint)
    }

    lastCommandRef.current = await runStep('installing', installActions.installAction)
    if (!lastCommandRef.current.ok) {
      failPodmanSetupRun({
        kind: 'error',
        message: hardFailureMessage('not_installed'),
        detail: hardFailureDetail('not_installed'),
      })
      broadcastProgress()
      return plainFailure(hardFailureMessage('not_installed'), hardFailureDetail('not_installed'))
    }

    code = await reprobe()
    if (code === 'not_installed') {
      const msg = rebootRequiredMessage()
      failPodmanSetupRun({ kind: 'restart_required', message: msg.message, detail: msg.detail })
      broadcastProgress()
      return plainFailure(msg.message, msg.detail, 'restart_required')
    }
  }

  if (code === 'machine_not_initialized') {
    lastCommandRef.current = await runStep('creating_environment', 'machine_init')
    if (!lastCommandRef.current.ok) {
      failPodmanSetupRun({
        kind: 'error',
        message: hardFailureMessage('machine_not_initialized'),
        detail: hardFailureDetail('machine_not_initialized'),
      })
      broadcastProgress()
      return plainFailure(
        hardFailureMessage('machine_not_initialized'),
        hardFailureDetail('machine_not_initialized'),
      )
    }
    code = await reprobe()
  }

  if (code === 'machine_not_running') {
    lastCommandRef.current = await runStep('starting', 'machine_start')
    if (!lastCommandRef.current.ok) {
      failPodmanSetupRun({
        kind: 'error',
        message: hardFailureMessage('machine_not_running'),
        detail: hardFailureDetail('machine_not_running'),
      })
      broadcastProgress()
      return plainFailure(
        hardFailureMessage('machine_not_running'),
        hardFailureDetail('machine_not_running'),
      )
    }
    code = await reprobe()
  }

  setPodmanSetupRunStep('verifying')
  broadcastProgress()
  code = await reprobe()

  if (code) {
    failPodmanSetupRun({
      kind: 'error',
      message: hardFailureMessage(code),
      detail: hardFailureDetail(code),
    })
    broadcastProgress()
    return plainFailure(hardFailureMessage(code), hardFailureDetail(code))
  }

  return null
}

async function runWindowsPodmanSetup(): Promise<PodmanFullSetupResult> {
  const lastCommandRef: { current?: PodmanCommandResult } = {}

  const wslBlock = await checkWindowsWslPrerequisite()
  if (wslBlock) return { ...wslBlock, lastCommand: lastCommandRef.current }

  const machineBlock = await runMachinePlatformSetup(lastCommandRef)
  if (machineBlock) return { ...machineBlock, lastCommand: lastCommandRef.current }

  completePodmanSetupRun()
  broadcastProgress()
  return { ok: true, lastCommand: lastCommandRef.current }
}

async function runMacPodmanSetup(): Promise<PodmanFullSetupResult> {
  const lastCommandRef: { current?: PodmanCommandResult } = {}
  const block = await runMachinePlatformSetup(lastCommandRef)
  if (block) return { ...block, lastCommand: lastCommandRef.current }

  completePodmanSetupRun()
  broadcastProgress()
  return { ok: true, lastCommand: lastCommandRef.current }
}

/** Linux: verify only — operator must install Podman with root. */
async function runLinuxPodmanSetup(): Promise<PodmanFullSetupResult> {
  setPodmanSetupRunStep('verifying')
  broadcastProgress()

  const code = await reprobe()
  if (!code) {
    completePodmanSetupRun()
    broadcastProgress()
    return { ok: true }
  }

  const hint = detectLinuxDistroHint()
  const instruction =
    code === 'engine_unhealthy'
      ? buildLinuxEngineOperatorInstruction()
      : buildLinuxOperatorInstruction(hint)

  failPodmanSetupRun({
    kind: 'operator_instruction',
    message: 'Operator action required on this server',
    detail: instruction,
  })
  broadcastProgress()
  return plainFailure('Operator action required on this server', instruction, 'operator_instruction')
}

/**
 * Runs Podman setup when prerequisites allow. WSL must already be installed (manual or installer).
 */
export async function runFullPodmanSetup(): Promise<PodmanFullSetupResult> {
  if (isPodmanSetupRunActive()) {
    const message = 'Setup is already running.'
    const detail = 'Wait for the current step to finish. If nothing is happening, restart WR Desk and try again.'
    failPodmanSetupRun({ kind: 'error', message, detail })
    broadcastProgress()
    return plainFailure(message, detail)
  }

  const plat = process.platform

  if (plat === 'win32') {
    const wslBlock = await checkWindowsWslPrerequisite()
    if (wslBlock) {
      return wslBlock
    }
  }

  if (!beginPodmanSetupRun('installing')) {
    const message = 'Setup could not start.'
    const detail = 'Restart WR Desk and try again.'
    failPodmanSetupRun({ kind: 'error', message, detail })
    broadcastProgress()
    return plainFailure(message, detail)
  }

  invalidatePodmanSetupProbeCache()
  broadcastProgress()

  try {
    if (plat === 'linux') {
      return runLinuxPodmanSetup()
    }
    if (plat === 'win32') {
      return runWindowsPodmanSetup()
    }
    if (plat === 'darwin') {
      return runMacPodmanSetup()
    }

    failPodmanSetupRun({
      kind: 'error',
      message: 'Unsupported platform for automatic Podman setup.',
      detail: 'Install Podman manually from podman.io.',
    })
    broadcastProgress()
    return plainFailure('Unsupported platform for automatic Podman setup.', 'Install Podman from podman.io.')
  } catch (err) {
    console.error('[PODMAN_SETUP] runFullPodmanSetup failed:', err instanceof Error ? err.message : err)
    failPodmanSetupRun({
      kind: 'error',
      message: unexpectedSetupErrorMessage(),
      detail: 'Try again, or install Podman manually from podman.io.',
    })
    broadcastProgress()
    return plainFailure(
      unexpectedSetupErrorMessage(),
      'Try again, or install Podman manually from podman.io.',
    )
  }
}

/** Test helper — reset run state between cases. */
export function resetPodmanSetupRunStateForTest(): void {
  resetPodmanSetupRunIdle()
}
