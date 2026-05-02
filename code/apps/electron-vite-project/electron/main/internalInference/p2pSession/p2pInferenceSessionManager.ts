/**
 * P2P internal inference — session state machine. WebRTC stack lives in the hidden `internal-inference-p2p-transport` page only.
 * - Handshake + role authorization from ledger (same rules as service RPC) before a session is created.
 * - Signaling: inbound via `handleSignal`; outbound POST /beap/p2p-signal via `p2pSignalRelayPost` (no RPC bodies).
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
import { resolveHostAiRemoteInferencePolicyBestEffort } from '../hostAiRemoteInferencePolicyResolve'
import { newHostAiCorrelationChain } from '../hostAiStageLog'
import {
  HostAiWebrtcStartError,
  startWebrtcAnswererForHostAiSession,
  startWebrtcOfferForHostAiSession,
} from '../hostAiWebrtcOfferStart'
import { redactIdForLog } from '../internalInferenceLogRedact'
import {
  assertRecordForServiceRpc,
  deriveInternalHostAiPeerRoles,
  type DeriveInternalHostAiPeerRolesResult,
  isInternalHandshakeInitiatorDevice,
  localCoordinationDeviceId,
  peerCoordinationDeviceId,
} from '../policy'
import {
  getP2pRelaySignalingCircuitOpenUntilMs,
  isP2pRelaySignalingCircuitOpen,
  resetP2pRelaySignalingCircuitForTests,
} from '../p2pSignalRelayCircuit'

/** Sandbox-side flows that require local=sandbox, peer=host (model selector, chat, probe). */
const SANDBOX_INITIATED_P2P_SESSION_REASONS = new Set([
  'model_selector',
  'capability_probe',
  'host_inference_chat',
  'pong_test',
])

/** Max time to complete signaling offer/answer before the session is treated as stale. */
export const P2P_SIGNALING_WINDOW_MS = 120_000

/** Tear down the hidden WebRTC pod peer for this ledger session (ICE queue + PC close). */
function disposeWebrtcPodSession(handshakeId: string, sessionId: string | null | undefined): void {
  const hid = typeof handshakeId === 'string' ? handshakeId.trim() : ''
  const sid = typeof sessionId === 'string' ? sessionId.trim() : ''
  if (!hid || !sid) return
  void import('../webrtc/webrtcTransportIpc')
    .then(({ webrtcCloseSession }) => webrtcCloseSession(sid, hid))
    .catch(() => {})
}

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
  /** Relay signaling circuit breaker: brief pause after repeated 429 storms (offer/answer only). */
  relay_reconnecting: 'relay_reconnecting',
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
  orchestrator_build_changed: 'orchestrator_build_changed',
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
  /** `phase=signaling` (WebRTC) is only valid after a successful `startWebrtcOfferForHostAiSession` — both true. */
  offerStartRequested: boolean
  offerCreateDispatched: boolean
  /** Set when the transport page logged `peer_connection_create_begin` for this session. */
  observedPeerConnectionCreateBegin: boolean
  /** Set when the transport page sent `create_offer_begin` to main. */
  observedCreateOfferBegin: boolean
  /**
   * WebRTC: ledger **initiator** (coordination id) runs `createOffer`; **acceptor** runs `createAnswer` only.
   * Prevents both peers from creating a local offer.
   */
  p2pWebrtcLocalRole: 'offerer' | 'answerer'
}

type SessionModel = {
  state: P2pSessionState
}

const sessions = new Map<string, SessionModel>()

/** One in-flight `ensureSession` per handshake (model list bursts, probe + list). */
const ensureSessionInFlight = new Map<string, { chain: string; promise: Promise<P2pSessionState> }>()

/** Cooldown after `failed` before `ensureSession` will allocate a new attempt. */
const HOST_AI_FAILED_COOLDOWN_MS = 5_000
/** Terminal `phase=failed` transitions in this rolling window trip a session storm pause. */
const HOST_AI_TERMINAL_FAIL_WINDOW_MS = 60_000
const HOST_AI_TERMINAL_FAIL_STORM_THRESHOLD = 3
const HOST_AI_SESSION_STORM_PAUSE_MS = 30_000

const handshakeTerminalFailureTimestamps = new Map<string, number[]>()
const handshakeSessionStormOpenUntilMs = new Map<string, number>()

/** Test-only: clear session storm counters and pause map. */
export function resetHostAiSessionStormForTests(): void {
  handshakeTerminalFailureTimestamps.clear()
  handshakeSessionStormOpenUntilMs.clear()
}

function pruneTerminalFailureTimestamps(hid: string, t: number): number[] {
  const arr = handshakeTerminalFailureTimestamps.get(hid) ?? []
  const pruned = arr.filter((x) => t - x <= HOST_AI_TERMINAL_FAIL_WINDOW_MS)
  handshakeTerminalFailureTimestamps.set(hid, pruned)
  return pruned
}

function recordHandshakeTerminalFailureForStorm(hid: string): void {
  const t = now()
  const pruned = pruneTerminalFailureTimestamps(hid, t)
  pruned.push(t)
  handshakeTerminalFailureTimestamps.set(hid, pruned)
  if (pruned.length >= HOST_AI_TERMINAL_FAIL_STORM_THRESHOLD) {
    const until = t + HOST_AI_SESSION_STORM_PAUSE_MS
    handshakeSessionStormOpenUntilMs.set(hid, until)
    console.log(
      `[HOST_AI_SESSION_STORM] handshake=${hid} consecutive_terminal_sessions=${pruned.length} window_ms=${HOST_AI_TERMINAL_FAIL_WINDOW_MS} pause_until_ms=${until} pause_ms=${HOST_AI_SESSION_STORM_PAUSE_MS}`,
    )
  }
}

function clearHandshakeTerminalFailureStreak(hid: string): void {
  handshakeTerminalFailureTimestamps.delete(hid)
}

function hostAiSessionStormOpenUntilMs(handshakeId: string): number {
  const hid = handshakeId.trim()
  if (!hid) return 0
  const until = handshakeSessionStormOpenUntilMs.get(hid) ?? 0
  const t = now()
  if (until > 0 && until <= t) {
    handshakeSessionStormOpenUntilMs.delete(hid)
    return 0
  }
  return until
}

/** After `phase=signaling`, if no outbound offer is recorded (main), fail with `OFFER_CREATE_TIMEOUT`. */
const HOST_AI_OFFER_OUTBOUND_DEADLINE_MS = 15_000
/** If in `signaling` (WebRTC) and neither `create_offer_begin` nor outbound offer is observed, fail. */
const HOST_AI_OFFER_START_WATCHDOG_MS = 5_000

const signalingOfferDeadlineTimers = new Map<string, ReturnType<typeof setTimeout>>()
const offerStartWatchdogTimers = new Map<string, ReturnType<typeof setTimeout>>()
const offerSentForSession = new Set<string>()

function noOfferMilestones(): {
  offerStartRequested: false
  offerCreateDispatched: false
  observedPeerConnectionCreateBegin: false
  observedCreateOfferBegin: false
  p2pWebrtcLocalRole: 'offerer'
} {
  return {
    offerStartRequested: false,
    offerCreateDispatched: false,
    observedPeerConnectionCreateBegin: false,
    observedCreateOfferBegin: false,
    p2pWebrtcLocalRole: 'offerer',
  }
}

function needsWebrtcOfferPipelineRepair(s: P2pSessionState, webrtc: boolean): boolean {
  if (s.p2pWebrtcLocalRole === 'answerer') {
    return false
  }
  if (!webrtc || !s.sessionId) {
    return false
  }
  if (s.phase !== P2pSessionPhase.starting && s.phase !== P2pSessionPhase.signaling) {
    return false
  }
  return !s.offerCreateDispatched
}

/** Pre-data-channel phases that may be torn down when signaling times out or list cache marks stuck. */
function isHostAiP2pPreDataChannelPhase(phase: P2pSessionPhaseType): boolean {
  return (
    phase === P2pSessionPhase.starting ||
    phase === P2pSessionPhase.signaling ||
    phase === P2pSessionPhase.connecting
  )
}

function computeHostAiP2pSessionStaleEvictionDetail(
  s: P2pSessionState,
  nowMs: number,
): { reason: string; age_ms: number } | null {
  if (!isHostAiP2pPreDataChannelPhase(s.phase)) {
    return null
  }
  const ageFromUpdated = Math.max(0, nowMs - s.updatedAt)
  const exp = s.signalingExpiresAt
  if (exp != null && nowMs >= exp) {
    return { reason: 'signaling_window_expired', age_ms: ageFromUpdated }
  }
  if (exp == null && nowMs - s.updatedAt > P2P_SIGNALING_WINDOW_MS) {
    return { reason: 'signaling_stale_no_window', age_ms: ageFromUpdated }
  }
  return null
}

function performHostAiP2pSessionEviction(
  hid: string,
  s: P2pSessionState,
  detail: { reason: string; age_ms: number },
): void {
  const oldSid = s.sessionId
  const oldPhase = s.phase
  const sidLog = oldSid ? redactIdForLog(oldSid) : 'null'
  console.log(
    `[HOST_AI_SESSION_EXPIRE] handshake=${hid} old_session=${sidLog} old_phase=${oldPhase} age_ms=${detail.age_ms} reason=${detail.reason} action=close_and_remove`,
  )
  emitP2pCapabilityDcWait(hid, { kind: 'session_terminal', lastErrorCode: null })
  tearDownP2pTransportAndRelayForHandshake(hid, oldSid)
  sessions.delete(hid)
  const t = now()
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
    ...noOfferMilestones(),
  })
  emitSessionState(final)
}

function evictStaleHostAiP2pSessionBeforeReuse(handshakeId: string): void {
  const hid = typeof handshakeId === 'string' ? handshakeId.trim() : ''
  if (!hid) return
  for (let i = 0; i < 4; i++) {
    const m = sessions.get(hid)
    if (!m) return
    const d = computeHostAiP2pSessionStaleEvictionDetail(m.state, now())
    if (!d) return
    performHostAiP2pSessionEviction(hid, m.state, d)
  }
}

/**
 * List path: `p2p_ensure_cache_expired` (stuck pre-DC ensure) must evict the live session so
 * `ensureHostAiP2pSession` cannot hit `reuse_active` on the same ledger session.
 */
export function evictHostAiP2pSessionForStuckListCache(handshakeId: string, ageMs: number): void {
  const hid = typeof handshakeId === 'string' ? handshakeId.trim() : ''
  if (!hid) return
  const m = sessions.get(hid)
  if (!m) return
  const s = m.state
  if (!isHostAiP2pPreDataChannelPhase(s.phase)) {
    return
  }
  performHostAiP2pSessionEviction(hid, s, { reason: 'stuck_signaling', age_ms: ageMs })
}

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

function clearOfferStartWatchdog(handshakeId: string, p2pSessionId: string | null | undefined) {
  const sid = typeof p2pSessionId === 'string' ? p2pSessionId.trim() : ''
  if (!sid) return
  const k = sessionOpKey(handshakeId, sid)
  const t = offerStartWatchdogTimers.get(k)
  if (t) {
    clearTimeout(t)
    offerStartWatchdogTimers.delete(k)
  }
}

function scheduleOfferStartWatchdogIfNeeded(handshakeId: string, p2pSessionId: string) {
  const hid = handshakeId.trim()
  const sid = p2pSessionId.trim()
  if (!hid || !sid) return
  if (!getP2pInferenceFlags().p2pInferenceWebrtcEnabled) {
    return
  }
  const m0 = sessions.get(hid)
  if (m0?.state.p2pWebrtcLocalRole === 'answerer') {
    return
  }
  const k = sessionOpKey(hid, sid)
  clearOfferStartWatchdog(hid, sid)
  const t = setTimeout(() => {
    offerStartWatchdogTimers.delete(k)
    const m = sessions.get(hid)
    if (!m || m.state.sessionId !== sid) return
    if (m.state.phase !== P2pSessionPhase.signaling) return
    if (m.state.observedCreateOfferBegin || offerSentForSession.has(k)) {
      return
    }
    if (m.state.p2pWebrtcLocalRole === 'answerer') {
      return
    }
    const tFail = now()
    tearDownP2pTransportAndRelayForHandshake(hid, sid)
    setSession(hid, {
      ...m.state,
      phase: P2pSessionPhase.failed,
      updatedAt: tFail,
      lastErrorCode: InternalInferenceErrorCode.OFFER_START_NOT_OBSERVED,
    })
    console.log(
      `[HOST_AI_SESSION_FAIL] handshake=${hid} session=${redactIdForLog(sid)} code=OFFER_START_NOT_OBSERVED phase=signaling`,
    )
  }, HOST_AI_OFFER_START_WATCHDOG_MS)
  offerStartWatchdogTimers.set(k, t)
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
  for (const [k, timer] of [...offerStartWatchdogTimers.entries()]) {
    if (k.startsWith(prefix)) {
      clearTimeout(timer)
      offerStartWatchdogTimers.delete(k)
    }
  }
  for (const k of [...offerSentForSession]) {
    if (k.startsWith(prefix)) {
      offerSentForSession.delete(k)
    }
  }
}

/** Clears relay ICE/429 soft state for a handshake (see `p2pSignalRelayPost`). */
function discardRelayOutboundSoftStateForHandshake(handshakeId: string): void {
  const h = typeof handshakeId === 'string' ? handshakeId.trim() : ''
  if (!h) return
  void import('../p2pSignalRelayPost')
    .then((m) => m.discardP2pRelayOutboundSoftStateForHandshake(h))
    .catch(() => {})
}

/** Pod close + signaling timers + relay soft state (not ledger row). */
function tearDownP2pTransportAndRelayForHandshake(
  handshakeId: string,
  sessionId: string | null | undefined,
): void {
  disposeWebrtcPodSession(handshakeId, sessionId)
  clearHostAiSignalingGatesForHandshake(handshakeId)
  discardRelayOutboundSoftStateForHandshake(handshakeId)
}

/**
 * Mark that the WebRTC transport produced a local SDP offer (or equivalent), so
 * `OFFER_CREATE_TIMEOUT` does not fire. Invoked from `p2pSignalOutbound` only.
 */
export function markP2pOfferSentForSession(handshakeId: string, p2pSessionId: string): void {
  const k = sessionOpKey(handshakeId, p2pSessionId)
  offerSentForSession.add(k)
  clearSignalingOfferDeadline(handshakeId, p2pSessionId)
  clearOfferStartWatchdog(handshakeId, p2pSessionId)
}

/** Transport page: RTCPeerConnection is about to be created (main-side correlation). */
export function markP2pPeerConnectionCreateBegin(handshakeId: string, p2pSessionId: string): void {
  const hid = typeof handshakeId === 'string' ? handshakeId.trim() : ''
  const sid = typeof p2pSessionId === 'string' ? p2pSessionId.trim() : ''
  if (!hid || !sid) return
  const m = sessions.get(hid)
  if (!m || m.state.sessionId !== sid) return
  setSession(hid, { ...m.state, observedPeerConnectionCreateBegin: true, updatedAt: now() })
}

/** Transport page: about to run createOffer. */
export function markP2pCreateOfferBegin(handshakeId: string, p2pSessionId: string): void {
  const hid = typeof handshakeId === 'string' ? handshakeId.trim() : ''
  const sid = typeof p2pSessionId === 'string' ? p2pSessionId.trim() : ''
  if (!hid || !sid) return
  const m = sessions.get(hid)
  if (!m || m.state.sessionId !== sid) return
  setSession(hid, { ...m.state, observedCreateOfferBegin: true, updatedAt: now() })
  clearOfferStartWatchdog(hid, sid)
}

function scheduleOfferOutboundDeadlineIfNeeded(handshakeId: string, p2pSessionId: string) {
  const hid = handshakeId.trim()
  const sid = p2pSessionId.trim()
  if (!hid || !sid) return
  const m0 = sessions.get(hid)
  if (m0?.state.p2pWebrtcLocalRole === 'answerer') {
    return
  }
  const k = sessionOpKey(hid, sid)
  clearSignalingOfferDeadline(hid, sid)
  const t = setTimeout(() => {
    signalingOfferDeadlineTimers.delete(k)
    const m = sessions.get(hid)
    if (!m || m.state.sessionId !== sid) return
    if (m.state.phase !== P2pSessionPhase.signaling) return
    if (offerSentForSession.has(k)) return
    tearDownP2pTransportAndRelayForHandshake(hid, sid)
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

/** Event-driven waiters: DataChannel open (from transport pod) or terminal ICE / session failure. */
export type P2pCapabilityDcWaitEvent =
  | { kind: 'dc_open' }
  | { kind: 'webrtc_ice_terminal'; ice: string; conn: string }
  | { kind: 'session_terminal'; lastErrorCode: InternalInferenceErrorCodeType | null }

const capabilityDcWaitListeners = new Map<string, Set<(e: P2pCapabilityDcWaitEvent) => void>>()

function emitP2pCapabilityDcWait(handshakeId: string, e: P2pCapabilityDcWaitEvent): void {
  const hid = handshakeId.trim()
  const set = capabilityDcWaitListeners.get(hid)
  if (!set) return
  for (const fn of [...set]) {
    try {
      fn(e)
    } catch {
      /* no-op */
    }
  }
}

/**
 * Subscribe to transport/session events used by `waitForP2pDataChannelOpenOrTerminal` (p2pSessionWait).
 * @returns Unsubscribe
 */
export function subscribeP2pCapabilityDcWait(
  handshakeId: string,
  listener: (e: P2pCapabilityDcWaitEvent) => void,
): () => void {
  const hid = handshakeId.trim()
  if (!hid) {
    return () => {}
  }
  let set = capabilityDcWaitListeners.get(hid)
  if (!set) {
    set = new Set()
    capabilityDcWaitListeners.set(hid, set)
  }
  set.add(listener)
  return () => {
    set!.delete(listener)
    if (set!.size === 0) {
      capabilityDcWaitListeners.delete(hid)
    }
  }
}

/**
 * From the WebRTC pod: `RTCPeerConnection` ICE or connection state reached `failed`.
 */
export function notifyWebrtcTransportTerminalIceOrConnectionFailed(
  handshakeId: string,
  p2pSessionId: string,
  ice: string,
  conn: string,
): void {
  const hid = handshakeId.trim()
  const sid = p2pSessionId.trim()
  if (!hid || !sid) return
  if (ice !== 'failed' && conn !== 'failed') return
  const m = sessions.get(hid)
  if (!m || m.state.sessionId !== sid) return
  emitP2pCapabilityDcWait(hid, { kind: 'webrtc_ice_terminal', ice, conn })
}

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
  if (base.lastErrorCode === InternalInferenceErrorCode.RELAY_429_CIRCUIT_OPEN) {
    return { ...base, p2pUiPhase: P2pSessionUiPhase.relay_reconnecting }
  }
  if (base.lastErrorCode === InternalInferenceErrorCode.HOST_AI_SESSION_TERMINAL_STORM) {
    return { ...base, p2pUiPhase: P2pSessionUiPhase.relay_reconnecting }
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
  const prev = sessions.get(hid)?.state
  const derived = withDerivedUi({ ...next, updatedAt: now() })
  sessions.set(hid, { state: derived })
  emitSessionState(derived)
  if (derived.phase === P2pSessionPhase.datachannel_open || derived.phase === P2pSessionPhase.ready) {
    clearHandshakeTerminalFailureStreak(hid)
  }
  if (derived.phase === P2pSessionPhase.failed && prev?.phase !== P2pSessionPhase.failed) {
    recordHandshakeTerminalFailureForStorm(hid)
    emitP2pCapabilityDcWait(hid, { kind: 'session_terminal', lastErrorCode: derived.lastErrorCode })
  }
}

/**
 * When signaling is on and auth passed: reserved for correlation hooks.
 * Actual POST /beap/p2p-signal runs from `p2pSignalOutbound` when SDP/ICE is ready.
 */
function scheduleP2pSignalingRelayOut(_: { sessionId: string; handshakeId: string; reason: string }): void {
  void _
}

/**
 * Terminal failure for outbound coordination signaling (HTTP 4xx/5xx except 202, or network).
 * Applies failed phase + cooldown so list/probes do not reuse a stuck session forever.
 */
export function failHostAiP2pSessionForTerminalSignalingError(
  handshakeId: string,
  code: InternalInferenceErrorCodeType,
): void {
  const hid = typeof handshakeId === 'string' ? handshakeId.trim() : ''
  if (!hid) return
  const m = sessions.get(hid)
  if (!m) return
  const sid = m.state.sessionId
  tearDownP2pTransportAndRelayForHandshake(hid, sid)
  const tFail = now()
  setSession(hid, {
    ...m.state,
    sessionId: sid,
    phase: P2pSessionPhase.failed,
    updatedAt: tFail,
    lastErrorCode: code,
  })
  console.log(
    `[HOST_AI_SESSION_FAIL] handshake=${hid} session=${sid ? redactIdForLog(sid) : 'null'} code=${code} phase=signaling_transport`,
  )
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
    if (!resolveHostAiRemoteInferencePolicyBestEffort().allowRemoteInference) {
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

function syntheticRelayCircuitCooldownState(handshakeId: string): P2pSessionState {
  const hid = handshakeId.trim()
  const t = now()
  const st: P2pSessionState = {
    handshakeId: hid,
    sessionId: null,
    phase: P2pSessionPhase.idle,
    p2pUiPhase: P2pSessionUiPhase.relay_reconnecting,
    lastErrorCode: InternalInferenceErrorCode.RELAY_429_CIRCUIT_OPEN,
    connectedAt: null,
    updatedAt: t,
    signalingExpiresAt: null,
    boundLocalDeviceId: '',
    boundPeerDeviceId: '',
    ...noOfferMilestones(),
  }
  return withDerivedUi(st)
}

function syntheticSessionStormCooldownState(handshakeId: string): P2pSessionState {
  const hid = handshakeId.trim()
  const t = now()
  const st: P2pSessionState = {
    handshakeId: hid,
    sessionId: null,
    phase: P2pSessionPhase.idle,
    p2pUiPhase: P2pSessionUiPhase.relay_reconnecting,
    lastErrorCode: InternalInferenceErrorCode.HOST_AI_SESSION_TERMINAL_STORM,
    connectedAt: null,
    updatedAt: t,
    signalingExpiresAt: null,
    boundLocalDeviceId: '',
    boundPeerDeviceId: '',
    ...noOfferMilestones(),
  }
  return withDerivedUi(st)
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
  evictStaleHostAiP2pSessionBeforeReuse(hid)
  const m0 = sessions.get(hid)
  if (m0) {
    const s = m0.state
    const tCheck = now()
    if (s.phase === P2pSessionPhase.failed) {
      if (tCheck - s.updatedAt < HOST_AI_FAILED_COOLDOWN_MS) {
        const failSid = s.sessionId ? redactIdForLog(s.sessionId) : 'null'
        console.log(
          `[HOST_AI_SESSION_ENSURE] reuse_failed_cooldown handshake=${hid} session=${failSid} code=${s.lastErrorCode ?? 'unknown'}`,
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
      const fReuse = getP2pInferenceFlags()
      if (needsWebrtcOfferPipelineRepair(s, fReuse.p2pInferenceWebrtcEnabled)) {
        // Invalid passive signaling: must run the awaited offer start path (falls through to ensure).
      } else {
        const sidLog2 = s.sessionId ? redactIdForLog(s.sessionId) : 'null'
        console.log(
          `[HOST_AI_SESSION_ENSURE] reuse_active handshake=${hid} session=${sidLog2} phase=${s.phase} requested_reason=${reason}`,
        )
        return Promise.resolve(withDerivedUi(s))
      }
    }
  }
  const f0 = getP2pInferenceFlags()
  const sessionStormUntilMs = hostAiSessionStormOpenUntilMs(hid)
  if (f0.p2pInferenceEnabled && f0.p2pInferenceSignalingEnabled && sessionStormUntilMs > 0) {
    console.log(
      `[HOST_AI_SESSION_ENSURE] session_storm_pause handshake=${hid} open_until_ms=${sessionStormUntilMs} skip_new_session`,
    )
    return Promise.resolve(syntheticSessionStormCooldownState(hid))
  }
  if (f0.p2pInferenceEnabled && f0.p2pInferenceSignalingEnabled && isP2pRelaySignalingCircuitOpen()) {
    console.log(
      `[HOST_AI_SESSION_ENSURE] relay_429_circuit_open handshake=${hid} open_until_ms=${getP2pRelaySignalingCircuitOpenUntilMs()} skip_new_session`,
    )
    return Promise.resolve(syntheticRelayCircuitCooldownState(hid))
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
      ...noOfferMilestones(),
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
      ...noOfferMilestones(),
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
      ...noOfferMilestones(),
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
      ...noOfferMilestones(),
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
      ...noOfferMilestones(),
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
  evictStaleHostAiP2pSessionBeforeReuse(hid)
  const existing = sessions.get(hid)
  if (existing) {
    const s = existing.state
    if (
      !s.sessionId &&
      s.p2pWebrtcLocalRole === 'answerer' &&
      s.phase === P2pSessionPhase.signaling
    ) {
      console.log(`[HOST_AI_SESSION_ENSURE] reuse_acceptor_wait handshake=${hid} reason=${reason}`)
      return withDerivedUi(s)
    }
    if (s.phase === P2pSessionPhase.failed) {
      if (t - s.updatedAt < HOST_AI_FAILED_COOLDOWN_MS) {
        return withDerivedUi(s)
      }
    } else if (s.sessionId && needsWebrtcOfferPipelineRepair(s, f.p2pInferenceWebrtcEnabled)) {
      const sid0 = s.sessionId
      try {
        await startWebrtcOfferForHostAiSession(hid, sid0, reason)
        const tSig = now()
        const stOk: P2pSessionState = {
          ...s,
          p2pWebrtcLocalRole: s.p2pWebrtcLocalRole ?? 'offerer',
          offerStartRequested: true,
          offerCreateDispatched: true,
          phase: P2pSessionPhase.signaling,
          updatedAt: tSig,
          signalingExpiresAt: tSig + P2P_SIGNALING_WINDOW_MS,
        }
        setSession(hid, stOk)
        scheduleP2pSignalingRelayOut({ sessionId: sid0, handshakeId: hid, reason: 'ensure_offer_repair' })
        scheduleOfferOutboundDeadlineIfNeeded(hid, sid0)
        scheduleOfferStartWatchdogIfNeeded(hid, sid0)
        return withDerivedUi(stOk)
      } catch (e) {
        const errCode: InternalInferenceErrorCodeType =
          e instanceof HostAiWebrtcStartError
            ? e.errorCode
            : InternalInferenceErrorCode.WEBRTC_TRANSPORT_NOT_READY
        const tFail = now()
        tearDownP2pTransportAndRelayForHandshake(hid, sid0)
        setSession(hid, {
          ...s,
          phase: P2pSessionPhase.failed,
          updatedAt: tFail,
          lastErrorCode: errCode,
        })
        logFailed(hid, sid0, P2pSessionLogReason.unknown, reason)
        return withDerivedUi(sessions.get(hid)!.state)
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
  const isInitiatorForAlloc = isInternalHandshakeInitiatorDevice(ar.record, localId)
  if (!isInitiatorForAlloc && f.p2pInferenceWebrtcEnabled) {
    const t0 = now()
    const localBoundW = localCoordinationDeviceId(ar.record)?.trim() ?? ''
    const peerBoundW = peerCoordinationDeviceId(ar.record)?.trim() ?? ''
    const stWait: P2pSessionState = {
      handshakeId: hid,
      sessionId: null,
      phase: P2pSessionPhase.signaling,
      p2pUiPhase: P2pSessionUiPhase.connecting,
      lastErrorCode: null,
      connectedAt: null,
      updatedAt: t0,
      signalingExpiresAt: t0 + P2P_SIGNALING_WINDOW_MS,
      boundLocalDeviceId: localBoundW,
      boundPeerDeviceId: peerBoundW,
      ...noOfferMilestones(),
      p2pWebrtcLocalRole: 'answerer',
    }
    setSession(hid, stWait)
    console.log(`[HOST_AI_SESSION_ENSURE] acceptor_wait_inbound handshake=${hid} reason=${reason}`)
    return withDerivedUi(stWait)
  }
  {
    const ev0 = sessions.get(hid)
    tearDownP2pTransportAndRelayForHandshake(hid, ev0?.state.sessionId ?? null)
  }
  const sessionId = randomUUID()
  const localBound = localCoordinationDeviceId(ar.record)?.trim() ?? ''
  const peerBound = peerCoordinationDeviceId(ar.record)?.trim() ?? ''
  const webrtc = f.p2pInferenceWebrtcEnabled
  const p2pWebrtcLocalRole: 'offerer' | 'answerer' = isInitiatorForAlloc ? 'offerer' : 'answerer'
  const tBase = now()
  const stBase: P2pSessionState = {
    handshakeId: hid,
    sessionId,
    phase: webrtc && p2pWebrtcLocalRole === 'offerer' ? P2pSessionPhase.starting : P2pSessionPhase.signaling,
    p2pUiPhase: P2pSessionUiPhase.connecting,
    lastErrorCode: null,
    connectedAt: null,
    updatedAt: tBase,
    signalingExpiresAt: tBase + P2P_SIGNALING_WINDOW_MS,
    boundLocalDeviceId: localBound,
    boundPeerDeviceId: peerBound,
    ...noOfferMilestones(),
    p2pWebrtcLocalRole,
  }
  setSession(hid, stBase)
  console.log(`[HOST_AI_SESSION_ENSURE] begin handshake=${hid} session=${redactIdForLog(sessionId)} reason=${reason}`)
  logConnecting(hid, sessionId)
  if (webrtc && p2pWebrtcLocalRole === 'offerer') {
    try {
      await startWebrtcOfferForHostAiSession(hid, sessionId, reason)
    } catch (e) {
      const errCode: InternalInferenceErrorCodeType =
        e instanceof HostAiWebrtcStartError
          ? e.errorCode
          : InternalInferenceErrorCode.WEBRTC_TRANSPORT_NOT_READY
      const tFail = now()
      tearDownP2pTransportAndRelayForHandshake(hid, sessionId)
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
    offerStartRequested: webrtc && p2pWebrtcLocalRole === 'offerer',
    offerCreateDispatched: webrtc && p2pWebrtcLocalRole === 'offerer',
    phase: P2pSessionPhase.signaling,
    updatedAt: tSig,
    signalingExpiresAt: tSig + P2P_SIGNALING_WINDOW_MS,
  }
  setSession(hid, st)
  scheduleP2pSignalingRelayOut({ sessionId, handshakeId: hid, reason: `ensure_${reason}` })
  if (webrtc && p2pWebrtcLocalRole === 'offerer') {
    scheduleOfferOutboundDeadlineIfNeeded(hid, sessionId)
    scheduleOfferStartWatchdogIfNeeded(hid, sessionId)
  }
  return withDerivedUi(st)
}

/**
 * Inbound relay frame (e.g. first offer) on acceptor: attach session and create answerer PC before
 * `preflightP2pRelaySignal` + WebRTC apply.
 */
export async function tryAttachP2pSessionForInboundSignaling(
  raw: Record<string, unknown>,
): Promise<'attached' | 'answerer_ready' | 'skipped'> {
  const f = getP2pInferenceFlags()
  if (!f.p2pInferenceEnabled || !f.p2pInferenceSignalingEnabled || !f.p2pInferenceWebrtcEnabled) {
    return 'skipped'
  }
  const stype = raw.signal_type
  const hid = typeof raw.handshake_id === 'string' ? raw.handshake_id.trim() : ''
  const sid = typeof raw.session_id === 'string' ? raw.session_id.trim() : ''
  if (!hid || !sid) return 'skipped'
  if (stype !== 'p2p_inference_offer' && stype !== 'p2p_inference_answer' && stype !== 'p2p_inference_ice') {
    return 'skipped'
  }
  const db = await getHandshakeDbForInternalInference()
  if (!db) return 'skipped'
  const record = getHandshakeRecord(db, hid)
  const ar = assertRecordForServiceRpc(record)
  if (!ar.ok) return 'skipped'
  const localId = String(getInstanceId() ?? '').trim()
  const isInitiator = isInternalHandshakeInitiatorDevice(ar.record, localId)
  const existing = sessions.get(hid)
  if (existing?.state.sessionId === sid) {
    if (existing.state.p2pWebrtcLocalRole === 'answerer') {
      await ensureAnswererWebrtcTransportIfNeeded(hid, sid)
      return 'answerer_ready'
    }
    if (existing.state.p2pWebrtcLocalRole === 'offerer' && stype === 'p2p_inference_answer') {
      return 'skipped'
    }
    if (existing.state.p2pWebrtcLocalRole === 'offerer' && stype === 'p2p_inference_ice') {
      return 'skipped'
    }
    return 'skipped'
  }
  if (stype === 'p2p_inference_answer' || stype === 'p2p_inference_ice') {
    return 'skipped'
  }
  if (isInitiator) {
    return 'skipped'
  }
  if (existing?.state.sessionId && existing.state.sessionId !== sid) {
    tearDownP2pTransportAndRelayForHandshake(hid, existing.state.sessionId)
  }
  const localBound = localCoordinationDeviceId(ar.record)?.trim() ?? ''
  const peerBound = peerCoordinationDeviceId(ar.record)?.trim() ?? ''
  const t0 = now()
  const stNew: P2pSessionState = {
    handshakeId: hid,
    sessionId: sid,
    phase: P2pSessionPhase.signaling,
    p2pUiPhase: P2pSessionUiPhase.connecting,
    lastErrorCode: null,
    connectedAt: null,
    updatedAt: t0,
    signalingExpiresAt: t0 + P2P_SIGNALING_WINDOW_MS,
    boundLocalDeviceId: localBound,
    boundPeerDeviceId: peerBound,
    ...noOfferMilestones(),
    p2pWebrtcLocalRole: 'answerer',
  }
  setSession(hid, stNew)
  try {
    await startWebrtcAnswererForHostAiSession(hid, sid, 'inbound_p2p_offer')
    const t1 = now()
    setSession(hid, {
      ...sessions.get(hid)!.state,
      offerStartRequested: true,
      offerCreateDispatched: true,
      updatedAt: t1,
    })
  } catch (e) {
    const errCode: InternalInferenceErrorCodeType =
      e instanceof HostAiWebrtcStartError ? e.errorCode : InternalInferenceErrorCode.WEBRTC_TRANSPORT_NOT_READY
    tearDownP2pTransportAndRelayForHandshake(hid, sid)
    setSession(hid, {
      ...stNew,
      phase: P2pSessionPhase.failed,
      updatedAt: now(),
      lastErrorCode: errCode,
    })
    logFailed(hid, sid, P2pSessionLogReason.unknown, 'inbound_attach')
    return 'skipped'
  }
  return 'attached'
}

async function ensureAnswererWebrtcTransportIfNeeded(hid: string, sessionId: string): Promise<void> {
  const m = sessions.get(hid)
  if (!m || m.state.sessionId !== sessionId) return
  if (m.state.p2pWebrtcLocalRole !== 'answerer') return
  if (m.state.offerCreateDispatched) return
  try {
    await startWebrtcAnswererForHostAiSession(hid, sessionId, 'inbound_p2p_signal')
  } catch (e) {
    const errCode: InternalInferenceErrorCodeType =
      e instanceof HostAiWebrtcStartError ? e.errorCode : InternalInferenceErrorCode.WEBRTC_TRANSPORT_NOT_READY
    tearDownP2pTransportAndRelayForHandshake(hid, sessionId)
    setSession(hid, {
      ...m.state,
      phase: P2pSessionPhase.failed,
      updatedAt: now(),
      lastErrorCode: errCode,
    })
    logFailed(hid, sessionId, P2pSessionLogReason.unknown, 'answerer_warmup')
    return
  }
  setSession(hid, {
    ...m.state,
    offerStartRequested: true,
    offerCreateDispatched: true,
    updatedAt: now(),
  })
}

/** Sandbox vs host (ledger) for inbound logs; async due to DB. */
export async function getP2pInboundLocalRoleForLog(handshakeId: string): Promise<string> {
  const hid = typeof handshakeId === 'string' ? handshakeId.trim() : ''
  if (!hid) return 'unknown'
  const db = await getHandshakeDbForInternalInference()
  if (!db) return 'unknown'
  const record = getHandshakeRecord(db, hid)
  const ar = assertRecordForServiceRpc(record)
  if (!ar.ok) return 'unknown'
  const dr = deriveInternalHostAiPeerRoles(ar.record, String(getInstanceId() ?? '').trim())
  return dr.ok ? dr.localRole : 'unknown'
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
    tearDownP2pTransportAndRelayForHandshake(hid, st.sessionId)
    setSession(hid, { ...st, phase: P2pSessionPhase.failed, updatedAt: t, lastErrorCode: InternalInferenceErrorCode.INTERNAL_INFERENCE_FAILED })
    return
  }
  if (st.phase === P2pSessionPhase.starting || st.phase === P2pSessionPhase.signaling) {
    clearSignalingOfferDeadline(hid, st.sessionId)
    clearOfferStartWatchdog(hid, st.sessionId)
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
  clearOfferStartWatchdog(hid, sid)
  const t = now()
  const st = m.state
  if (st.phase === P2pSessionPhase.failed) {
    console.log(
      `[P2P_DC_OPEN_PHASE_RESET] handshake=${hid} session=${redactIdForLog(sid)} from=failed to=datachannel_open`,
    )
  }
  setSession(hid, {
    ...st,
    phase: P2pSessionPhase.datachannel_open,
    connectedAt: t,
    updatedAt: t,
    lastErrorCode: st.phase === P2pSessionPhase.failed ? null : st.lastErrorCode,
  })
  console.log(`[P2P_DC_OPEN] handshake=${hid} session=${redactIdForLog(sid)}`)
  emitP2pCapabilityDcWait(hid, { kind: 'dc_open' })
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
  tearDownP2pTransportAndRelayForHandshake(hid, sessionId)
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
    ...noOfferMilestones(),
  })
  emitSessionState(final)
  logClosed(hid, sessionId, reason)
}

export function closeAllP2pInferenceSessions(reason: P2pSessionLogReasonType): void {
  for (const hid of [...sessions.keys()]) {
    closeSession(hid, reason)
  }
}

/** Handshake IDs with an active WebRTC data channel (host proactive caps push). */
export function listHandshakeIdsWithOpenP2pDataChannel(): string[] {
  const out: string[] = []
  for (const [hid, m] of sessions) {
    const s = m.state
    if (s.sessionId && s.phase === P2pSessionPhase.datachannel_open) {
      out.push(hid)
    }
  }
  return out
}

/** @internal Seed an in-memory session row for Vitest (no ledger write). */
export function _seedHostAiP2pSessionForTests(state: P2pSessionState): void {
  const hid = typeof state.handshakeId === 'string' ? state.handshakeId.trim() : ''
  if (!hid) return
  const derived = withDerivedUi({ ...state, handshakeId: hid })
  sessions.set(hid, { state: derived })
}

/** @internal */
export function _resetP2pInferenceSessionsForTests(): void {
  for (const timer of signalingOfferDeadlineTimers.values()) {
    clearTimeout(timer)
  }
  signalingOfferDeadlineTimers.clear()
  for (const timer of offerStartWatchdogTimers.values()) {
    clearTimeout(timer)
  }
  offerStartWatchdogTimers.clear()
  offerSentForSession.clear()
  sessions.clear()
  ensureSessionInFlight.clear()
  capabilityDcWaitListeners.clear()
  resetP2pRelaySignalingCircuitForTests()
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
