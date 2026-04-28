/**
 * Host AI capability exchange over a WebRTC DataChannel (Phase 6).
 * Wire: inference_capabilities_{request,result} + inference_error (JSON UTF-8; main validates, no Ollama in transport page).
 */
import { randomUUID } from 'crypto'
import { getLedgerDb } from '../../handshake/ledger'
import { getHandshakeRecord } from '../../handshake/db'
import { getInstanceId } from '../../orchestrator/orchestratorModeStore'
import { getHandshakeDbForInternalInference } from '../dbAccess'
import {
  buildInternalInferenceCapabilitiesResult,
  type HostInferenceCapabilitiesBuildMeta,
} from '../hostInferenceCapabilities'
import { getSessionState } from '../p2pSession/p2pInferenceSessionManager'
import { InternalInferenceErrorCode } from '../errors'
import { logOllamaDirectCapsSnapshot, HOST_AI_OLLAMA_PROVIDER, HOST_AI_ROUTE_KIND_OLLAMA_DIRECT } from '../hostAiOllamaDirect'
import { logHostAiPairingRoleGate } from '../hostAiPairingRoleGateLog'
import {
  assertRecordForServiceRpc,
  coordinationDeviceIdForHandshakeDeviceRole,
  deriveInternalHostAiPeerRoles,
  hostAiHostToSandboxAsHost,
  hostAiSandboxToHostRequestDeviceIds,
} from '../policy'
import type { InternalInferenceCapabilitiesResultWire } from '../types'
import { tryRouteP2pInferenceDataChannelMessage } from './p2pDcInference'
import { evaluateSandboxHostAiOllamaDirectFromCapabilitiesWire } from '../sandboxHostAiOllamaDirectCandidate'
import { invalidateSandboxOllamaDirectTagsCacheForHandshake } from '../sandboxHostAiOllamaDirectTags'

export type HostInferenceCapabilitiesDcOutcome =
  | { ok: true; wire: InternalInferenceCapabilitiesResultWire }
  | { ok: false; reason: string; code?: string }

type CapResolve = (r: HostInferenceCapabilitiesDcOutcome) => void

type PendingCap = {
  resolve: CapResolve
  timeoutId: ReturnType<typeof setTimeout>
  handshakeId: string
  p2pSessionId: string
}

const pending = new Map<string, PendingCap>()

export type SbxAiCapsPurpose = 'capabilities_dc'

/** Sandbox requester key: handshake + peer Host coordination id + logical purpose (not WebRTC session id). */
export function sbxAiCapsCacheKey(
  handshakeId: string,
  peerHostDeviceId: string,
  purpose: SbxAiCapsPurpose = 'capabilities_dc',
): string {
  return `${handshakeId.trim()}:${peerHostDeviceId.trim()}:${purpose}`
}

export type SbxAiCapsResponseClassification =
  | 'available'
  | 'no_models'
  | 'policy_disabled'
  | 'transport_failed'
  | 'invalid_response'

/** Terminal capability outcomes keyed by {@link sbxAiCapsCacheKey}; avoids hammering Host when models=[] etc. */
const sbxAiCapsTerminalCache = new Map<string, { outcome: HostInferenceCapabilitiesDcOutcome; expiresAt: number }>()

/** Single-flight join map keyed like {@link sbxAiCapsTerminalCache}. */
const sbxAiCapsInflightByCacheKey = new Map<string, Promise<HostInferenceCapabilitiesDcOutcome>>()

function getSbxAiCapsTerminalCache(cacheKey: string): HostInferenceCapabilitiesDcOutcome | null {
  const e = sbxAiCapsTerminalCache.get(cacheKey)
  if (!e || Date.now() >= e.expiresAt) {
    if (e) sbxAiCapsTerminalCache.delete(cacheKey)
    return null
  }
  return deepCloneDcOutcome(e.outcome)
}

function setSbxAiCapsTerminalCache(cacheKey: string, outcome: HostInferenceCapabilitiesDcOutcome, ttlMs: number): void {
  if (ttlMs <= 0) return
  sbxAiCapsTerminalCache.set(cacheKey, { outcome: deepCloneDcOutcome(outcome), expiresAt: Date.now() + ttlMs })
}

function deepCloneDcOutcome(o: HostInferenceCapabilitiesDcOutcome): HostInferenceCapabilitiesDcOutcome {
  return JSON.parse(JSON.stringify(o)) as HostInferenceCapabilitiesDcOutcome
}

function cloneDcOutcomeFreshRequestId(
  out: HostInferenceCapabilitiesDcOutcome,
  requestIdOpt?: string,
): HostInferenceCapabilitiesDcOutcome {
  if (!out.ok) return { ...out }
  const rid = requestIdOpt?.trim() ? requestIdOpt.trim() : randomUUID()
  return { ok: true, wire: { ...out.wire, request_id: rid } }
}

function classifySbxAiCapsOutcome(out: HostInferenceCapabilitiesDcOutcome): SbxAiCapsResponseClassification {
  if (!out.ok) {
    const r = out.reason
    if (
      r === 'timeout' ||
      r === 'parse' ||
      r === 'handshake_mismatch' ||
      r === 'session_mismatch' ||
      r === 'missing_coordination_ids' ||
      r === 'handshake' ||
      r === 'no_db'
    ) {
      return 'transport_failed'
    }
    return 'invalid_response'
  }
  const w = out.wire
  if (w.policy_enabled === false) return 'policy_disabled'
  const mc = Array.isArray(w.models) ? w.models.length : 0
  if (mc > 0) return 'available'
  return 'no_models'
}

function ttlMsForSbxAiCapsOutcome(out: HostInferenceCapabilitiesDcOutcome): number {
  if (!out.ok) {
    const r = out.reason
    if (
      r === 'timeout' ||
      r === 'parse' ||
      r === 'handshake_mismatch' ||
      r === 'session_mismatch' ||
      r === 'missing_coordination_ids' ||
      r === 'handshake' ||
      r === 'no_db'
    ) {
      return 0
    }
    const code = out.code
    if (
      code === InternalInferenceErrorCode.HOST_AI_CAPABILITY_ROLE_REJECTED ||
      code === InternalInferenceErrorCode.POLICY_FORBIDDEN
    ) {
      return 20_000
    }
    if (r === 'inference_error') {
      return 10_000
    }
    return 0
  }
  const w = out.wire
  if (w.policy_enabled === false) return 20_000
  const mc = Array.isArray(w.models) ? w.models.length : 0
  if (mc > 0) return 30_000
  return 5_000
}

/** Clears TTL terminal caches when handshake rows / transport change (caller: invalidateProbeCache). */
export function invalidateSbxAiCapsTerminalCache(handshakeId?: string): void {
  if (!handshakeId?.trim()) {
    sbxAiCapsTerminalCache.clear()
    sbxAiCapsInflightByCacheKey.clear()
    return
  }
  const prefix = `${handshakeId.trim()}:`
  for (const k of [...sbxAiCapsTerminalCache.keys()]) {
    if (k.startsWith(prefix)) sbxAiCapsTerminalCache.delete(k)
  }
  for (const k of [...sbxAiCapsInflightByCacheKey.keys()]) {
    if (k.startsWith(prefix)) sbxAiCapsInflightByCacheKey.delete(k)
  }
}

const CAPS_TYPE_RESULT = 'inference_capabilities_result'
const CAPS_TYPE_ERR = 'inference_error'
const CAPS_TYPE_REQ = 'inference_capabilities_request'

/** Host: same Sandbox sender + handshake → one concurrent provider enumeration / wire build (duplicate DC frames join). */
function hostCapsHandshakeSenderKey(handshakeId: string, sandboxSenderDeviceId: string): string {
  return `${handshakeId.trim()}:${sandboxSenderDeviceId.trim()}`
}

const HOST_CAPS_CACHE_SUCCESS_MS = 25_000
const HOST_CAPS_CACHE_FAILURE_MS = 2_000

type HostCapsBuiltPack = { wire: InternalInferenceCapabilitiesResultWire; meta: HostInferenceCapabilitiesBuildMeta }

/** Host-side TTL cache for identical builds (models/error bodies); request_id merged per inbound frame. */
const hostCapsBuiltCacheByHsSender = new Map<string, { pack: HostCapsBuiltPack; expiresAt: number }>()

const inflightHostCapsBuildByHandshakeSender = new Map<string, Promise<HostCapsBuiltPack>>()

async function sendCapsDcError(
  p2pSessionId: string,
  handshakeId: string,
  p: { requestId: string; code: string; message: string },
): Promise<void> {
  const err = {
    schema_version: 1,
    type: CAPS_TYPE_ERR,
    request_id: p.requestId,
    handshake_id: handshakeId.trim(),
    session_id: p2pSessionId.trim(),
    code: p.code,
    message: p.message,
  }
  const body = JSON.stringify(err)
  const bytes = new TextEncoder().encode(body).length
  console.log(
    `[HOST_AI_CAPS_RESPONSE_SEND] ${JSON.stringify({
      handshake_id: handshakeId.trim(),
      session_id: p2pSessionId.trim(),
      correlation_id: p.requestId,
      request_type: CAPS_TYPE_ERR,
      ok: false,
      models_count: null,
      provider_ok: null,
      error_code: p.code,
      bytes,
      dc_phase: getSessionState(handshakeId.trim())?.phase ?? null,
    })}`,
  )
  const te = new TextEncoder().encode(body)
  const { webrtcSendData } = await import('../webrtc/webrtcTransportIpc')
  void webrtcSendData(p2pSessionId, handshakeId.trim(), te.buffer)
}

export function clearPendingP2pCapabilitiesForTests(): void {
  for (const [, v] of pending) {
    clearTimeout(v.timeoutId)
  }
  pending.clear()
  sbxAiCapsInflightByCacheKey.clear()
  sbxAiCapsTerminalCache.clear()
  inflightHostCapsBuildByHandshakeSender.clear()
  hostCapsBuiltCacheByHsSender.clear()
}

/** Drop host caps build cache for a handshake (all sandbox senders) before rebuilding for proactive push. */
export function invalidateHostCapsBuiltCacheForHandshake(handshakeId: string): void {
  const p = `${handshakeId.trim()}:`
  if (!p || p === ':') return
  for (const k of [...hostCapsBuiltCacheByHsSender.keys()]) {
    if (k.startsWith(p)) hostCapsBuiltCacheByHsSender.delete(k)
  }
}

function ollamaDirectWireFieldsFromDcPayload(
  o: Record<string, unknown>,
): Partial<
  Pick<
    InternalInferenceCapabilitiesResultWire,
    | 'ollama_direct_available'
    | 'ollama_direct_base_url'
    | 'ollama_direct_host_ip'
    | 'ollama_direct_models_count'
    | 'ollama_direct_source'
    | 'endpoint_owner_device_id'
  >
> {
  const extra: Partial<
    Pick<
      InternalInferenceCapabilitiesResultWire,
      | 'ollama_direct_available'
      | 'ollama_direct_base_url'
      | 'ollama_direct_host_ip'
      | 'ollama_direct_models_count'
      | 'ollama_direct_source'
      | 'endpoint_owner_device_id'
    >
  > = {}
  if (typeof o.ollama_direct_available === 'boolean') extra.ollama_direct_available = o.ollama_direct_available
  if (typeof o.ollama_direct_base_url === 'string') extra.ollama_direct_base_url = o.ollama_direct_base_url
  else if (o.ollama_direct_base_url === null) extra.ollama_direct_base_url = undefined
  if (typeof o.ollama_direct_host_ip === 'string') extra.ollama_direct_host_ip = o.ollama_direct_host_ip
  else if (o.ollama_direct_host_ip === null) extra.ollama_direct_host_ip = undefined
  if (typeof o.ollama_direct_models_count === 'number' && Number.isFinite(o.ollama_direct_models_count)) {
    extra.ollama_direct_models_count = o.ollama_direct_models_count
  }
  if (typeof o.ollama_direct_source === 'string') extra.ollama_direct_source = o.ollama_direct_source
  if (typeof o.endpoint_owner_device_id === 'string') extra.endpoint_owner_device_id = o.endpoint_owner_device_id
  else if (o.endpoint_owner_device_id === null) extra.endpoint_owner_device_id = undefined
  return extra
}

function mapDcToInternalWire(o: Record<string, unknown>, hid: string): InternalInferenceCapabilitiesResultWire | null {
  if (o.type !== CAPS_TYPE_RESULT) {
    return null
  }
  const requestId = typeof o.request_id === 'string' ? o.request_id : ''
  if (!requestId) {
    return null
  }
  const policy = o.policy_enabled === true
  const al = o.active_local_llm
  const ep = o.inference_error_code
  const ollamaDirect = ollamaDirectWireFieldsFromDcPayload(o)
  return {
    type: 'internal_inference_capabilities_result',
    schema_version: typeof o.schema_version === 'number' ? o.schema_version : 1,
    request_id: requestId,
    handshake_id: typeof o.handshake_id === 'string' ? o.handshake_id : hid,
    sender_device_id: typeof o.sender_device_id === 'string' ? o.sender_device_id : '',
    target_device_id: typeof o.target_device_id === 'string' ? o.target_device_id : '',
    created_at: typeof o.created_at === 'string' ? o.created_at : new Date().toISOString(),
    transport_policy: 'direct_only',
    host_computer_name: typeof o.host_computer_name === 'string' ? o.host_computer_name : '',
    host_pairing_code: typeof o.host_pairing_code === 'string' ? o.host_pairing_code : '',
    models: Array.isArray(o.models) ? (o.models as InternalInferenceCapabilitiesResultWire['models']) : [],
    policy_enabled: policy,
    active_local_llm: al && typeof al === 'object' && al !== null ? (al as InternalInferenceCapabilitiesResultWire['active_local_llm']) : undefined,
    active_chat_model: typeof o.active_chat_model === 'string' ? o.active_chat_model : undefined,
    inference_error_code: typeof ep === 'string' ? ep : undefined,
    ...ollamaDirect,
  }
}

/**
 * Host: inbound `inference_capabilities_request` on the local pod — respond on the same DC.
 */
export async function handleP2pDcInferenceCapabilitiesAsHost(
  p2pSessionId: string,
  handshakeId: string,
  raw: Record<string, unknown>,
): Promise<void> {
  if (raw.type !== CAPS_TYPE_REQ) {
    return
  }
  const reqRid = typeof raw.request_id === 'string' ? raw.request_id.trim() : ''
  const db = await getHandshakeDbForInternalInference()
  if (!db) {
    return
  }
  const record = getHandshakeRecord(db, handshakeId.trim())
  const ar = assertRecordForServiceRpc(record)
  if (!ar.ok) {
    return
  }
  const r = ar.record
  const me = getInstanceId().trim()
  const dr = deriveInternalHostAiPeerRoles(r, me)
  const snd0 = (typeof raw.sender_device_id === 'string' ? raw.sender_device_id : '').trim()
  const tgt0 = (typeof raw.target_device_id === 'string' ? raw.target_device_id : '').trim()
  if (!dr.ok) {
    logHostAiPairingRoleGate({
      gate: 'caps_rpc',
      handshake_id: handshakeId.trim(),
      request_type: 'internal_inference_capabilities_request',
      current_device_id: me,
      sender_device_id: snd0,
      receiver_device_id: tgt0,
      local_derived_role: 'unknown',
      peer_derived_role: 'unknown',
      requester_role: 'sandbox',
      receiver_role: 'host',
      decision: 'deny',
      reason: dr.reason,
    })
    if (reqRid) {
      void sendCapsDcError(p2pSessionId, handshakeId, {
        requestId: reqRid,
        code: InternalInferenceErrorCode.HOST_AI_CAPABILITY_ROLE_REJECTED,
        message: 'ledger_role_derivation_failed',
      })
    }
    return
  }
  if (dr.localRole !== 'host' || dr.peerRole !== 'sandbox') {
    logHostAiPairingRoleGate({
      gate: 'caps_rpc',
      handshake_id: handshakeId.trim(),
      request_type: 'internal_inference_capabilities_request',
      current_device_id: me,
      sender_device_id: snd0,
      receiver_device_id: tgt0,
      local_derived_role: dr.localRole,
      peer_derived_role: dr.peerRole,
      requester_role: 'sandbox',
      receiver_role: 'host',
      decision: 'deny',
      reason: `receiver_must_be_host_requester_sandbox_got_local_${dr.localRole}_peer_${dr.peerRole}`,
    })
    if (reqRid) {
      void sendCapsDcError(p2pSessionId, handshakeId, {
        requestId: reqRid,
        code: InternalInferenceErrorCode.HOST_AI_CAPABILITY_ROLE_REJECTED,
        message: 'receiver_must_be_ledger_host',
      })
    }
    return
  }
  const s = getSessionState(handshakeId.trim())
  if (!s?.sessionId || s.sessionId !== p2pSessionId) {
    return
  }
  const hx = hostAiHostToSandboxAsHost(r, getInstanceId().trim())
  if (!hx.ok) {
    return
  }
  const localHost = hx.localHost
  const peerSb = hx.peerSandbox
  if (!localHost || !peerSb) {
    return
  }
  const reqSid = typeof raw.sender_device_id === 'string' ? raw.sender_device_id.trim() : ''
  const reqTgt = typeof raw.target_device_id === 'string' ? raw.target_device_id.trim() : ''
  if (reqSid && reqSid !== peerSb) {
    return
  }
  if (reqTgt && reqTgt !== localHost) {
    return
  }
  const requestId = typeof raw.request_id === 'string' ? raw.request_id : ''
  if (!requestId) {
    return
  }
  logHostAiPairingRoleGate({
    gate: 'caps_rpc',
    handshake_id: handshakeId.trim(),
    request_type: 'internal_inference_capabilities_request',
    current_device_id: me,
    sender_device_id: reqSid || dr.localCoordinationDeviceId,
    receiver_device_id: reqTgt || dr.peerCoordinationDeviceId,
    local_derived_role: dr.localRole,
    peer_derived_role: dr.peerRole,
    requester_role: 'sandbox',
    receiver_role: 'host',
    decision: 'allow',
    reason: 'ledger_sandbox_to_host',
  })
  const sessState = getSessionState(handshakeId.trim())
  const dcPhase = sessState?.phase ?? null
  console.log(
    `[HOST_AI_CAPS_BUILD_BEGIN] ${JSON.stringify({
      handshake_id: handshakeId.trim(),
      session_id: p2pSessionId.trim(),
      correlation_id: requestId,
      request_type: CAPS_TYPE_REQ,
      dc_phase: dcPhase,
    })}`,
  )
  const createdAt = typeof raw.created_at === 'string' ? raw.created_at : new Date().toISOString()
  let built: InternalInferenceCapabilitiesResultWire
  let buildMeta: HostInferenceCapabilitiesBuildMeta
  try {
    const hk = hostCapsHandshakeSenderKey(handshakeId, reqSid || peerSb)
    const cached = hostCapsBuiltCacheByHsSender.get(hk)
    let builtPack: HostCapsBuiltPack
    if (cached && Date.now() < cached.expiresAt) {
      builtPack = cached.pack
    } else {
      let inflight = inflightHostCapsBuildByHandshakeSender.get(hk)
      if (!inflight) {
        inflight = buildInternalInferenceCapabilitiesResult(r, {
          request_id: requestId,
          created_at: createdAt,
        }).finally(() => {
          inflightHostCapsBuildByHandshakeSender.delete(hk)
        })
        inflightHostCapsBuildByHandshakeSender.set(hk, inflight)
      }
      builtPack = await inflight
      const mc = Array.isArray(builtPack.wire.models) ? builtPack.wire.models.length : 0
      const ie = builtPack.wire.inference_error_code
      const ieUnset =
        ie === undefined ||
        ie === null ||
        (typeof ie === 'string' && ie.trim().length === 0)
      const badEmptySuccess = builtPack.wire.policy_enabled === true && mc === 0 && ieUnset
      if (!badEmptySuccess) {
        const ttl =
          mc > 0 ? HOST_CAPS_CACHE_SUCCESS_MS : ie !== undefined ? HOST_CAPS_CACHE_FAILURE_MS : 0
        if (ttl > 0) {
          hostCapsBuiltCacheByHsSender.set(hk, { pack: builtPack, expiresAt: Date.now() + ttl })
        }
      }
    }
    built = {
      ...builtPack.wire,
      request_id: requestId,
      created_at: createdAt,
    }
    buildMeta = builtPack.meta
  } catch {
    console.log(
      `[HOST_AI_CAPS_BUILD_DONE] ${JSON.stringify({
        handshake_id: handshakeId.trim(),
        session_id: p2pSessionId.trim(),
        correlation_id: requestId,
        request_type: CAPS_TYPE_REQ,
        ok: false,
        models_count: null,
        provider_ok: null,
        error_code: 'BUILD_THROW',
        dc_phase: dcPhase,
      })}`,
    )
    await sendCapsDcError(p2pSessionId, handshakeId, {
      requestId,
      code: 'INTERNAL',
      message: 'capabilities build failed',
    })
    return
  }
  const modelsCount = Array.isArray(built.models) ? built.models.length : 0
  const ie = built.inference_error_code
  const probeHadModels = buildMeta.probe_http_model_count > 0
  const providerOk =
    ie !== InternalInferenceErrorCode.PROBE_OLLAMA_UNAVAILABLE &&
    !(probeHadModels && modelsCount === 0)
  const okCaps =
    ie !== InternalInferenceErrorCode.MODEL_MAPPING_DROPPED_ALL && !(probeHadModels && modelsCount === 0)
  console.log(
    `[HOST_AI_CAPS_BUILD_DONE] ${JSON.stringify({
      handshake_id: handshakeId.trim(),
      session_id: p2pSessionId.trim(),
      correlation_id: requestId,
      request_type: CAPS_TYPE_REQ,
      ok: okCaps,
      models_count: modelsCount,
      raw_models_count: buildMeta.raw_models_count,
      mapped_models_count: buildMeta.mapped_models_count,
      probe_http_model_count: buildMeta.probe_http_model_count,
      provider_ok: providerOk,
      error_code: ie ?? null,
      dc_phase: dcPhase,
    })}`,
  )
  const capsEpoch = Date.now()
  const odAvail = built.ollama_direct_available === true
  const odSourceRaw =
    typeof built.ollama_direct_source === 'string' && built.ollama_direct_source.trim()
      ? built.ollama_direct_source.trim()
      : 'none'
  const out = {
    type: CAPS_TYPE_RESULT,
    schema_version: 1,
    request_id: built.request_id,
    handshake_id: built.handshake_id,
    session_id: p2pSessionId.trim(),
    policy_enabled: built.policy_enabled,
    active_local_llm: built.active_local_llm,
    caps_epoch: capsEpoch,
    host_computer_name: built.host_computer_name,
    host_pairing_code: built.host_pairing_code,
    models: built.models,
    created_at: built.created_at,
    sender_device_id: built.sender_device_id,
    target_device_id: built.target_device_id,
    active_chat_model: built.active_chat_model,
    inference_error_code: built.inference_error_code,
    ollama_direct_available: odAvail,
    ollama_direct_base_url: built.ollama_direct_base_url ?? null,
    ollama_direct_host_ip: built.ollama_direct_host_ip ?? null,
    ollama_direct_models_count:
      typeof built.ollama_direct_models_count === 'number' && Number.isFinite(built.ollama_direct_models_count)
        ? built.ollama_direct_models_count
        : 0,
    ollama_direct_source: odSourceRaw,
    endpoint_owner_device_id: built.endpoint_owner_device_id ?? null,
  }
  logOllamaDirectCapsSnapshot({
    channel: 'p2p_dc',
    route_kind: HOST_AI_ROUTE_KIND_OLLAMA_DIRECT,
    provider: HOST_AI_OLLAMA_PROVIDER,
    handshake_id: handshakeId.trim(),
    session_id: p2pSessionId.trim(),
    correlation_id: built.request_id,
    current_device_id: getInstanceId().trim(),
    sender_device_id: built.sender_device_id,
    target_device_id: built.target_device_id,
    endpoint_owner_device_id: built.endpoint_owner_device_id ?? null,
    ollama_direct_available: odAvail,
    ollama_direct_base_url: built.ollama_direct_base_url ?? null,
    ollama_direct_host_ip: built.ollama_direct_host_ip ?? null,
    ollama_direct_models_count:
      typeof built.ollama_direct_models_count === 'number' ? built.ollama_direct_models_count : 0,
    ollama_direct_source: odSourceRaw,
    legacy_models_array_length: modelsCount,
    inference_error_code: built.inference_error_code ?? null,
  })
  const body = JSON.stringify(out)
  const bytes = new TextEncoder().encode(body).length
  console.log(
    `[HOST_AI_CAPS_RESPONSE_BODY] ${JSON.stringify({
      response_type: CAPS_TYPE_RESULT,
      session_id: p2pSessionId.trim(),
      correlation_id: built.request_id,
      handshake_id: handshakeId.trim(),
      models_array_length: modelsCount,
      provider_ok: providerOk,
      ok: okCaps,
      schema_keys: Object.keys(out),
      inference_error_code: built.inference_error_code ?? null,
    })}`,
  )
  console.log(
    `[HOST_AI_CAPS_RESPONSE_SEND] ${JSON.stringify({
      handshake_id: handshakeId.trim(),
      session_id: p2pSessionId.trim(),
      correlation_id: built.request_id,
      request_type: CAPS_TYPE_RESULT,
      ok: okCaps,
      models_count: modelsCount,
      provider_ok: providerOk,
      error_code: built.inference_error_code ?? null,
      bytes,
      dc_phase: getSessionState(handshakeId.trim())?.phase ?? dcPhase,
    })}`,
  )
  const te = new TextEncoder().encode(body)
  const { webrtcSendData } = await import('../webrtc/webrtcTransportIpc')
  void webrtcSendData(p2pSessionId, handshakeId.trim(), te.buffer)
}

/**
 * Host: unsolicited `inference_capabilities_result` when `ollama_direct` advertisement changes (timer-driven).
 */
export async function sendProactiveInferenceCapabilitiesDcResult(params: {
  p2pSessionId: string
  handshakeId: string
  wire: InternalInferenceCapabilitiesResultWire
}): Promise<void> {
  const hid = params.handshakeId.trim()
  const sid = params.p2pSessionId.trim()
  const built = params.wire
  const rid = randomUUID()
  const capsEpoch = Date.now()
  const modelsCount = Array.isArray(built.models) ? built.models.length : 0
  const ie = built.inference_error_code
  const providerOk =
    ie !== InternalInferenceErrorCode.PROBE_OLLAMA_UNAVAILABLE &&
    ie !== InternalInferenceErrorCode.MODEL_MAPPING_DROPPED_ALL &&
    !(modelsCount === 0 && ie === InternalInferenceErrorCode.PROBE_INVALID_RESPONSE)
  const okCaps =
    ie !== InternalInferenceErrorCode.MODEL_MAPPING_DROPPED_ALL &&
    !(modelsCount === 0 && ie === InternalInferenceErrorCode.PROBE_INVALID_RESPONSE)
  const odAvail = built.ollama_direct_available === true
  const odSourceRaw =
    typeof built.ollama_direct_source === 'string' && built.ollama_direct_source.trim()
      ? built.ollama_direct_source.trim()
      : 'none'
  const out = {
    type: CAPS_TYPE_RESULT,
    schema_version: 1,
    request_id: rid,
    handshake_id: built.handshake_id,
    session_id: sid,
    policy_enabled: built.policy_enabled,
    active_local_llm: built.active_local_llm,
    caps_epoch: capsEpoch,
    host_computer_name: built.host_computer_name,
    host_pairing_code: built.host_pairing_code,
    models: built.models,
    created_at: built.created_at,
    sender_device_id: built.sender_device_id,
    target_device_id: built.target_device_id,
    active_chat_model: built.active_chat_model,
    inference_error_code: built.inference_error_code,
    ollama_direct_available: odAvail,
    ollama_direct_base_url: built.ollama_direct_base_url ?? null,
    ollama_direct_host_ip: built.ollama_direct_host_ip ?? null,
    ollama_direct_models_count:
      typeof built.ollama_direct_models_count === 'number' && Number.isFinite(built.ollama_direct_models_count)
        ? built.ollama_direct_models_count
        : 0,
    ollama_direct_source: odSourceRaw,
    endpoint_owner_device_id: built.endpoint_owner_device_id ?? null,
  }
  const body = JSON.stringify(out)
  const bytes = new TextEncoder().encode(body).length
  const dcPhase = getSessionState(hid)?.phase ?? null
  console.log(
    `[HOST_AI_CAPS_RESPONSE_SEND] ${JSON.stringify({
      handshake_id: hid,
      session_id: sid,
      correlation_id: rid,
      request_type: CAPS_TYPE_RESULT,
      ok: okCaps,
      models_count: modelsCount,
      provider_ok: providerOk,
      error_code: built.inference_error_code ?? null,
      bytes,
      dc_phase: dcPhase,
      proactive: true,
    })}`,
  )
  const te = new TextEncoder().encode(body)
  const { webrtcSendData } = await import('../webrtc/webrtcTransportIpc')
  await webrtcSendData(sid, hid, te.buffer)
}

/**
 * Sandbox: inbound result / error for a pending capabilities request.
 * @returns true if this message was consumed as a capabilities RPC (including unknown id for result).
 */
export function handleP2pDcInferenceCapabilitiesAsSandbox(
  p2pSessionId: string,
  handshakeId: string,
  raw: Record<string, unknown>,
): boolean {
  const wireType = raw.type === CAPS_TYPE_ERR || raw.type === CAPS_TYPE_RESULT ? String(raw.type) : ''
  if (!wireType) {
    return false
  }

  const ridEarly = typeof raw.request_id === 'string' ? raw.request_id : ''
  const rawHidEarly = typeof raw.handshake_id === 'string' ? raw.handshake_id.trim() : ''
  const rawSidEarly = typeof raw.session_id === 'string' ? raw.session_id.trim() : ''
  const modelsEarly =
    raw.type === CAPS_TYPE_RESULT && Array.isArray((raw as { models?: unknown }).models)
      ? (raw as { models: unknown[] }).models.length
      : null
  console.log(
    `[HOST_AI_CAPS_RESPONSE_RECV] ${JSON.stringify({
      response_type: wireType,
      handshake_id: handshakeId.trim(),
      session_id: p2pSessionId.trim(),
      correlation_id: ridEarly || null,
      payload_handshake_id: rawHidEarly || null,
      payload_session_id: rawSidEarly || null,
      models_count: modelsEarly,
      reject_reason: null,
      dc_phase: getSessionState(handshakeId.trim())?.phase ?? null,
    })}`,
  )

  const dbl = getLedgerDb()
  if (!dbl) {
    console.log(
      `[HOST_AI_CAPS_RESPONSE_REJECT] ${JSON.stringify({
        response_type: wireType,
        handshake_id: handshakeId.trim(),
        session_id: p2pSessionId.trim(),
        correlation_id: ridEarly || null,
        models_count: null,
        reject_reason: 'no_ledger_db',
        dc_phase: getSessionState(handshakeId.trim())?.phase ?? null,
      })}`,
    )
    return false
  }
  const srec = getHandshakeRecord(dbl, handshakeId.trim())
  if (!srec) {
    console.log(
      `[HOST_AI_CAPS_RESPONSE_REJECT] ${JSON.stringify({
        response_type: wireType,
        handshake_id: handshakeId.trim(),
        session_id: p2pSessionId.trim(),
        correlation_id: ridEarly || null,
        models_count: null,
        reject_reason: 'handshake_row_missing',
        dc_phase: getSessionState(handshakeId.trim())?.phase ?? null,
      })}`,
    )
    return false
  }
  const sdr = deriveInternalHostAiPeerRoles(srec, getInstanceId().trim())
  if (!sdr.ok || sdr.localRole !== 'sandbox') {
    console.log(
      `[HOST_AI_CAPS_RESPONSE_REJECT] ${JSON.stringify({
        response_type: wireType,
        handshake_id: handshakeId.trim(),
        session_id: p2pSessionId.trim(),
        correlation_id: ridEarly || null,
        models_count: null,
        reject_reason: 'ledger_role_not_sandbox',
        dc_phase: getSessionState(handshakeId.trim())?.phase ?? null,
      })}`,
    )
    return false
  }

  const rid = typeof raw.request_id === 'string' ? raw.request_id : ''
  const rawHid = typeof raw.handshake_id === 'string' ? raw.handshake_id.trim() : ''
  const rawSid = typeof raw.session_id === 'string' ? raw.session_id.trim() : ''

  if (raw.type === CAPS_TYPE_ERR) {
    if (!rid || !pending.has(rid)) {
      console.log(
        `[HOST_AI_CAPS_RESPONSE_REJECT] ${JSON.stringify({
          response_type: CAPS_TYPE_ERR,
          handshake_id: handshakeId.trim(),
          session_id: p2pSessionId.trim(),
          correlation_id: rid || null,
          models_count: null,
          reject_reason: 'no_pending_or_unknown_correlation',
          dc_phase: getSessionState(handshakeId.trim())?.phase ?? null,
        })}`,
      )
      return false
    }
    const entry = pending.get(rid)
    if (!entry) {
      return false
    }
    if (rawHid && rawHid !== entry.handshakeId) {
      console.log(
        `[HOST_AI_CAPS_RESPONSE_REJECT] ${JSON.stringify({
          response_type: CAPS_TYPE_ERR,
          handshake_id: handshakeId.trim(),
          session_id: p2pSessionId.trim(),
          correlation_id: rid,
          models_count: null,
          reject_reason: 'handshake_id_mismatch',
          dc_phase: getSessionState(handshakeId.trim())?.phase ?? null,
        })}`,
      )
      clearTimeout(entry.timeoutId)
      pending.delete(rid)
      entry.resolve({ ok: false, reason: 'handshake_mismatch', code: InternalInferenceErrorCode.MALFORMED_SERVICE_MESSAGE })
      return true
    }
    if (rawSid && rawSid !== entry.p2pSessionId) {
      console.log(
        `[HOST_AI_CAPS_RESPONSE_REJECT] ${JSON.stringify({
          response_type: CAPS_TYPE_ERR,
          handshake_id: handshakeId.trim(),
          session_id: p2pSessionId.trim(),
          correlation_id: rid,
          models_count: null,
          reject_reason: 'session_id_mismatch',
          dc_phase: getSessionState(handshakeId.trim())?.phase ?? null,
        })}`,
      )
      clearTimeout(entry.timeoutId)
      pending.delete(rid)
      entry.resolve({ ok: false, reason: 'session_mismatch', code: InternalInferenceErrorCode.MALFORMED_SERVICE_MESSAGE })
      return true
    }
    clearTimeout(entry.timeoutId)
    pending.delete(rid)
    const code = typeof raw.code === 'string' ? raw.code : 'error'
    console.log(
      `[HOST_AI_CAPS_RESPONSE_ACCEPT] ${JSON.stringify({
        response_type: CAPS_TYPE_ERR,
        handshake_id: handshakeId.trim(),
        session_id: p2pSessionId.trim(),
        correlation_id: rid,
        ok: false,
        models_count: null,
        provider_ok: null,
        error_code: code,
        reject_reason: null,
        dc_phase: getSessionState(handshakeId.trim())?.phase ?? null,
      })}`,
    )
    entry.resolve({ ok: false, reason: 'inference_error', code })
    return true
  }
  if (raw.type === CAPS_TYPE_RESULT) {
    if (!rid) {
      console.log(
        `[HOST_AI_CAPS_RESPONSE_REJECT] ${JSON.stringify({
          response_type: CAPS_TYPE_RESULT,
          handshake_id: handshakeId.trim(),
          session_id: p2pSessionId.trim(),
          correlation_id: null,
          models_count: null,
          reject_reason: 'missing_request_id',
          dc_phase: getSessionState(handshakeId.trim())?.phase ?? null,
        })}`,
      )
      return false
    }
    const entry = pending.get(rid)
    if (!entry) {
      if (!rawHid || rawHid !== handshakeId.trim() || !rawSid || rawSid !== p2pSessionId.trim()) {
        console.log(
          `[HOST_AI_CAPS_RESPONSE_REJECT] ${JSON.stringify({
            response_type: CAPS_TYPE_RESULT,
            handshake_id: handshakeId.trim(),
            session_id: p2pSessionId.trim(),
            correlation_id: rid,
            models_count: null,
            reject_reason: 'unsolicited_caps_session_handshake_mismatch',
            dc_phase: getSessionState(handshakeId.trim())?.phase ?? null,
          })}`,
        )
        return false
      }
      const wU = mapDcToInternalWire(raw, handshakeId.trim())
      if (!wU) {
        console.log(
          `[HOST_AI_CAPS_RESPONSE_REJECT] ${JSON.stringify({
            response_type: CAPS_TYPE_RESULT,
            handshake_id: handshakeId.trim(),
            session_id: p2pSessionId.trim(),
            correlation_id: rid,
            models_count: null,
            reject_reason: 'schema_or_type_map_failed',
            dc_phase: getSessionState(handshakeId.trim())?.phase ?? null,
          })}`,
        )
        return false
      }
      const mcU = Array.isArray(wU.models) ? wU.models.length : 0
      let ieU0 = wU.inference_error_code
      const ieUnsetU =
        ieU0 === undefined ||
        ieU0 === null ||
        (typeof ieU0 === 'string' && ieU0.trim().length === 0)
      let wireOutU = wU
      if (wU.policy_enabled === true && mcU === 0 && ieUnsetU) {
        console.log(
          `[SBX_AI_CAPS_EMPTY_WIRE_NORMALIZED] ${JSON.stringify({
            handshake_id: handshakeId.trim(),
            session_id: p2pSessionId.trim(),
            correlation_id: rid,
            policy_enabled: true,
            models_length: 0,
            inference_error_code_before: ieU0 ?? null,
            inference_error_code_after: InternalInferenceErrorCode.PROBE_NO_MODELS,
          })}`,
        )
        wireOutU = {
          ...wU,
          inference_error_code: InternalInferenceErrorCode.PROBE_NO_MODELS,
        }
      }
      const peerHostWireU = (coordinationDeviceIdForHandshakeDeviceRole(srec, 'host') ?? '').trim()
      const ownerWU =
        typeof wireOutU.endpoint_owner_device_id === 'string' ? wireOutU.endpoint_owner_device_id.trim() : ''
      let baseValidU = false
      const buU = typeof wireOutU.ollama_direct_base_url === 'string' ? wireOutU.ollama_direct_base_url.trim() : ''
      if (buU) {
        try {
          const uU = new URL(buU)
          baseValidU = uU.protocol === 'http:' || uU.protocol === 'https:'
        } catch {
          baseValidU = false
        }
      }
      let rejected_reasonU: string | null = null
      let acceptedOdU = false
      if (wireOutU.ollama_direct_available === true && baseValidU && peerHostWireU && ownerWU === peerHostWireU) {
        acceptedOdU = true
      } else if (wireOutU.ollama_direct_available !== true) {
        rejected_reasonU = 'ollama_direct_not_available'
      } else if (!baseValidU) {
        rejected_reasonU = 'invalid_or_missing_ollama_direct_base_url'
      } else if (!peerHostWireU) {
        rejected_reasonU = 'missing_peer_host_device_id'
      } else if (ownerWU !== peerHostWireU) {
        rejected_reasonU = 'endpoint_owner_not_peer_host'
      } else {
        rejected_reasonU = 'rejected'
      }
      console.log(
        `[SBX_HOST_AI_OLLAMA_DIRECT_WIRE_RECEIVED] ${JSON.stringify({
          handshake_id: handshakeId.trim(),
          current_device_id: getInstanceId().trim(),
          peer_host_device_id: peerHostWireU || null,
          endpoint_owner_device_id: ownerWU || null,
          ollama_direct_available: wireOutU.ollama_direct_available === true,
          ollama_direct_base_url: wireOutU.ollama_direct_base_url ?? null,
          ollama_direct_host_ip: wireOutU.ollama_direct_host_ip ?? null,
          ollama_direct_models_count:
            typeof wireOutU.ollama_direct_models_count === 'number' ? wireOutU.ollama_direct_models_count : 0,
          accepted: acceptedOdU,
          rejected_reason: rejected_reasonU,
          proactive: true,
        })}`,
      )
      evaluateSandboxHostAiOllamaDirectFromCapabilitiesWire({
        handshakeId: handshakeId.trim(),
        currentDeviceId: getInstanceId().trim(),
        peerHostDeviceId: peerHostWireU,
        wire: wireOutU,
      })
      invalidateSandboxOllamaDirectTagsCacheForHandshake(handshakeId.trim())
      console.log(
        `[SBX_HOST_AI_OLLAMA_DIRECT_PROACTIVE_RECV] ${JSON.stringify({
          handshake_id: handshakeId.trim(),
          session_id: p2pSessionId.trim(),
          correlation_id: rid,
        })}`,
      )
      return true
    }
    if (rawHid && rawHid !== entry.handshakeId) {
      console.log(
        `[HOST_AI_CAPS_RESPONSE_REJECT] ${JSON.stringify({
          response_type: CAPS_TYPE_RESULT,
          handshake_id: handshakeId.trim(),
          session_id: p2pSessionId.trim(),
          correlation_id: rid,
          models_count: null,
          reject_reason: 'handshake_id_mismatch',
          dc_phase: getSessionState(handshakeId.trim())?.phase ?? null,
        })}`,
      )
      clearTimeout(entry.timeoutId)
      pending.delete(rid)
      entry.resolve({ ok: false, reason: 'handshake_mismatch', code: InternalInferenceErrorCode.MALFORMED_SERVICE_MESSAGE })
      return true
    }
    if (rawSid && rawSid !== entry.p2pSessionId) {
      console.log(
        `[HOST_AI_CAPS_RESPONSE_REJECT] ${JSON.stringify({
          response_type: CAPS_TYPE_RESULT,
          handshake_id: handshakeId.trim(),
          session_id: p2pSessionId.trim(),
          correlation_id: rid,
          models_count: null,
          reject_reason: 'session_id_mismatch',
          dc_phase: getSessionState(handshakeId.trim())?.phase ?? null,
        })}`,
      )
      clearTimeout(entry.timeoutId)
      pending.delete(rid)
      entry.resolve({ ok: false, reason: 'session_mismatch', code: InternalInferenceErrorCode.MALFORMED_SERVICE_MESSAGE })
      return true
    }
    clearTimeout(entry.timeoutId)
    pending.delete(rid)
    const w = mapDcToInternalWire(raw, handshakeId.trim())
    if (!w) {
      console.log(
        `[HOST_AI_CAPS_RESPONSE_REJECT] ${JSON.stringify({
          response_type: CAPS_TYPE_RESULT,
          handshake_id: handshakeId.trim(),
          session_id: p2pSessionId.trim(),
          correlation_id: rid,
          models_count: null,
          reject_reason: 'schema_or_type_map_failed',
          dc_phase: getSessionState(handshakeId.trim())?.phase ?? null,
        })}`,
      )
      entry.resolve({ ok: false, reason: 'parse' })
      return true
    }
    const mc = Array.isArray(w.models) ? w.models.length : 0
    let ie = w.inference_error_code
    const ieUnset =
      ie === undefined ||
      ie === null ||
      (typeof ie === 'string' && ie.trim().length === 0)
    let wireOut = w
    if (w.policy_enabled === true && mc === 0 && ieUnset) {
      console.log(
        `[SBX_AI_CAPS_EMPTY_WIRE_NORMALIZED] ${JSON.stringify({
          handshake_id: handshakeId.trim(),
          session_id: p2pSessionId.trim(),
          correlation_id: rid,
          policy_enabled: true,
          models_length: 0,
          inference_error_code_before: ie ?? null,
          inference_error_code_after: InternalInferenceErrorCode.PROBE_NO_MODELS,
        })}`,
      )
      wireOut = {
        ...w,
        inference_error_code: InternalInferenceErrorCode.PROBE_NO_MODELS,
      }
      ie = wireOut.inference_error_code
    }
    const providerOk =
      ie !== InternalInferenceErrorCode.PROBE_OLLAMA_UNAVAILABLE &&
      ie !== InternalInferenceErrorCode.MODEL_MAPPING_DROPPED_ALL &&
      !(mc === 0 && ie === InternalInferenceErrorCode.PROBE_INVALID_RESPONSE)
    console.log(
      `[HOST_AI_CAPS_RESPONSE_ACCEPT] ${JSON.stringify({
        response_type: CAPS_TYPE_RESULT,
        handshake_id: handshakeId.trim(),
        session_id: p2pSessionId.trim(),
        correlation_id: rid,
        ok: true,
        models_count: mc,
        provider_ok: providerOk,
        error_code: ie ?? null,
        reject_reason: null,
        dc_phase: getSessionState(handshakeId.trim())?.phase ?? null,
      })}`,
    )
    const peerHostWire = (coordinationDeviceIdForHandshakeDeviceRole(srec, 'host') ?? '').trim()
    const ownerW = typeof wireOut.endpoint_owner_device_id === 'string' ? wireOut.endpoint_owner_device_id.trim() : ''
    let baseValid = false
    const bu = typeof wireOut.ollama_direct_base_url === 'string' ? wireOut.ollama_direct_base_url.trim() : ''
    if (bu) {
      try {
        const u = new URL(bu)
        baseValid = u.protocol === 'http:' || u.protocol === 'https:'
      } catch {
        baseValid = false
      }
    }
    let rejected_reason: string | null = null
    let acceptedOd = false
    if (wireOut.ollama_direct_available === true && baseValid && peerHostWire && ownerW === peerHostWire) {
      acceptedOd = true
    } else if (wireOut.ollama_direct_available !== true) {
      rejected_reason = 'ollama_direct_not_available'
    } else if (!baseValid) {
      rejected_reason = 'invalid_or_missing_ollama_direct_base_url'
    } else if (!peerHostWire) {
      rejected_reason = 'missing_peer_host_device_id'
    } else if (ownerW !== peerHostWire) {
      rejected_reason = 'endpoint_owner_not_peer_host'
    } else {
      rejected_reason = 'rejected'
    }
    console.log(
      `[SBX_HOST_AI_OLLAMA_DIRECT_WIRE_RECEIVED] ${JSON.stringify({
        handshake_id: handshakeId.trim(),
        current_device_id: getInstanceId().trim(),
        peer_host_device_id: peerHostWire || null,
        endpoint_owner_device_id: ownerW || null,
        ollama_direct_available: wireOut.ollama_direct_available === true,
        ollama_direct_base_url: wireOut.ollama_direct_base_url ?? null,
        ollama_direct_host_ip: wireOut.ollama_direct_host_ip ?? null,
        ollama_direct_models_count:
          typeof wireOut.ollama_direct_models_count === 'number' ? wireOut.ollama_direct_models_count : 0,
        accepted: acceptedOd,
        rejected_reason,
      })}`,
    )
    entry.resolve({ ok: true, wire: wireOut })
    return true
  }
  return false
}

export function tryRouteP2pDataChannelJsonMessage(
  p2pSessionId: string,
  handshakeId: string,
  str: string,
): boolean {
  let raw: unknown
  try {
    raw = JSON.parse(str) as unknown
  } catch {
    return false
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return false
  }
  const o = raw as Record<string, unknown>
  const t = o.type
  if (t === CAPS_TYPE_REQ) {
    if (typeof o.session_id !== 'string' || o.session_id.trim() !== p2pSessionId) {
      return true
    }
    void handleP2pDcInferenceCapabilitiesAsHost(p2pSessionId, handshakeId, o)
    return true
  }
  if (t === CAPS_TYPE_ERR) {
    if (handleP2pDcInferenceCapabilitiesAsSandbox(p2pSessionId, handshakeId, o)) {
      return true
    }
    return tryRouteP2pInferenceDataChannelMessage(p2pSessionId, handshakeId, o)
  }
  if (t === CAPS_TYPE_RESULT) {
    if (handleP2pDcInferenceCapabilitiesAsSandbox(p2pSessionId, handshakeId, o)) {
      return true
    }
    return false
  }
  return tryRouteP2pInferenceDataChannelMessage(p2pSessionId, handshakeId, o)
}

async function peekSandboxPeerHostDeviceForCapsCache(handshakeId: string): Promise<string | null> {
  const me = getInstanceId().trim()
  const db = await getHandshakeDbForInternalInference()
  if (!db) return null
  const r = getHandshakeRecord(db, handshakeId.trim())
  const ar = assertRecordForServiceRpc(r)
  if (!ar.ok) return null
  const dr = deriveInternalHostAiPeerRoles(ar.record, me)
  if (!dr.ok || dr.localRole !== 'sandbox' || dr.peerRole !== 'host') return null
  const sb = hostAiSandboxToHostRequestDeviceIds(ar.record, me)
  if (!sb.ok || !sb.targetHost?.trim()) return null
  return sb.targetHost.trim()
}

function logSbxAiCapsResponseClassifiedPayload(
  handshakeId: string,
  peerHost: string | null,
  cacheKey: string | null,
  out: HostInferenceCapabilitiesDcOutcome,
): void {
  const me = getInstanceId().trim()
  const ttl = ttlMsForSbxAiCapsOutcome(out)
  const classification = classifySbxAiCapsOutcome(out)
  const modelsCount =
    out.ok && Array.isArray(out.wire.models) ? out.wire.models.length : null
  const policyEnabled = out.ok ? out.wire.policy_enabled === true : null
  const inferenceErr =
    out.ok ? (out.wire.inference_error_code ?? null) : (out.code ?? out.reason ?? null)
  console.log(
    `[SBX_AI_CAPS_RESPONSE_CLASSIFIED] ${JSON.stringify({
      handshake_id: handshakeId.trim(),
      peer_host_device_id: peerHost,
      current_device_id: me,
      cache_key: cacheKey,
      models_count: modelsCount,
      policy_enabled: policyEnabled,
      inference_error_code: inferenceErr,
      classification,
      ttl_ms: ttl,
      caller_purpose: 'capabilities_dc',
    })}`,
  )
}

/**
 * Sandbox → Host: send capabilities request over DC and await response (or error).
 * Same handshake + peer Host device coalesce and share TTL terminal cache (models=[] included).
 */
export async function requestHostInferenceCapabilitiesOverDataChannel(
  handshakeId: string,
  p2pSessionId: string,
  timeoutMs: number,
  options?: { requestId?: string },
): Promise<HostInferenceCapabilitiesDcOutcome> {
  const hidTrim = handshakeId.trim()
  const me = getInstanceId().trim()
  const peerHostPeek = await peekSandboxPeerHostDeviceForCapsCache(handshakeId)
  let cacheKey: string | null = null
  if (peerHostPeek) {
    cacheKey = sbxAiCapsCacheKey(hidTrim, peerHostPeek)
    const cached = getSbxAiCapsTerminalCache(cacheKey)
    if (cached) {
      console.log(
        `[SBX_AI_CAPS_REQUEST_CACHE_HIT] ${JSON.stringify({
          handshake_id: hidTrim,
          peer_host_device_id: peerHostPeek,
          current_device_id: me,
          cache_key: cacheKey,
          models_count:
            cached.ok && Array.isArray(cached.wire.models) ? cached.wire.models.length : null,
          policy_enabled: cached.ok ? cached.wire.policy_enabled === true : null,
          inference_error_code:
            cached.ok ? cached.wire.inference_error_code ?? null : cached.code ?? cached.reason,
          classification: classifySbxAiCapsOutcome(cached),
          ttl_ms: ttlMsForSbxAiCapsOutcome(cached),
          caller_purpose: 'capabilities_dc',
        })}`,
      )
      return cloneDcOutcomeFreshRequestId(cached, options?.requestId)
    }
    const existingInflight = sbxAiCapsInflightByCacheKey.get(cacheKey)
    if (existingInflight) {
      console.log(
        `[SBX_AI_CAPS_REQUEST_INFLIGHT_REUSE] ${JSON.stringify({
          handshake_id: hidTrim,
          peer_host_device_id: peerHostPeek,
          current_device_id: me,
          cache_key: cacheKey,
          caller_purpose: 'capabilities_dc',
        })}`,
      )
      return existingInflight
    }
  }

  console.log(
    `[SBX_AI_CAPS_REQUEST_START] ${JSON.stringify({
      handshake_id: hidTrim,
      peer_host_device_id: peerHostPeek,
      current_device_id: me,
      cache_key: cacheKey,
      caller_purpose: 'capabilities_dc',
    })}`,
  )

  const inner = executeHostInferenceCapabilitiesDcExchange(handshakeId, p2pSessionId, timeoutMs, options)

  const finalize = (out: HostInferenceCapabilitiesDcOutcome): HostInferenceCapabilitiesDcOutcome => {
    logSbxAiCapsResponseClassifiedPayload(hidTrim, peerHostPeek, cacheKey, out)
    if (cacheKey) {
      const ttl = ttlMsForSbxAiCapsOutcome(out)
      if (ttl > 0) setSbxAiCapsTerminalCache(cacheKey, out, ttl)
    }
    return out
  }

  if (!cacheKey) {
    return inner.then(finalize)
  }

  const started = inner.then(finalize).finally(() => {
    sbxAiCapsInflightByCacheKey.delete(cacheKey!)
  })

  sbxAiCapsInflightByCacheKey.set(cacheKey, started)
  return started
}

/**
 * Single DC capabilities RPC: registers pending + sends one request frame.
 */
async function executeHostInferenceCapabilitiesDcExchange(
  handshakeId: string,
  p2pSessionId: string,
  timeoutMs: number,
  options?: { requestId?: string },
): Promise<HostInferenceCapabilitiesDcOutcome> {
  const me = getInstanceId().trim()
  const db = await getHandshakeDbForInternalInference()
  if (!db) {
    return { ok: false, reason: 'no_db' }
  }
  const r = getHandshakeRecord(db, handshakeId.trim())
  const ar = assertRecordForServiceRpc(r)
  if (!ar.ok) {
    return { ok: false, reason: 'handshake' }
  }
  const rec = ar.record
  const dr = deriveInternalHostAiPeerRoles(rec, me)
  if (!dr.ok) {
    logHostAiPairingRoleGate({
      gate: 'caps_rpc',
      handshake_id: handshakeId.trim(),
      request_type: 'internal_inference_capabilities_request',
      current_device_id: me,
      sender_device_id: '',
      receiver_device_id: '',
      local_derived_role: 'unknown',
      peer_derived_role: 'unknown',
      requester_role: 'sandbox',
      receiver_role: 'host',
      decision: 'deny',
      reason: dr.reason,
    })
    return { ok: false, reason: 'role', code: InternalInferenceErrorCode.HOST_AI_CAPABILITY_ROLE_REJECTED }
  }
  if (dr.localRole !== 'sandbox' || dr.peerRole !== 'host') {
    logHostAiPairingRoleGate({
      gate: 'caps_rpc',
      handshake_id: handshakeId.trim(),
      request_type: 'internal_inference_capabilities_request',
      current_device_id: me,
      sender_device_id: dr.localCoordinationDeviceId,
      receiver_device_id: dr.peerCoordinationDeviceId,
      local_derived_role: dr.localRole,
      peer_derived_role: dr.peerRole,
      requester_role: 'sandbox',
      receiver_role: 'host',
      decision: 'deny',
      reason: `requester_must_be_sandbox_got_local_${dr.localRole}_peer_${dr.peerRole}`,
    })
    return { ok: false, reason: 'not_sandbox_requester', code: InternalInferenceErrorCode.HOST_AI_CAPABILITY_ROLE_REJECTED }
  }
  logHostAiPairingRoleGate({
    gate: 'caps_rpc',
    handshake_id: handshakeId.trim(),
    request_type: 'internal_inference_capabilities_request',
    current_device_id: me,
    sender_device_id: dr.localCoordinationDeviceId,
    receiver_device_id: dr.peerCoordinationDeviceId,
    local_derived_role: dr.localRole,
    peer_derived_role: dr.peerRole,
    requester_role: 'sandbox',
    receiver_role: 'host',
    decision: 'allow',
    reason: 'ledger_sandbox_to_host',
  })
  const sb = hostAiSandboxToHostRequestDeviceIds(rec, me)
  if (!sb.ok) {
    return { ok: false, reason: 'missing_coordination_ids' }
  }
  const localSandbox = sb.requester
  const peerHost = sb.targetHost
  if (!localSandbox || !peerHost) {
    return { ok: false, reason: 'missing_coordination_ids' }
  }
  const requestId = (options?.requestId?.trim() ? options.requestId.trim() : null) || randomUUID()
  const hidTrim = handshakeId.trim()
  const sidTrim = p2pSessionId.trim()
  const body = {
    schema_version: 1,
    type: CAPS_TYPE_REQ,
    request_id: requestId,
    handshake_id: hidTrim,
    session_id: sidTrim,
    sender_device_id: localSandbox,
    target_device_id: peerHost,
    created_at: new Date().toISOString(),
    transport_policy: 'p2p_only' as const,
  }
  return new Promise((resolve) => {
    const to = setTimeout(() => {
      if (pending.has(requestId)) {
        pending.delete(requestId)
        resolve({ ok: false, reason: 'timeout' })
      }
    }, Math.min(timeoutMs, 15_000))
    const finish: CapResolve = (x) => {
      clearTimeout(to)
      resolve(x)
    }
    pending.set(requestId, {
      resolve: finish,
      timeoutId: to,
      handshakeId: hidTrim,
      p2pSessionId: sidTrim,
    })
    const te = new TextEncoder().encode(JSON.stringify(body))
    void (async () => {
      const { webrtcSendData } = await import('../webrtc/webrtcTransportIpc')
      await webrtcSendData(p2pSessionId, hidTrim, te.buffer)
    })()
  })
}
