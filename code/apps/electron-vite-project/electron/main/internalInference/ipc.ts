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

  ipcMain.handle('internal-inference:probeHostPolicy', async (_e, params: { handshakeId?: string }) => {
    const handshakeId = typeof params?.handshakeId === 'string' ? params.handshakeId.trim() : ''
    if (!handshakeId) {
      return { ok: false as const, error: 'handshakeId required' }
    }
    const { probeHostInferencePolicyFromSandbox } = await import('./sandboxHostUi')
    return probeHostInferencePolicyFromSandbox(handshakeId)
  })

  ipcMain.handle(
    'internal-inference:runHostChat',
    async (
      _e,
      params: {
        handshakeId?: string
        messages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
        model?: string
        temperature?: number
        max_tokens?: number
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
      })
    },
  )
}
