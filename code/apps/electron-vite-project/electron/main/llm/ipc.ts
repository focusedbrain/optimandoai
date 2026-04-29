/**
 * LLM IPC Handlers
 * Electron IPC interface for renderer process to communicate with LLM services
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron'
import { hardwareService } from './hardware'
import { ollamaManager } from './ollama-manager'
import { DEBUG_ACTIVE_OLLAMA_MODEL } from './activeOllamaModelStore'
import { broadcastActiveOllamaModelChanged } from './broadcastActiveModel'
import { MODEL_CATALOG, getModelConfig } from './config'
import { ChatRequest } from './types'
import { resolveInboxAutosortRuntime } from './inboxAutosortRuntime'
import { isSandboxMode } from '../orchestrator/orchestratorModeStore'
import {
  normalizeAiExecutionContextInput,
  writeStoredAiExecutionContext,
} from './aiExecutionContextStore'
import type { AiExecutionLane } from './aiExecutionTypes'
import { getSandboxOllamaDirectRouteCandidate } from '../internalInference/sandboxHostAiOllamaDirectCandidate'

/**
 * Register all LLM-related IPC handlers
 */
export function registerLlmHandlers() {
  console.log('[LLM IPC] Registering handlers...')
  
  // Hardware detection
  ipcMain.handle('llm:getHardware', async () => {
    try {
      const hardware = await hardwareService.detect()
      return { ok: true, data: hardware }
    } catch (error: any) {
      console.error('[LLM IPC] Hardware detection failed:', error)
      return { ok: false, error: error.message }
    }
  })
  
  // Ollama status — same `data` shape as GET `/api/llm/status` (includes optional `localRuntime`)
  // 3-second result cache: prevents 30+ rapid IPC calls (e.g. BulkOllamaModelSelect remounts during
  // sort progress updates) from each spawning subprocess + HTTP calls to Ollama.
  let _getStatusCache: { at: number; result: unknown } | null = null
  const GET_STATUS_CACHE_TTL_MS = 3_000
  ipcMain.handle('llm:getStatus', async () => {
    if (_getStatusCache && Date.now() - _getStatusCache.at < GET_STATUS_CACHE_TTL_MS) {
      return _getStatusCache.result
    }
    try {
      const status = await ollamaManager.getStatus()
      const result = { ok: true, data: status }
      _getStatusCache = { at: Date.now(), result }
      return result
    } catch (error: any) {
      console.error('[LLM IPC] Get status failed:', error)
      return { ok: false, error: error.message }
    }
  })
  
  // Start Ollama server
  ipcMain.handle('llm:startOllama', async () => {
    try {
      if (isSandboxMode()) {
        return { ok: false, error: 'Ollama management is disabled in sandbox mode' }
      }
      await ollamaManager.start()
      return { ok: true }
    } catch (error: any) {
      console.error('[LLM IPC] Start Ollama failed:', error)
      return { ok: false, error: error.message }
    }
  })
  
  // Stop Ollama server
  ipcMain.handle('llm:stopOllama', async () => {
    try {
      if (isSandboxMode()) {
        return { ok: false, error: 'Ollama management is disabled in sandbox mode' }
      }
      await ollamaManager.stop()
      return { ok: true }
    } catch (error: any) {
      console.error('[LLM IPC] Stop Ollama failed:', error)
      return { ok: false, error: error.message }
    }
  })
  
  // List installed models
  ipcMain.handle('llm:listModels', async () => {
    try {
      const models = await ollamaManager.listModels()
      return { ok: true, data: models }
    } catch (error: any) {
      console.error('[LLM IPC] List models failed:', error)
      return { ok: false, error: error.message }
    }
  })
  
  // Get model catalog
  ipcMain.handle('llm:getModelCatalog', async () => {
    try {
      return { ok: true, data: MODEL_CATALOG }
    } catch (error: any) {
      console.error('[LLM IPC] Get model catalog failed:', error)
      return { ok: false, error: error.message }
    }
  })
  
  // Get model performance estimate
  ipcMain.handle('llm:getPerformanceEstimate', async (_event, modelId: string) => {
    try {
      const hardware = await hardwareService.detect()
      const modelConfig = getModelConfig(modelId)
      
      if (!modelConfig) {
        return { ok: false, error: 'Model not found in catalog' }
      }
      
      const estimate = hardwareService.estimatePerformance(modelConfig, hardware)
      return { ok: true, data: estimate }
    } catch (error: any) {
      console.error('[LLM IPC] Get performance estimate failed:', error)
      return { ok: false, error: error.message }
    }
  })
  
  // Install/pull model — fire the download, then verify the model exists in Ollama before
  // declaring success. Sends a terminal 'verified' or 'verification_failed' progress event.
  ipcMain.handle('llm:installModel', async (event: IpcMainInvokeEvent, modelId: string) => {
    try {
      if (isSandboxMode()) {
        return {
          ok: false,
          error: 'Model installation is disabled in sandbox mode — install models on the host machine',
        }
      }
      console.log('[LLM IPC] Install started:', modelId)

      // Run pull — progress events go to renderer in real-time.
      // pullModel itself invalidates the listModels cache on stream completion (Patch 1).
      ollamaManager.pullModel(modelId, (progress) => {
        event.sender.send('llm:installProgress', progress)
      }).then(async () => {
        console.log('[LLM IPC] Install stream done, verifying:', modelId)

        // Re-query Ollama to confirm the model is present (cache was cleared by pullModel).
        let verified = false
        try {
          const models = await ollamaManager.listModels()
          verified = models.some((m) => m.name === modelId)
          console.log('[LLM IPC] Verification result for', modelId, ':', verified ? 'FOUND' : 'NOT FOUND')
        } catch (verifyErr: any) {
          console.error('[LLM IPC] Verification listModels failed:', verifyErr)
        }

        // Flush the 3-second status cache so the next llm:getStatus returns fresh data.
        _getStatusCache = null
        console.log('[LLM IPC] Status cache flushed after install of', modelId)

        // Send terminal progress event.
        if (verified) {
          event.sender.send('llm:installProgress', {
            modelId,
            status: 'verified',
            progress: 100,
          })
        } else {
          event.sender.send('llm:installProgress', {
            modelId,
            status: 'verification_failed',
            progress: 0,
            error: `Model "${modelId}" was not found in Ollama after installation. ` +
              'It may still be processing — try refreshing the model list.',
          })
        }
      }).catch((error: any) => {
        console.error('[LLM IPC] Install failed:', modelId, error)
        event.sender.send('llm:installProgress', {
          modelId,
          status: 'error',
          progress: 0,
          error: error.message,
        })
      })

      return { ok: true, message: 'Installation started' }
    } catch (error: any) {
      console.error('[LLM IPC] Install model failed:', error)
      return { ok: false, error: error.message }
    }
  })
  
  // Delete model
  ipcMain.handle('llm:deleteModel', async (_event, modelId: string) => {
    try {
      if (isSandboxMode()) {
        return {
          ok: false,
          error: 'Model deletion is disabled in sandbox mode — manage models on the host machine',
        }
      }
      await ollamaManager.deleteModel(modelId)
      return { ok: true }
    } catch (error: any) {
      console.error('[LLM IPC] Delete model failed:', error)
      return { ok: false, error: error.message }
    }
  })
  
  ipcMain.handle('llm:setAiExecutionContext', async (_event, raw: unknown) => {
    try {
      if (!raw || typeof raw !== 'object') {
        return { ok: false as const, error: 'invalid payload' }
      }
      const o = raw as Record<string, unknown>
      const normalized = normalizeAiExecutionContextInput({
        lane: o.lane as AiExecutionLane,
        model: typeof o.model === 'string' ? o.model : '',
        baseUrl: typeof o.baseUrl === 'string' ? o.baseUrl : undefined,
        handshakeId: typeof o.handshakeId === 'string' ? o.handshakeId : undefined,
        peerDeviceId: typeof o.peerDeviceId === 'string' ? o.peerDeviceId : undefined,
        beapReady: typeof o.beapReady === 'boolean' ? o.beapReady : undefined,
        ollamaDirectReady: typeof o.ollamaDirectReady === 'boolean' ? o.ollamaDirectReady : undefined,
        models: Array.isArray(o.models) ? o.models.map((x) => String(x)) : undefined,
      })
      if (!normalized) {
        return { ok: false as const, error: 'invalid execution context' }
      }
      let toStore = normalized
      if (toStore.lane === 'ollama_direct' && toStore.handshakeId?.trim()) {
        const cand = getSandboxOllamaDirectRouteCandidate(toStore.handshakeId.trim())
        const base = typeof cand?.base_url === 'string' ? cand.base_url.trim().replace(/\/$/, '') : ''
        const peer =
          typeof cand?.peer_host_device_id === 'string' && cand.peer_host_device_id.trim()
            ? cand.peer_host_device_id.trim()
            : toStore.peerDeviceId?.trim()
        if (base) {
          toStore = { ...toStore, baseUrl: base, peerDeviceId: peer }
        }
      }
      writeStoredAiExecutionContext(toStore)
      _getStatusCache = null
      return { ok: true as const }
    } catch (error: any) {
      console.error('[LLM IPC] setAiExecutionContext failed:', error)
      return { ok: false as const, error: error?.message ?? String(error) }
    }
  })

  ipcMain.handle('llm:setActiveModel', async (_event, modelId: string) => {
    try {
      if (isSandboxMode()) {
        return {
          ok: false,
          error:
            'Activating a local Ollama model is disabled in sandbox mode — the active model is managed on the host',
        }
      }
      if (DEBUG_ACTIVE_OLLAMA_MODEL) console.warn('[LLM IPC] setActiveModel requested:', modelId)
      const result = await ollamaManager.setActiveModelPreference(modelId)
      if (result.ok) {
        // Flush the getStatus cache so the next llm:getStatus call returns the updated activeModel
        // immediately — without this, the 3-second TTL cache would serve stale state to
        // BulkOllamaModelSelect and any other component that reads getStatus after a model change.
        _getStatusCache = null
        broadcastActiveOllamaModelChanged(modelId)
        console.log('[LLM IPC] setActiveModel persisted and cache flushed:', modelId?.trim())
      } else {
        console.warn('[LLM IPC] setActiveModel rejected:', modelId?.trim(), result)
      }
      return result
    } catch (error: any) {
      console.error('[LLM IPC] Set active model failed:', error)
      return { ok: false, error: error.message }
    }
  })

  // Strict autosort runtime check — fail-closed gate for inbox Auto-Sort.
  // Returns ResolvedInboxRuntime; renderer must check autosortAllowed before starting.
  ipcMain.handle('llm:resolveAutosortRuntime', async () => {
    try {
      const runtime = await resolveInboxAutosortRuntime()
      return { ok: true, data: runtime }
    } catch (error: any) {
      console.error('[LLM IPC] resolveAutosortRuntime failed:', error)
      return { ok: false, error: error.message }
    }
  })
  
  // Chat with model
  ipcMain.handle('llm:chat', async (_event, request: ChatRequest) => {
    try {
      if (isSandboxMode()) {
        return {
          ok: false,
          error:
            'Sandbox inference over HTTP is removed. Create an internal handshake in the Handshakes panel; inference will use the BEAP channel.',
        }
      }

      let modelId = request.modelId
      if (!modelId) {
        const resolved = await ollamaManager.getEffectiveChatModelName()
        if (!resolved) {
          return { ok: false, error: 'No models installed. Install a model in LLM Settings first.' }
        }
        modelId = resolved
      }
      const response = await ollamaManager.chat(modelId, request.messages)
      return { ok: true, data: response }
    } catch (error: any) {
      console.error('[LLM IPC] Chat failed:', error)
      return { ok: false, error: error.message }
    }
  })
  
  console.log('[LLM IPC] Handlers registered successfully')
}
