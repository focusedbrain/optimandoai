/**
 * Renderer broadcast when Podman is required for BEAP receive (blocking modal).
 */

import { BrowserWindow, app } from 'electron'

import { buildPodmanSetupStatusSnapshot } from './podmanSetupStatus.js'
import { refreshPodmanSetupProbe } from './podmanSetupProbe.js'

export type PodmanSetupBroadcastPayload = ReturnType<typeof buildPodmanSetupStatusSnapshot>

let _lastBroadcastJson: string | null = null

export function resetPodmanSetupBroadcastDedupForTest(): void {
  _lastBroadcastJson = null
}

export function broadcastPodmanSetupState(): void {
  const payload = buildPodmanSetupStatusSnapshot()
  const json = JSON.stringify(payload)
  if (json === _lastBroadcastJson) return
  _lastBroadcastJson = json

  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.webContents.send('podman-setup:state', payload)
  }
}

let _focusHookInstalled = false

/** Re-probe Podman when the app regains focus (cheap probe only — no WSL shell-out). */
export function registerPodmanSetupFocusReprobe(
  reprobe: () => Promise<unknown>,
): void {
  if (_focusHookInstalled) return
  _focusHookInstalled = true

  app.on('browser-window-focus', () => {
    void reprobe().then(async () => {
      broadcastPodmanSetupState()
      const snap = buildPodmanSetupStatusSnapshot()
      if (!snap.required) {
        const { refreshIngestionMode } = await import('../ingestion/ingestionModeService.js')
        const { drainHoldQueueIfReady } = await import('../ingestion/ingestionDispatcher.js')
        const mode = await refreshIngestionMode(true)
        if (mode.mode !== 'Blocked' && mode.blockedReason !== 'pod_required') {
          const { startLocalPodWhenSsoReady } = await import('./index.js')
          void startLocalPodWhenSsoReady()
          void drainHoldQueueIfReady()
        }
      }
    })
  })
}

export async function reprobeAndBroadcastPodmanSetup(): Promise<void> {
  await refreshPodmanSetupProbe({ force: true })
  broadcastPodmanSetupState()
}
