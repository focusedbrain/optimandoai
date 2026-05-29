/**
 * Renderer broadcast when Podman is required for BEAP receive (blocking modal).
 */

import { BrowserWindow, app } from 'electron'

import type { PodmanSetupError } from './podmanDetect.js'
import { getPodSetupErrorRef } from './podStatus.js'

export type PodmanSetupBroadcastPayload = {
  required: boolean
  code: PodmanSetupError['code'] | null
  userMessage: string | null
  platform: NodeJS.Platform
}

function buildPayload(err: PodmanSetupError | null): PodmanSetupBroadcastPayload {
  return {
    required: err != null,
    code: err?.code ?? null,
    userMessage: err?.userMessage ?? null,
    platform: process.platform,
  }
}

export function broadcastPodmanSetupState(err?: PodmanSetupError | null): void {
  const setupErr = err === undefined ? getPodSetupErrorRef() : err
  const payload = buildPayload(setupErr)
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.webContents.send('podman-setup:state', payload)
  }
}

let _focusHookInstalled = false

/** Re-probe Podman when the app regains focus (no restart required). */
export function registerPodmanSetupFocusReprobe(
  reprobe: () => Promise<PodmanSetupError | null>,
): void {
  if (_focusHookInstalled) return
  _focusHookInstalled = true

  app.on('browser-window-focus', () => {
    void reprobe().then(async (err) => {
      if (!err) {
        const { refreshIngestionMode } = await import('../ingestion/ingestionModeService.js')
        const { drainHoldQueueIfReady } = await import('../ingestion/ingestionDispatcher.js')
        const snap = await refreshIngestionMode(true)
        if (snap.mode !== 'Blocked' && snap.blockedReason !== 'pod_required') {
          const { startLocalPodWhenSsoReady } = await import('./index.js')
          void startLocalPodWhenSsoReady()
          void drainHoldQueueIfReady()
        }
      }
    })
  })
}
