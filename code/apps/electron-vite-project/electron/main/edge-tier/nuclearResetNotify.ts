/**
 * User-visible notifications after nuclear replica reset (P5.10).
 */

import { BrowserWindow, Notification } from 'electron'

export interface NuclearResetReauthorizePayload {
  accountId: string
  email: string
  replicaId: string
}

export function notifyNuclearResetReauthorize(payload: NuclearResetReauthorizePayload): void {
  console.log(
    `[NUCLEAR_RESET] account=${payload.accountId} needs re-authorization after replica reset`,
  )
  try {
    if (Notification.isSupported()) {
      new Notification({
        title: 'Re-authorize this account',
        body: `${payload.email} was edge-fetched on a replica that was reset. Re-authorize to resume fetch.`,
      }).show()
    }
  } catch (err) {
    console.warn(
      '[NUCLEAR_RESET] notification failed:',
      err instanceof Error ? err.message : err,
    )
  }

  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('edge-tier:nuclear-reset-reauthorize', payload)
    }
  }
}
