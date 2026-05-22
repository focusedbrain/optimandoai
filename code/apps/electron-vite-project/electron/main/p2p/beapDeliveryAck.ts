/**
 * Receiver-side delivery ACK notifier.
 * Wired from main.ts via setBeapDeliveryAckNotifier → broadcasts inbox:beapDeliveryAck
 * to all renderer windows so the sender UI can confirm delivery.
 */

import type { ReasonCode } from '../vault/capabilityBroker'

export type BeapDeliveryAckPayload = {
  handshakeId: string
  rowId: string
  status?: 'ok' | 'error'
  reasonCode?: ReasonCode
  retryable?: boolean
}

type DeliveryAckWaiter = {
  handshakeId: string
  resolve: (rowId: string) => void
  timer: ReturnType<typeof setTimeout>
}

const deliveryAckWaiters: DeliveryAckWaiter[] = []
const RECENT_ACK_TTL_MS = 60_000
const recentAckByHandshake = new Map<string, { rowId: string; at: number }>()

let _notify: ((payload: BeapDeliveryAckPayload) => void) | null = null

export function setBeapDeliveryAckNotifier(fn: (payload: BeapDeliveryAckPayload) => void): void {
  _notify = fn
}

function removeDeliveryAckWaiter(target: DeliveryAckWaiter): void {
  const i = deliveryAckWaiters.indexOf(target)
  if (i >= 0) deliveryAckWaiters.splice(i, 1)
}

function takeRecentAck(handshakeId: string): string | null {
  const hid = handshakeId.trim()
  const ent = recentAckByHandshake.get(hid)
  if (!ent) return null
  if (Date.now() - ent.at > RECENT_ACK_TTL_MS) {
    recentAckByHandshake.delete(hid)
    return null
  }
  return ent.rowId
}

/** Register before outbound send — ACK may arrive while transport is in flight. */
export function waitForBeapDeliveryAck(handshakeId: string, timeoutMs: number): Promise<string | null> {
  const hid = String(handshakeId ?? '').trim()
  if (!hid) return Promise.resolve(null)
  const cached = takeRecentAck(hid)
  if (cached) return Promise.resolve(cached)
  const ms = Math.max(0, Math.min(timeoutMs, 60_000))
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      removeDeliveryAckWaiter(waiter)
      resolve(takeRecentAck(hid))
    }, ms)
    const waiter: DeliveryAckWaiter = {
      handshakeId: hid,
      resolve: (rowId) => {
        clearTimeout(timer)
        removeDeliveryAckWaiter(waiter)
        resolve(rowId)
      },
      timer,
    }
    deliveryAckWaiters.push(waiter)
  })
}

export function notifyBeapDeliveryAck(
  handshakeId: string,
  rowId: string,
  extras?: Pick<BeapDeliveryAckPayload, 'status' | 'reasonCode' | 'retryable'>,
): void {
  const hid = String(handshakeId ?? '').trim()
  const rid = String(rowId ?? '').trim()
  const payload: BeapDeliveryAckPayload = {
    handshakeId: hid,
    rowId: rid,
    status: extras?.status ?? 'ok',
    ...(extras?.reasonCode ? { reasonCode: extras.reasonCode } : {}),
    ...(extras?.retryable === true ? { retryable: true } : {}),
  }
  if (hid && rid && payload.status === 'ok') {
    recentAckByHandshake.set(hid, { rowId: rid, at: Date.now() })
    for (const w of [...deliveryAckWaiters]) {
      if (w.handshakeId === hid) w.resolve(rid)
    }
  }
  try {
    _notify?.(payload)
  } catch {
    /* non-fatal */
  }
}

/** @internal */
export function resetBeapDeliveryAckWaitersForTests(): void {
  for (const w of deliveryAckWaiters) clearTimeout(w.timer)
  deliveryAckWaiters.length = 0
  recentAckByHandshake.clear()
}
