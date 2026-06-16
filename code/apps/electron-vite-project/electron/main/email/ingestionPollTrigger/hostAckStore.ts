/**
 * Host-side cache of sandbox ingestion poll trigger acks (PROMPT 4).
 * Poll outcomes are sandbox-local; the synchronous HTTP ack is how the host learns
 * held_read_consent_missing vs held_fetch_failed without reading the sandbox DB.
 */

export interface HostIngestionPollAck {
  accountId: string
  requestId: string
  pollStatus: string
  fetched: number
  depackaged: number
  delivered: number
  held: number
  at: number
}

const lastAckByAccount = new Map<string, HostIngestionPollAck>()

export function recordHostIngestionPollAck(ack: HostIngestionPollAck): void {
  lastAckByAccount.set(ack.accountId, ack)
}

/** Transport/handshake failure before a poll result — treat as unreachable on host UI. */
export function recordHostIngestionPollUnreachable(accountId: string, requestId: string): void {
  recordHostIngestionPollAck({
    accountId,
    requestId,
    pollStatus: 'trigger_unreachable',
    fetched: 0,
    depackaged: 0,
    delivered: 0,
    held: 0,
    at: Date.now(),
  })
}

export function getLastHostIngestionPollAck(accountId: string): HostIngestionPollAck | undefined {
  return lastAckByAccount.get(accountId)
}

export function getLastHostIngestionPollAcks(): ReadonlyMap<string, HostIngestionPollAck> {
  return lastAckByAccount
}

export function _resetHostIngestionPollAcksForTests(): void {
  lastAckByAccount.clear()
}
