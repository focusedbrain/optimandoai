/**
 * IPC — blocking Podman setup gate (one-click install + machine setup).
 */

import { ipcMain, shell } from 'electron'

import { PODMAN_MANUAL_INSTALL_URL } from './podmanDetect.js'
import { refreshPodmanSetupProbe } from './podmanSetupProbe.js'
import { broadcastPodmanSetupState } from './podmanSetupBroadcast.js'
import {
  buildPodmanSetupStatusSnapshot,
  type PodmanSetupStatusSnapshot,
} from './podmanSetupStatus.js'
import {
  runPodmanInstallAction,
  type PodmanInstallAction,
} from './podmanInstallRunner.js'
import { runFullPodmanSetup } from './podmanSetupOrchestrator.js'
import { getPodSetupErrorRef } from './podStatus.js'
import { failPodmanSetupRun } from './podmanSetupRunState.js'
import { unexpectedSetupErrorMessage } from './podmanSetupCopy.js'
import { ensureWslStatusCachedOnce } from './podmanWslStatusCache.js'

export type PodmanSetupStatusResponse = PodmanSetupStatusSnapshot

async function refreshIngestionAfterProbeReady(): Promise<void> {
  const err = getPodSetupErrorRef()
  if (err) return
  const { refreshIngestionMode } = await import('../ingestion/ingestionModeService.js')
  const snap = await refreshIngestionMode(true)
  if (snap.mode !== 'Blocked') {
    const { drainHoldQueueIfReady } = await import('../ingestion/ingestionDispatcher.js')
    const { startLocalPodWhenSsoReady } = await import('./index.js')
    void startLocalPodWhenSsoReady()
    void drainHoldQueueIfReady()
  }
}

/** After package install (or already-installed), advance machine init/start when needed. */
async function runMachineSetupFollowUp(): Promise<PodmanInstallAction[]> {
  const ran: PodmanInstallAction[] = []
  let err = await refreshPodmanSetupProbe({ force: true })

  if (err?.code === 'machine_not_initialized') {
    const init = await runPodmanInstallAction('machine_init')
    if (init.ok) ran.push('machine_init')
    err = await refreshPodmanSetupProbe({ force: true })
  }

  if (err?.code === 'machine_not_running') {
    const start = await runPodmanInstallAction('machine_start')
    if (start.ok) ran.push('machine_start')
    await refreshPodmanSetupProbe({ force: true })
  }

  return ran
}

export function registerPodmanSetupIpc(): void {
  ipcMain.handle('podman-setup:get-status', async () => {
    return buildPodmanSetupStatusSnapshot()
  })

  ipcMain.handle('podman-setup:probe', async () => {
    await refreshPodmanSetupProbe({ force: true })
    await refreshIngestionAfterProbeReady()
    return buildPodmanSetupStatusSnapshot()
  })

  ipcMain.handle('podman-setup:open-manual-install', async () => {
    await shell.openExternal(PODMAN_MANUAL_INSTALL_URL)
    return { ok: true }
  })

  ipcMain.handle('podman-setup:run-full-setup', async () => {
    try {
      const result = await runFullPodmanSetup()
      await refreshIngestionAfterProbeReady()
      return { ...result, status: buildPodmanSetupStatusSnapshot() }
    } catch (err) {
      console.error('[PODMAN_SETUP] IPC run-full-setup error:', err instanceof Error ? err.message : err)
      failPodmanSetupRun({
        kind: 'error',
        message: unexpectedSetupErrorMessage(),
        detail: 'Try again. If Windows asks for permission, choose Yes.',
      })
      broadcastPodmanSetupState()
      return {
        ok: false,
        failure: {
          kind: 'error',
          message: unexpectedSetupErrorMessage(),
          detail: 'Try again. If Windows asks for permission, choose Yes.',
        },
        status: buildPodmanSetupStatusSnapshot(),
      }
    }
  })

  ipcMain.handle('podman-setup:run-action', async (_e, raw: unknown) => {
    const action = (typeof raw === 'object' && raw != null && 'action' in raw
      ? (raw as { action: string }).action
      : raw) as PodmanInstallAction
    const allowed: PodmanInstallAction[] = [
      'winget_install',
      'brew_install',
      'machine_init',
      'machine_start',
    ]
    if (!allowed.includes(action)) {
      throw new Error(`Invalid podman setup action: ${String(action)}`)
    }

    const result = await runPodmanInstallAction(action)
    await refreshPodmanSetupProbe({ force: true })

    if (
      result.ok &&
      (action === 'winget_install' || action === 'brew_install')
    ) {
      await runMachineSetupFollowUp()
    } else if (result.ok && action === 'machine_init') {
      const err = getPodSetupErrorRef()
      if (err?.code === 'machine_not_running') {
        await runPodmanInstallAction('machine_start')
        await refreshPodmanSetupProbe({ force: true })
      }
    }

    await refreshIngestionAfterProbeReady()
    return { result, status: buildPodmanSetupStatusSnapshot() }
  })
}

export async function runStartupPodmanProbe(): Promise<void> {
  await refreshPodmanSetupProbe({ force: true, skipBroadcast: true })
  if (process.platform === 'win32' && getPodSetupErrorRef()) {
    await ensureWslStatusCachedOnce()
  }
  broadcastPodmanSetupState()
}
