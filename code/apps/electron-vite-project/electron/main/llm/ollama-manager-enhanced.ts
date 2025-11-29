/**
 * Ollama Manager - Enhanced with Diagnostics and Auto-Fallback
 * Manages Ollama runtime: installation, lifecycle, model operations
 * Includes: Hardware diagnostics, automatic CPU fallback, hang protection
 */

import { exec, spawn, ChildProcess } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import fs from 'fs'
import { app } from 'electron'
import { OllamaStatus, InstalledModel, ChatMessage, ChatResponse, DownloadProgress } from './types'
import { hardwareDiagnostics, type HardwareDiagnostics } from './hardware-diagnostics'
import { ollamaLogger } from './rotating-logger'

const execAsync = promisify(exec)

interface ModelLoadContext {
  modelId: string
  startTime: number
  timeout: NodeJS.Timeout | null
  fallbackAttempted: boolean
}

export class OllamaManager {
  private ollamaPath: string = ''
  private ollamaPort: number = 11434
  private process: ChildProcess | null = null
  private baseUrl: string = ''
  private downloadProgress: any = null
  private diagnostics: HardwareDiagnostics | null = null
  private currentLoadContext: ModelLoadContext | null = null
  private cpuFallbackMode: boolean = false
  private healthCheckPassed: boolean = false
  
  constructor() {
    this.ollamaPort = 11434
    this.baseUrl = `http://127.0.0.1:${this.ollamaPort}`
    this.initializeOllamaPath()
  }
  
  /**
   * Initialize with full diagnostics
   */
  async initialize(): Promise<void> {
    ollamaLogger.log('INFO', 'OllamaManager', '===== INITIALIZING OLLAMA MANAGER =====')
    
    // Run hardware diagnostics
    try {
      this.diagnostics = await hardwareDiagnostics.diagnose()
      
      // Check if we should force CPU mode
      if (!this.diagnostics.recommendations.useGPU) {
        ollamaLogger.log('WARN', 'OllamaManager', 
          'GPU/Vulkan unhealthy - will use CPU-only mode', 
          { issues: this.diagnostics.vulkan.issues }
        )
        this.cpuFallbackMode = true
      }
      
      this.healthCheckPassed = true
    } catch (error: any) {
      ollamaLogger.log('ERROR', 'OllamaManager', 'Hardware diagnostics failed', { error: error.message })
      // Continue with conservative defaults
      this.cpuFallbackMode = true
      this.healthCheckPassed = false
    }
    
    ollamaLogger.log('INFO', 'OllamaManager', 'Initialization complete', {
      cpuFallbackMode: this.cpuFallbackMode,
      healthCheckPassed: this.healthCheckPassed
    })
  }
  
  /**
   * Get current diagnostics
   */
  getDiagnostics(): HardwareDiagnostics | null {
    return this.diagnostics
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
        ollamaLogger.log('INFO', 'OllamaManager', `Using bundled Ollama: ${bundledPath}`)
        return
      }
      
      // 2. Try standard Windows installation path
      if (platform === 'win32') {
        const localAppData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local')
        const windowsPath = path.join(localAppData, 'Programs', 'Ollama', 'ollama.exe')
        
        if (fs.existsSync(windowsPath)) {
          this.ollamaPath = windowsPath
          ollamaLogger.log('INFO', 'OllamaManager', `Using Windows installation: ${windowsPath}`)
          return
        }
      }
      
      // 3. Try standard macOS installation path
      if (platform === 'darwin') {
        const macPath = '/usr/local/bin/ollama'
        if (fs.existsSync(macPath)) {
          this.ollamaPath = macPath
          ollamaLogger.log('INFO', 'OllamaManager', `Using macOS installation: ${macPath}`)
          return
        }
      }
      
      // 4. Fallback: assume Ollama is in system PATH
      this.ollamaPath = 'ollama'
      ollamaLogger.log('INFO', 'OllamaManager', 'Using system Ollama from PATH')
    } catch (error: any) {
      ollamaLogger.log('ERROR', 'OllamaManager', 'Failed to initialize path', { error: error.message })
      this.ollamaPath = 'ollama'
    }
  }
  
  /**
   * Check if Ollama is installed
   */
  async checkInstalled(): Promise<boolean> {
    try {
      const version = await this.getVersion()
      const installed = version !== null
      ollamaLogger.log('INFO', 'OllamaManager', `Ollama installed: ${installed}`, { version })
      return installed
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
      return stdout.trim()
    } catch (error: any) {
      ollamaLogger.log('ERROR', 'OllamaManager', 'Failed to get version', { error: error.message })
      return null
    }
  }
  
  /**
   * Start Ollama server with auto-fallback
   */
  async start(): Promise<void> {
    if (await this.isRunning()) {
      ollamaLogger.log('INFO', 'OllamaManager', 'Server already running')
      return
    }
    
    try {
      ollamaLogger.log('INFO', 'OllamaManager', 'Starting Ollama server...', {
        cpuFallbackMode: this.cpuFallbackMode,
        diagnostics: this.diagnostics?.recommendations
      })
      
      // Prepare environment variables
      const env = { ...process.env }
      
      // Force CPU mode if diagnostics indicate problems
      if (this.cpuFallbackMode) {
        env.OLLAMA_NO_GPU = '1'
        ollamaLogger.log('WARN', 'OllamaManager', 'Starting in CPU-only mode (GPU/Vulkan unhealthy)')
      }
      
      // Start Ollama serve in background
      this.process = spawn(this.ollamaPath, ['serve'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env
      })
      
      this.process.unref()
      
      // Wait for server to be ready (with timeout)
      await this.waitForServer(30000)
      
      ollamaLogger.log('INFO', 'OllamaManager', 'Server started successfully')
    } catch (error: any) {
      ollamaLogger.log('ERROR', 'OllamaManager', 'Failed to start server', { error: error.message })
      
      // Try one more time with CPU mode if not already in CPU mode
      if (!this.cpuFallbackMode) {
        ollamaLogger.log('WARN', 'OllamaManager', 'Retrying with CPU-only mode...')
        this.cpuFallbackMode = true
        await this.start() // Recursive retry with CPU mode
      } else {
        throw new Error('Failed to start Ollama server even in CPU mode')
      }
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
    ollamaLogger.log('INFO', 'OllamaManager', 'Stopping Ollama server...')
    
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
    
    ollamaLogger.log('INFO', 'OllamaManager', 'Server stopped')
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
        ollamaLogger.log('WARN', 'OllamaManager', 'Failed to list models', { status: response.statusText })
        return []
      }
      
      const data = await response.json()
      const models = data.models || []
      
      return models.map((m: any) => ({
        name: m.name,
        size: m.size || 0,
        modified: m.modified_at || new Date().toISOString(),
        digest: m.digest || '',
        isActive: false
      }))
    } catch (error: any) {
      ollamaLogger.log('ERROR', 'OllamaManager', 'Error listing models', { error: error.message })
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
      ollamaLogger.log('INFO', 'OllamaManager', `Pulling model: ${modelId}`)
      
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
              this.downloadProgress = progress
              onProgress(progress)
            }
            
            if (json.status === 'success' || json.status?.includes('complete')) {
              ollamaLogger.log('INFO', 'OllamaManager', `Model pull completed: ${modelId}`)
              return
            }
          } catch (e) {
            // Skip invalid JSON lines
          }
        }
      }
      
      ollamaLogger.log('INFO', 'OllamaManager', `Model pull completed: ${modelId}`)
    } catch (error: any) {
      ollamaLogger.log('ERROR', 'OllamaManager', `Model pull failed: ${modelId}`, { error: error.message })
      throw error
    }
  }
  
  /**
   * Delete a model
   */
  async deleteModel(modelId: string): Promise<void> {
    try {
      ollamaLogger.log('INFO', 'OllamaManager', `Deleting model: ${modelId}`)
      
      const response = await fetch(`${this.baseUrl}/api/delete`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelId })
      })
      
      if (!response.ok) {
        throw new Error(`Failed to delete model: ${response.statusText}`)
      }
      
      ollamaLogger.log('INFO', 'OllamaManager', `Model deleted: ${modelId}`)
    } catch (error: any) {
      ollamaLogger.log('ERROR', 'OllamaManager', `Model deletion failed: ${modelId}`, { error: error.message })
      throw error
    }
  }
  
  /**
   * Chat with a model - WITH HANG PROTECTION AND AUTO-FALLBACK
   */
  async chat(modelId: string, messages: ChatMessage[], userOptions?: any): Promise<ChatResponse> {
    const startTime = Date.now()
    
    // Get safe options based on diagnostics
    const options = this.getSafeModelOptions(modelId, userOptions)
    
    ollamaLogger.log('INFO', 'OllamaManager', `Starting chat with ${modelId}`, {
      cpuFallbackMode: this.cpuFallbackMode,
      options
    })
    
    try {
      // Set up hang protection
      this.currentLoadContext = {
        modelId,
        startTime,
        timeout: null,
        fallbackAttempted: false
      }
      
      // Set watchdog timeout (90 seconds)
      const watchdogPromise = new Promise<never>((_, reject) => {
        this.currentLoadContext!.timeout = setTimeout(() => {
          ollamaLogger.log('ERROR', 'OllamaManager', `Chat hung for ${modelId} - timeout after 90s`)
          reject(new Error('Model load/response timed out (90s) - system may be unstable'))
        }, 90000)
      })
      
      // Race between actual chat and watchdog
      const chatPromise = this.executeChatWithOptions(modelId, messages, options)
      
      const response = await Promise.race([chatPromise, watchdogPromise])
      
      // Clear watchdog
      if (this.currentLoadContext?.timeout) {
        clearTimeout(this.currentLoadContext.timeout)
        this.currentLoadContext = null
      }
      
      const duration = Date.now() - startTime
      ollamaLogger.log('INFO', 'OllamaManager', `Chat completed for ${modelId}`, {
        duration_ms: duration,
        load_duration_ms: response.loadDuration ? Math.round(response.loadDuration / 1000000) : undefined
      })
      
      return response
    } catch (error: any) {
      // Clear watchdog
      if (this.currentLoadContext?.timeout) {
        clearTimeout(this.currentLoadContext.timeout)
      }
      
      ollamaLogger.log('ERROR', 'OllamaManager', `Chat failed for ${modelId}`, { 
        error: error.message,
        fallbackAttempted: this.currentLoadContext?.fallbackAttempted 
      })
      
      // Try fallback if not already attempted
      if (!this.currentLoadContext?.fallbackAttempted && !this.cpuFallbackMode) {
        ollamaLogger.log('WARN', 'OllamaManager', 'Attempting CPU fallback...')
        this.currentLoadContext!.fallbackAttempted = true
        this.cpuFallbackMode = true
        
        // Restart Ollama in CPU mode
        await this.stop()
        await this.start()
        
        // Retry chat
        return await this.chat(modelId, messages, userOptions)
      }
      
      this.currentLoadContext = null
      throw new Error(this.getUserFriendlyError(error.message))
    }
  }
  
  /**
   * Execute chat with specific options
   */
  private async executeChatWithOptions(
    modelId: string,
    messages: ChatMessage[],
    options: any
  ): Promise<ChatResponse> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelId,
        messages,
        stream: false,
        options
      }),
      signal: AbortSignal.timeout(120000) // 2 minute hard timeout
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
  }
  
  /**
   * Get safe model options based on hardware diagnostics
   */
  private getSafeModelOptions(_modelId: string, userOptions?: any): any {
    if (!this.diagnostics) {
      // Conservative defaults if no diagnostics
      return {
        num_ctx: 512,
        num_batch: 8,
        num_thread: 2,
        ...userOptions
      }
    }
    
    const rec = this.diagnostics.recommendations
    
    return {
      num_ctx: rec.maxContext,
      num_batch: rec.maxBatch,
      num_thread: rec.numThreads,
      ...userOptions // User options override
    }
  }
  
  /**
   * Convert technical errors to user-friendly messages
   */
  private getUserFriendlyError(technicalError: string): string {
    if (technicalError.includes('timeout') || technicalError.includes('hung')) {
      return 'Model loading timed out. Your system may not have enough resources. Try:\n' +
        '1. Using a smaller model (TinyLlama or Phi-3 Low)\n' +
        '2. Closing other applications to free up RAM\n' +
        '3. Restarting the application'
    }
    
    if (technicalError.includes('GPU') || technicalError.includes('Vulkan') || technicalError.includes('CUDA')) {
      return 'GPU/graphics driver issue detected. The app has switched to CPU-only mode.\n' +
        'For better performance, update your graphics drivers.'
    }
    
    if (technicalError.includes('out of memory') || technicalError.includes('OOM')) {
      return 'Insufficient memory. Try:\n' +
        '1. Using a smaller model\n' +
        '2. Closing other applications\n' +
        '3. Restarting your computer'
    }
    
    if (technicalError.includes('model not found') || technicalError.includes('404')) {
      return 'Model not found. Please install it from LLM Settings first.'
    }
    
    return `Error: ${technicalError}\n\nIf this persists, try reinstalling Ollama.`
  }
  
  /**
   * Get current download progress (for polling)
   */
  getDownloadProgress(): any {
    return this.downloadProgress
  }
  
  /**
   * Get health status
   */
  getHealthStatus() {
    return {
      healthCheckPassed: this.healthCheckPassed,
      cpuFallbackMode: this.cpuFallbackMode,
      diagnostics: this.diagnostics,
      logPath: ollamaLogger.getLogPath()
    }
  }
}

// Singleton instance
export const ollamaManager = new OllamaManager()



