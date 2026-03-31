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
  ipcMain.handle('llm:getStatus', async () => {
    try {
      const status = await ollamaManager.getStatus()
      return { ok: true, data: status }
    } catch (error: any) {
      console.error('[LLM IPC] Get status failed:', error)
      return { ok: false, error: error.message }
    }
  })
  
  // Start Ollama server
  ipcMain.handle('llm:startOllama', async () => {
    try {
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
  
  // Install/pull model
  ipcMain.handle('llm:installModel', async (event: IpcMainInvokeEvent, modelId: string) => {
    try {
      console.log('[LLM IPC] Installing model:', modelId)
      
      // Start async pull with progress updates
      ollamaManager.pullModel(modelId, (progress) => {
        // Send progress updates to renderer
        event.sender.send('llm:installProgress', progress)
      }).catch((error) => {
        event.sender.send('llm:installProgress', {
          modelId,
          status: 'error',
          progress: 0,
          error: error.message
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
      await ollamaManager.deleteModel(modelId)
      return { ok: true }
    } catch (error: any) {
      console.error('[LLM IPC] Delete model failed:', error)
      return { ok: false, error: error.message }
    }
  })
  
  ipcMain.handle('llm:setActiveModel', async (_event, modelId: string) => {
    try {
      if (DEBUG_ACTIVE_OLLAMA_MODEL) console.warn('[LLM IPC] setActiveModel requested:', modelId)
      const result = await ollamaManager.setActiveModelPreference(modelId)
      if (result.ok) broadcastActiveOllamaModelChanged(modelId)
      if (DEBUG_ACTIVE_OLLAMA_MODEL && result.ok) console.warn('[LLM IPC] setActiveModel persisted:', modelId?.trim())
      return result
    } catch (error: any) {
      console.error('[LLM IPC] Set active model failed:', error)
      return { ok: false, error: error.message }
    }
  })
  
  // Chat with model
  ipcMain.handle('llm:chat', async (_event, request: ChatRequest) => {
    try {
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
