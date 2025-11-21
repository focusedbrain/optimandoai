/**
 * LLM IPC Handlers
 * Exposes LLM services to renderer process via IPC
 */

import { ipcMain, BrowserWindow } from 'electron'
import { hardwareService } from './hardware'
import { ollamaManager } from './ollama-manager'
import { llmClientService } from './client'
import { llmConfigService } from './config'
import type { ChatCompletionRequest } from './types'

/**
 * Register all LLM-related IPC handlers
 * @param win Main browser window for sending progress events
 */
export function registerLlmHandlers(win: BrowserWindow) {
  /**
   * Check system hardware capabilities
   */
  ipcMain.handle('llm:checkHardware', async () => {
    try {
      return await hardwareService.checkHardware()
    } catch (error: any) {
      console.error('[LLM IPC] Hardware check failed:', error)
      throw error
    }
  })
  
  /**
   * Get current LLM runtime status
   */
  ipcMain.handle('llm:getStatus', async () => {
    try {
      return await ollamaManager.getStatus()
    } catch (error: any) {
      console.error('[LLM IPC] Status check failed:', error)
      throw error
    }
  })
  
  /**
   * Start Ollama server
   */
  ipcMain.handle('llm:startOllama', async () => {
    try {
      await ollamaManager.startOllama()
      return { success: true }
    } catch (error: any) {
      console.error('[LLM IPC] Failed to start Ollama:', error)
      throw error
    }
  })
  
  /**
   * Stop Ollama server
   */
  ipcMain.handle('llm:stopOllama', async () => {
    try {
      await ollamaManager.stopOllama()
      return { success: true }
    } catch (error: any) {
      console.error('[LLM IPC] Failed to stop Ollama:', error)
      throw error
    }
  })
  
  /**
   * Download a model from Ollama registry
   * Sends progress events to renderer
   */
  ipcMain.handle('llm:downloadModel', async (_event, modelName: string) => {
    try {
      console.log('[LLM IPC] Starting model download:', modelName)
      
      await ollamaManager.pullModel(modelName, (progress, status) => {
        // Send progress updates to renderer
        win.webContents.send('llm:downloadProgress', { 
          progress: Math.round(progress), 
          status,
          modelName
        })
      })
      
      console.log('[LLM IPC] Model download completed:', modelName)
      return { success: true, modelName }
    } catch (error: any) {
      console.error('[LLM IPC] Model download failed:', error)
      throw error
    }
  })
  
  /**
   * List available models
   */
  ipcMain.handle('llm:listModels', async () => {
    try {
      return await ollamaManager.listModels()
    } catch (error: any) {
      console.error('[LLM IPC] Failed to list models:', error)
      throw error
    }
  })
  
  /**
   * Send a chat completion request
   */
  ipcMain.handle('llm:chat', async (_event, request: ChatCompletionRequest) => {
    try {
      console.log('[LLM IPC] Chat request received')
      return await llmClientService.chat(request)
    } catch (error: any) {
      console.error('[LLM IPC] Chat request failed:', error)
      throw error
    }
  })
  
  /**
   * Check if LLM client is ready
   */
  ipcMain.handle('llm:isReady', async () => {
    try {
      return await llmClientService.isReady()
    } catch (error: any) {
      console.error('[LLM IPC] Ready check failed:', error)
      return false
    }
  })
  
  /**
   * Get current LLM configuration
   */
  ipcMain.handle('llm:getConfig', async () => {
    try {
      return llmConfigService.get()
    } catch (error: any) {
      console.error('[LLM IPC] Failed to get config:', error)
      throw error
    }
  })
  
  /**
   * Update LLM configuration
   */
  ipcMain.handle('llm:updateConfig', async (_event, updates: any) => {
    try {
      console.log('[LLM IPC] Updating config:', updates)
      await llmConfigService.save(updates)
      
      // Reload client with new config
      const config = llmConfigService.get()
      llmClientService.setClient(config)
      
      return { success: true, config }
    } catch (error: any) {
      console.error('[LLM IPC] Failed to update config:', error)
      throw error
    }
  })
  
  console.log('[LLM IPC] All handlers registered successfully')
}

