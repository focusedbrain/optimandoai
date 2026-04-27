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
import {
  DEBUG_ACTIVE_OLLAMA_MODEL,
  getStoredActiveOllamaModelId,
  resolveEffectiveOllamaModel,
  setStoredActiveOllamaModelId,
} from './activeOllamaModelStore'
import {
  DEBUG_OLLAMA_RUNTIME_TRACE,
  nsToMs,
  ollamaRuntimeGetInFlight,
  ollamaRuntimeInFlightDelta,
  ollamaRuntimeLog,
  ollamaRuntimeRecordChatTiming,
} from './ollamaRuntimeDiagnostics'
import { buildLocalLlmRuntimeInfo } from './localLlmRuntimeStatus'
import { noteOllamaActiveModelChangedForBulkPrewarm } from './ollamaBulkPrewarm'

const execAsync = promisify(exec)

/**
 * Set to true during debugging to see every listModels call, cache hit, and dedup in the console.
 * Keep false in production — these lines fire on every classify message in a bulk run.
 */
const DEBUG_AI_DIAGNOSTICS = false

export class OllamaManager {
  private ollamaPath: string = ''
  private ollamaPort: number = 11434
  private process: ChildProcess | null = null
  private baseUrl: string = ''
  private downloadProgress: any = null

  // ── listModels cache + in-flight dedup ────────────────────────────────────
  private _modelsCache: InstalledModel[] | null = null
  private _modelsCacheTime = 0
  /** Bumped on invalidate; cache/TTL only applies when this matches. */
  private _listModelsCacheEpoch = 0
  /** Epoch snapshot for the data currently in `_modelsCache`. */
  private _modelsCacheValidEpoch = -1
  private _modelsInFlight: Promise<InstalledModel[]> | null = null
  /** Long enough that bulk Auto-Sort chunks do not re-hit `/api/tags` mid-run (tags rarely change; invalidateModelsCache handles explicit changes). */
  private readonly MODELS_CACHE_TTL_MS = 600_000
  
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

  /** Resolve probe URLs: `OLLAMA_HOST` first, then loopback (Electron often lacks shell PATH for `ollama`). */
  private collectOllamaHttpBases(): string[] {
    const out: string[] = []
    const seen = new Set<string>()
    const push = (u: string) => {
      const t = u.replace(/\/$/, '')
      if (!seen.has(t)) {
        seen.add(t)
        out.push(t)
      }
    }
    const raw = (process.env.OLLAMA_HOST ?? '').trim()
    if (raw) {
      try {
        if (raw.startsWith('http://') || raw.startsWith('https://')) {
          push(new URL(raw).origin)
        } else {
          const colon = raw.lastIndexOf(':')
          const hostPart = colon > 0 ? raw.slice(0, colon) : raw
          const portPart = colon > 0 ? raw.slice(colon + 1) : '11434'
          push(`http://${hostPart}:${portPart}`)
        }
      } catch {
        /* ignore malformed OLLAMA_HOST */
      }
    }
    push('http://127.0.0.1:11434')
    push('http://localhost:11434')
    return out
  }

  private applyResolvedBaseUrl(origin: string): void {
    const base = origin.replace(/\/$/, '')
    this.baseUrl = base
    try {
      const u = new URL(base)
      const p = u.port ? parseInt(u.port, 10) : 11434
      if (Number.isFinite(p)) this.ollamaPort = p
    } catch {
      this.ollamaPort = 11434
    }
  }

  /**
   * HTTP-first: `/api/tags` must succeed and return at least one model for “provider ready”.
   * Does not rely on `ollama` CLI (PATH may be empty under Electron).
   */
  async probeHttpTagsWithLogging(): Promise<{ ok: boolean; baseUrl: string; modelCount: number }> {
    const bases = this.collectOllamaHttpBases()
    for (const b of bases) {
      try {
        const res = await fetch(`${b}/api/tags`, { method: 'GET', signal: AbortSignal.timeout(5000) })
        if (!res.ok) {
          console.log(`[HOST_PROVIDER] ollama_probe method=http endpoint=${b} ok=false reason=http_${res.status}`)
          continue
        }
        const data = (await res.json()) as { models?: unknown[] }
        const n = Array.isArray(data?.models) ? data.models.length : 0
        if (n === 0) {
          console.log(`[HOST_PROVIDER] ollama_probe method=http endpoint=${b} ok=false reason=no_models`)
          continue
        }
        this.applyResolvedBaseUrl(b)
        console.log(`[HOST_PROVIDER] ollama_probe method=http endpoint=${b} ok=true models=${n}`)
        return { ok: true, baseUrl: b, modelCount: n }
      } catch {
        console.log(`[HOST_PROVIDER] ollama_probe method=http endpoint=${b} ok=false reason=unreachable`)
      }
    }
    console.log(`[HOST_PROVIDER] ollama_probe method=http ok=false reason=unreachable`)
    return { ok: false, baseUrl: bases[0] ?? 'http://127.0.0.1:11434', modelCount: 0 }
  }
  
  /**
   * Check if Ollama is installed
   */
  async checkInstalled(): Promise<boolean> {
    try {
      const r = await this.probeHttpTagsWithLogging()
      return r.ok
    } catch {
      return false
    }
  }
  
  /**
   * Get Ollama version (HTTP `/api/version` first; CLI is optional debug only).
   */
  async getVersion(): Promise<string | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/version`, {
        method: 'GET',
        signal: AbortSignal.timeout(2000),
      })
      if (res.ok) {
        const j = (await res.json()) as { version?: string }
        if (typeof j?.version === 'string' && j.version.trim()) {
          return j.version.trim()
        }
      }
    } catch {
      /* try CLI */
    }
    try {
      const { stdout } = await execAsync(`"${this.ollamaPath}" --version`)
      const match = stdout.match(/ollama version is (\d+\.\d+\.\d+)/)
      if (match) {
        return match[1]
      }
      return stdout.trim()
    } catch (error) {
      console.warn('[Ollama] Optional CLI version check failed (HTTP already preferred):', error)
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
    const r = await this.probeHttpTagsWithLogging()
    return r.ok
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
    const probe = await this.probeHttpTagsWithLogging()
    const installed = probe.ok
    const running = probe.ok
    const version = installed ? await this.getVersion() : undefined
    
    let modelsInstalled: InstalledModel[] = []
    let activeModel: string | undefined
    
    if (running) {
      modelsInstalled = await this.listModels()
      const stored = getStoredActiveOllamaModelId()
      const names = modelsInstalled.map((m) => m.name)
      const { model: effective, usedFallback, missingStored } = resolveEffectiveOllamaModel(names, stored)
      if (effective) {
        activeModel = effective
        for (const m of modelsInstalled) {
          m.isActive = m.name === effective
        }
        if (DEBUG_ACTIVE_OLLAMA_MODEL) {
          console.warn('[ActiveOllamaModel] getStatus activeModel=', effective, {
            storedPreference: stored,
            usedFallback,
            missingStored,
          })
        }
      }
    }

    const localRuntime = await buildLocalLlmRuntimeInfo({
      ollamaRunning: running,
      activeModel,
    })

    return {
      installed,
      running,
      version: version || undefined,
      port: this.ollamaPort,
      modelsInstalled,
      activeModel,
      localRuntime,
    }
  }
  
  /**
   * Invalidate TTL/in-flight dedup, then fetch `/api/tags` directly against {@link baseUrl}.
   * Host capability builder calls this immediately after {@link probeHttpTagsWithLogging} so enumeration
   * matches the resolved probe endpoint (avoids stale empty cache from a previous wrong base URL).
   */
  async fetchTagsInstalledModelsFresh(): Promise<InstalledModel[]> {
    this.invalidateModelsCache()
    return this.listModelsRaw()
  }

  /**
   * Raw /api/tags fetch — no cache, no dedup. Used internally by listModels().
   */
  private async listModelsRaw(): Promise<InstalledModel[]> {
    const parse = (data: any): InstalledModel[] => {
      const models = data.models || []
      return models.map((m: any) => ({
        name: m.name,
        size: m.size || 0,
        modified: m.modified_at || new Date().toISOString(),
        digest: m.digest || '',
        isActive: false,
      }))
    }
    const fetchTags = async (base: string) => {
      const response = await fetch(`${base.replace(/\/$/, '')}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      })
      if (!response.ok) {
        console.warn('[Ollama] Failed to list models:', response.statusText)
        return null
      }
      return response.json()
    }
    try {
      const data = await fetchTags(this.baseUrl)
      if (data) return parse(data)
    } catch (error) {
      console.error('[Ollama] Error listing models:', error)
    }
    const pr = await this.probeHttpTagsWithLogging()
    if (!pr.ok) return []
    try {
      const data = await fetchTags(this.baseUrl)
      if (data) return parse(data)
    } catch (error) {
      console.error('[Ollama] Error listing models after HTTP probe:', error)
    }
    return []
  }

  /**
   * List installed models.
   *
   * Includes two storm-prevention layers so a bulk classify run with
   * CONCURRENCY=5 causes at most 1 real /api/tags request:
   *
   *   1. In-flight dedup — concurrent callers join the same pending promise.
   *   2. TTL cache (30 s) — callers that arrive after the promise resolves
   *      get the cached result without a new HTTP round-trip.
   */
  async listModels(): Promise<InstalledModel[]> {
    if (DEBUG_AI_DIAGNOSTICS) console.warn('⚡ ollamaManager.listModels CALLED', new Date().toISOString())

    const epoch = this._listModelsCacheEpoch

    // 1. TTL cache hit (only if not invalidated since this cache was written)
    if (
      this._modelsCache !== null &&
      this._modelsCacheValidEpoch === epoch &&
      Date.now() - this._modelsCacheTime < this.MODELS_CACHE_TTL_MS
    ) {
      if (DEBUG_AI_DIAGNOSTICS) console.warn('⚡ ollamaManager.listModels → CACHE HIT', new Date().toISOString())
      return this._modelsCache
    }

    // 2. In-flight dedup — join existing request instead of firing a new one
    if (this._modelsInFlight !== null) {
      if (DEBUG_AI_DIAGNOSTICS) console.warn('⚡ ollamaManager.listModels → DEDUP (joining in-flight request)', new Date().toISOString())
      return this._modelsInFlight
    }

    // 3. New fetch
    if (DEBUG_AI_DIAGNOSTICS) console.warn('⚡ ollamaManager.listModels → FETCH /api/tags', new Date().toISOString())
    const fetchEpochAtStart = this._listModelsCacheEpoch
    this._modelsInFlight = this.listModelsRaw().then(
      (models) => {
        if (fetchEpochAtStart !== this._listModelsCacheEpoch) {
          if (DEBUG_ACTIVE_OLLAMA_MODEL) {
            console.warn('[Ollama] listModels fetch settled stale (epoch bumped) — skipping cache write')
          }
          return models
        }
        this._modelsCache = models
        this._modelsCacheTime = Date.now()
        this._modelsCacheValidEpoch = fetchEpochAtStart
        this._modelsInFlight = null
        return models
      },
      (err) => {
        this._modelsInFlight = null
        throw err
      }
    )
    return this._modelsInFlight
  }

  /**
   * Invalidate the listModels cache.
   * Call after model install, model delete, or base-URL change so the
   * next call reflects the new state.
   */
  invalidateModelsCache(): void {
    this._listModelsCacheEpoch++
    this._modelsCache = null
    this._modelsCacheTime = 0
    this._modelsCacheValidEpoch = -1
    this._modelsInFlight = null
    if (DEBUG_ACTIVE_OLLAMA_MODEL) {
      console.warn('[Ollama] listModels cache invalidated (epoch=', this._listModelsCacheEpoch, ')')
    } else {
      console.warn('[Ollama] listModels cache invalidated')
    }
  }

  /**
   * Effective Ollama model for chat (inbox, HTTP /api/llm/chat): persisted preference
   * when that tag exists, otherwise first installed model.
   */
  async getEffectiveChatModelName(): Promise<string | null> {
    const models = await this.listModels()
    const names = models.map((m) => m.name)
    const stored = getStoredActiveOllamaModelId()
    const { model, usedFallback, missingStored } = resolveEffectiveOllamaModel(names, stored)
    if (DEBUG_ACTIVE_OLLAMA_MODEL && model) {
      console.warn('[ActiveOllamaModel] getEffectiveChatModelName →', model, {
        storedPreference: stored,
        usedFallback,
        missingStored,
      })
    }
    console.log('[MODEL-DEBUG] resolved:', model, { stored, installedNames: names, usedFallback, missingStored })
    return model
  }

  /**
   * Persist active model. When Ollama is running, the name must exist in /api/tags.
   * When not running, preference is still saved (verified on next request).
   */
  async setActiveModelPreference(
    modelId: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const trimmed = modelId?.trim()
    if (!trimmed) return { ok: false, error: 'modelId is required' }
    if (DEBUG_ACTIVE_OLLAMA_MODEL) console.warn('[ActiveOllamaModel] setActiveModelPreference requested:', trimmed)

    const running = await this.isRunning()
    if (running) {
      const models = await this.listModels()
      if (!models.some((m) => m.name === trimmed)) {
        return {
          ok: false,
          error: `Model "${trimmed}" is not installed. Install it first or use the exact name from ollama list.`,
        }
      }
    }

    setStoredActiveOllamaModelId(trimmed)
    noteOllamaActiveModelChangedForBulkPrewarm(trimmed)
    /** Single bump: next `listModels` sees new installs; avoid double-invalidate + double `/api/tags` on switch. */
    this.invalidateModelsCache()
    if (DEBUG_ACTIVE_OLLAMA_MODEL) {
      console.warn('[Ollama] setActiveModelPreference persisted:', trimmed, { ollamaRunning: running })
    }
    return { ok: true }
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
              console.log('[Ollama] Model pull stream completed:', modelId)
              this.invalidateModelsCache()
              return
            }
          } catch (e) {
            // Skip invalid JSON lines
          }
        }
      }
      
      console.log('[Ollama] Model pull completed:', modelId)
      this.invalidateModelsCache()
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
      this.invalidateModelsCache()
    } catch (error) {
      console.error('[Ollama] Model deletion failed:', error)
      throw error
    }
  }
  
  /**
   * Chat with a model
   */
  async chat(modelId: string, messages: ChatMessage[]): Promise<ChatResponse> {
    if (DEBUG_AI_DIAGNOSTICS) {
      console.warn('⚡ ollamaManager.chat CALLED', new Date().toISOString(), { model: modelId || 'unknown' })
    }
    const t0 = Date.now()
    const inflightStart = ollamaRuntimeInFlightDelta(1)
    if (DEBUG_OLLAMA_RUNTIME_TRACE) {
      ollamaRuntimeLog('ollamaManager.chat:start', {
        model: modelId,
        baseUrl: this.baseUrl,
        inFlight: inflightStart,
      })
    }
    try {
      const allImages = messages.flatMap((m) => (m.images?.length ? m.images : []))
      const serializedMessages = messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.images && m.images.length > 0 ? { images: m.images } : {}),
      }))
      const body: Record<string, unknown> = {
        model: modelId,
        messages: serializedMessages,
        stream: false,
        keep_alive: '2m',
      }
      // Do NOT also set root `images` when messages already carry `images` — duplicate payloads
      // confuse vision models (e.g. Gemma) and can surface as `[img-0]` / missing attachment errors.
      const hasPerMessageImages = messages.some((m) => (m.images?.length ?? 0) > 0)
      if (allImages.length > 0 && !hasPerMessageImages) {
        body.images = allImages
      }
      console.log('[ollamaManager.chat] model:', modelId, '| total images:', allImages.length, '| hasPerMessageImages:', hasPerMessageImages, '| first img b64 length:', allImages[0]?.length ?? 0)
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120000) // 2 minute timeout
      })
      
      if (!response.ok) {
        throw new Error(`Chat request failed: ${response.statusText}`)
      }
      
      const data = await response.json()
      const out: ChatResponse = {
        content: data.message?.content || '',
        model: data.model || modelId,
        done: data.done || false,
        totalDuration: data.total_duration,
        loadDuration: data.load_duration,
        promptEvalCount: data.prompt_eval_count,
        evalCount: data.eval_count
      }
      if (DEBUG_OLLAMA_RUNTIME_TRACE) {
        ollamaRuntimeLog('ollamaManager.chat:done', {
          model: modelId,
          wallMs: Date.now() - t0,
          inFlight: ollamaRuntimeGetInFlight(),
          totalDurationMs: nsToMs(out.totalDuration),
          loadDurationMs: nsToMs(out.loadDuration),
          promptEvalCount: out.promptEvalCount,
          evalCount: out.evalCount,
        })
      }
      ollamaRuntimeRecordChatTiming(Date.now() - t0, out.totalDuration, out.loadDuration)
      return out
    } catch (error) {
      if (DEBUG_OLLAMA_RUNTIME_TRACE) {
        ollamaRuntimeLog('ollamaManager.chat:error', {
          model: modelId,
          wallMs: Date.now() - t0,
          err: error instanceof Error ? error.message : String(error),
        })
      }
      console.error('[Ollama] Chat failed:', error)
      throw error
    } finally {
      ollamaRuntimeInFlightDelta(-1)
    }
  }
  
  /**
   * Get current download progress (for polling)
   */
  getDownloadProgress(): any {
    return this.downloadProgress
  }

  /** Ollama HTTP API base URL (typically localhost). Exposed for Watchdog privacy audits. */
  getBaseUrl(): string {
    return this.baseUrl
  }
}

// Singleton instance
export const ollamaManager = new OllamaManager()
