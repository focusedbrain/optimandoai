/**
 * Edge tier IPC — Phase 3 (P3.10).
 */

import { ipcMain, BrowserWindow } from 'electron'
import { getEdgeTierStatusSnapshot } from './status.js'
import { getRecentEdgeVerifications, onEdgeVerificationAppended } from './verificationAudit.js'
import { getLocalPodSetupError } from '../local-pod/index.js'
import {
  onVerifierVerificationIngested,
  registerDashboardIpcHandlers,
  notifyDashboardUpdated,
} from './dashboard.js'
import { initReplicaActionIpc, registerReplicaActionIpcHandlers } from './replicaActionsIpc.js'
import { initGlobalActionIpc, registerGlobalActionIpcHandlers } from './globalActionsIpc.js'
import { initRebootRecovery, startRebootRecoveryPolling } from './rebootRecovery.js'
import { initPodSupervisor, startPodSupervisor } from './supervisor/index.js'
import type { EdgeTierPodVault } from './podLifecycle.js'
import {
  listKnownHostFingerprints,
  removeFingerprint,
} from './ssh/hostKeyStore.js'

export function initEdgeTierIpc(vault: EdgeTierPodVault): void {
  initReplicaActionIpc(vault)
  initGlobalActionIpc(vault)
  initRebootRecovery(vault)
  initPodSupervisor(vault)
  startRebootRecoveryPolling()
  startPodSupervisor()
}

let _dashboardHookInstalled = false

function ensureDashboardVerificationHook(): void {
  if (_dashboardHookInstalled) return
  _dashboardHookInstalled = true
  onEdgeVerificationAppended(onVerifierVerificationIngested)
}

export function registerEdgeTierIpcHandlers(): void {
  ensureDashboardVerificationHook()
  registerDashboardIpcHandlers()
  registerReplicaActionIpcHandlers()
  registerGlobalActionIpcHandlers()

  ipcMain.handle('edge-tier:get-status', async () => {
    return getEdgeTierStatusSnapshot()
  })

  ipcMain.handle('edge-tier:get-verifications', async (_event, limit?: unknown) => {
    const n = typeof limit === 'number' && limit > 0 ? Math.min(limit, 50) : 50
    return getRecentEdgeVerifications(n)
  })

  ipcMain.handle('edge-tier:get-local-pod-requirement', async () => {
    const err = getLocalPodSetupError()
    return { ok: !err, message: err?.userMessage ?? null }
  })

  ipcMain.handle('edge-tier:list-known-hosts', async () => {
    return listKnownHostFingerprints()
  })

  ipcMain.handle('edge-tier:remove-known-host', async (_event, raw: unknown) => {
    if (typeof raw !== 'object' || raw === null) {
      throw new Error('Invalid remove-known-host input')
    }
    const o = raw as Record<string, unknown>
    if (typeof o.host !== 'string' || typeof o.port !== 'number') {
      throw new Error('host and port are required')
    }
    const removed = removeFingerprint(o.host, o.port)
    return { ok: removed }
  })

  console.log(
    '[MAIN] IPC handlers registered: edge-tier:get-status, edge-tier:get-verifications, edge-tier:get-local-pod-requirement, edge-tier:list-known-hosts, edge-tier:remove-known-host',
  )
}

export function notifyEdgeVerificationsUpdated(): void {
  notifyDashboardUpdated()
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('edge-tier:verifications-updated')
    }
  }
}
