/**
 * Per-peer validation failure rate limiting (Stream A — A6).
 */

import {
  PEER_VALIDATION_FLOOD_MAX,
  PEER_VALIDATION_FLOOD_WINDOW_MS,
  type FailureCode,
} from './failurePolicy.js';

interface PeerWindow {
  timestampsMs: number[];
}

const windows = new Map<string, PeerWindow>();

export function resetPeerValidationFloodForTests(): void {
  windows.clear();
}

export function peerIdFromTransport(senderAddress: string, messageId: string): string {
  const addr = senderAddress.trim() || 'unknown';
  const mid = messageId.trim() || 'unknown';
  return `${addr}|${mid}`;
}

/**
 * Record a validation rejection for a peer. Returns flood code when threshold exceeded.
 */
export function recordPeerValidationFailure(peerId: string, nowMs = Date.now()): FailureCode | null {
  const cutoff = nowMs - PEER_VALIDATION_FLOOD_WINDOW_MS;
  let w = windows.get(peerId);
  if (!w) {
    w = { timestampsMs: [] };
    windows.set(peerId, w);
  }
  w.timestampsMs = w.timestampsMs.filter((t) => t > cutoff);
  w.timestampsMs.push(nowMs);
  if (w.timestampsMs.length >= PEER_VALIDATION_FLOOD_MAX) {
    return 'peer_validation_flood';
  }
  return null;
}
