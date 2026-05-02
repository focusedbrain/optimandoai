/**
 * Main-process IPC for internal (direct P2P) inference (Sandbox test + Host policy).
 */

import { ipcMain } from 'electron'
import { isHostMode, isSandboxMode } from '../orchestrator/orchestratorModeStore'
import { InternalInferenceErrorCode } from './errors'
import {
  getHostInternalInferencePolicy,
  setHostInternalInferencePolicy,
  type HostInternalInferencePolicy,
} from './hostInferencePolicyStore'
import { runSandboxPongTestFromHostHandshake } from './sandboxRequest'
import {
  closeSession,
  ensureHostAiP2pSession,
  getSessionState,
  P2pSessionLogReason,
  type P2pSessionState,
} from './p2pSession/p2pInferenceSessionManager'
import { registerWebrtcTransportIpc } from './webrtc/webrtcTransportIpc'

type P2pSessionLogReasonType = (typeof P2pSessionLogReason)[keyof typeof P2pSessionLogReason]

type ListSandboxHostInferenceResult = Awaited<
  ReturnType<typeof import('./listInferenceTargets').listSandboxHostInternalInferenceTargets>
>

/** Completed-list snapshot: same renderer burst (effects + events) must not re-run `list_begin` within this window. */
const IPC_LIST_INFERENCE_TARGETS_CACHE_MS = 1500

const listInferenceCacheByHandshake = new Map<
  string,
  { completedAt: number; result: ListSandboxHostInferenceResult }
>()
let lastListInferenceGlobalCache: { completedAt: number; result: ListSandboxHostInferenceResult } | null = null

/** Parallel IPC invokes join this promise; sequential duplicates use TTL cache above. */
let listInferenceTargetsInflight: Promise<ListSandboxHostInferenceResult> | null = null

function parseListInferenceTargetsIpcArg(raw: unknown): { coalesceHandshakeId: string; forceRefresh: boolean } {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { coalesceHandshakeId: '', forceRefresh: false }
  }
  const o = raw as { coalesceHandshakeId?: unknown; forceRefresh?: unknown }
  const coalesceHandshakeId = typeof o.coalesceHandshakeId === 'string' ? o.coalesceHandshakeId.trim() : ''
  const forceRefresh = o.forceRefresh === true
  return { coalesceHandshakeId, forceRefresh }
}

function noteListInferenceTargetsIpcCache(result: ListSandboxHostInferenceResult): void {
  const now = Date.now()
  lastListInferenceGlobalCache = { completedAt: now, result }
  listInferenceCacheByHandshake.clear()
  if (result.ok && Array.isArray(result.targets)) {
    for (const t of result.targets) {
      const hid = typeof t.handshake_id === 'string' ? t.handshake_id.trim() : ''
      if (hid) {
        listInferenceCacheByHandshake.set(hid, { completedAt: now, result })
      }
    }
  }
}

function tryListInferenceTargetsIpcCache(
  coalesceHandshakeId: string,
  now: number,
): ListSandboxHostInferenceResult | null {
  if (coalesceHandshakeId) {
    const hit = listInferenceCacheByHandshake.get(coalesceHandshakeId)
    if (hit && now - hit.completedAt < IPC_LIST_INFERENCE_TARGETS_CACHE_MS) {
      console.log(`[HOST_INFERENCE_TARGETS] probe_coalesced age_ms=${now - hit.completedAt}`)
      return hit.result
    }
    return null
  }
  const g = lastListInferenceGlobalCache
  if (g && now - g.completedAt < IPC_LIST_INFERENCE_TARGETS_CACHE_MS) {
    console.log(`[HOST_INFERENCE_TARGETS] probe_coalesced age_ms=${now - g.completedAt}`)
    return g.result
  }
  return null
}

/** Drop list IPC cache when orchestrator / Host AI build invalidates in-memory probe state. */
export function resetListInferenceTargetsIpcCacheForOrchestrator(): void {
  listInferenceCacheByHandshake.clear()
  lastListInferenceGlobalCache = null
}

const lastIpcProbeHostPolicyLogByHandshake = new Map<string, number>()
const IPC_PROBE_HOST_POLICY_LOG_MIN_MS = 5_000

function parseP2pSessionCloseReason(r: unknown): P2pSessionLogReasonType {
  const s = typeof r === 'string' ? r : ''
  const allowed = new Set<string>(Object.values(P2pSessionLogReason)) as Set<string>
  if (s && allowed.has(s)) {
    return s as P2pSessionLogReasonType
  }
  return P2pSessionLogReason.unknown
}

/**
 * Shared by IPC handlers and lifecycle tests (Prompt 7: model selector reopen within TTL).
 */
export async function dispatchListInferenceTargetsIpc(rawArg?: unknown): Promise<ListSandboxHostInferenceResult> {
  const { coalesceHandshakeId, forceRefresh } = parseListInferenceTargetsIpcArg(rawArg)
  const now = Date.now()
  if (forceRefresh) {
    resetListInferenceTargetsIpcCacheForOrchestrator()
    const { invalidateProbeCache } = await import('./listInferenceTargets')
    invalidateProbeCache()
  }
  const cached = tryListInferenceTargetsIpcCache(coalesceHandshakeId, now)
  if (cached) {
    return cached
  }
  if (listInferenceTargetsInflight) {
    console.log('[HOST_INFERENCE_TARGETS] ipc_list_coalesced joining_inflight=1')
    return listInferenceTargetsInflight
  }
  const { listSandboxHostInternalInferenceTargets } = await import('./listInferenceTargets')
  if (listInferenceTargetsInflight) {
    console.log('[HOST_INFERENCE_TARGETS] ipc_list_coalesced joining_inflight=1')
    return listInferenceTargetsInflight
  }
  const p = listSandboxHostInternalInferenceTargets().then((r) => {
    noteListInferenceTargetsIpcCache(r)
    return r
  })
  listInferenceTargetsInflight = p
  void p.finally(() => {
    if (listInferenceTargetsInflight === p) {
      listInferenceTargetsInflight = null
    }
  })
  return p
}

export function registerInternalInferenceIpc(): void {
  console.log('[InternalInference IPC] register')

  ipcMain.handle('internal-inference:requestPongTest', async (_event, params: { handshakeId?: string }) => {
    const handshakeId = typeof params?.handshakeId === 'string' ? params.handshakeId.trim() : ''
    if (!handshakeId) {
      return {
        ok: false as const,
        code: InternalInferenceErrorCode.MALFORMED_SERVICE_MESSAGE,
        message: 'handshakeId required',
      }
    }
    return runSandboxPongTestFromHostHandshake(handshakeId)
  })

  ipcMain.handle('internal-inference:getHostPolicy', async (): Promise<HostInternalInferencePolicy> => {
    return getHostInternalInferencePolicy()
  })

  ipcMain.handle(
    'internal-inference:setHostPolicy',
    async (_event, partial: Partial<HostInternalInferencePolicy>): Promise<HostInternalInferencePolicy> => {
      return setHostInternalInferencePolicy(partial ?? {})
    },
  )

  ipcMain.handle('internal-inference:listHostCandidates', async () => {
    if (isHostMode()) {
      return { ok: true as const, candidates: [] }
    }
    const { listSandboxHostInferenceCandidates } = await import('./sandboxHostUi')
    const candidates = await listSandboxHostInferenceCandidates()
    return { ok: true as const, candidates }
  })

  /** Legacy alias — same as `internal-inference:listTargets`. */
  ipcMain.handle('internal-inference:listInferenceTargets', (_e, rawArg) => dispatchListInferenceTargetsIpc(rawArg))
  /** Host AI model rows for Sandbox (active internal Host handshakes; same handler as listInferenceTargets). */
  ipcMain.handle('internal-inference:listTargets', (_e, rawArg) => dispatchListInferenceTargetsIpc(rawArg))

  ipcMain.handle('internal-inference:listSandboxPeerCandidates', async () => {
    if (isSandboxMode()) {
      return { ok: true as const, candidates: [] }
    }
    const { listHostToSandboxDirectReachabilityRows } = await import('./directP2pReachability')
    const candidates = await listHostToSandboxDirectReachabilityRows()
    return { ok: true as const, candidates }
  })

  ipcMain.handle('internal-inference:checkDirectP2pReachability', async (_e, params: { handshakeId?: string }) => {
    const handshakeId = typeof params?.handshakeId === 'string' ? params.handshakeId.trim() : ''
    if (!handshakeId) {
      return { ok: false as const, error: 'handshakeId required' }
    }
    const { checkDirectP2pReachabilityFromHandshake } = await import('./directP2pReachability')
    const r = await checkDirectP2pReachabilityFromHandshake(handshakeId)
    return { ok: true as const, ...r }
  })

  ipcMain.handle('internal-inference:inspectP2pHandshake', async (_e, params: { handshakeId?: string }) => {
    const { getInternalHostHandshakeP2pInspect } = await import('./internalP2pHandshakeInspect')
    const handshakeId = typeof params?.handshakeId === 'string' ? params.handshakeId.trim() : undefined
    return getInternalHostHandshakeP2pInspect(handshakeId)
  })

  ipcMain.handle('internal-inference:probeHostPolicy', async (_e, params: { handshakeId?: string }) => {
    const handshakeId = typeof params?.handshakeId === 'string' ? params.handshakeId.trim() : ''
    if (!handshakeId) {
      return { ok: false as const, error: 'handshakeId required' }
    }
    const t = Date.now()
    const last = lastIpcProbeHostPolicyLogByHandshake.get(handshakeId) ?? 0
    if (t - last >= IPC_PROBE_HOST_POLICY_LOG_MIN_MS) {
      lastIpcProbeHostPolicyLogByHandshake.set(handshakeId, t)
      console.log(`[HOST_INFERENCE_P2P] ipc_probeHostPolicy handshake=${handshakeId}`)
    }
    const { probeHostInferencePolicyFromSandbox } = await import('./sandboxHostUi')
    return probeHostInferencePolicyFromSandbox(handshakeId)
  })

  const parseExecutionTransport = (raw: unknown): 'ollama_direct' | undefined =>
    raw === 'ollama_direct' ? 'ollama_direct' : undefined

  const handleHostChatOrRequestCompletion = async (
    _e: unknown,
    params: {
      handshakeId?: string
      messages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
      model?: string
      temperature?: number
      max_tokens?: number
      timeoutMs?: number
      execution_transport?: unknown
    },
  ) => {
    const { runSandboxHostInferenceChat } = await import('./sandboxHostChat')
    const handshakeId = typeof params?.handshakeId === 'string' ? params.handshakeId.trim() : ''
    if (!handshakeId || !Array.isArray(params?.messages)) {
      return { ok: false as const, code: InternalInferenceErrorCode.MALFORMED_SERVICE_MESSAGE, message: 'invalid params' }
    }
    return runSandboxHostInferenceChat({
      handshakeId,
      messages: params.messages,
      model: params.model,
      temperature: params.temperature,
      max_tokens: params.max_tokens,
      timeoutMs: params.timeoutMs,
      execution_transport: parseExecutionTransport(params.execution_transport),
    })
  }

  /** STEP 5: `internalInference:requestCompletion` — direct P2P, snake_case wire fields. */
  ipcMain.handle(
    'internal-inference:requestCompletion',
    async (
      _e: unknown,
      params: {
        provider?: string
        target_id?: string
        handshake_id?: string
        messages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
        model?: string
        timeout_ms?: number
        stream?: boolean
        execution_transport?: unknown
      },
    ) => {
      const { runSandboxHostInferenceChat } = await import('./sandboxHostChat')
      const p = params?.provider
      if (p != null && p !== 'host_internal') {
        return { ok: false as const, code: InternalInferenceErrorCode.MALFORMED_SERVICE_MESSAGE, message: 'provider must be host_internal' }
      }
      const handshakeId = typeof params?.handshake_id === 'string' ? params.handshake_id.trim() : ''
      if (!handshakeId || !Array.isArray(params?.messages)) {
        return { ok: false as const, code: InternalInferenceErrorCode.MALFORMED_SERVICE_MESSAGE, message: 'invalid params' }
      }
      if (params?.stream !== false) {
        return { ok: false as const, code: InternalInferenceErrorCode.MALFORMED_SERVICE_MESSAGE, message: 'stream must be false' }
      }
      const timeoutMs = typeof params.timeout_ms === 'number' && Number.isFinite(params.timeout_ms) ? params.timeout_ms : undefined
      return runSandboxHostInferenceChat({
        handshakeId,
        messages: params.messages,
        model: typeof params.model === 'string' ? params.model : undefined,
        timeoutMs,
        execution_transport: parseExecutionTransport(params.execution_transport),
      })
    },
  )

  /** Legacy name — same as `requestHostCompletion` (direct P2P internal inference). */
  ipcMain.handle('internal-inference:runHostChat', handleHostChatOrRequestCompletion)
  /** Direct P2P internal inference; camelCase params (older preload). */
  ipcMain.handle('internal-inference:requestHostCompletion', handleHostChatOrRequestCompletion)

  /** P2P session skeleton (no WebRTC): state for selectors, signaling hooks only. */
  ipcMain.handle(
    'internal-inference:p2pSession:ensure',
    async (
      _e: unknown,
      params: { handshakeId?: string; reason?: string },
    ): Promise<P2pSessionState> => {
      const handshakeId = typeof params?.handshakeId === 'string' ? params.handshakeId.trim() : ''
      const reason = typeof params?.reason === 'string' && params.reason.trim() ? params.reason.trim() : 'ipc'
      return ensureHostAiP2pSession(handshakeId, reason)
    },
  )
  ipcMain.handle(
    'internal-inference:p2pSession:close',
    async (
      _e: unknown,
      params: { handshakeId?: string; reason?: string },
    ): Promise<{ ok: true }> => {
      const handshakeId = typeof params?.handshakeId === 'string' ? params.handshakeId.trim() : ''
      const reason = parseP2pSessionCloseReason(params?.reason)
      closeSession(handshakeId, reason)
      return { ok: true as const }
    },
  )
  ipcMain.handle('internal-inference:p2pSession:getState', async (_e: unknown, handshakeId: unknown) => {
    const id = typeof handshakeId === 'string' ? handshakeId.trim() : ''
    if (!id) {
      return null
    }
    return getSessionState(id)
  })

  registerWebrtcTransportIpc()
}
