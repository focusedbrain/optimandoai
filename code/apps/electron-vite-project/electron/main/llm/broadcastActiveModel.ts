import { BrowserWindow } from 'electron'

/**
 * After the persisted active local model changes (IPC or HTTP `/api/llm/models/activate`),
 * notify all Electron renderer windows so inbox / settings UIs can refresh without a manual reload.
 *
 * The Chrome extension Backend Configuration uses HTTP and does not receive this IPC; it reloads
 * status on tab visibility / window focus (see LlmSettings).
 */
export function broadcastActiveLocalModelChanged(modelId: string): void {
  const trimmed = modelId?.trim()
  if (!trimmed) return
  const payload = { modelId: trimmed }
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.webContents.send('llm:activeModelChanged', payload)
  }
}

/** @deprecated Use broadcastActiveLocalModelChanged */
export const broadcastActiveOllamaModelChanged = broadcastActiveLocalModelChanged
