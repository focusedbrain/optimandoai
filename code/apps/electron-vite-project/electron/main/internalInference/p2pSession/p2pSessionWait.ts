/**
 * Await the P2P session manager to reach a DataChannel-open phase (or timeout).
 * Used by Sandbox so capability probes can prefer DC over HTTP once the path is up.
 */
import {
  P2pSessionPhase,
  getSessionState,
  subscribeP2pCapabilityDcWait,
} from './p2pInferenceSessionManager'

/** Max wait for model-selector / capability probe while WebRTC handshakes (event-driven). */
export const HOST_AI_CAPABILITY_DC_WAIT_MS = 8_000

export function isP2pDataChannelUpForHandshake(handshakeId: string): boolean {
  const s = getSessionState(handshakeId.trim())
  if (!s) {
    return false
  }
  return s.phase === P2pSessionPhase.datachannel_open || s.phase === P2pSessionPhase.ready
}

export type P2pCapabilityDcWaitOutcome =
  | { ok: true }
  | { ok: false; reason: 'ice_failed'; ice?: string; conn?: string }
  | { ok: false; reason: 'dc_open_timeout' }
  | { ok: false; reason: 'p2p_session_failed'; lastErrorCode: string | null }

/** Single-line `reason=` fragment for `[HOST_AI_CAPABILITY_PROBE]` logs. */
export function p2pCapabilityDcWaitOutcomeLogReason(out: P2pCapabilityDcWaitOutcome): string {
  if (out.ok) {
    return 'dc_open'
  }
  if (out.reason === 'ice_failed') {
    const ice = out.ice ?? ''
    const conn = out.conn ?? ''
    if (ice || conn) {
      return `ice_failed ice=${ice} conn=${conn}`
    }
    return 'ice_failed'
  }
  if (out.reason === 'dc_open_timeout') {
    return 'dc_open_timeout'
  }
  return `p2p_session_failed code=${out.lastErrorCode ?? 'unknown'}`
}

/**
 * Wait for DataChannel open or a terminal WebRTC/session outcome. Listeners are driven by
 * `datachannel_open` IPC, `state` (ice/connection failed), and session phase transitions to `failed`.
 */
export function waitForP2pDataChannelOpenOrTerminal(
  handshakeId: string,
  maxMs: number,
): Promise<P2pCapabilityDcWaitOutcome> {
  const hid = String(handshakeId ?? '').trim()
  if (!hid) {
    return Promise.resolve({ ok: false, reason: 'dc_open_timeout' })
  }

  if (isP2pDataChannelUpForHandshake(hid)) {
    return Promise.resolve({ ok: true })
  }

  const st0 = getSessionState(hid)
  if (st0?.phase === P2pSessionPhase.failed) {
    return Promise.resolve({
      ok: false,
      reason: 'p2p_session_failed',
      lastErrorCode: st0.lastErrorCode ? String(st0.lastErrorCode) : null,
    })
  }

  return new Promise((resolve) => {
    let settled = false
    const finish = (out: P2pCapabilityDcWaitOutcome) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      unsub()
      resolve(out)
    }

    const unsub = subscribeP2pCapabilityDcWait(hid, (ev) => {
      if (ev.kind === 'dc_open') {
        if (isP2pDataChannelUpForHandshake(hid)) {
          finish({ ok: true })
        }
        return
      }
      if (ev.kind === 'webrtc_ice_terminal') {
        finish({ ok: false, reason: 'ice_failed', ice: ev.ice, conn: ev.conn })
        return
      }
      if (ev.kind === 'session_terminal') {
        finish({
          ok: false,
          reason: 'p2p_session_failed',
          lastErrorCode: ev.lastErrorCode ? String(ev.lastErrorCode) : null,
        })
      }
    })

    const timer = setTimeout(() => {
      if (isP2pDataChannelUpForHandshake(hid)) {
        finish({ ok: true })
      } else {
        finish({ ok: false, reason: 'dc_open_timeout' })
      }
    }, Math.max(0, maxMs))

    if (isP2pDataChannelUpForHandshake(hid)) {
      finish({ ok: true })
      return
    }
    const st1 = getSessionState(hid)
    if (st1?.phase === P2pSessionPhase.failed) {
      finish({
        ok: false,
        reason: 'p2p_session_failed',
        lastErrorCode: st1.lastErrorCode ? String(st1.lastErrorCode) : null,
      })
    }
  })
}

export async function waitForP2pDataChannelOrTimeout(handshakeId: string, maxMs: number): Promise<boolean> {
  const r = await waitForP2pDataChannelOpenOrTerminal(handshakeId, maxMs)
  return r.ok
}
