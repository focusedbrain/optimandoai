/**
 * P2P internal inference — session state machine. WebRTC stack lives in the hidden `internal-inference-p2p-transport` page only.
 * - Handshake + role authorization from ledger (same rules as service RPC) before a session is created.
 * - Signaling: inbound via `handleSignal`; coordination relay post is a reserved stub (no prompts).
 * - `p2p_unavailable` when P2P / signaling feature flags are off; does not change HTTP direct fallback.
 */

import { randomUUID } from 'crypto'
import { BrowserWindow } from 'electron'
import { getHandshakeRecord } from '../../handshake/db'
import type { HandshakeRecord } from '../../handshake/types'
import { getInstanceId, getOrchestratorMode } from '../../orchestrator/orchestratorModeStore'
import { getP2pInferenceFlags } from '../p2pInferenceFlags'
import { getHandshakeDbForInternalInference } from '../dbAccess'
import { InternalInferenceErrorCode, type InternalInferenceErrorCodeType } from '../errors'
import { getHostInternalInferencePolicy } from '../hostInferencePolicyStore'
import { newHostAiCorrelationChain } from '../hostAiStageLog'
import { HostAiWebrtcStartError, startHostAiP2pWebrtcSessionOffer } from '../hostAiWebrtcOfferStart'
import { redactIdForLog } from '../internalInferenceLogRedact'
import {
  assertRecordForServiceRpc,
  deriveInternalHostAiPeerRoles,
  type DeriveInternalHostAiPeerRolesResult,
  localCoordinationDeviceId,
  peerCoordinationDeviceId,
} from '../policy'

/** Sandbox-side flows that require local=sandbox, peer=host (model selector, chat, probe). */
const SANDBOX_INITIATED_P2P_SESSION_REASONS = new Set([
  'model_selector',
  'capability_probe',
  'host_inference_chat',
  'pong_test',
])

/** Max time to complete signaling offer/answer before the session is treated as stale. */
export const P2P_SIGNALING_WINDOW_MS = 120_000

export const P2pSessionPhase = {
  idle: 'idle',
  /** WebRTC offer pipeline is being started (transport window + create); not yet in ICE signaling. */
  starting: 'starting',
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

/** One in-flight `ensureSession` per handshake (model list bursts, probe + list). */
const ensureSessionInFlight = new Map<string, { chain: string; promise: Promise<P2pSessionState> }>()

/** Cooldown after `failed` before `ensureSession` will allocate a new attempt. */
const HOST_AI_FAILED_COOLDOWN_MS = 5_000
/** After `phase=signaling`, if no outbound offer is recorded (main), fail with `OFFER_CREATE_TIMEOUT`. */
const HOST_AI_OFFER_OUTBOUND_DEADLINE_MS = 15_000

const signalingOfferDeadlineTimers = new Map<string, ReturnType<typeof setTimeout>>()
const offerSentForSession = new Set<string>()

function sessionOpKey(handshakeId: string, p2pSessionId: string): string {
  return `${handshakeId.trim()}\0${p2pSessionId.trim()}`
}

function clearSignalingOfferDeadline(handshakeId: string, p2pSessionId: string | null | undefined) {
  const sid = typeof p2pSessionId === 'string' ? p2pSessionId.trim() : ''
  if (!sid) return
  const k = sessionOpKey(handshakeId, sid)
  const t = signalingOfferDeadlineTimers.get(k)
  if (t) {
    clearTimeout(t)
    signalingOfferDeadlineTimers.delete(k)
  }
}

function clearHostAiSignalingGatesForHandshake(handshakeId: string) {
  const hid = handshakeId.trim()
  const prefix = `${hid}\0`
  for (const [k, timer] of [...signalingOfferDeadlineTimers.entries()]) {
    if (k.startsWith(prefix)) {
      clearTimeout(timer)
      signalingOfferDeadlineTimers.delete(k)
    }
  }
  for (const k of [...offerSentForSession]) {
    if (k.startsWith(prefix)) {
      offerSentForSession.delete(k)
    }
  }
}

/**
 * Mark that the WebRTC transport produced a local SDP offer (or equivalent), so
 * `OFFER_CREATE_TIMEOUT` does not fire. Invoked from `p2pSignalOutbound` only.
 */
export function markP2pOfferSentForSession(handshakeId: string, p2pSessionId: string): void {
  const k = sessionOpKey(handshakeId, p2pSessionId)
  offerSentForSession.add(k)
  clearSignalingOfferDeadline(handshakeId, p2pSessionId)
}

function scheduleOfferOutboundDeadlineIfNeeded(handshakeId: string, p2pSessionId: string) {
  const hid = handshakeId.trim()
  const sid = p2pSessionId.trim()
  if (!hid || !sid) return
  const k = sessionOpKey(hid, sid)
  clearSignalingOfferDeadline(hid, sid)
  const t = setTimeout(() => {
    signalingOfferDeadlineTimers.delete(k)
    const m = sessions.get(hid)
    if (!m || m.state.sessionId !== sid) return
    if (m.state.phase !== P2pSessionPhase.signaling) return
    if (offerSentForSession.has(k)) return
    setSession(hid, {
      ...m.state,
      phase: P2pSessionPhase.failed,
      updatedAt: now(),
      lastErrorCode: InternalInferenceErrorCode.OFFER_CREATE_TIMEOUT,
    })
    console.log(
      `[P2P_SIGNAL] failed type=offer handshake=${hid} session=${redactIdForLog(sid)} code=OFFER_CREATE_TIMEOUT`,
    )
  }, HOST_AI_OFFER_OUTBOUND_DEADLINE_MS)
  signalingOfferDeadlineTimers.set(k, t)
}

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
  if (
    base.phase === P2pSessionPhase.starting ||
    base.phase === P2pSessionPhase.signaling ||
    base.phase === P2pSessionPhase.connecting
  ) {
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

type P2pSessionAuthFailureReason =
  | 'device_id_mismatch'
  | 'sandbox_target_reason_wrong_role'
  | 'host_path_policy'
  | 'host_path_wrong_role'
  | 'invalid_pair'

function logP2pSessionAuthFailed(
  hid: string,
  record: HandshakeRecord | null,
  dr: DeriveInternalHostAiPeerRolesResult,
  params: {
    ensureReason: string
    lastErrorCode: InternalInferenceErrorCodeType
    authReason: P2pSessionAuthFailureReason
    expectedLocalRole?: 'sandbox' | 'host'
  },
) {
  const om = getOrchestratorMode()
  const localId8 = redactIdForLog(String(getInstanceId() ?? '').trim())
  const initiator = record?.initiator_device_role ?? 'null'
  const acceptor = record?.acceptor_device_role ?? 'null'
  const lrField = record?.local_role ?? 'null'
  let derivedLocal = 'null'
  let derivedPeer = 'null'
  if (dr.ok) {
    derivedLocal = dr.localRole
    derivedPeer = dr.peerRole
  }
  const exp = params.expectedLocalRole ?? 'n/a'
  console.log(
    `[P2P_SESSION_AUTH] failed handshake=${hid} configured_mode=${om.mode} derived_local_role=${derivedLocal} derived_peer_role=${derivedPeer} expected_local_role=${exp} local_device_id=${localId8} initiator_device_role=${initiator} acceptor_device_role=${acceptor} local_role_field=${lrField} reason=${params.authReason} lastErrorCode=${params.lastErrorCode} ensure=${params.ensureReason}`,
  )
}

function authorizeInternalP2pSession(
  reason: string,
  dr: DeriveInternalHostAiPeerRolesResult,
):
  | { ok: true }
  | {
      ok: false
      code: InternalInferenceErrorCodeType
      authReason: P2pSessionAuthFailureReason
      expectedLocalRole?: 'sandbox' | 'host'
    } {
  if (!dr.ok) {
    return {
      ok: false,
      code: dr.code as InternalInferenceErrorCodeType,
      authReason: 'device_id_mismatch',
    }
  }
  const { localRole, peerRole } = dr
  if (
    (localRole !== 'host' && localRole !== 'sandbox') ||
    (peerRole !== 'host' && peerRole !== 'sandbox') ||
    localRole === peerRole
  ) {
    return {
      ok: false,
      code: InternalInferenceErrorCode.INVALID_INTERNAL_ROLE,
      authReason: 'invalid_pair',
    }
  }
  if (SANDBOX_INITIATED_P2P_SESSION_REASONS.has(reason)) {
    if (localRole !== 'sandbox' || peerRole !== 'host') {
      return {
        ok: false,
        code: InternalInferenceErrorCode.INVALID_INTERNAL_ROLE,
        authReason: 'sandbox_target_reason_wrong_role',
        expectedLocalRole: 'sandbox',
      }
    }
    return { ok: true }
  }
  if (localRole === 'sandbox' && peerRole === 'host') {
    return { ok: true }
  }
  if (localRole === 'host' && peerRole === 'sandbox') {
    if (!getHostInternalInferencePolicy().allowSandboxInference) {
      return {
        ok: false,
        code: InternalInferenceErrorCode.HOST_INFERENCE_DISABLED,
        authReason: 'host_path_policy',
        expectedLocalRole: 'host',
      }
    }
    return { ok: true }
  }
  return {
    ok: false,
    code: InternalInferenceErrorCode.INVALID_INTERNAL_ROLE,
    authReason: 'host_path_wrong_role',
  }
}

/**
 * Single owner for Host AI WebRTC session attempts: one in-flight promise, reuse of an
 * already-active session (signaling … ready), and failed-state cooldown.
 * `capability_probe` must not use this to start sessions — call `ensureSession` only from
 * list/chat/p2p IPC via this API; probe paths use `getSessionState` only.
 */
export function ensureHostAiP2pSession(handshakeId: string, reason: string): Promise<P2pSessionState> {
  const hid = typeof handshakeId === 'string' ? handshakeId.trim() : ''
  if (!hid) {
    return ensureSession(handshakeId, reason)
  }
  const inflight = ensureSessionInFlight.get(hid)
  if (inflight) {
    const curSid = sessions.get(hid)?.state.sessionId
    const sidLog = curSid ? redactIdForLog(curSid) : 'null'
    console.log(
      `[HOST_AI_SESSION_ENSURE] reuse_inflight handshake=${hid} session=${sidLog} chain=${inflight.chain} requested_reason=${reason}`,
    )
    return inflight.promise
  }
  const m0 = sessions.get(hid)
  if (m0) {
    const s = m0.state
    const tCheck = now()
    if (s.phase === P2pSessionPhase.failed) {
      if (tCheck - s.updatedAt < HOST_AI_FAILED_COOLDOWN_MS) {
        console.log(
          `[HOST_AI_SESSION_ENSURE] reuse_failed_cooldown handshake=${hid} code=${s.lastErrorCode ?? 'unknown'}`,
        )
        return Promise.resolve(withDerivedUi(s))
      }
    } else if (
      s.phase === P2pSessionPhase.starting ||
      s.phase === P2pSessionPhase.signaling ||
      s.phase === P2pSessionPhase.connecting ||
      s.phase === P2pSessionPhase.datachannel_open ||
      s.phase === P2pSessionPhase.ready
    ) {
      const sidLog2 = s.sessionId ? redactIdForLog(s.sessionId) : 'null'
      console.log(
        `[HOST_AI_SESSION_ENSURE] reuse_active handshake=${hid} session=${sidLog2} phase=${s.phase} requested_reason=${reason}`,
      )
      return Promise.resolve(withDerivedUi(s))
    }
  }
  const chain = newHostAiCorrelationChain()
  console.log(`[HOST_AI_SESSION_ENSURE] ensure_chain_start handshake=${hid} chain=${chain} reason=${reason}`)
  const p = ensureSession(hid, reason)
    .then((st) => st, (e) => {
      throw e
    })
    .finally(() => {
      ensureSessionInFlight.delete(hid)
    })
  ensureSessionInFlight.set(hid, { chain, promise: p })
  return p
}

/**
 * @deprecated Prefer {@link ensureHostAiP2pSession}; same behavior.
 */
export function ensureSessionSingleFlight(
  handshakeId: string,
  reason: string,
): Promise<P2pSessionState> {
  return ensureHostAiP2pSession(handshakeId, reason)
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
  const localId = String(getInstanceId() ?? '').trim()
  const dr = deriveInternalHostAiPeerRoles(ar.record, localId)
  const authz = authorizeInternalP2pSession(reason, dr)
  if (!authz.ok) {
    const st: P2pSessionState = {
      handshakeId: hid,
      sessionId: null,
      phase: P2pSessionPhase.failed,
      p2pUiPhase:
        authz.code === InternalInferenceErrorCode.HOST_INFERENCE_DISABLED
          ? P2pSessionUiPhase.policy_disabled
          : P2pSessionUiPhase.p2p_unavailable,
      lastErrorCode: authz.code,
      connectedAt: null,
      updatedAt: t,
      signalingExpiresAt: null,
      boundLocalDeviceId: '',
      boundPeerDeviceId: '',
    }
    setSession(hid, st)
    logP2pSessionAuthFailed(hid, ar.record, dr, {
      ensureReason: reason,
      lastErrorCode: authz.code,
      authReason: authz.authReason,
      expectedLocalRole: authz.expectedLocalRole,
    })
    logFailed(
      hid,
      null,
      authz.code === InternalInferenceErrorCode.HOST_INFERENCE_DISABLED
        ? P2pSessionLogReason.host_policy
        : P2pSessionLogReason.unauthorized,
      reason,
    )
    return withDerivedUi(st)
  }
  const existing = sessions.get(hid)
  if (existing) {
    const s = existing.state
    if (s.phase === P2pSessionPhase.failed) {
      if (t - s.updatedAt < HOST_AI_FAILED_COOLDOWN_MS) {
        return withDerivedUi(s)
      }
    } else if (s.sessionId) {
      if (s.phase === P2pSessionPhase.starting || s.phase === P2pSessionPhase.signaling) {
        scheduleP2pSignalingRelayOut({ sessionId: s.sessionId, handshakeId: hid, reason: 'ensure_idempotent' })
        return withDerivedUi(s)
      }
    }
    if (s.phase === P2pSessionPhase.connecting || s.phase === P2pSessionPhase.datachannel_open || s.phase === P2pSessionPhase.ready) {
      return withDerivedUi(s)
    }
  }
  clearHostAiSignalingGatesForHandshake(hid)
  const sessionId = randomUUID()
  const localBound = localCoordinationDeviceId(ar.record)?.trim() ?? ''
  const peerBound = peerCoordinationDeviceId(ar.record)?.trim() ?? ''
  const webrtc = f.p2pInferenceWebrtcEnabled
  const tBase = now()
  const stBase: P2pSessionState = {
    handshakeId: hid,
    sessionId,
    phase: webrtc ? P2pSessionPhase.starting : P2pSessionPhase.signaling,
    p2pUiPhase: P2pSessionUiPhase.connecting,
    lastErrorCode: null,
    connectedAt: null,
    updatedAt: tBase,
    signalingExpiresAt: tBase + P2P_SIGNALING_WINDOW_MS,
    boundLocalDeviceId: localBound,
    boundPeerDeviceId: peerBound,
  }
  setSession(hid, stBase)
  console.log(`[HOST_AI_SESSION_ENSURE] begin handshake=${hid} session=${redactIdForLog(sessionId)} reason=${reason}`)
  logConnecting(hid, sessionId)
  if (webrtc) {
    try {
      await startHostAiP2pWebrtcSessionOffer(hid, sessionId, reason)
    } catch (e) {
      const errCode: InternalInferenceErrorCodeType =
        e instanceof HostAiWebrtcStartError
          ? e.errorCode
          : InternalInferenceErrorCode.WEBRTC_TRANSPORT_NOT_READY
      const tFail = now()
      const stFailed: P2pSessionState = {
        ...stBase,
        phase: P2pSessionPhase.failed,
        updatedAt: tFail,
        lastErrorCode: errCode,
      }
      setSession(hid, stFailed)
      logFailed(hid, sessionId, P2pSessionLogReason.unknown, reason)
      return withDerivedUi(stFailed)
    }
  }
  const tSig = now()
  const st: P2pSessionState = {
    ...stBase,
    phase: P2pSessionPhase.signaling,
    updatedAt: tSig,
    signalingExpiresAt: tSig + P2P_SIGNALING_WINDOW_MS,
  }
  setSession(hid, st)
  scheduleP2pSignalingRelayOut({ sessionId, handshakeId: hid, reason: `ensure_${reason}` })
  if (webrtc) {
    scheduleOfferOutboundDeadlineIfNeeded(hid, sessionId)
  }
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
  if (
    (st0.phase === P2pSessionPhase.starting || st0.phase === P2pSessionPhase.signaling) &&
    st0.signalingExpiresAt != null &&
    t > st0.signalingExpiresAt
  ) {
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
  if (st.phase === P2pSessionPhase.starting || st.phase === P2pSessionPhase.signaling) {
    clearSignalingOfferDeadline(hid, st.sessionId)
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
  clearSignalingOfferDeadline(hid, sid)
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
  clearHostAiSignalingGatesForHandshake(hid)
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
  for (const timer of signalingOfferDeadlineTimers.values()) {
    clearTimeout(timer)
  }
  signalingOfferDeadlineTimers.clear()
  offerSentForSession.clear()
  sessions.clear()
  ensureSessionInFlight.clear()
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
