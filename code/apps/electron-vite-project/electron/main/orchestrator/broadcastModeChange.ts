import { BrowserWindow } from 'electron'

/** Notify all renderer windows that persisted orchestrator host/sandbox mode may have changed. */
export function broadcastOrchestratorModeChanged(): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.isDestroyed()) continue
    try {
      w.webContents.send('orchestrator-mode-did-change')
    } catch {
      /* no receiver */
    }
  }
}
