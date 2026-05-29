/**
 * IPC for ingestion mode status surface and session host fallback actions.
 */

import { ipcMain, BrowserWindow, Tray, nativeImage } from 'electron'

import {
  refreshIngestionMode,
  getIngestionModeSnapshot,
  onIngestionModeChange,
  startIngestionModePolling,
} from './ingestionModeService.js'
import {
  authorizeSessionHostFallback,
  revokeSessionHostFallback,
} from './sessionHostFallback.js'
import { drainHoldQueueIfReady } from './ingestionDispatcher.js'
import { invalidateEdgeProbeCache, invalidateHostPodReadyCache } from './edgeProbe.js'
import type { IngestionModeSnapshot } from './ingestionModeService.js'
import { buildLocalPodStartContext } from '../local-pod/index.js'

let _tray: Tray | null = null

function broadcastMode(snap: IngestionModeSnapshot): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.webContents.send('ingestion-mode:updated', snap)
  }
  updateTray(snap)
}

function modeTooltip(snap: IngestionModeSnapshot): string {
  const n = snap.holdQueue.count
  switch (snap.mode) {
    case 'EdgeActive':
      return 'Secure mode: remote VPS verifying.'
    case 'HostPodActive':
      if (snap.hostPodVariant === 'halted_by_anomaly') {
        const n = snap.holdQueue.count
        return `Verification halted. ${n} message${n === 1 ? '' : 's'} held safely.`
      }
      if (snap.hostPodVariant === 'session_fallback') {
        return 'Host fallback active (session). Edge unreachable.'
      }
      return 'Host mode: local pod verifying.'
    case 'Blocked':
      if (snap.blockedReason === 'pod_required') {
        return `BEAP validation pod required. ${n} message${n === 1 ? '' : 's'} held safely. Install Podman Desktop.`
      }
      if (snap.blockedWithoutConnectivity) {
        return `No network. ${n} message${n === 1 ? '' : 's'} held safely.`
      }
      return `Edge unreachable. ${n} message${n === 1 ? '' : 's'} held safely. Click for options.`
    default:
      return 'Ingestion mode'
  }
}

function updateTray(snap: IngestionModeSnapshot): void {
  if (!_tray) return
  _tray.setToolTip(modeTooltip(snap))
  if (snap.mode === 'Blocked' && snap.holdQueue.count > 0) {
    _tray.setTitle(String(snap.holdQueue.count))
  } else {
    _tray.setTitle('')
  }
}

export function initIngestionModeTray(): void {
  if (_tray) return
  const img = nativeImage.createEmpty()
  _tray = new Tray(img)
  _tray.setToolTip('WR Desk ingestion mode')
  _tray.on('click', () => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue
      win.webContents.send('ingestion-mode:open-panel')
      win.show()
      break
    }
  })
}

export function registerIngestionModeIpc(): void {
  ipcMain.handle('ingestion-mode:get', async () => {
    return refreshIngestionMode(false)
  })

  ipcMain.handle('ingestion-mode:retry-edge', async () => {
    invalidateEdgeProbeCache()
    const snap = await refreshIngestionMode(true)
    if (snap.mode !== 'Blocked') {
      await drainHoldQueueIfReady()
    }
    broadcastMode(snap)
    return snap
  })

  ipcMain.handle('ingestion-mode:authorize-host-fallback', async () => {
    authorizeSessionHostFallback()
    const snap = await refreshIngestionMode(true)
    await drainHoldQueueIfReady()
    broadcastMode(snap)
    return snap
  })

  ipcMain.handle('ingestion-mode:revoke-host-fallback', async () => {
    revokeSessionHostFallback()
    const snap = await refreshIngestionMode(true)
    broadcastMode(snap)
    return snap
  })

  ipcMain.handle('ingestion-mode:retry-host-pod', async () => {
    const { userRetryLocalPodSupervisor } = await import(
      '../local-pod/supervisor/index.js'
    )
    const { restartLocalPod } = await import('../local-pod/index.js')
    userRetryLocalPodSupervisor()
    invalidateHostPodReadyCache()
    await restartLocalPod(buildLocalPodStartContext())
    const snap = await refreshIngestionMode(true)
    if (snap.hostPodVariant !== 'halted_by_anomaly') {
      await drainHoldQueueIfReady()
    }
    broadcastMode(snap)
    return snap
  })
}

export function startIngestionModeLifecycle(): void {
  initIngestionModeTray()
  startIngestionModePolling(15_000)
  onIngestionModeChange((snap) => {
    broadcastMode(snap)
    if (snap.mode !== 'Blocked' && snap.hostPodVariant !== 'halted_by_anomaly') {
      void drainHoldQueueIfReady()
    }
  })
  void refreshIngestionMode(true).then(broadcastMode)
}

export function stopIngestionModeLifecycle(): void {
  revokeSessionHostFallback()
}

export function getPublicModeSnapshot(): IngestionModeSnapshot | null {
  return getIngestionModeSnapshot()
}
