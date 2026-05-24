/**
 * User-visible notification when the local BEAP pod cannot start.
 */

import { Notification } from 'electron'

export function notifyLocalPodSetupIssue(message: string): void {
  console.error(`[LOCAL_POD] ${message}`)
  try {
    if (Notification.isSupported()) {
      new Notification({
        title: 'BEAP validation pod unavailable',
        body: message,
      }).show()
    }
  } catch (err) {
    console.warn(
      '[LOCAL_POD] Could not show setup notification:',
      (err as Error).message ?? err,
    )
  }
}
