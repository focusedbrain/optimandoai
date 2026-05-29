/**
 * One-click Podman setup — install package, init machine, start, verify (idempotent).
 */

import { platform } from 'node:os'

import { clearPodmanBinCacheForTest, type PodmanSetupErrorCode } from './podmanDetect.js'
import { getPodSetupErrorRef } from './podStatus.js'
import {
  getInstallActionsForPlatform,
  runPodmanInstallAction,
  type PodmanCommandResult,
} from './podmanInstallRunner.js'
import { refreshPodmanSetupProbe } from './podmanSetupProbe.js'
import { broadcastPodmanSetupState } from './podmanSetupBroadcast.js'
import {
  beginPodmanSetupRun,
  completePodmanSetupRun,
  failPodmanSetupRun,
  isPodmanSetupRunActive,
  resetPodmanSetupRunIdle,
  setPodmanSetupRunStep,
  setupStepLabelFor,
} from './podmanSetupRunState.js'

export interface PodmanFullSetupResult {
  ok: boolean
  failure?: { message: string; detail?: string }
  lastCommand?: PodmanCommandResult
}

function clearPodmanBinCache(): void {
  clearPodmanBinCacheForTest()
}

function broadcastProgress(): void {
  broadcastPodmanSetupState()
}

function hardFailureMessage(code: PodmanSetupErrorCode | null, detail?: string): string {
  switch (code) {
    case 'not_installed':
      return 'Podman could not be installed automatically. Install it manually from podman.io, then try again.'
    case 'machine_not_initialized':
    case 'machine_not_running':
      return 'Podman is installed but its background environment could not be started. See podman.io for help, or try again.'
    case 'engine_unhealthy':
      return 'Podman is installed but not responding. Restart Podman Desktop (or your computer), then try again.'
    default:
      return detail?.trim()
        ? `Podman setup did not finish. ${detail.trim()}`
        : 'Podman setup did not finish. Install manually from podman.io, then try again.'
  }
}

async function reprobe(): Promise<PodmanSetupErrorCode | null> {
  clearPodmanBinCache()
  const err = await refreshPodmanSetupProbe()
  return err?.code ?? null
}

async function runStep(
  step: 'installing' | 'creating_environment' | 'starting',
  action: Parameters<typeof runPodmanInstallAction>[0],
): Promise<PodmanCommandResult> {
  setPodmanSetupRunStep(step)
  broadcastProgress()
  const result = await runPodmanInstallAction(action)
  broadcastProgress()
  return result
}

/**
 * Runs the full unattended setup flow. Resumes from current probe state.
 * Only one run at a time.
 */
export async function runFullPodmanSetup(): Promise<PodmanFullSetupResult> {
  if (isPodmanSetupRunActive()) {
    return { ok: false, failure: { message: 'Setup is already running.' } }
  }

  if (!beginPodmanSetupRun()) {
    return { ok: false, failure: { message: 'Setup is already running.' } }
  }

  broadcastProgress()
  let lastCommand: PodmanCommandResult | undefined

  try {
    const plat = platform()
    const installActions = getInstallActionsForPlatform(plat)
    let code = await reprobe()

    if (!code) {
      completePodmanSetupRun()
      broadcastProgress()
      return { ok: true }
    }

    if (code === 'not_installed') {
      if (!installActions.canAutoInstall || !installActions.installAction) {
        failPodmanSetupRun({
          message: hardFailureMessage('not_installed'),
          detail: installActions.manualHint,
        })
        broadcastProgress()
        return {
          ok: false,
          failure: { message: hardFailureMessage('not_installed'), detail: installActions.manualHint },
        }
      }

      lastCommand = await runStep('installing', installActions.installAction)
      if (!lastCommand.ok) {
        const detail = lastCommand.stderr || lastCommand.stdout || 'Install command failed'
        failPodmanSetupRun({ message: hardFailureMessage('not_installed'), detail })
        broadcastProgress()
        return {
          ok: false,
          failure: { message: hardFailureMessage('not_installed'), detail },
          lastCommand,
        }
      }

      code = await reprobe()
      if (code === 'not_installed') {
        const detail = 'Podman was not found after install. You may need to restart WR Desk once.'
        failPodmanSetupRun({ message: hardFailureMessage('not_installed'), detail })
        broadcastProgress()
        return { ok: false, failure: { message: hardFailureMessage('not_installed'), detail }, lastCommand }
      }
    }

    if (code === 'machine_not_initialized') {
      lastCommand = await runStep('creating_environment', 'machine_init')
      if (!lastCommand.ok) {
        const detail = lastCommand.stderr || lastCommand.stdout || 'Could not create Podman environment'
        failPodmanSetupRun({ message: hardFailureMessage('machine_not_initialized'), detail })
        broadcastProgress()
        return {
          ok: false,
          failure: { message: hardFailureMessage('machine_not_initialized'), detail },
          lastCommand,
        }
      }

      code = await reprobe()
    }

    if (code === 'machine_not_running') {
      lastCommand = await runStep('starting', 'machine_start')
      if (!lastCommand.ok) {
        const detail = lastCommand.stderr || lastCommand.stdout || 'Could not start Podman'
        failPodmanSetupRun({ message: hardFailureMessage('machine_not_running'), detail })
        broadcastProgress()
        return {
          ok: false,
          failure: { message: hardFailureMessage('machine_not_running'), detail },
          lastCommand,
        }
      }

      code = await reprobe()
    }

    setPodmanSetupRunStep('verifying')
    broadcastProgress()
    code = await reprobe()

    if (code) {
      const err = getPodSetupErrorRef()
      const detail = err?.userMessage ?? setupStepLabelFor('verifying')
      failPodmanSetupRun({ message: hardFailureMessage(code, detail), detail })
      broadcastProgress()
      return {
        ok: false,
        failure: { message: hardFailureMessage(code, detail), detail },
        lastCommand,
      }
    }

    completePodmanSetupRun()
    broadcastProgress()
    return { ok: true, lastCommand }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    failPodmanSetupRun({
      message: 'Podman setup stopped unexpectedly. Install manually from podman.io, then try again.',
      detail,
    })
    broadcastProgress()
    return {
      ok: false,
      failure: {
        message: 'Podman setup stopped unexpectedly. Install manually from podman.io, then try again.',
        detail,
      },
      lastCommand,
    }
  }
}

/** Test helper — reset run state between cases. */
export function resetPodmanSetupRunStateForTest(): void {
  resetPodmanSetupRunIdle()
}
