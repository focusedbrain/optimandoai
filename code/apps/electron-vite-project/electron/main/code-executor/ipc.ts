/**
 * Code Executor IPC Handlers
 * 
 * Registers IPC handlers for the code execution flow
 */

import { ipcMain, shell, BrowserWindow } from 'electron'
import {
  getCodeGenerationSystemPrompt,
  executeGeneratedCode,
  setCodeFolderPath,
  getCodeFolderPath,
  listGeneratedFiles,
  cleanupOldFiles,
  ensureCodeFolder,
  CodeExecutionResult
} from './index'
import { ollamaManager } from '../llm/ollama-manager'
import { ChatMessage } from '../llm/types'

/**
 * Register all code execution IPC handlers
 */
export function registerCodeExecutorHandlers() {
  console.log('[CodeExecutor IPC] Registering handlers...')
  
  // Get current code folder path
  ipcMain.handle('code-executor:getFolder', async () => {
    try {
      return { ok: true, data: getCodeFolderPath() }
    } catch (error: any) {
      return { ok: false, error: error.message }
    }
  })
  
  // Set code folder path
  ipcMain.handle('code-executor:setFolder', async (_event, folderPath: string) => {
    try {
      setCodeFolderPath(folderPath)
      return { ok: true, data: folderPath }
    } catch (error: any) {
      return { ok: false, error: error.message }
    }
  })
  
  // List generated files
  ipcMain.handle('code-executor:listFiles', async () => {
    try {
      const files = listGeneratedFiles()
      return { ok: true, data: files }
    } catch (error: any) {
      return { ok: false, error: error.message }
    }
  })
  
  // Cleanup old files
  ipcMain.handle('code-executor:cleanup', async (_event, olderThanDays: number = 7) => {
    try {
      const deletedCount = cleanupOldFiles(olderThanDays)
      return { ok: true, data: { deletedCount } }
    } catch (error: any) {
      return { ok: false, error: error.message }
    }
  })
  
  // Get system prompt for code generation
  ipcMain.handle('code-executor:getSystemPrompt', async () => {
    try {
      return { ok: true, data: getCodeGenerationSystemPrompt() }
    } catch (error: any) {
      return { ok: false, error: error.message }
    }
  })
  
  // Execute the full code generation + execution flow
  ipcMain.handle('code-executor:run', async (_event, payload: { 
    query: string
    modelId?: string
    outputFolder?: string
  }): Promise<{ ok: boolean; data?: CodeExecutionResult; error?: string }> => {
    try {
      const { query, modelId, outputFolder } = payload
      
      console.log('[CodeExecutor] Starting code generation flow...')
      console.log('[CodeExecutor] Query:', query)
      
      // Step 1: Get available model
      let activeModelId = modelId
      if (!activeModelId) {
        const models = await ollamaManager.listModels()
        if (models.length === 0) {
          return { 
            ok: false, 
            error: 'No AI models installed. Please install a model first.' 
          }
        }
        activeModelId = models[0].name
      }
      
      console.log('[CodeExecutor] Using model:', activeModelId)
      
      // Step 2: Generate code using AI
      const systemPrompt = getCodeGenerationSystemPrompt()
      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: query }
      ]
      
      console.log('[CodeExecutor] Calling AI for code generation...')
      const aiResponse = await ollamaManager.chat(activeModelId, messages)
      
      if (!aiResponse || !aiResponse.content) {
        return { 
          ok: false, 
          error: 'AI did not return a response' 
        }
      }
      
      console.log('[CodeExecutor] AI response received, executing code...')
      
      // Step 3: Execute the generated code
      const result = await executeGeneratedCode(aiResponse.content, outputFolder)
      
      console.log('[CodeExecutor] Execution complete:', result.success ? 'SUCCESS' : 'FAILED')
      
      return { ok: true, data: result }
      
    } catch (error: any) {
      console.error('[CodeExecutor] Error:', error)
      return { ok: false, error: error.message }
    }
  })
  
  // Open mini app in browser
  ipcMain.handle('code-executor:openMiniApp', async (_event, filePath: string) => {
    try {
      await shell.openPath(filePath)
      return { ok: true }
    } catch (error: any) {
      return { ok: false, error: error.message }
    }
  })
  
  // Open mini app in Electron window
  ipcMain.handle('code-executor:openMiniAppWindow', async (_event, filePath: string) => {
    try {
      const miniAppWindow = new BrowserWindow({
        width: 800,
        height: 600,
        title: 'Mini App - Generated',
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true
        }
      })
      
      await miniAppWindow.loadFile(filePath)
      return { ok: true }
    } catch (error: any) {
      return { ok: false, error: error.message }
    }
  })
  
  // Open folder in file explorer
  ipcMain.handle('code-executor:openFolder', async () => {
    try {
      const folder = ensureCodeFolder()
      await shell.openPath(folder)
      return { ok: true }
    } catch (error: any) {
      return { ok: false, error: error.message }
    }
  })
  
  console.log('[CodeExecutor IPC] Handlers registered successfully')
}
