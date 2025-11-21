/**
 * Ollama Manager Service
 * Manages Ollama binary lifecycle, model downloads, and runtime status
 */

import { spawn, exec } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { app } from 'electron'
import type { LlmRuntimeStatus } from './types'

const execAsync = promisify(exec)

export class OllamaManagerService {
  private ollamaProcess: any = null
  private ollamaPath: string
  private readonly OLLAMA_PORT = 11434
  
  constructor() {
    // Path to bundled Ollama binary
    // In production: app.getAppPath()/resources/ollama/
    // In development: just use 'ollama' and assume it's in PATH for now
    const isDev = !app.isPackaged
    
    if (isDev) {
      // In dev mode, assume ollama is installed globally
      this.ollamaPath = process.platform === 'win32' ? 'ollama.exe' : 'ollama'
    } else {
      // In production, use bundled binary
      const resourcesPath = process.resourcesPath
      this.ollamaPath = this.getOllamaBinaryPath(resourcesPath)
    }
    
    console.log('[OLLAMA] Binary path:', this.ollamaPath)
  }
  
  /**
   * Get platform-specific Ollama binary path
   */
  private getOllamaBinaryPath(resourcesPath: string): string {
    const platform = process.platform
    if (platform === 'win32') {
      return path.join(resourcesPath, 'ollama', 'ollama.exe')
    } else if (platform === 'darwin') {
      return path.join(resourcesPath, 'ollama', 'ollama')
    }
    return path.join(resourcesPath, 'ollama', 'ollama')
  }
  
  /**
   * Check if Ollama binary exists
   */
  async checkInstallation(): Promise<boolean> {
    try {
      // Try to get version - if this works, Ollama is available
      const version = await this.getVersion()
      return version !== null
    } catch {
      return false
    }
  }
  
  /**
   * Get Ollama version string
   */
  async getVersion(): Promise<string | null> {
    try {
      const { stdout } = await execAsync(`"${this.ollamaPath}" --version`)
      return stdout.trim()
    } catch (error) {
      console.warn('[OLLAMA] Version check failed:', error)
      return null
    }
  }
  
  /**
   * Start Ollama server process
   */
  async startOllama(): Promise<void> {
    if (this.ollamaProcess) {
      console.log('[OLLAMA] Already running')
      return
    }
    
    console.log('[OLLAMA] Starting Ollama server...')
    
    try {
      this.ollamaProcess = spawn(this.ollamaPath, ['serve'], {
        env: { 
          ...process.env, 
          OLLAMA_HOST: `127.0.0.1:${this.OLLAMA_PORT}`,
          OLLAMA_ORIGINS: '*' // Allow all origins for local development
        },
        stdio: ['ignore', 'pipe', 'pipe']
      })
      
      this.ollamaProcess.stdout?.on('data', (data: Buffer) => {
        console.log('[OLLAMA]', data.toString().trim())
      })
      
      this.ollamaProcess.stderr?.on('data', (data: Buffer) => {
        console.error('[OLLAMA ERROR]', data.toString().trim())
      })
      
      this.ollamaProcess.on('error', (error: Error) => {
        console.error('[OLLAMA] Process error:', error)
        this.ollamaProcess = null
      })
      
      this.ollamaProcess.on('exit', (code: number) => {
        console.log('[OLLAMA] Process exited with code:', code)
        this.ollamaProcess = null
      })
      
      // Wait for server to be ready
      await this.waitForReady()
      console.log('[OLLAMA] Server started successfully')
    } catch (error) {
      console.error('[OLLAMA] Failed to start:', error)
      this.ollamaProcess = null
      throw error
    }
  }
  
  /**
   * Stop Ollama server process
   */
  async stopOllama(): Promise<void> {
    if (!this.ollamaProcess) {
      console.log('[OLLAMA] Not running')
      return
    }
    
    console.log('[OLLAMA] Stopping server...')
    this.ollamaProcess.kill()
    this.ollamaProcess = null
  }
  
  /**
   * Wait for Ollama server to be ready
   */
  private async waitForReady(timeoutMs = 10000): Promise<void> {
    const startTime = Date.now()
    while (Date.now() - startTime < timeoutMs) {
      try {
        const response = await fetch(`http://127.0.0.1:${this.OLLAMA_PORT}/api/tags`, {
          signal: AbortSignal.timeout(2000)
        })
        if (response.ok) {
          return
        }
      } catch {
        // Not ready yet, continue waiting
      }
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    throw new Error('Ollama failed to start within timeout period')
  }
  
  /**
   * List all available models in Ollama
   */
  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`http://127.0.0.1:${this.OLLAMA_PORT}/api/tags`)
      if (!response.ok) {
        console.warn('[OLLAMA] Failed to list models:', response.statusText)
        return []
      }
      const data = await response.json()
      return data.models?.map((m: any) => m.name) || []
    } catch (error) {
      console.warn('[OLLAMA] Error listing models:', error)
      return []
    }
  }
  
  /**
   * Check if a specific model is available
   */
  async hasModel(modelName: string): Promise<boolean> {
    const models = await this.listModels()
    return models.some(m => m === modelName || m.startsWith(modelName + ':'))
  }
  
  /**
   * Download/pull a model from Ollama registry
   * @param modelName Model identifier (e.g., "mistral:7b")
   * @param onProgress Callback for progress updates
   */
  async pullModel(
    modelName: string, 
    onProgress?: (progress: number, status: string) => void
  ): Promise<void> {
    console.log('[OLLAMA] Pulling model:', modelName)
    
    try {
      const response = await fetch(`http://127.0.0.1:${this.OLLAMA_PORT}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName, stream: true })
      })
      
      if (!response.ok || !response.body) {
        throw new Error(`Failed to start model download: ${response.statusText}`)
      }
      
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        
        const chunk = decoder.decode(value)
        const lines = chunk.split('\n').filter(l => l.trim())
        
        for (const line of lines) {
          try {
            const json = JSON.parse(line)
            
            // Calculate progress percentage if available
            if (json.total && json.completed) {
              const progress = (json.completed / json.total) * 100
              onProgress?.(progress, json.status || 'downloading')
            } else if (json.status) {
              // Just report status without progress
              onProgress?.(0, json.status)
            }
            
            // Log for debugging
            console.log('[OLLAMA] Pull progress:', json.status, json.completed, '/', json.total)
          } catch (parseError) {
            // Ignore parse errors for malformed JSON chunks
          }
        }
      }
      
      console.log('[OLLAMA] Model pull completed:', modelName)
    } catch (error) {
      console.error('[OLLAMA] Model pull failed:', error)
      throw error
    }
  }
  
  /**
   * Get current runtime status
   */
  async getStatus(): Promise<LlmRuntimeStatus> {
    const installed = await this.checkInstallation()
    
    if (!installed) {
      return {
        ollamaInstalled: false,
        modelAvailable: false,
        endpointUrl: `http://127.0.0.1:${this.OLLAMA_PORT}`,
        isReady: false,
        error: 'Ollama binary not found or not in PATH'
      }
    }
    
    const version = await this.getVersion()
    
    try {
      // Check if server is responding
      const response = await fetch(`http://127.0.0.1:${this.OLLAMA_PORT}/api/tags`, {
        signal: AbortSignal.timeout(3000)
      })
      
      if (!response.ok) {
        return {
          ollamaInstalled: true,
          ollamaVersion: version || undefined,
          modelAvailable: false,
          endpointUrl: `http://127.0.0.1:${this.OLLAMA_PORT}`,
          isReady: false,
          error: 'Ollama server not responding'
        }
      }
      
      // Check if Mistral 7B is available
      const hasMistral = await this.hasModel('mistral:7b')
      
      return {
        ollamaInstalled: true,
        ollamaVersion: version || undefined,
        modelAvailable: hasMistral,
        modelName: hasMistral ? 'mistral:7b' : undefined,
        endpointUrl: `http://127.0.0.1:${this.OLLAMA_PORT}`,
        isReady: hasMistral
      }
    } catch (error: any) {
      return {
        ollamaInstalled: true,
        ollamaVersion: version || undefined,
        modelAvailable: false,
        endpointUrl: `http://127.0.0.1:${this.OLLAMA_PORT}`,
        isReady: false,
        error: error.message || 'Ollama server not running'
      }
    }
  }
}

// Singleton instance
export const ollamaManager = new OllamaManagerService()

