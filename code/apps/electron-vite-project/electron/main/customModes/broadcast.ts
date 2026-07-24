import { BrowserWindow } from 'electron'
import type { CustomModeDefinition } from '../../../../extension-chromium/src/shared/ui/customModeTypes'

let extensionBroadcast: ((message: Record<string, unknown>) => void) | null = null

/** Wired from main.ts after `broadcastToExtensions` is defined (avoids import cycle). */
export function setCustomModesExtensionBroadcast(fn: (message: Record<string, unknown>) => void): void {
  extensionBroadcast = fn
}

export function broadcastCustomModesChanged(modes: CustomModeDefinition[]): void {
  const payload = { modes }
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.webContents.send('customModes:changed', payload)
  }
  extensionBroadcast?.({ type: 'CUSTOM_MODES_CHANGED', modes })
}
