/**
 * A5 — bridge sealed-relay async poll results back to blocking IPC / UI waiters.
 */

import type { HostIngestionPollAck } from './hostAckStore'
import { DEFAULT_INGESTION_POLL_TRIGGER_TIMEOUT_MS } from './hostTrigger'

export interface IngestionPollTriggerCounts {
  requestId: string
  pollStatus: string
  fetched: number
  depackaged: number
  delivered: number
  held: number
}

export interface PendingIngestionPollSyncSlice {
  ok: boolean
  skipReason?: string
  ingestionPollTrigger?: IngestionPollTriggerCounts
}

type CompletionWaiter = {
  resolve: (ack: HostIngestionPollAck) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const waitersByRequestId = new Map<string, CompletionWaiter>()

export function waitForHostIngestionPollResult(
  requestId: string,
  timeoutMs: number = DEFAULT_INGESTION_POLL_TRIGGER_TIMEOUT_MS,
): Promise<HostIngestionPollAck> {
  const id = typeof requestId === 'string' ? requestId.trim() : ''
  if (!id) {
    return Promise.reject(new Error('requestId required'))
  }

  const existing = waitersByRequestId.get(id)
  if (existing) {
    clearTimeout(existing.timer)
    waitersByRequestId.delete(id)
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waitersByRequestId.delete(id)
      reject(new Error(`ingestion poll result timed out after ${timeoutMs}ms`))
    }, Math.max(1, timeoutMs))
    waitersByRequestId.set(id, { resolve, reject, timer })
  })
}

export function resolveHostIngestionPollCompletion(ack: HostIngestionPollAck): void {
  const id = ack.requestId.trim()
  const waiter = waitersByRequestId.get(id)
  if (!waiter) return
  clearTimeout(waiter.timer)
  waitersByRequestId.delete(id)
  waiter.resolve(ack)
}

export function rejectHostIngestionPollCompletion(requestId: string, err: Error): void {
  const id = requestId.trim()
  const waiter = waitersByRequestId.get(id)
  if (!waiter) return
  clearTimeout(waiter.timer)
  waitersByRequestId.delete(id)
  waiter.reject(err)
}

/** Block IPC until sealed relay result arrives or pending timeout fires (A5 async UI). */
export async function finalizePendingIngestionPollSyncResult<T extends PendingIngestionPollSyncSlice>(
  result: T,
  opts: {
    waitForResult?: (requestId: string, timeoutMs: number) => Promise<HostIngestionPollAck>
    timeoutMs?: number
  } = {},
): Promise<T> {
  if (result.skipReason !== 'ingestion_trigger_pending' || !result.ingestionPollTrigger?.requestId) {
    return result
  }
  const waitForResult = opts.waitForResult ?? waitForHostIngestionPollResult
  const timeoutMs = opts.timeoutMs ?? DEFAULT_INGESTION_POLL_TRIGGER_TIMEOUT_MS
  const requestId = result.ingestionPollTrigger.requestId
  try {
    const ack = await waitForResult(requestId, timeoutMs)
    return {
      ...result,
      skipReason: 'ingestion_triggered_to_sandbox',
      ingestionPollTrigger: {
        requestId: ack.requestId,
        pollStatus: ack.pollStatus,
        fetched: ack.fetched,
        depackaged: ack.depackaged,
        delivered: ack.delivered,
        held: ack.held,
      },
    }
  } catch {
    return {
      ...result,
      ok: false,
      skipReason: 'ingestion_trigger_unreachable',
      ingestionPollTrigger: {
        requestId,
        pollStatus: 'trigger_unreachable',
        fetched: 0,
        depackaged: 0,
        delivered: 0,
        held: 0,
      },
    }
  }
}

export function _resetHostIngestionPollCompletionForTests(): void {
  for (const waiter of waitersByRequestId.values()) {
    clearTimeout(waiter.timer)
  }
  waitersByRequestId.clear()
}
