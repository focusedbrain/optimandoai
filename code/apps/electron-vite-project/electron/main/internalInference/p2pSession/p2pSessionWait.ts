/**
 * Await the P2P session manager to reach a DataChannel-open phase (or timeout).
 * Used by Sandbox so capability probes can prefer DC over HTTP once the path is up.
 */
import { P2pSessionPhase, getSessionState } from './p2pInferenceSessionManager'

const POLL_MS = 150

export function isP2pDataChannelUpForHandshake(handshakeId: string): boolean {
  const s = getSessionState(handshakeId.trim())
  if (!s) {
    return false
  }
  return s.phase === P2pSessionPhase.datachannel_open || s.phase === P2pSessionPhase.ready
}

export async function waitForP2pDataChannelOrTimeout(handshakeId: string, maxMs: number): Promise<boolean> {
  const hid = String(handshakeId ?? '').trim()
  if (!hid) {
    return false
  }
  const deadline = Date.now() + Math.max(0, maxMs)
  while (Date.now() < deadline) {
    if (isP2pDataChannelUpForHandshake(hid)) {
      return true
    }
    await new Promise((r) => {
      setTimeout(r, POLL_MS)
    })
  }
  return isP2pDataChannelUpForHandshake(hid)
}
