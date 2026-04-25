/**
 * Sandbox renderer support: list internal Host handshakes, probe Host policy over direct P2P.
 */

import { getHandshakeRecord, listHandshakeRecords } from '../handshake/db'
import type { HandshakeRecord } from '../handshake/types'
import { isSandboxMode } from '../orchestrator/orchestratorModeStore'
import { getHandshakeDbForInternalInference } from './dbAccess'
import { InternalInferenceErrorCode } from './errors'
import {
  assertP2pEndpointDirect,
  assertRecordForServiceRpc,
  assertSandboxRequestToHost,
} from './policy'
import { getHostInternalInferencePolicy } from './hostInferencePolicyStore'

export interface SandboxHostInferenceCandidate {
  handshakeId: string
  /** Shown in UI (counterparty “computer name”). */
  hostDisplayName: string
  hostRoleLabel: 'Host orchestrator'
  /** Formatted e.g. 482-917 when 6 digits. */
  pairingCodeDisplay: string
  directP2pAvailable: boolean
  /** Hostname from direct URL when parseable. */
  endpointHostLabel: string | null
}

function peerHostComputerName(r: HandshakeRecord): string {
  if (r.local_role === 'initiator') {
    if (r.initiator_device_role === 'host') {
      return (r.initiator_device_name?.trim() || 'This computer (Host)').trim()
    }
    return (r.acceptor_device_name?.trim() || 'Host').trim()
  }
  if (r.acceptor_device_role === 'host') {
    return (r.acceptor_device_name?.trim() || 'This computer (Host)').trim()
  }
  return (r.initiator_device_name?.trim() || 'Host').trim()
}

function formatPairingCode(raw: string | null | undefined): string {
  const s = (raw ?? '').replace(/\D/g, '').trim()
  if (s.length === 6) {
    return `${s.slice(0, 3)}-${s.slice(3)}`
  }
  return s || '—'
}

export function policyProbeUrlFromP2pIngest(ingestUrl: string): string {
  const t = ingestUrl.trim()
  if (/\/beap\/ingest\/?$/i.test(t)) {
    return t.replace(/\/beap\/ingest\/?$/i, '/beap/internal-inference-policy')
  }
  try {
    const u = new URL(t)
    u.pathname = '/beap/internal-inference-policy'
    return u.href
  } catch {
    return t
  }
}

function endpointHostLabel(ingestUrl: string | null | undefined): string | null {
  const ep = typeof ingestUrl === 'string' ? ingestUrl.trim() : ''
  if (!ep) return null
  try {
    return new URL(ep).hostname
  } catch {
    return null
  }
}

/**
 * List ACTIVE internal handshakes where this device is Sandbox and peer is Host.
 */
export async function listSandboxHostInferenceCandidates(): Promise<SandboxHostInferenceCandidate[]> {
  if (!isSandboxMode()) {
    return []
  }
  const db = await getHandshakeDbForInternalInference()
  if (!db) {
    return []
  }
  const rows = listHandshakeRecords(db, { state: 'ACTIVE', handshake_type: 'internal' })
  const out: SandboxHostInferenceCandidate[] = []
  for (const r of rows) {
    const ar = assertRecordForServiceRpc(r)
    if (!ar.ok) {
      continue
    }
    const role = assertSandboxRequestToHost(ar.record)
    if (!role.ok) {
      continue
    }
    const direct = assertP2pEndpointDirect(db, ar.record.p2p_endpoint)
    const directOk = direct.ok
    out.push({
      handshakeId: ar.record.handshake_id,
      hostDisplayName: peerHostComputerName(ar.record),
      hostRoleLabel: 'Host orchestrator',
      pairingCodeDisplay: formatPairingCode(ar.record.internal_peer_pairing_code),
      directP2pAvailable: directOk,
      endpointHostLabel: endpointHostLabel(ar.record.p2p_endpoint),
    })
  }
  return out
}

/** Host response from GET /beap/internal-inference-policy (direct P2P; STEP 6 metadata). */
export type HostInternalInferencePolicyPayload = {
  allowSandboxInference?: boolean
  defaultChatModel?: string
  provider?: string
  modelId?: string | null
  displayLabel?: string
  hostComputerName?: string
  hostOrchestratorRoleLabel?: string
  internalIdentifier6?: string
  internalIdentifierDisplay?: string
  directReachable?: boolean
  policyEnabled?: boolean
  inferenceErrorCode?: string
}

export type ProbeHostPolicyResult =
  | {
      ok: true
      allowSandboxInference: boolean
      defaultChatModel?: string
      /** Ollama chat model id (live on each probe). */
      modelId?: string | null
      displayLabelFromHost?: string
      hostComputerNameFromHost?: string
      providerFromHost?: 'ollama'
      hostOrchestratorRoleLabelFromHost?: string
      internalIdentifier6FromHost?: string
      internalIdentifierDisplayFromHost?: string
      directP2pPath?: boolean
      policyEnabledFromHost?: boolean
      inferenceErrorCode?: string
    }
  | { ok: false; code: string; message: string; directP2pAvailable: boolean; allowSandboxInference?: undefined }

/**
 * HTTP GET to Host’s direct P2P base — returns whether Host has enabled Sandbox inference in policy.
 */
export async function probeHostInferencePolicyFromSandbox(
  handshakeId: string,
): Promise<ProbeHostPolicyResult> {
  if (!isSandboxMode()) {
    return { ok: false, code: 'NOT_SANDBOX', message: 'not sandbox', directP2pAvailable: false }
  }
  const db = await getHandshakeDbForInternalInference()
  if (!db) {
    return { ok: false, code: 'NO_DB', message: 'no database', directP2pAvailable: false }
  }
  const hid = String(handshakeId ?? '').trim()
  const r = getHandshakeRecord(db, hid)
  const ar = assertRecordForServiceRpc(r)
  if (!ar.ok) {
    return { ok: false, code: ar.code, message: 'handshake', directP2pAvailable: false }
  }
  const role = assertSandboxRequestToHost(ar.record)
  if (!role.ok) {
    return { ok: false, code: role.code, message: 'role', directP2pAvailable: false }
  }
  const direct = assertP2pEndpointDirect(db, ar.record.p2p_endpoint)
  if (!direct.ok) {
    return {
      ok: false,
      code: direct.code,
      message: 'direct P2P required',
      directP2pAvailable: false,
    }
  }
  const ep = ar.record.p2p_endpoint?.trim() ?? ''
  const token = ar.record.counterparty_p2p_token
  if (!token?.trim()) {
    return { ok: false, code: 'POLICY_FORBIDDEN', message: 'token', directP2pAvailable: true }
  }
  const url = policyProbeUrlFromP2pIngest(ep)
  const { timeoutMs } = getHostInternalInferencePolicy()
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), Math.min(timeoutMs, 15_000))
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token.trim()}`,
        'X-BEAP-Handshake': hid,
      },
      signal: ac.signal,
    })
    clearTimeout(timer)
    if (res.status === 401 || res.status === 403) {
      return { ok: false, code: InternalInferenceErrorCode.POLICY_FORBIDDEN, message: 'forbidden', directP2pAvailable: true }
    }
    if (!res.ok) {
      return {
        ok: false,
        code: InternalInferenceErrorCode.OLLAMA_UNAVAILABLE,
        message: `http ${res.status}`,
        directP2pAvailable: true,
      }
    }
    const j = (await res.json()) as HostInternalInferencePolicyPayload
    const allow = j.allowSandboxInference === true
    const dcmFromLegacy = typeof j.defaultChatModel === 'string' && j.defaultChatModel.trim() ? j.defaultChatModel.trim() : undefined
    const dcmFromId = typeof j.modelId === 'string' && j.modelId.trim() ? j.modelId.trim() : undefined
    const dcm = dcmFromId ?? dcmFromLegacy
    let modelId: string | null | undefined
    if (j.modelId === null) {
      modelId = null
    } else if (typeof j.modelId === 'string' && j.modelId.trim()) {
      modelId = j.modelId.trim()
    } else if (dcm) {
      modelId = dcm
    }
    return {
      ok: true as const,
      allowSandboxInference: allow,
      defaultChatModel: dcm,
      modelId,
      displayLabelFromHost: typeof j.displayLabel === 'string' ? j.displayLabel : undefined,
      hostComputerNameFromHost: typeof j.hostComputerName === 'string' ? j.hostComputerName.trim() : undefined,
      providerFromHost: j.provider === 'ollama' ? 'ollama' : undefined,
      hostOrchestratorRoleLabelFromHost:
        typeof j.hostOrchestratorRoleLabel === 'string' ? j.hostOrchestratorRoleLabel : undefined,
      internalIdentifier6FromHost: typeof j.internalIdentifier6 === 'string' ? j.internalIdentifier6 : undefined,
      internalIdentifierDisplayFromHost:
        typeof j.internalIdentifierDisplay === 'string' ? j.internalIdentifierDisplay : undefined,
      directP2pPath: j.directReachable === true,
      policyEnabledFromHost: typeof j.policyEnabled === 'boolean' ? j.policyEnabled : undefined,
      inferenceErrorCode: typeof j.inferenceErrorCode === 'string' ? j.inferenceErrorCode : undefined,
    }
  } catch (e) {
    clearTimeout(timer)
    const name = (e as Error)?.name
    if (name === 'AbortError') {
      return {
        ok: false,
        code: InternalInferenceErrorCode.PROVIDER_TIMEOUT,
        message: 'timeout',
        directP2pAvailable: true,
      }
    }
    return {
      ok: false,
      code: InternalInferenceErrorCode.HOST_DIRECT_P2P_UNAVAILABLE,
      message: (e as Error)?.message ?? 'fetch failed',
      directP2pAvailable: true,
    }
  }
}
