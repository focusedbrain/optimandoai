/**
 * Ollama Manager
 * Manages Ollama runtime: installation, lifecycle, model operations
 */

import { exec, spawn, ChildProcess } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import fs from 'fs'
import { app } from 'electron'
import { OllamaStatus, InstalledModel, ChatMessage, ChatResponse, DownloadProgress } from './types'

const execAsync = promisify(exec)

export class OllamaManager {
  private ollamaPath: string = ''
  private ollamaPort: number = 11434
  private process: ChildProcess | null = null
  private baseUrl: string = ''
  private downloadProgress: any = null
  
  constructor() {
    this.ollamaPort = 11434
    this.baseUrl = `http://127.0.0.1:${this.ollamaPort}`
    this.initializeOllamaPath()
  }
  
  /**
   * Initialize Ollama path based on bundled resources or system PATH
   */
  private initializeOllamaPath() {
    try {
      const platform = process.platform
      
      let binaryName = 'ollama'
      if (platform === 'win32') {
        binaryName = 'ollama.exe'
      }
      
      // 1. Try bundled Ollama first
      const resourcesPath = process.resourcesPath || app.getAppPath()
      const bundledPath = path.join(resourcesPath, 'ollama', binaryName)
      
      if (fs.existsSync(bundledPath)) {
        this.ollamaPath = bundledPath
        console.log('[Ollama] Using bundled Ollama:', bundledPath)
        return
      }
      
      // 2. Try standard Windows installation path
      if (platform === 'win32') {
        const localAppData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local')
        const windowsPath = path.join(localAppData, 'Programs', 'Ollama', 'ollama.exe')
        
        if (fs.existsSync(windowsPath)) {
          this.ollamaPath = windowsPath
          console.log('[Ollama] Using Windows installation:', windowsPath)
          return
        }
      }
      
      // 3. Try standard macOS installation path
      if (platform === 'darwin') {
        const macPath = '/usr/local/bin/ollama'
        if (fs.existsSync(macPath)) {
          this.ollamaPath = macPath
          console.log('[Ollama] Using macOS installation:', macPath)
          return
        }
      }
      
      // 4. Fallback: assume Ollama is in system PATH
      this.ollamaPath = 'ollama'
      console.log('[Ollama] Using system Ollama from PATH')
    } catch (error) {
      console.error('[Ollama] Failed to initialize path:', error)
      this.ollamaPath = 'ollama'
    }
  }
  
  /**
   * Check if Ollama is installed
   */
  async checkInstalled(): Promise<boolean> {
    try {
      const version = await this.getVersion()
      return version !== null
    } catch (error) {
      return false
    }
  }
  
  /**
   * Get Ollama version
   */
  async getVersion(): Promise<string | null> {
    try {
      const { stdout } = await execAsync(`"${this.ollamaPath}" --version`)
      const match = stdout.match(/ollama version is (\d+\.\d+\.\d+)/)
      if (match) {
        return match[1]
      }
      // Fallback: return raw output
      return stdout.trim()
    } catch (error) {
      console.error('[Ollama] Failed to get version:', error)
      return null
    }
  }
  
  /**
   * Start Ollama server
   */
  async start(): Promise<void> {
    if (await this.isRunning()) {
      console.log('[Ollama] Server already running')
      return
    }
    
    try {
      console.log('[Ollama] Starting server...')
      
      // Start Ollama serve in background
      this.process = spawn(this.ollamaPath, ['serve'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      })
      
      this.process.unref()
      
      // Wait for server to be ready
      await this.waitForServer(30000) // 30 second timeout
      
      console.log('[Ollama] Server started successfully')
    } catch (error) {
      console.error('[Ollama] Failed to start server:', error)
      throw new Error('Failed to start Ollama server')
    }
  }
  
  /**
   * Wait for Ollama server to be ready
   */
  private async waitForServer(timeoutMs: number): Promise<void> {
    const startTime = Date.now()
    
    while (Date.now() - startTime < timeoutMs) {
      if (await this.isRunning()) {
        return
      }
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    
    throw new Error('Ollama server did not start within timeout')
  }
  
  /**
   * Check if Ollama server is running
   */
  async isRunning(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(2000)
      })
      return response.ok
    } catch (error) {
      return false
    }
  }
  
  /**
   * Stop Ollama server
   */
  async stop(): Promise<void> {
    if (this.process) {
      this.process.kill()
      this.process = null
    }
    
    // Also try to kill via system command
    try {
      const platform = process.platform
      if (platform === 'win32') {
        await execAsync('taskkill /F /IM ollama.exe /T')
      } else {
        await execAsync('pkill -f ollama')
      }
    } catch (error) {
      // Process may not be running, ignore error
    }
  }
  
  /**
   * Get complete Ollama status
   */
  async getStatus(): Promise<OllamaStatus> {
    const installed = await this.checkInstalled()
    const running = await this.isRunning()
    const version = installed ? await this.getVersion() : undefined
    
    let modelsInstalled: InstalledModel[] = []
    let activeModel: string | undefined
    
    if (running) {
      modelsInstalled = await this.listModels()
      // Active model would be stored in config
      // For now, just mark first model as active if any exist
      if (modelsInstalled.length > 0) {
        modelsInstalled[0].isActive = true
        activeModel = modelsInstalled[0].name
      }
    }
    
    return {
      installed,
      running,
      version: version || undefined,
      port: this.ollamaPort,
      modelsInstalled,
      activeModel
    }
  }
  
  /**
   * List installed models
   */
  async listModels(): Promise<InstalledModel[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      })
      
      if (!response.ok) {
        console.warn('[Ollama] Failed to list models:', response.statusText)
        return []
      }
      
      const data = await response.json()
      const models = data.models || []
      
      return models.map((m: any) => ({
        name: m.name,
        size: m.size || 0,
        modified: m.modified_at || new Date().toISOString(),
        digest: m.digest || '',
        isActive: false // Will be set by caller based on config
      }))
    } catch (error) {
      console.error('[Ollama] Error listing models:', error)
      return []
    }
  }
  
  /**
   * Pull/download a model
   */
  async pullModel(
    modelId: string, 
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<void> {
    try {
      console.log('[Ollama] Pulling model:', modelId)
      
      const response = await fetch(`${this.baseUrl}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelId, stream: true })
      })
      
      if (!response.ok) {
        throw new Error(`Failed to pull model: ${response.statusText}`)
      }
      
      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('No response body')
      }
      
      const decoder = new TextDecoder()
      let buffer = ''
      
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        
        for (const line of lines) {
          if (!line.trim()) continue
          
          try {
            const json = JSON.parse(line)
            
            if (onProgress) {
              const progress: DownloadProgress = {
                modelId,
                status: json.status || 'downloading',
                progress: json.completed && json.total 
                  ? Math.round((json.completed / json.total) * 100) 
                  : 0,
                completed: json.completed,
                total: json.total,
                digest: json.digest
              }
              this.downloadProgress = progress // Store for polling
              onProgress(progress)
            }
            
            if (json.status === 'success' || json.status?.includes('complete')) {
              console.log('[Ollama] Model pull completed:', modelId)
              return
            }
          } catch (e) {
            // Skip invalid JSON lines
          }
        }
      }
      
      console.log('[Ollama] Model pull completed:', modelId)
    } catch (error) {
      console.error('[Ollama] Model pull failed:', error)
      throw error
    }
  }
  
  /**
   * Delete a model
   */
  async deleteModel(modelId: string): Promise<void> {
    try {
      console.log('[Ollama] Deleting model:', modelId)
      
      const response = await fetch(`${this.baseUrl}/api/delete`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelId })
      })
      
      if (!response.ok) {
        throw new Error(`Failed to delete model: ${response.statusText}`)
      }
      
      console.log('[Ollama] Model deleted:', modelId)
    } catch (error) {
      console.error('[Ollama] Model deletion failed:', error)
      throw error
    }
  }
  
  /**
   * Chat with a model
   */
  async chat(modelId: string, messages: ChatMessage[]): Promise<ChatResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages,
          stream: false
        }),
        signal: AbortSignal.timeout(300000) // 5 minute timeout for larger models
      })
      
      if (!response.ok) {
        throw new Error(`Chat request failed: ${response.statusText}`)
      }
      
      const data = await response.json()
      
      return {
        content: data.message?.content || '',
        model: data.model || modelId,
        done: data.done || false,
        totalDuration: data.total_duration,
        loadDuration: data.load_duration,
        promptEvalCount: data.prompt_eval_count,
        evalCount: data.eval_count
      }
    } catch (error) {
      console.error('[Ollama] Chat failed:', error)
      throw error
    }
  }
  
  /**
   * Get current download progress (for polling)
   */
  getDownloadProgress(): any {
    return this.downloadProgress
  }
}

// Singleton instance
export const ollamaManager = new OllamaManager()
