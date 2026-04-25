/**
 * P2P internal inference — session state machine. WebRTC stack lives in the hidden `internal-inference-p2p-transport` page only.
 * - Handshake + role authorization from ledger (same rules as service RPC) before a session is created.
 * - Signaling: inbound via `handleSignal`; coordination relay post is a reserved stub (no prompts).
 * - `p2p_unavailable` when P2P / signaling feature flags are off; does not change HTTP direct fallback.
 */

import { randomUUID } from 'crypto'
import { BrowserWindow } from 'electron'
import { getHandshakeRecord } from '../../handshake/db'
import { isHostMode, isSandboxMode } from '../../orchestrator/orchestratorModeStore'
import { getP2pInferenceFlags } from '../p2pInferenceFlags'
import { getHandshakeDbForInternalInference } from '../dbAccess'
import { InternalInferenceErrorCode, type InternalInferenceErrorCodeType } from '../errors'
import { getHostInternalInferencePolicy } from '../hostInferencePolicyStore'
import { redactIdForLog } from '../internalInferenceLogRedact'
import {
  assertHostSendsResultToSandbox,
  assertRecordForServiceRpc,
  assertSandboxRequestToHost,
  localCoordinationDeviceId,
  peerCoordinationDeviceId,
} from '../policy'

/** Max time to complete signaling offer/answer before the session is treated as stale. */
export const P2P_SIGNALING_WINDOW_MS = 120_000

export const P2pSessionPhase = {
  idle: 'idle',
  signaling: 'signaling',
  connecting: 'connecting',
  datachannel_open: 'datachannel_open',
  ready: 'ready',
  failed: 'failed',
  closed: 'closed',
} as const
export type P2pSessionPhaseType = (typeof P2pSessionPhase)[keyof typeof P2pSessionPhase]

export const P2pSessionUiPhase = {
  ledger: 'ledger',
  connecting: 'connecting',
  ready: 'ready',
  p2p_unavailable: 'p2p_unavailable',
  no_model: 'no_model',
  policy_disabled: 'policy_disabled',
} as const
export type P2pSessionUiPhaseType = (typeof P2pSessionUiPhase)[keyof typeof P2pSessionUiPhase]

/** Log / IPC reasons for `closeSession` and failure paths. */
export const P2pSessionLogReason = {
  user: 'user',
  unknown: 'unknown',
  p2p_disabled: 'p2p_disabled',
  signaling_disabled: 'signaling_disabled',
  unauthorized: 'unauthorized',
  no_db: 'no_db',
  host_policy: 'host_policy',
  not_found: 'not_found',
  stale_signal: 'stale_signal',
  handshake_revoked: 'handshake_revoked',
  orchestrator_mode_change: 'orchestrator_mode_change',
  account_switch: 'account_switch',
} as const
export type P2pSessionLogReasonType = (typeof P2pSessionLogReason)[keyof typeof P2pSessionLogReason]

export type P2pSessionState = {
  handshakeId: string
  sessionId: string | null
  phase: P2pSessionPhaseType
  p2pUiPhase: P2pSessionUiPhaseType
  lastErrorCode: InternalInferenceErrorCodeType | null
  connectedAt: number | null
  updatedAt: number
  /** When `phase === signaling`, drop signaling after this (epoch ms). */
  signalingExpiresAt: number | null
  /** From ledger at session creation; must match a live re-read for relay signals. */
  boundLocalDeviceId: string
  boundPeerDeviceId: string
}

type SessionModel = {
  state: P2pSessionState
}

const sessions = new Map<string, SessionModel>()

const sessionListeners = new Set<(s: P2pSessionState) => void>()

function now() {
  return Date.now()
}

function emitSessionState(s: P2pSessionState) {
  for (const l of sessionListeners) {
    try {
      l(s)
    } catch {
      /* no-op */
    }
  }
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.isDestroyed()) continue
    w.webContents.send('internal-inference:p2pSession:state', s)
  }
}

function withDerivedUi(base: P2pSessionState): P2pSessionState {
  const f = getP2pInferenceFlags()
  if (!f.p2pInferenceEnabled || !f.p2pInferenceSignalingEnabled) {
    return { ...base, p2pUiPhase: P2pSessionUiPhase.p2p_unavailable }
  }
  if (base.lastErrorCode === InternalInferenceErrorCode.HOST_INFERENCE_DISABLED) {
    return { ...base, p2pUiPhase: P2pSessionUiPhase.policy_disabled }
  }
  if (base.phase === P2pSessionPhase.failed) {
    return { ...base, p2pUiPhase: P2pSessionUiPhase.p2p_unavailable }
  }
  if (base.phase === P2pSessionPhase.signaling || base.phase === P2pSessionPhase.connecting) {
    return { ...base, p2pUiPhase: P2pSessionUiPhase.connecting }
  }
  if (base.phase === P2pSessionPhase.datachannel_open || base.phase === P2pSessionPhase.ready) {
    return { ...base, p2pUiPhase: P2pSessionUiPhase.ready }
  }
  if (base.phase === P2pSessionPhase.idle) {
    return { ...base, p2pUiPhase: P2pSessionUiPhase.ledger }
  }
  if (base.phase === P2pSessionPhase.closed) {
    return { ...base, p2pUiPhase: P2pSessionUiPhase.ledger }
  }
  return base
}

function setSession(hid: string, next: P2pSessionState) {
  const derived = withDerivedUi({ ...next, updatedAt: now() })
  sessions.set(hid, { state: derived })
  emitSessionState(derived)
}

/**
 * When signaling is on and auth passed: reserved for POST /beap/p2p-signal outbound (Phase 5+).
 * Does not send prompts, completions, or service RPC bodies.
 */
function scheduleP2pSignalingRelayOut(_: { sessionId: string; handshakeId: string; reason: string }): void {
  void _
}

/**
 * @returns Unsubscribe
 */
export function subscribeSessionState(listener: (s: P2pSessionState) => void): () => void {
  sessionListeners.add(listener)
  for (const { state } of sessions.values()) {
    try {
      listener(state)
    } catch {
      /* no-op */
    }
  }
  return () => {
    sessionListeners.delete(listener)
  }
}

export function getSessionState(handshakeId: string): P2pSessionState | null {
  const h = typeof handshakeId === 'string' ? handshakeId.trim() : ''
  if (!h) return null
  const m = sessions.get(h)
  if (!m) return null
  return withDerivedUi(m.state)
}

/**
 * @param reason — caller context for logs only (e.g. `ui_ensure`); not sent to peer.
 */
export async function ensureSession(
  handshakeId: string,
  reason: string,
): Promise<P2pSessionState> {
  const hid = typeof handshakeId === 'string' ? handshakeId.trim() : ''
  const t = now()
  const f = getP2pInferenceFlags()
  if (!hid) {
    const st: P2pSessionState = {
      handshakeId: '',
      sessionId: null,
      phase: P2pSessionPhase.failed,
      p2pUiPhase: P2pSessionUiPhase.p2p_unavailable,
      lastErrorCode: InternalInferenceErrorCode.MALFORMED_SERVICE_MESSAGE,
      connectedAt: null,
      updatedAt: t,
      signalingExpiresAt: null,
      boundLocalDeviceId: '',
      boundPeerDeviceId: '',
    }
    return withDerivedUi(st)
  }
  if (!f.p2pInferenceEnabled || !f.p2pInferenceSignalingEnabled) {
    const st: P2pSessionState = {
      handshakeId: hid,
      sessionId: null,
      phase: P2pSessionPhase.idle,
      p2pUiPhase: P2pSessionUiPhase.p2p_unavailable,
      lastErrorCode: null,
      connectedAt: null,
      updatedAt: t,
      signalingExpiresAt: null,
      boundLocalDeviceId: '',
      boundPeerDeviceId: '',
    }
    setSession(hid, st)
    return withDerivedUi(st)
  }
  if (!isHostMode() && !isSandboxMode()) {
    const st: P2pSessionState = {
      handshakeId: hid,
      sessionId: null,
      phase: P2pSessionPhase.failed,
      p2pUiPhase: P2pSessionUiPhase.p2p_unavailable,
      lastErrorCode: InternalInferenceErrorCode.INVALID_INTERNAL_ROLE,
      connectedAt: null,
      updatedAt: t,
      signalingExpiresAt: null,
      boundLocalDeviceId: '',
      boundPeerDeviceId: '',
    }
    setSession(hid, st)
    logFailed(hid, null, P2pSessionLogReason.unauthorized, reason)
    return withDerivedUi(st)
  }
  const db = await getHandshakeDbForInternalInference()
  if (!db) {
    const st: P2pSessionState = {
      handshakeId: hid,
      sessionId: null,
      phase: P2pSessionPhase.failed,
      p2pUiPhase: P2pSessionUiPhase.p2p_unavailable,
      lastErrorCode: InternalInferenceErrorCode.NO_ACTIVE_INTERNAL_HOST_HANDSHAKE,
      connectedAt: null,
      updatedAt: t,
      signalingExpiresAt: null,
      boundLocalDeviceId: '',
      boundPeerDeviceId: '',
    }
    setSession(hid, st)
    logFailed(hid, null, P2pSessionLogReason.no_db, reason)
    return withDerivedUi(st)
  }
  const record = getHandshakeRecord(db, hid)
  const ar = assertRecordForServiceRpc(record)
  if (!ar.ok) {
    const st: P2pSessionState = {
      handshakeId: hid,
      sessionId: null,
      phase: P2pSessionPhase.failed,
      p2pUiPhase: P2pSessionUiPhase.p2p_unavailable,
      lastErrorCode: ar.code as InternalInferenceErrorCodeType,
      connectedAt: null,
      updatedAt: t,
      signalingExpiresAt: null,
      boundLocalDeviceId: '',
      boundPeerDeviceId: '',
    }
    setSession(hid, st)
    logFailed(hid, null, P2pSessionLogReason.unauthorized, reason)
    return withDerivedUi(st)
  }
  if (isSandboxMode()) {
    const role = assertSandboxRequestToHost(ar.record)
    if (!role.ok) {
      const st: P2pSessionState = {
        handshakeId: hid,
        sessionId: null,
        phase: P2pSessionPhase.failed,
        p2pUiPhase: P2pSessionUiPhase.p2p_unavailable,
        lastErrorCode: role.code as InternalInferenceErrorCodeType,
        connectedAt: null,
        updatedAt: t,
        signalingExpiresAt: null,
        boundLocalDeviceId: '',
        boundPeerDeviceId: '',
      }
      setSession(hid, st)
      logFailed(hid, null, P2pSessionLogReason.unauthorized, reason)
      return withDerivedUi(st)
    }
  } else {
    const role = assertHostSendsResultToSandbox(ar.record)
    if (!role.ok) {
      const st: P2pSessionState = {
        handshakeId: hid,
        sessionId: null,
        phase: P2pSessionPhase.failed,
        p2pUiPhase: P2pSessionUiPhase.p2p_unavailable,
        lastErrorCode: role.code as InternalInferenceErrorCodeType,
        connectedAt: null,
        updatedAt: t,
        signalingExpiresAt: null,
        boundLocalDeviceId: '',
        boundPeerDeviceId: '',
      }
      setSession(hid, st)
      logFailed(hid, null, P2pSessionLogReason.unauthorized, reason)
      return withDerivedUi(st)
    }
    if (!getHostInternalInferencePolicy().allowSandboxInference) {
      const st: P2pSessionState = {
        handshakeId: hid,
        sessionId: null,
        phase: P2pSessionPhase.failed,
        p2pUiPhase: P2pSessionUiPhase.policy_disabled,
        lastErrorCode: InternalInferenceErrorCode.HOST_INFERENCE_DISABLED,
        connectedAt: null,
        updatedAt: t,
        signalingExpiresAt: null,
        boundLocalDeviceId: '',
        boundPeerDeviceId: '',
      }
      setSession(hid, st)
      logFailed(hid, null, P2pSessionLogReason.host_policy, reason)
      return withDerivedUi(st)
    }
  }
  const existing = sessions.get(hid)
  if (existing) {
    const s = existing.state
    if (s.sessionId) {
      if (s.phase === P2pSessionPhase.signaling) {
        scheduleP2pSignalingRelayOut({ sessionId: s.sessionId, handshakeId: hid, reason: 'ensure_idempotent' })
        return withDerivedUi(s)
      }
    }
    if (s.phase === P2pSessionPhase.connecting || s.phase === P2pSessionPhase.datachannel_open || s.phase === P2pSessionPhase.ready) {
      return withDerivedUi(s)
    }
  }
  const sessionId = randomUUID()
  const localBound = localCoordinationDeviceId(ar.record)?.trim() ?? ''
  const peerBound = peerCoordinationDeviceId(ar.record)?.trim() ?? ''
  const st: P2pSessionState = {
    handshakeId: hid,
    sessionId,
    phase: P2pSessionPhase.signaling,
    p2pUiPhase: P2pSessionUiPhase.connecting,
    lastErrorCode: null,
    connectedAt: null,
    updatedAt: t,
    signalingExpiresAt: t + P2P_SIGNALING_WINDOW_MS,
    boundLocalDeviceId: localBound,
    boundPeerDeviceId: peerBound,
  }
  setSession(hid, st)
  logConnecting(hid, sessionId)
  scheduleP2pSignalingRelayOut({ sessionId, handshakeId: hid, reason: `ensure_${reason}` })
  return withDerivedUi(st)
}

/**
 * Ledger + session binding checks before applying relay signaling. Call before `handleSignal`.
 */
export async function preflightP2pRelaySignal(raw: Record<string, unknown>): Promise<boolean> {
  const f = getP2pInferenceFlags()
  if (!f.p2pInferenceEnabled || !f.p2pInferenceSignalingEnabled) {
    return false
  }
  const hid = typeof raw.handshake_id === 'string' ? raw.handshake_id.trim() : ''
  if (!hid) return false
  const m = sessions.get(hid)
  if (!m) return false
  const sid = typeof raw.session_id === 'string' ? raw.session_id.trim() : ''
  if (!m.state.sessionId || !sid || m.state.sessionId !== sid) {
    return false
  }
  const t = now()
  const st0 = m.state
  if (st0.phase === P2pSessionPhase.failed || st0.phase === P2pSessionPhase.closed) {
    return false
  }
  if (st0.phase === P2pSessionPhase.signaling && st0.signalingExpiresAt != null && t > st0.signalingExpiresAt) {
    closeSession(hid, P2pSessionLogReason.stale_signal)
    return false
  }
  const db = await getHandshakeDbForInternalInference()
  if (!db) {
    closeSession(hid, P2pSessionLogReason.no_db)
    return false
  }
  const record = getHandshakeRecord(db, hid)
  const ar = assertRecordForServiceRpc(record)
  if (!ar.ok) {
    closeSession(hid, P2pSessionLogReason.unauthorized)
    return false
  }
  const local = localCoordinationDeviceId(ar.record)?.trim() ?? ''
  const peer = peerCoordinationDeviceId(ar.record)?.trim() ?? ''
  if (!local || !peer) {
    return false
  }
  if (st0.boundLocalDeviceId && st0.boundPeerDeviceId) {
    if (local !== st0.boundLocalDeviceId || peer !== st0.boundPeerDeviceId) {
      closeSession(hid, P2pSessionLogReason.unauthorized)
      return false
    }
  }
  const snd = typeof raw.sender_device_id === 'string' ? raw.sender_device_id.trim() : ''
  const rcv = typeof raw.receiver_device_id === 'string' ? raw.receiver_device_id.trim() : ''
  const validPair = (snd === local && rcv === peer) || (snd === peer && rcv === local)
  if (!validPair) {
    return false
  }
  return true
}

/**
 * Inbound from coordination relay (after `preflightP2pRelaySignal`). Idempotent, no WebRTC.
 */
export function handleSignal(raw: Record<string, unknown>): void {
  const f = getP2pInferenceFlags()
  if (!f.p2pInferenceEnabled || !f.p2pInferenceSignalingEnabled) {
    return
  }
  const hid = typeof raw.handshake_id === 'string' ? raw.handshake_id.trim() : ''
  if (!hid) return
  const m = sessions.get(hid)
  if (!m) return
  const sid = typeof raw.session_id === 'string' ? raw.session_id.trim() : ''
  if (!m.state.sessionId || !sid || m.state.sessionId !== sid) {
    return
  }
  const t = now()
  const st = m.state
  if (st.phase === P2pSessionPhase.failed || st.phase === P2pSessionPhase.closed) {
    return
  }
  const stype = raw.signal_type
  if (stype === 'p2p_inference_error' || stype === 'p2p_inference_close') {
    setSession(hid, { ...st, phase: P2pSessionPhase.failed, updatedAt: t, lastErrorCode: InternalInferenceErrorCode.INTERNAL_INFERENCE_FAILED })
    return
  }
  if (st.phase === P2pSessionPhase.signaling) {
    setSession(hid, { ...st, phase: P2pSessionPhase.connecting, updatedAt: t })
  }
}

/**
 * When the WebRTC DataChannel is open, advance session to `datachannel_open` (and connectedAt).
 * Only updates when the stored `sessionId` matches the active P2P session for that handshake.
 */
export function markDataChannelOpenForP2pSession(handshakeId: string, p2pSessionId: string): void {
  const hid = typeof handshakeId === 'string' ? handshakeId.trim() : ''
  const sid = typeof p2pSessionId === 'string' ? p2pSessionId.trim() : ''
  if (!hid || !sid) return
  const m = sessions.get(hid)
  if (!m || m.state.sessionId !== sid) return
  const t = now()
  setSession(hid, {
    ...m.state,
    phase: P2pSessionPhase.datachannel_open,
    connectedAt: t,
    updatedAt: t,
  })
}

export function closeSession(handshakeId: string, reason: P2pSessionLogReasonType): void {
  const hid = typeof handshakeId === 'string' ? handshakeId.trim() : ''
  if (!hid) return
  const m = sessions.get(hid)
  if (!m) {
    return
  }
  const t = now()
  const sessionId = m.state.sessionId
  sessions.delete(hid)
  const final: P2pSessionState = withDerivedUi({
    handshakeId: hid,
    sessionId: null,
    phase: P2pSessionPhase.closed,
    p2pUiPhase: P2pSessionUiPhase.ledger,
    lastErrorCode: null,
    connectedAt: null,
    updatedAt: t,
    signalingExpiresAt: null,
    boundLocalDeviceId: '',
    boundPeerDeviceId: '',
  })
  emitSessionState(final)
  logClosed(hid, sessionId, reason)
}

export function closeAllP2pInferenceSessions(reason: P2pSessionLogReasonType): void {
  for (const hid of [...sessions.keys()]) {
    closeSession(hid, reason)
  }
}

/** @internal */
export function _resetP2pInferenceSessionsForTests(): void {
  sessions.clear()
}

function logConnecting(handshake: string, session: string) {
  console.log(`[P2P_SESSION] connecting handshake=${handshake} session=${redactIdForLog(session)}`)
}

function logFailed(handshake: string, session: string | null, logReason: P2pSessionLogReasonType, _ensureReason: string) {
  const sid = session && session.length ? redactIdForLog(session) : 'none'
  void _ensureReason
  console.log(`[P2P_SESSION] failed handshake=${handshake} session=${sid} reason=${logReason}`)
}

function logClosed(handshake: string, session: string | null, logReason: P2pSessionLogReasonType) {
  const sid = session && session.length ? redactIdForLog(session) : 'none'
  console.log(`[P2P_SESSION] closed handshake=${handshake} session=${sid} reason=${logReason}`)
}
