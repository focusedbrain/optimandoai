/**
 * IPC — blocking Podman setup gate (probe, guided install, machine init/start).
 */

import { ipcMain, shell } from 'electron'

import {
  PODMAN_MANUAL_INSTALL_URL,
  type PodmanSetupErrorCode,
} from './podmanDetect.js'
import { getPodSetupErrorRef, isPodmanProbeComplete } from './podStatus.js'
import { refreshPodmanSetupProbe } from './podmanSetupProbe.js'
import { broadcastPodmanSetupState } from './podmanSetupBroadcast.js'
import {
  getInstallActionsForPlatform,
  runPodmanInstallAction,
  type PodmanInstallAction,
} from './podmanInstallRunner.js'

export interface PodmanSetupStatusResponse {
  required: boolean
  probePending: boolean
  code: PodmanSetupErrorCode | null
  userMessage: string | null
  platform: NodeJS.Platform
  install: ReturnType<typeof getInstallActionsForPlatform>
  showMachineSteps: boolean
  machineInitCommand: string
  machineStartCommand: string
}

function buildStatusResponse(): PodmanSetupStatusResponse {
  const err = getPodSetupErrorRef()
  const probePending = !isPodmanProbeComplete()
  const plat = process.platform
  const install = getInstallActionsForPlatform(plat)
  const showMachineSteps =
    !probePending &&
    (plat === 'win32' || plat === 'darwin') &&
    (err?.code === 'machine_not_initialized' || err?.code === 'machine_not_running')

  return {
    required: err != null,
    probePending,
    code: err?.code ?? null,
    userMessage: err?.userMessage ?? null,
    platform: plat,
    install,
    showMachineSteps,
    machineInitCommand: 'podman machine init',
    machineStartCommand: 'podman machine start',
  }
}

export function registerPodmanSetupIpc(): void {
  ipcMain.handle('podman-setup:get-status', async () => buildStatusResponse())

  ipcMain.handle('podman-setup:probe', async () => {
    const err = await refreshPodmanSetupProbe()
    const { refreshIngestionMode } = await import('../ingestion/ingestionModeService.js')
    const snap = await refreshIngestionMode(true)
    if (!err && snap.mode !== 'Blocked') {
      const { drainHoldQueueIfReady } = await import('../ingestion/ingestionDispatcher.js')
      const { startLocalPodWhenSsoReady } = await import('./index.js')
      void startLocalPodWhenSsoReady()
      void drainHoldQueueIfReady()
    }
    return { ...buildStatusResponse(), ingestionMode: snap.mode, blockedReason: snap.blockedReason }
  })

  ipcMain.handle('podman-setup:open-manual-install', async () => {
    await shell.openExternal(PODMAN_MANUAL_INSTALL_URL)
    return { ok: true }
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
    const err = await refreshPodmanSetupProbe()
    if (!err) {
      const { refreshIngestionMode } = await import('../ingestion/ingestionModeService.js')
      await refreshIngestionMode(true)
    }
    return { result, status: buildStatusResponse() }
  })
}

export async function runStartupPodmanProbe(): Promise<void> {
  await refreshPodmanSetupProbe()
  broadcastPodmanSetupState()
}
