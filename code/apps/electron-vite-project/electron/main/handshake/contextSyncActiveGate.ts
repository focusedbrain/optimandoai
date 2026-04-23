/**
 * Single source of truth: ACCEPTED → ACTIVE on **inbound** `handshake-context-sync` (see
 * `buildContextSyncRecord` in enforcement). Kept in a small module for regression tests
 * and to avoid import cycles.
 */

import type { HandshakeRecord } from './types'
import { HandshakeState } from './types'

export function getNextStateAfterInboundContextSync(
  existing: HandshakeRecord,
  incomingContextSyncSeq: number,
): HandshakeState {
  const receivedContextSync = existing.state === HandshakeState.ACCEPTED && incomingContextSyncSeq >= 1
  const ownDurableContextSyncEnqueued = (existing.last_seq_sent ?? 0) >= 1
  if (receivedContextSync && ownDurableContextSyncEnqueued) {
    return HandshakeState.ACTIVE
  }
  return existing.state
}
