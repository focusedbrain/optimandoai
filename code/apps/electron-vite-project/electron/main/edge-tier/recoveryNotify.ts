/**
 * User-visible notifications for edge mail-fetcher reboot recovery.
 */

import { BrowserWindow, Notification } from 'electron'

export interface RecoveryNotificationPayload {
  accountId: string
  email: string
  message: string
  kind: 'vault_locked' | 'unwrap_failed' | 'key_redelivered'
}

export function notifyRecoveryEvent(payload: RecoveryNotificationPayload): void {
  console.log(`[EDGE_RECOVERY] ${payload.kind} account=${payload.accountId}: ${payload.message}`)
  try {
    if (Notification.isSupported()) {
      new Notification({
        title:
          payload.kind === 'vault_locked'
            ? 'Edge email fetch waiting for vault'
            : payload.kind === 'unwrap_failed'
              ? 'Edge account needs re-migration'
              : 'Edge email fetch resumed',
        body: payload.message,
      }).show()
    }
  } catch (err) {
    console.warn('[EDGE_RECOVERY] notification failed:', err instanceof Error ? err.message : err)
  }

  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('edge-tier:recovery-notification', payload)
    }
  }
}
