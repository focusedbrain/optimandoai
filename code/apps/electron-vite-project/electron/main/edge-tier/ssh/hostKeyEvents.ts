/**
 * Structured audit events for SSH host key TOFU — P4.5.13.
 */

export const SSH_HOST_KEY_FIRST_SEEN_EVENT = 'ssh_host_key_first_seen' as const

export interface SshHostKeyFirstSeenEvent {
  readonly event: typeof SSH_HOST_KEY_FIRST_SEEN_EVENT
  readonly host: string
  readonly port: number
  readonly key_type: string
  /** Lowercase hex SHA-256 of raw host public key bytes. */
  readonly fingerprint_sha256: string
  readonly ts: string
}

const _recentEvents: SshHostKeyFirstSeenEvent[] = []

export function emitSshHostKeyFirstSeen(input: Omit<SshHostKeyFirstSeenEvent, 'event' | 'ts'>): SshHostKeyFirstSeenEvent {
  const payload: SshHostKeyFirstSeenEvent = {
    event: SSH_HOST_KEY_FIRST_SEEN_EVENT,
    ts: new Date().toISOString(),
    ...input,
  }
  _recentEvents.push(payload)
  if (_recentEvents.length > 100) _recentEvents.shift()
  console.log(JSON.stringify(payload))
  return payload
}

/** Tests only. */
export function _drainHostKeyFirstSeenEventsForTest(): SshHostKeyFirstSeenEvent[] {
  return _recentEvents.splice(0, _recentEvents.length)
}

/** Tests only. */
export function _clearHostKeyFirstSeenEventsForTest(): void {
  _recentEvents.length = 0
}
