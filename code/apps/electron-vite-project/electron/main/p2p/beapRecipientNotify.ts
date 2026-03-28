/**
 * Notify the Chromium extension (via WebSocket bridge) when a BEAP message
 * lands in p2p_pending_beap. Wired from main.ts with broadcastToExtensions.
 */

let _notify: ((handshakeId: string) => void) | null = null

export function setBeapRecipientPendingNotifier(fn: (handshakeId: string) => void): void {
  _notify = fn
}

export function notifyBeapRecipientPending(handshakeId: string): void {
  console.log('[P2P-RECV] Notifying extension of new BEAP message', handshakeId)
  try {
    _notify?.(handshakeId)
  } catch {
    /* non-fatal */
  }
}
