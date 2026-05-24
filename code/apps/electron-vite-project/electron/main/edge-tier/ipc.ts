/**
 * Edge tier IPC — Phase 3 (P3.10).
 */

import { ipcMain, BrowserWindow } from 'electron'
import { getEdgeTierStatusSnapshot } from './status.js'
import { getRecentEdgeVerifications } from './verificationAudit.js'
import { getLocalPodSetupError } from '../local-pod/index.js'

export function registerEdgeTierIpcHandlers(): void {
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

  console.log('[MAIN] IPC handlers registered: edge-tier:get-status, edge-tier:get-verifications, edge-tier:get-local-pod-requirement')
}

export function notifyEdgeVerificationsUpdated(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('edge-tier:verifications-updated')
    }
  }
}
