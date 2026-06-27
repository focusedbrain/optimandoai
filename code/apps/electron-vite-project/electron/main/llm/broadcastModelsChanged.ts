import { BrowserWindow } from 'electron'

/** Notify renderers + extension HTTP clients that the on-disk GGUF model list changed. */
export function broadcastModelsInstalledChanged(payload?: { modelId?: string; sha256?: string }): void {
  const data = payload ?? {}
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.webContents.send('llm:modelsChanged', data)
  }
}
