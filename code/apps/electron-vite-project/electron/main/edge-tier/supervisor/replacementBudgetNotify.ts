/**
 * User-visible notifications when replacement budget is exhausted (P5.7).
 *
 * Notifications persist until the user resumes recovery or triggers nuclear reset.
 */

import { BrowserWindow, Notification } from 'electron'
import type { ReplacementBudgetNotification } from './replacementBudget.js'

export function notifyReplacementBudgetExhausted(
  payload: ReplacementBudgetNotification,
): void {
  console.log(
    `[SUPERVISOR] replacement budget exhausted replica=${payload.replica_id} role=${payload.container_role}`,
  )
  try {
    if (Notification.isSupported()) {
      new Notification({
        title: 'Edge container recovery paused',
        body: payload.message,
      }).show()
    }
  } catch (err) {
    console.warn(
      '[SUPERVISOR] replacement budget notification failed:',
      err instanceof Error ? err.message : err,
    )
  }

  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('edge-tier:replacement-budget-exhausted', payload)
    }
  }
}
