/**
 * Renderer notifications for edge fetch account state changes.
 */

import { BrowserWindow } from 'electron'
import { buildEdgeFetchSnapshots } from './snapshots.js'

export function notifyEdgeFetchStateChanged(): void {
  const payload = buildEdgeFetchSnapshots()
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('email:edgeFetchStateChanged', payload)
    }
  }
}
