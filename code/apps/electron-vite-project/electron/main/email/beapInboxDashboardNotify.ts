/**
 * Optional main-process hook: broadcast to dashboard renderer when P2P BEAP rows are imported into inbox_messages.
 * Registered from main.ts (BrowserWindow.webContents.send).
 */

let _notify: ((handshakeId: string | null) => void) | null = null

export function setBeapInboxDashboardNotifier(fn: (handshakeId: string | null) => void): void {
  _notify = fn
}

export function notifyBeapInboxDashboard(handshakeId: string | null): void {
  try {
    _notify?.(handshakeId)
  } catch {
    /* non-fatal */
  }
}
