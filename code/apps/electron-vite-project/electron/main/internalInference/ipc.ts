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

function parseP2pSessionCloseReason(r: unknown): P2pSessionLogReasonType {
  const s = typeof r === 'string' ? r : ''
  const allowed = new Set<string>(Object.values(P2pSessionLogReason)) as Set<string>
  if (s && allowed.has(s)) {
    return s as P2pSessionLogReasonType
  }
  return P2pSessionLogReason.unknown
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

  const listInferenceTargetsHandler = async () => {
    const { listSandboxHostInternalInferenceTargets } = await import('./listInferenceTargets')
    return listSandboxHostInternalInferenceTargets()
  }
  /** Legacy alias — same as `internal-inference:listTargets`. */
  ipcMain.handle('internal-inference:listInferenceTargets', listInferenceTargetsHandler)
  /** Host AI model rows for Sandbox (active internal Host handshakes; same handler as listInferenceTargets). */
  ipcMain.handle('internal-inference:listTargets', listInferenceTargetsHandler)

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
    console.log(`[HOST_INFERENCE_P2P] ipc_probeHostPolicy handshake=${handshakeId}`)
    const { probeHostInferencePolicyFromSandbox } = await import('./sandboxHostUi')
    return probeHostInferencePolicyFromSandbox(handshakeId)
  })

  const handleHostChatOrRequestCompletion = async (
    _e: unknown,
    params: {
      handshakeId?: string
      messages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
      model?: string
      temperature?: number
      max_tokens?: number
      timeoutMs?: number
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
