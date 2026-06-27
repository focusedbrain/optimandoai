/**
 * Local LLM Manager (llama.cpp backend)
 * Manages llama-server runtime: lifecycle, model operations, OpenAI-compatible HTTP API.
 */

import { exec, spawn, ChildProcess, execSync } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import fs from 'fs'
import { app } from 'electron'
import { LocalLlmStatus, InstalledModel, ChatMessage, ChatResponse, DownloadProgress } from './types'
import {
  DEBUG_ACTIVE_LOCAL_MODEL,
  getStoredActiveLocalModelId,
  resolveEffectiveLocalModel,
  setStoredActiveLocalModelId,
} from './activeLocalModelStore'
import {
  DEBUG_LOCAL_LLM_RUNTIME_TRACE,
  localLlmRuntimeGetInFlight,
  localLlmRuntimeInFlightDelta,
  localLlmRuntimeLog,
  localLlmRuntimeRecordChatTiming,
} from './localLlmRuntimeDiagnostics'
import { buildLocalLlmRuntimeInfo } from './localLlmRuntimeStatus'
import { noteLocalLlmActiveModelChangedForBulkPrewarm } from './localLlmBulkPrewarm'
import { collectLlamacppHttpBasesFromEnv } from './llamacppHttpBases'
import { assertGpuInferenceAvailable } from '../inference/inferenceGate'
import { getAdaptiveKeepAlive } from './adaptiveWarmupStrategy'
import { DEFAULT_LLAMACPP_PORT, getLocalLlmModelsDirectory } from './localLlmPaths'
import {
  deleteInstalledGguf,
  downloadGgufFromAllowedUrl,
  importGgufFromUserPath,
  readInstalledModelSha256,
  type ModelInstallResult,
} from './localLlmModelInstall'

const execAsync = promisify(exec)

const DEBUG_AI_DIAGNOSTICS = false

type OpenAiModelsResponse = {
  data?: Array<{ id?: string; created?: number }>
}

type OpenAiChatCompletionResponse = {
  model?: string
  choices?: Array<{ message?: { content?: string } }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

function modelIdFromGgufFilename(fileName: string): string {
  return fileName.replace(/\.gguf$/i, '')
}

function resolveGgufPathForModelId(modelId: string): string | null {
  const dir = getLocalLlmModelsDirectory()
  const direct = path.join(dir, `${modelId}.gguf`)
  if (fs.existsSync(direct)) return direct
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const e of entries) {
      if (!e.isFile()) continue
      if (!e.name.toLowerCase().endsWith('.gguf')) continue
      if (modelIdFromGgufFilename(e.name) === modelId) {
        return path.join(dir, e.name)
      }
    }
  } catch {
    /* dir may not exist yet */
  }
  return null
}

export class LocalLlmManager {
  private serverBinaryPath: string = ''
  private serverPort: number = DEFAULT_LLAMACPP_PORT
  private process: ChildProcess | null = null
  private weOwnProcess = false
  private supervisionEnabled = false
  private shuttingDown = false
  private restartTimer: ReturnType<typeof setTimeout> | null = null
  private restartAttemptTimes: number[] = []
  private readonly maxRestartAttempts = 5
  private readonly restartWindowMs = 300_000
  private baseUrl: string = ''
  private downloadProgress: DownloadProgress | null = null
  private downloadAbort: AbortController | null = null

  private _modelsCache: InstalledModel[] | null = null
  private _modelsCacheTime = 0
  private _listModelsCacheEpoch = 0
  private _modelsCacheValidEpoch = -1
  private _modelsInFlight: Promise<InstalledModel[]> | null = null
  private readonly MODELS_CACHE_TTL_MS = 600_000

  constructor() {
    this.serverPort = DEFAULT_LLAMACPP_PORT
    this.baseUrl = `http://127.0.0.1:${this.serverPort}`
    this.initializeServerBinaryPath()
  }

  private initializeServerBinaryPath(): void {
    try {
      const platform = process.platform
      let binaryName = 'llama-server'
      if (platform === 'win32') binaryName = 'llama-server.exe'

      const resourcesPath = process.resourcesPath || app.getAppPath()
      const bundledPath = path.join(resourcesPath, 'llamacpp', binaryName)
      if (fs.existsSync(bundledPath)) {
        this.serverBinaryPath = bundledPath
        console.log('[LocalLlm] Using bundled llama-server:', bundledPath)
        return
      }

      if (platform === 'win32') {
        const localAppData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local')
        const windowsPath = path.join(localAppData, 'Programs', 'llama.cpp', binaryName)
        if (fs.existsSync(windowsPath)) {
          this.serverBinaryPath = windowsPath
          console.log('[LocalLlm] Using Windows installation:', windowsPath)
          return
        }
      }

      this.serverBinaryPath = binaryName
      console.log('[LocalLlm] Using llama-server from PATH')
    } catch (error) {
      console.error('[LocalLlm] Failed to initialize server binary path:', error)
      this.serverBinaryPath = 'llama-server'
    }
  }

  /** True when a resolved llama-server binary exists (bundled, install path, or PATH). */
  isBinaryAvailable(): boolean {
    const p = this.serverBinaryPath.trim()
    if (!p) return false
    if (path.isAbsolute(p) || p.includes(path.sep) || p.includes('\\')) {
      return fs.existsSync(p)
    }
    try {
      if (process.platform === 'win32') {
        const out = execSync(`where ${p}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] })
        return out.trim().length > 0
      }
      execSync(`which ${p}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] })
      return true
    } catch {
      return false
    }
  }

  enableSupervision(): void {
    this.supervisionEnabled = true
  }

  private clearRestartTimer(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
  }

  private pruneRestartWindow(): void {
    const cutoff = Date.now() - this.restartWindowMs
    this.restartAttemptTimes = this.restartAttemptTimes.filter((t) => t >= cutoff)
  }

  private scheduleSupervisedRestart(reason: string): void {
    if (!this.supervisionEnabled || this.shuttingDown) return
    this.pruneRestartWindow()
    if (this.restartAttemptTimes.length >= this.maxRestartAttempts) {
      console.warn(
        `[LOCAL_LLM_LIFECYCLE] restart_exhausted reason=${reason} attempts=${this.restartAttemptTimes.length} — manual intervention required`,
      )
      return
    }
    const attempt = this.restartAttemptTimes.length + 1
    const backoffMs = Math.min(1000 * 2 ** (attempt - 1), 30_000)
    this.restartAttemptTimes.push(Date.now())
    this.clearRestartTimer()
    console.log(
      `[LOCAL_LLM_LIFECYCLE] restart_scheduled reason=${reason} attempt=${attempt} backoff_ms=${backoffMs}`,
    )
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      void this.ensureManagedServerRunning({ reason: `crash_restart:${reason}` })
    }, backoffMs)
  }

  private attachProcessExitHandler(proc: ChildProcess): void {
    proc.on('exit', (code, signal) => {
      if (this.process === proc) {
        this.process = null
        this.weOwnProcess = false
      }
      if (this.shuttingDown) {
        console.log(`[LOCAL_LLM_LIFECYCLE] child_exit expected code=${code ?? 'null'} signal=${signal ?? 'null'}`)
        return
      }
      console.warn(
        `[LOCAL_LLM_LIFECYCLE] child_exit_unexpected code=${code ?? 'null'} signal=${signal ?? 'null'}`,
      )
      this.scheduleSupervisedRestart('process_exit')
    })
  }

  async waitUntilReady(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (await this.isServerResponding()) return true
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    return false
  }

  /**
   * Host orchestrator entry: spawn when binary + GGUF exist; health-check before marking ready.
   * Does not throw — surfaces reason for logging.
   */
  async ensureManagedServerRunning(p: { reason: string }): Promise<{
    ok: boolean
    running: boolean
    reason?: string
  }> {
    if (await this.isServerResponding()) {
      console.log(`[LOCAL_LLM_LIFECYCLE] ready reason=already_running trigger=${p.reason}`)
      return { ok: true, running: true }
    }

    if (!this.isBinaryAvailable()) {
      return { ok: false, running: false, reason: 'binary_missing' }
    }

    const active = await this.getEffectiveChatModelName()
    const gguf = active ? resolveGgufPathForModelId(active) : null
    if (!gguf) {
      console.log(
        `[LOCAL_LLM_LIFECYCLE] deferred reason=no_model_installed trigger=${p.reason} — install a GGUF to auto-start`,
      )
      return { ok: false, running: false, reason: 'no_model_installed' }
    }

    try {
      await this.spawnOwnedServer(gguf, p.reason)
      const ready = await this.waitUntilReady(30_000)
      if (!ready) {
        return { ok: false, running: false, reason: 'health_check_timeout' }
      }
      console.log(
        `[LOCAL_LLM_LIFECYCLE] ready endpoint=${this.baseUrl}/v1/models model=${active} trigger=${p.reason}`,
      )
      this.restartAttemptTimes = []
      return { ok: true, running: true }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.warn(`[LOCAL_LLM_LIFECYCLE] spawn_failed trigger=${p.reason} detail=${msg.slice(0, 200)}`)
      return { ok: false, running: false, reason: `spawn_failed:${msg.slice(0, 120)}` }
    }
  }

  async shutdownManagedServer(phase: string): Promise<void> {
    this.shuttingDown = true
    this.clearRestartTimer()
    console.log(`[LOCAL_LLM_LIFECYCLE] stopping phase=${phase} we_own=${this.weOwnProcess}`)
    await this.stop()
  }

  private async spawnOwnedServer(gguf: string, trigger: string): Promise<void> {
    if (this.process && this.weOwnProcess) {
      console.log('[LocalLlm] Owned llama-server process already tracked')
      return
    }

    console.log(`[LocalLlm] Starting llama-server on loopback trigger=${trigger} model=${path.basename(gguf)}`)
    const proc = spawn(
      this.serverBinaryPath,
      ['--host', '127.0.0.1', '--port', String(this.serverPort), '-m', gguf],
      { stdio: 'ignore', windowsHide: true },
    )
    this.process = proc
    this.weOwnProcess = true
    this.attachProcessExitHandler(proc)
  }

  private collectHttpBases(): string[] {
    return collectLlamacppHttpBasesFromEnv()
  }

  private applyResolvedBaseUrl(origin: string): void {
    const base = origin.replace(/\/$/, '')
    this.baseUrl = base
    try {
      const u = new URL(base)
      const p = u.port ? parseInt(u.port, 10) : DEFAULT_LLAMACPP_PORT
      if (Number.isFinite(p)) this.serverPort = p
    } catch {
      this.serverPort = DEFAULT_LLAMACPP_PORT
    }
  }

  async probeHttpModelsWithLogging(): Promise<{ ok: boolean; baseUrl: string; modelCount: number }> {
    const bases = this.collectHttpBases()
    for (const b of bases) {
      try {
        const res = await fetch(`${b}/v1/models`, { method: 'GET', signal: AbortSignal.timeout(5000) })
        if (!res.ok) {
          console.log(`[HOST_PROVIDER] llamacpp_probe method=http endpoint=${b} ok=false reason=http_${res.status}`)
          continue
        }
        const data = (await res.json()) as OpenAiModelsResponse
        const n = Array.isArray(data?.data) ? data.data.length : 0
        const diskModels = this.scanGgufModelsOnDisk()
        const total = Math.max(n, diskModels.length)
        if (total === 0) {
          console.log(`[HOST_PROVIDER] llamacpp_probe method=http endpoint=${b} ok=false reason=no_models`)
          continue
        }
        this.applyResolvedBaseUrl(b)
        console.log(`[HOST_PROVIDER] llamacpp_probe method=http endpoint=${b} ok=true models=${total}`)
        return { ok: true, baseUrl: b, modelCount: total }
      } catch {
        console.log(`[HOST_PROVIDER] llamacpp_probe method=http endpoint=${b} ok=false reason=unreachable`)
      }
    }
    const diskOnly = this.scanGgufModelsOnDisk()
    if (diskOnly.length > 0) {
      const b = bases[0] ?? `http://127.0.0.1:${DEFAULT_LLAMACPP_PORT}`
      console.log(
        `[HOST_PROVIDER] llamacpp_probe method=disk endpoint=${b} ok=true models=${diskOnly.length} server=offline`,
      )
      return { ok: true, baseUrl: b, modelCount: diskOnly.length }
    }
    console.log('[HOST_PROVIDER] llamacpp_probe method=http ok=false reason=unreachable')
    return { ok: false, baseUrl: bases[0] ?? `http://127.0.0.1:${DEFAULT_LLAMACPP_PORT}`, modelCount: 0 }
  }

  async probeHttpTagsWithLogging(): Promise<{ ok: boolean; baseUrl: string; modelCount: number }> {
    return this.probeHttpModelsWithLogging()
  }

  async checkInstalled(): Promise<boolean> {
    if (!this.isBinaryAvailable()) {
      return this.scanGgufModelsOnDisk().length > 0
    }
    try {
      return (await this.probeHttpModelsWithLogging()).ok || this.scanGgufModelsOnDisk().length > 0
    } catch {
      return this.scanGgufModelsOnDisk().length > 0
    }
  }

  async getVersion(): Promise<string | null> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, { method: 'GET', signal: AbortSignal.timeout(2000) })
      if (res.ok) {
        const text = await res.text()
        const m = text.match(/version[:\s]+([\d.]+)/i)
        if (m?.[1]) return m[1]
        return 'llama.cpp'
      }
    } catch {
      /* try CLI */
    }
    try {
      const { stdout } = await execAsync(`"${this.serverBinaryPath}" --version`)
      const match = stdout.match(/(\d+\.\d+\.\d+)/)
      if (match) return match[1]
      return stdout.trim() || null
    } catch {
      return null
    }
  }

  private scanGgufModelsOnDisk(): InstalledModel[] {
    const dir = getLocalLlmModelsDirectory()
    try {
      fs.mkdirSync(dir, { recursive: true })
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      const out: InstalledModel[] = []
      for (const e of entries) {
        if (!e.isFile() || !e.name.toLowerCase().endsWith('.gguf')) continue
        const full = path.join(dir, e.name)
        const st = fs.statSync(full)
        out.push({
          name: modelIdFromGgufFilename(e.name),
          size: st.size,
          modified: st.mtime.toISOString(),
          digest: readInstalledModelSha256(full),
          isActive: false,
        })
      }
      out.sort((a, b) => a.name.localeCompare(b.name))
      return out
    } catch {
      return []
    }
  }

  private async parseOpenAiModelsResponse(data: OpenAiModelsResponse): Promise<InstalledModel[]> {
    const rows = Array.isArray(data?.data) ? data.data : []
    const fromApi: InstalledModel[] = []
    for (const row of rows) {
      const id = typeof row.id === 'string' ? row.id.trim() : ''
      if (!id) continue
      fromApi.push({
        name: id,
        size: 0,
        modified: row.created ? new Date(row.created * 1000).toISOString() : new Date().toISOString(),
        digest: '',
        isActive: false,
      })
    }
    const disk = this.scanGgufModelsOnDisk()
    const byName = new Map<string, InstalledModel>()
    for (const m of disk) byName.set(m.name, m)
    for (const m of fromApi) {
      if (!byName.has(m.name)) byName.set(m.name, m)
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  async start(): Promise<void> {
    this.enableSupervision()
    const result = await this.ensureManagedServerRunning({ reason: 'manual_start' })
    if (!result.ok || !result.running) {
      throw new Error(result.reason ?? 'Failed to start llama-server')
    }
  }

  private async isServerResponding(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(2000) })
      return res.ok
    } catch {
      try {
        const res = await fetch(`${this.baseUrl}/v1/models`, { signal: AbortSignal.timeout(2000) })
        return res.ok
      } catch {
        return false
      }
    }
  }

  async isRunning(): Promise<boolean> {
    const r = await this.probeHttpModelsWithLogging()
    if (r.ok && (await this.isServerResponding())) return true
    return false
  }

  async stop(): Promise<void> {
    this.clearRestartTimer()
    if (this.process && this.weOwnProcess) {
      try {
        this.process.kill()
      } catch {
        /* ignore */
      }
      this.process = null
      this.weOwnProcess = false
    }
    try {
      if (process.platform === 'win32') {
        await execAsync('taskkill /F /IM llama-server.exe /T')
      } else {
        await execAsync('pkill -f llama-server')
      }
    } catch {
      /* ignore — process may not be running */
    }
  }

  async getStatus(): Promise<LocalLlmStatus> {
    const probe = await this.probeHttpModelsWithLogging()
    const installed = probe.ok
    const running = await this.isServerResponding()
    const version = installed ? await this.getVersion() : undefined

    let modelsInstalled: InstalledModel[] = []
    let activeModel: string | undefined

    if (installed) {
      modelsInstalled = await this.listModels()
      const stored = getStoredActiveLocalModelId()
      const names = modelsInstalled.map((m) => m.name)
      const { model: effective } = resolveEffectiveLocalModel(names, stored)
      if (effective) {
        activeModel = effective
        for (const m of modelsInstalled) {
          m.isActive = m.name === effective
        }
      }
    }

    const localRuntime = await buildLocalLlmRuntimeInfo({ localLlmRunning: probe.ok, activeModel })

    return {
      installed,
      running,
      version: version || undefined,
      port: this.serverPort,
      modelsInstalled,
      activeModel,
      localRuntime,
    }
  }

  async fetchModelsInstalledFresh(): Promise<InstalledModel[]> {
    this.invalidateModelsCache()
    return this.listModelsRaw()
  }

  async fetchTagsInstalledModelsFresh(): Promise<InstalledModel[]> {
    return this.fetchModelsInstalledFresh()
  }

  private async listModelsRaw(): Promise<InstalledModel[]> {
    const fetchModels = async (base: string) => {
      const response = await fetch(`${base.replace(/\/$/, '')}/v1/models`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      })
      if (!response.ok) return null
      return response.json() as Promise<OpenAiModelsResponse>
    }
    try {
      const data = await fetchModels(this.baseUrl)
      if (data) return this.parseOpenAiModelsResponse(data)
    } catch (error) {
      console.error('[LocalLlm] Error listing models from server:', error)
    }
    const disk = this.scanGgufModelsOnDisk()
    if (disk.length > 0) return disk
    const pr = await this.probeHttpModelsWithLogging()
    if (!pr.ok) return []
    try {
      const data = await fetchModels(this.baseUrl)
      if (data) return this.parseOpenAiModelsResponse(data)
    } catch (error) {
      console.error('[LocalLlm] Error listing models after probe:', error)
    }
    return this.scanGgufModelsOnDisk()
  }

  async listModels(): Promise<InstalledModel[]> {
    const epoch = this._listModelsCacheEpoch
    if (
      this._modelsCache !== null &&
      this._modelsCacheValidEpoch === epoch &&
      Date.now() - this._modelsCacheTime < this.MODELS_CACHE_TTL_MS
    ) {
      return this._modelsCache
    }
    if (this._modelsInFlight !== null) return this._modelsInFlight

    const fetchEpochAtStart = this._listModelsCacheEpoch
    this._modelsInFlight = this.listModelsRaw().then(
      (models) => {
        if (fetchEpochAtStart === this._listModelsCacheEpoch) {
          this._modelsCache = models
          this._modelsCacheTime = Date.now()
          this._modelsCacheValidEpoch = fetchEpochAtStart
        }
        this._modelsInFlight = null
        return models
      },
      (err) => {
        this._modelsInFlight = null
        throw err
      },
    )
    return this._modelsInFlight
  }

  invalidateModelsCache(): void {
    this._listModelsCacheEpoch++
    this._modelsCache = null
    this._modelsCacheTime = 0
    this._modelsCacheValidEpoch = -1
    this._modelsInFlight = null
  }

  async getEffectiveChatModelName(): Promise<string | null> {
    const models = await this.listModels()
    const names = models.map((m) => m.name)
    const stored = getStoredActiveLocalModelId()
    const { model } = resolveEffectiveLocalModel(names, stored)
    console.log('[MODEL-DEBUG] resolved:', model, { stored, installedNames: names })
    return model
  }

  async setActiveModelPreference(
    modelId: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const trimmed = modelId?.trim()
    if (!trimmed) return { ok: false, error: 'modelId is required' }

    const models = await this.listModels()
    if (!models.some((m) => m.name === trimmed)) {
      return {
        ok: false,
        error: `Model "${trimmed}" is not installed. Place the GGUF file in the models directory first.`,
      }
    }

    setStoredActiveLocalModelId(trimmed)
    noteLocalLlmActiveModelChangedForBulkPrewarm(trimmed)
    this.invalidateModelsCache()
    return { ok: true }
  }

  async pullModel(modelId: string, onProgress?: (progress: DownloadProgress) => void): Promise<void> {
    void modelId
    void onProgress
    throw new Error(
      'Ollama-style model pull is removed. Import a .gguf file via Backend Configuration or download from an allowlisted Hugging Face HTTPS URL.',
    )
  }

  cancelModelDownload(): void {
    this.downloadAbort?.abort()
    this.downloadAbort = null
  }

  async importModelFromFile(
    sourcePath: string,
    opts?: { overwrite?: boolean; onProgress?: (progress: DownloadProgress) => void },
  ): Promise<ModelInstallResult> {
    this.downloadProgress = null
    const result = await importGgufFromUserPath(sourcePath, {
      overwrite: opts?.overwrite,
      onProgress: (p) => {
        this.downloadProgress = p
        opts?.onProgress?.(p)
      },
    })
    this.invalidateModelsCache()
    return result
  }

  async downloadModelFromUrl(
    url: string,
    onProgress?: (progress: DownloadProgress) => void,
  ): Promise<ModelInstallResult> {
    this.downloadAbort?.abort()
    this.downloadAbort = new AbortController()
    this.downloadProgress = { modelId: '', status: 'starting', progress: 0 }
    try {
      const result = await downloadGgufFromAllowedUrl(url, {
        signal: this.downloadAbort.signal,
        onProgress: (p) => {
          this.downloadProgress = p
          onProgress?.(p)
        },
      })
      this.invalidateModelsCache()
      return result
    } finally {
      this.downloadAbort = null
    }
  }

  async deleteModel(modelId: string): Promise<void> {
    const gguf = resolveGgufPathForModelId(modelId)
    if (!gguf || !fs.existsSync(gguf)) {
      throw new Error(`Model "${modelId}" not found in models directory`)
    }
    deleteInstalledGguf(gguf)
    this.invalidateModelsCache()
  }

  async chat(modelId: string, messages: ChatMessage[], opts?: { keepAlive?: string }): Promise<ChatResponse> {
    void opts?.keepAlive ?? getAdaptiveKeepAlive()
    const t0 = Date.now()
    localLlmRuntimeInFlightDelta(1)
    try {
      await assertGpuInferenceAvailable()
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          stream: false,
        }),
        signal: AbortSignal.timeout(120000),
      })
      if (!response.ok) throw new Error(`Chat request failed: ${response.statusText}`)

      const data = (await response.json()) as OpenAiChatCompletionResponse
      const out: ChatResponse = {
        content: data.choices?.[0]?.message?.content ?? '',
        model: data.model || modelId,
        done: true,
        promptEvalCount: data.usage?.prompt_tokens,
        evalCount: data.usage?.completion_tokens,
      }
      localLlmRuntimeRecordChatTiming(Date.now() - t0)
      return out
    } catch (error) {
      console.error('[LocalLlm] Chat failed:', error)
      throw error
    } finally {
      localLlmRuntimeInFlightDelta(-1)
    }
  }

  getDownloadProgress(): DownloadProgress | null {
    return this.downloadProgress
  }

  setDownloadProgress(progress: DownloadProgress | null): void {
    this.downloadProgress = progress
  }

  getBaseUrl(): string {
    return this.baseUrl
  }

  getModelsDirectory(): string {
    return getLocalLlmModelsDirectory()
  }
}

export const localLlmManager = new LocalLlmManager()
