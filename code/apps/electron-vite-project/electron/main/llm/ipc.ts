/**
 * LLM IPC Handlers
 * Electron IPC interface for renderer process to communicate with LLM services
 */

import { ipcMain, IpcMainInvokeEvent, dialog } from 'electron'
import { hardwareService } from './hardware'
import { localLlmManager } from './local-llm-manager'
import { getGpuStatus, getGpuInferenceStatusRemote } from '../inference/gpuStatus'
import { isGpuInferenceAvailable } from '../inference/inferenceGate'
import {
  isCpuSafeModel,
  resolveInferenceCapabilityFromInput,
} from '../inference/inferenceCapabilityResolver'
import {
  isEffectiveSandboxSideForAiExecution,
  fallbackFromListSandbox,
} from './resolveAiExecutionContext'
import { DEBUG_ACTIVE_LOCAL_MODEL } from './activeLocalModelStore'
import { broadcastActiveLocalModelChanged } from './broadcastActiveModel'
import { broadcastModelsInstalledChanged } from './broadcastModelsChanged'
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
import { peekHostGpuInferenceAvailableFromRelay } from '../internalInference/p2pEndpointRepair'

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
      const status = await localLlmManager.getStatus()
      const { augmentOllamaStatusWithWrChatModels } = await import('./handshakeAvailableModelsCompute')
      const augmented = await augmentOllamaStatusWithWrChatModels(status)
      const result = { ok: true, data: augmented }
      _getStatusCache = { at: Date.now(), result }
      return result
    } catch (error: any) {
      console.error('[LLM IPC] Get status failed:', error)
      return { ok: false, error: error.message }
    }
  })

  /** GPU / offload diagnostics for UI (cached ~60s inside getGpuStatus). */
  ipcMain.handle('llm:getGpuStatus', async () => {
    try {
      const data = await getGpuStatus()
      return { ok: true, data }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error ?? 'unknown')
      console.error('[LLM IPC] getGpuStatus failed:', error)
      return { ok: false, error: msg }
    }
  })
  
  // Start Ollama server
  ipcMain.handle('llm:startOllama', async () => {
    try {
      if (isSandboxMode()) {
        return { ok: false, error: 'Local LLM management is disabled in sandbox mode' }
      }
      await localLlmManager.start()
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
        return { ok: false, error: 'Local LLM management is disabled in sandbox mode' }
      }
      await localLlmManager.stop()
      return { ok: true }
    } catch (error: any) {
      console.error('[LLM IPC] Stop Ollama failed:', error)
      return { ok: false, error: error.message }
    }
  })
  
  // List installed models
  ipcMain.handle('llm:listModels', async () => {
    try {
      const models = await localLlmManager.listModels()
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
      localLlmManager.pullModel(modelId, (progress) => {
        event.sender.send('llm:installProgress', progress)
      }).then(async () => {
        console.log('[LLM IPC] Install stream done, verifying:', modelId)

        // Re-query Ollama to confirm the model is present (cache was cleared by pullModel).
        let verified = false
        try {
          const models = await localLlmManager.listModels()
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
            error: `Model "${modelId}" was not found after installation. ` +
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
      await localLlmManager.deleteModel(modelId)
      _getStatusCache = null
      broadcastModelsInstalledChanged()
      return { ok: true }
    } catch (error: any) {
      console.error('[LLM IPC] Delete model failed:', error)
      return { ok: false, error: error.message }
    }
  })

  /** High-assurance import: OS file picker → copy GGUF into models dir (no network). */
  ipcMain.handle('llm:importModelFromPicker', async (event: IpcMainInvokeEvent) => {
    try {
      if (isSandboxMode()) {
        return {
          ok: false,
          error: 'Model installation is disabled in sandbox mode — install models on the host machine',
        }
      }
      const pick = await dialog.showOpenDialog({
        title: 'Import GGUF model',
        properties: ['openFile'],
        filters: [{ name: 'GGUF Models', extensions: ['gguf'] }],
      })
      if (pick.canceled || !pick.filePaths[0]) {
        return { ok: false, cancelled: true as const }
      }
      const sourcePath = pick.filePaths[0]
      let overwrite = false
      try {
        const result = await localLlmManager.importModelFromFile(sourcePath, {
          onProgress: (progress) => event.sender.send('llm:installProgress', progress),
        })
        _getStatusCache = null
        broadcastModelsInstalledChanged({ modelId: result.modelId, sha256: result.sha256 })
        event.sender.send('llm:installProgress', {
          modelId: result.modelId,
          status: 'verified',
          progress: 100,
          digest: result.sha256,
        })
        return { ok: true as const, data: result }
      } catch (err: unknown) {
        const e = err as Error & { code?: string; modelId?: string }
        if (e.code !== 'MODEL_EXISTS') throw err
        const confirm = await dialog.showMessageBox({
          type: 'warning',
          buttons: ['Cancel', 'Replace'],
          defaultId: 0,
          cancelId: 0,
          title: 'Replace existing model?',
          message: `A model named "${e.modelId ?? 'this file'}" is already installed.`,
          detail: 'Replacing will delete the existing GGUF in your models folder.',
        })
        if (confirm.response !== 1) {
          return { ok: false, cancelled: true as const }
        }
        overwrite = true
        const result = await localLlmManager.importModelFromFile(sourcePath, {
          overwrite,
          onProgress: (progress) => event.sender.send('llm:installProgress', progress),
        })
        _getStatusCache = null
        broadcastModelsInstalledChanged({ modelId: result.modelId, sha256: result.sha256 })
        event.sender.send('llm:installProgress', {
          modelId: result.modelId,
          status: 'verified',
          progress: 100,
          digest: result.sha256,
        })
        return { ok: true as const, data: result }
      }
    } catch (error: any) {
      console.error('[LLM IPC] importModelFromPicker failed:', error)
      event.sender.send('llm:installProgress', {
        modelId: '',
        status: 'error',
        progress: 0,
        error: error.message,
      })
      return { ok: false, error: error.message }
    }
  })

  /** Convenience HTTPS download from allowlisted Hugging Face hosts only. */
  ipcMain.handle('llm:downloadModelFromUrl', async (event: IpcMainInvokeEvent, url: string) => {
    try {
      if (isSandboxMode()) {
        return {
          ok: false,
          error: 'Model installation is disabled in sandbox mode — install models on the host machine',
        }
      }
      const trimmed = typeof url === 'string' ? url.trim() : ''
      if (!trimmed) return { ok: false, error: 'url is required' }

      localLlmManager
        .downloadModelFromUrl(trimmed, (progress) => {
          event.sender.send('llm:installProgress', progress)
        })
        .then((result) => {
          _getStatusCache = null
          broadcastModelsInstalledChanged({ modelId: result.modelId, sha256: result.sha256 })
          event.sender.send('llm:installProgress', {
            modelId: result.modelId,
            status: 'verified',
            progress: 100,
            digest: result.sha256,
          })
        })
        .catch((error: Error) => {
          event.sender.send('llm:installProgress', {
            modelId: '',
            status: 'error',
            progress: 0,
            error: error.message,
          })
        })

      return { ok: true, message: 'Download started' }
    } catch (error: any) {
      console.error('[LLM IPC] downloadModelFromUrl failed:', error)
      return { ok: false, error: error.message }
    }
  })

  ipcMain.handle('llm:cancelModelDownload', async () => {
    try {
      localLlmManager.cancelModelDownload()
      return { ok: true }
    } catch (error: any) {
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
        selectionSource: o.selectionSource === 'auto' ? undefined : 'user',
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
      if (!isSandboxMode() && toStore.lane === 'local') {
        const pref = await localLlmManager.setActiveModelPreference(toStore.model)
        if (!pref.ok) {
          return { ok: false as const, error: pref.error }
        }
        _getStatusCache = null
        broadcastActiveLocalModelChanged(toStore.model)
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
            'Activating a local model is disabled in sandbox mode — the active model is managed on the host',
        }
      }
      if (DEBUG_ACTIVE_LOCAL_MODEL) console.warn('[LLM IPC] setActiveModel requested:', modelId)
      const result = await localLlmManager.setActiveModelPreference(modelId)
      if (result.ok) {
        // Flush the getStatus cache so the next llm:getStatus call returns the updated activeModel
        // immediately — without this, the 3-second TTL cache would serve stale state to
        // BulkOllamaModelSelect and any other component that reads getStatus after a model change.
        _getStatusCache = null
        broadcastActiveLocalModelChanged(modelId)
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
        const resolved = await localLlmManager.getEffectiveChatModelName()
        if (!resolved) {
          return { ok: false, error: 'No models installed. Install a model in LLM Settings first.' }
        }
        modelId = resolved
      }
      const response = await localLlmManager.chat(modelId, request.messages)
      return { ok: true, data: response }
    } catch (error: any) {
      console.error('[LLM IPC] Chat failed:', error)
      return { ok: false, error: error.message }
    }
  })
  
  /**
   * Tier-ranked inference capability for top-chat badge and routing decisions.
   *
   * Resolution (in order):
   *   1. remote-host  sandbox + healthy paired host
   *      → also probes host Ollama GPU status so badge shows GPU/CPU, not "Remote"
   *   2. local-gpu    local Ollama with full GPU offload
   *   3. local-cpu    local Ollama + CPU-safe model (or WRDESK_ALLOW_CPU_INFERENCE=1)
   *   4. unavailable  none of the above
   *
   * Sandbox devices must call this for their badge — NOT getGpuStatus(),
   * which probes the local (Linux) machine and maps to "GPU Issue".
   */
  ipcMain.handle('llm:resolveInferenceCapability', async () => {
    try {
      const [isSandbox, localGpuAvailable, modelName] = await Promise.all([
        isEffectiveSandboxSideForAiExecution(),
        isGpuInferenceAvailable(),
        localLlmManager.getEffectiveChatModelName(),
      ])

      const allowCpuOverride =
        (process.env.WRDESK_ALLOW_CPU_INFERENCE ?? '').trim() === '1' ||
        /^true$/i.test(process.env.WRDESK_ALLOW_CPU_INFERENCE ?? '')

      let remoteContext: {
        modelName?: string | null
        baseUrl?: string | null
        handshakeId?: string | null
        peerDeviceId?: string | null
      } | null = null
      // gpuAvailable is local by default; overridden below for sandbox path.
      let gpuAvailable = localGpuAvailable

      if (isSandbox) {
        const fb = await fallbackFromListSandbox()
        if (fb) {
          remoteContext = {
            modelName: fb.model,
            baseUrl: fb.baseUrl ?? null,
            handshakeId: fb.handshakeId ?? null,
            peerDeviceId: fb.peerDeviceId ?? null,
          }

          const hostBaseUrl = (fb.baseUrl ?? '').trim().replace(/\/$/, '')
          const sealedBeapReady = fb.lane === 'beap' && fb.beapReady !== false && !hostBaseUrl
          if (hostBaseUrl) {
            const hostGpu = await getGpuInferenceStatusRemote(hostBaseUrl, fb.model ?? '')
            gpuAvailable = hostGpu.available
          } else if (sealedBeapReady || (fb.lane === 'beap' && fb.beapReady !== false)) {
            const hid = (fb.handshakeId ?? '').trim()
            const relayGpu = hid ? peekHostGpuInferenceAvailableFromRelay(hid) : null
            gpuAvailable = relayGpu === true
          } else {
            gpuAvailable = false
          }
        }
      }

      // platforms without NVIDIA sets localLlmRunning:false even if llama-server IS running.
      // Do an independent lightweight probe so CPU-safe models aren't blocked.
      let localLlmRunning = localGpuAvailable // gpu probe reaching server implies it is running
      if (!localLlmRunning && !isSandbox) {
        try {
          const base = localLlmManager.getBaseUrl().replace(/\/$/, '')
          const r = await fetch(`${base}/v1/models`, { signal: AbortSignal.timeout(3_000) })
          localLlmRunning = r.ok
        } catch {
          localLlmRunning = false
        }
      }

      const result = resolveInferenceCapabilityFromInput({
        isSandbox,
        remoteContext,
        gpuAvailable,
        ollamaRunning: localLlmRunning,
        modelName: modelName ?? null,
        allowCpuOverride,
      })
      return { ok: true as const, data: result }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err ?? 'unknown')
      console.error('[LLM IPC] resolveInferenceCapability failed:', err)
      return { ok: false as const, error: msg }
    }
  })

  ipcMain.handle(
    'llm:modeModelWarmOnTrigger',
    async (_event, payload: { modeId?: string; trigger?: string }) => {
      try {
        const modeId = typeof payload?.modeId === 'string' ? payload.modeId.trim() : ''
        const triggerRaw = payload?.trigger
        const trigger =
          triggerRaw === 'interval' || triggerRaw === 'speech_bubble' ? triggerRaw : null
        if (!modeId || !trigger) {
          return { ok: false as const, error: 'invalid payload' }
        }
        const { scheduleModeModelWarmOnTrigger } = await import('./modeModelWarmupTrigger')
        scheduleModeModelWarmOnTrigger(modeId, trigger)
        return { ok: true as const }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err ?? 'unknown')
        return { ok: false as const, error: msg }
      }
    },
  )

  console.log('[LLM IPC] Handlers registered successfully')
}
