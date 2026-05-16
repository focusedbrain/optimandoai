/**
 * Receiver-side delivery ACK notifier.
 * Called after a direct_beap row is successfully persisted to inbox_messages.
 * Wired from main.ts via setBeapDeliveryAckNotifier → broadcasts inbox:beapDeliveryAck
 * to all renderer windows so the sender UI can confirm delivery.
 */

let _notify: ((handshakeId: string, rowId: string) => void) | null = null

export function setBeapDeliveryAckNotifier(fn: (handshakeId: string, rowId: string) => void): void {
  _notify = fn
}

export function notifyBeapDeliveryAck(handshakeId: string, rowId: string): void {
  try {
    _notify?.(handshakeId, rowId)
  } catch {
    /* non-fatal */
  }
}
