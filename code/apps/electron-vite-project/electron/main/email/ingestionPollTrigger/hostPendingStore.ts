/**
 * Host-side pending correlation for async sealed-relay ingestion poll triggers (A3).
 * Registers { request_id → accountId, startedAt } before send; cleared on result (A5) or timeout.
 */

import { recordHostIngestionPollUnreachable } from './hostAckStore'

export interface HostIngestionPollPendingEntry {
  requestId: string
  accountId: string
  startedAt: number
}

const pendingByRequestId = new Map<string, HostIngestionPollPendingEntry>()
const timersByRequestId = new Map<string, ReturnType<typeof setTimeout>>()

export function registerHostIngestionPollPending(opts: {
  requestId: string
  accountId: string
  timeoutMs: number
}): HostIngestionPollPendingEntry {
  const entry: HostIngestionPollPendingEntry = {
    requestId: opts.requestId,
    accountId: opts.accountId,
    startedAt: Date.now(),
  }
  pendingByRequestId.set(opts.requestId, entry)

  const existing = timersByRequestId.get(opts.requestId)
  if (existing) clearTimeout(existing)

  const timer = setTimeout(() => {
    timersByRequestId.delete(opts.requestId)
    if (!pendingByRequestId.has(opts.requestId)) return
    pendingByRequestId.delete(opts.requestId)
    recordHostIngestionPollUnreachable(opts.accountId, opts.requestId)
    console.warn(
      `[IngestionPollTrigger] sealed relay pending expired. request_id=${opts.requestId} account=${opts.accountId}`,
    )
  }, Math.max(1, opts.timeoutMs))
  timersByRequestId.set(opts.requestId, timer)

  return entry
}

export function cancelHostIngestionPollPending(requestId: string): void {
  const timer = timersByRequestId.get(requestId)
  if (timer) {
    clearTimeout(timer)
    timersByRequestId.delete(requestId)
  }
  pendingByRequestId.delete(requestId)
}

/** A5: correlate async result — cancels timeout and removes pending row. */
export function resolveHostIngestionPollPending(requestId: string): HostIngestionPollPendingEntry | undefined {
  const entry = pendingByRequestId.get(requestId)
  if (!entry) return undefined
  cancelHostIngestionPollPending(requestId)
  return entry
}

export function getHostIngestionPollPending(requestId: string): HostIngestionPollPendingEntry | undefined {
  return pendingByRequestId.get(requestId)
}

export function _resetHostIngestionPollPendingForTests(): void {
  for (const timer of timersByRequestId.values()) {
    clearTimeout(timer)
  }
  timersByRequestId.clear()
  pendingByRequestId.clear()
}
