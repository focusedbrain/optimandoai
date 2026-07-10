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
import { getLocalLlmServerConfig } from './localLlmServerConfig'
import {
  buildLlamaServerArgs,
  computeMaxCtxForVram,
  estimateKvBytesPerTokenFromGgufFile,
  queryNvidiaVramUsage,
  readLlamaServerHelpText,
  type ResolvedSpawnPlan,
} from './llamaServerArgs'
import { RotatingLogWriter, llamaServerLogPath } from './llamaServerLog'

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

  // --- Shared cached probe (B2): single underlying probe for checkInstalled/getStatus/
  // isRunning/listModelsRaw. TTL when healthy; exponential backoff while down so a stopped
  // or not-yet-installed server does not get hammered by every uncoordinated caller.
  private _probeCache: {
    at: number
    result: { ok: boolean; serverReachable: boolean; baseUrl: string; modelCount: number }
  } | null = null
  private _probeInFlight: Promise<{
    ok: boolean
    serverReachable: boolean
    baseUrl: string
    modelCount: number
  }> | null = null
  private _probeBackoffMs = 2_000
  private readonly PROBE_OK_TTL_MS = 3_000
  private readonly PROBE_BACKOFF_BASE_MS = 2_000
  private readonly PROBE_BACKOFF_MAX_MS = 30_000

  // build038: managed spawn configuration state
  private serverLogWriter: RotatingLogWriter | null = null
  private lastSpawnPlan: ResolvedSpawnPlan | null = null
  private lastSpawnClampNotice: string | null = null
  private helpTextCache: { binaryPath: string; text: string } | null = null
  private restartPending = false
  private restartWaitingForTasks = false

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

  /** Cached `--help` output of the installed binary (re-read when the path changes). */
  private async getServerHelpText(): Promise<string> {
    if (this.helpTextCache && this.helpTextCache.binaryPath === this.serverBinaryPath) {
      return this.helpTextCache.text
    }
    const text = await readLlamaServerHelpText(this.serverBinaryPath)
    this.helpTextCache = { binaryPath: this.serverBinaryPath, text }
    return text
  }

  /**
   * build038: resolve the spawn plan for a GGUF — persisted config, flag
   * verification against the installed binary's --help, and VRAM-fit ctx clamp
   * based on the actual model file size + GGUF KV metadata.
   */
  private async resolveSpawnPlan(gguf: string): Promise<ResolvedSpawnPlan> {
    const config = getLocalLlmServerConfig()
    let helpText = ''
    try {
      helpText = await this.getServerHelpText()
    } catch (e) {
      console.warn('[LOCAL_LLM_SPAWN] help_probe_failed — spawning with base args only:', e)
    }

    let maxCtxTokens: number | null = null
    try {
      const vram = await queryNvidiaVramUsage()
      if (vram) {
        const modelFileBytes = fs.statSync(gguf).size
        const kv = estimateKvBytesPerTokenFromGgufFile(gguf)
        const fit = computeMaxCtxForVram({
          vramTotalBytes: vram.totalBytes,
          modelFileBytes,
          kvBytesPerToken: kv.kvBytesPerToken,
          parallel: config.parallel,
          trainedCtx: kv.trainedCtx,
        })
        maxCtxTokens = fit.maxCtx
        console.log(
          `[LOCAL_LLM_SPAWN] vram_budget total_mb=${Math.round(vram.totalBytes / 1024 ** 2)} model_mb=${Math.round(modelFileBytes / 1024 ** 2)} kv_per_token=${kv.kvBytesPerToken} kv_source=${kv.source} max_ctx=${fit.maxCtx} fits=${fit.fits}`,
        )
      }
    } catch (e) {
      console.warn('[LOCAL_LLM_SPAWN] vram_budget_failed — no ctx clamp applied:', e)
    }

    return buildLlamaServerArgs({
      ggufPath: gguf,
      port: this.serverPort,
      config,
      helpText,
      maxCtxTokens,
    })
  }

  private async spawnOwnedServer(gguf: string, trigger: string): Promise<void> {
    if (this.process && this.weOwnProcess) {
      console.log('[LocalLlm] Owned llama-server process already tracked')
      return
    }

    const plan = await this.resolveSpawnPlan(gguf)
    this.lastSpawnPlan = plan
    for (const flag of plan.unsupportedFlags) {
      console.warn(`[LOCAL_LLM_SPAWN] flag_unsupported=${flag} — omitted for this binary`)
    }
    if (plan.ctxClamped) {
      this.lastSpawnClampNotice = `Settings reduced to fit your GPU memory (context ${plan.ctxRequested.toLocaleString()} → ${plan.ctxTokens.toLocaleString()} tokens).`
      console.warn(
        `[LOCAL_LLM_SPAWN] ctx_clamped from=${plan.ctxRequested} to=${plan.ctxTokens} reason=vram_fit`,
      )
    } else {
      this.lastSpawnClampNotice = null
    }

    console.log(`[LocalLlm] Starting llama-server on loopback trigger=${trigger} model=${path.basename(gguf)}`)
    console.log(`[LOCAL_LLM_SPAWN] args=${JSON.stringify(plan.args)}`)

    this.serverLogWriter?.close()
    this.serverLogWriter = new RotatingLogWriter(llamaServerLogPath())
    this.serverLogWriter.write(
      `\n===== [${new Date().toISOString()}] spawn trigger=${trigger} args=${JSON.stringify(plan.args)} =====\n`,
    )

    const proc = spawn(this.serverBinaryPath, plan.args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    proc.stdout?.on('data', (chunk: Buffer) => this.serverLogWriter?.write(chunk))
    proc.stderr?.on('data', (chunk: Buffer) => this.serverLogWriter?.write(chunk))
    this.process = proc
    this.weOwnProcess = true
    this.attachProcessExitHandler(proc)
  }

  /** UI: last applied spawn settings + clamp notice (null before the first spawn). */
  getLastSpawnPlan(): { plan: ResolvedSpawnPlan | null; clampNotice: string | null } {
    return { plan: this.lastSpawnPlan, clampNotice: this.lastSpawnClampNotice }
  }

  /**
   * UI: computed "Maximum" ctx for the active model with the given parallel
   * setting, plus current VRAM usage for the status line.
   */
  async computeServerConfigInsight(parallel: number): Promise<{
    maxCtxTokens: number | null
    kvSource: 'gguf' | 'fallback' | null
    vramUsedBytes: number | null
    vramTotalBytes: number | null
  }> {
    const vram = await queryNvidiaVramUsage()
    let maxCtxTokens: number | null = null
    let kvSource: 'gguf' | 'fallback' | null = null
    try {
      const active = await this.getEffectiveChatModelName()
      const gguf = active ? resolveGgufPathForModelId(active) : null
      if (vram && gguf) {
        const kv = estimateKvBytesPerTokenFromGgufFile(gguf)
        kvSource = kv.source
        maxCtxTokens = computeMaxCtxForVram({
          vramTotalBytes: vram.totalBytes,
          modelFileBytes: fs.statSync(gguf).size,
          kvBytesPerToken: kv.kvBytesPerToken,
          parallel,
          trainedCtx: kv.trainedCtx,
        }).maxCtx
      }
    } catch {
      /* insight is best-effort */
    }
    return {
      maxCtxTokens,
      kvSource,
      vramUsedBytes: vram?.usedBytes ?? null,
      vramTotalBytes: vram?.totalBytes ?? null,
    }
  }

  getRestartState(): { pending: boolean; waitingForTasks: boolean } {
    return { pending: this.restartPending, waitingForTasks: this.restartWaitingForTasks }
  }

  /**
   * build038 "Apply & restart AI server": graceful restart that waits for
   * in-flight inference to drain (up to `maxWaitMs`) before killing the server.
   * Returns immediately; the UI polls {@link getRestartState} + server status.
   */
  async restartManagedServerGraceful(p?: { maxWaitMs?: number }): Promise<{
    ok: boolean
    queued: boolean
    reason?: string
  }> {
    if (this.restartPending) {
      return { ok: true, queued: true, reason: 'restart_already_pending' }
    }
    this.restartPending = true
    const maxWaitMs = p?.maxWaitMs ?? 600_000
    void (async () => {
      try {
        const deadline = Date.now() + maxWaitMs
        while (localLlmRuntimeGetInFlight() > 0 && Date.now() < deadline) {
          this.restartWaitingForTasks = true
          await new Promise((resolve) => setTimeout(resolve, 1_000))
        }
        this.restartWaitingForTasks = false
        console.log('[LOCAL_LLM_LIFECYCLE] restart_apply_settings draining_done')
        this.shuttingDown = true
        try {
          await this.stop()
          // Let the old child's exit event drain while shuttingDown=true so it is
          // logged as expected and does not schedule a competing supervised restart.
          await new Promise((resolve) => setTimeout(resolve, 500))
        } finally {
          this.shuttingDown = false
        }
        this.invalidateProbeCache()
        await this.ensureManagedServerRunning({ reason: 'apply_settings_restart' })
      } catch (e) {
        console.warn('[LOCAL_LLM_LIFECYCLE] restart_apply_settings_failed:', e)
      } finally {
        this.restartPending = false
        this.restartWaitingForTasks = false
      }
    })()
    return { ok: true, queued: true }
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

  /**
   * `ok` = "usable somehow" (server reachable OR GGUF found on disk) — kept for
   * `checkInstalled()`'s historical "is there anything to work with" semantics.
   * `serverReachable` = strictly "llama-server answered over HTTP" — the ONLY field B1
   * consumers (`serverRunning`, `isRunning`, `getStatus().running`) may use. Do not derive
   * "is the server running" from `ok`: a disk-only GGUF match must never report the server
   * as reachable (that was the root cause of the `ollama_ok: true`-while-down regression).
   */
  async probeHttpModelsWithLogging(): Promise<{
    ok: boolean
    serverReachable: boolean
    baseUrl: string
    modelCount: number
  }> {
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
        return { ok: true, serverReachable: true, baseUrl: b, modelCount: total }
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
      return { ok: true, serverReachable: false, baseUrl: b, modelCount: diskOnly.length }
    }
    console.log('[HOST_PROVIDER] llamacpp_probe method=http ok=false reason=unreachable')
    return {
      ok: false,
      serverReachable: false,
      baseUrl: bases[0] ?? `http://127.0.0.1:${DEFAULT_LLAMACPP_PORT}`,
      modelCount: 0,
    }
  }

  async probeHttpTagsWithLogging(): Promise<{
    ok: boolean
    serverReachable: boolean
    baseUrl: string
    modelCount: number
  }> {
    return this.probeHttpModelsWithLogging()
  }

  /**
   * Shared cached prober (B2) — wraps {@link probeHttpModelsWithLogging} with a short TTL
   * cache while healthy and exponential backoff (2s → 30s) while unreachable, so uncoordinated
   * callers (UI polling, warmup poll loop, BEAP ad gate, provider status) collapse onto a single
   * underlying network probe instead of firing one each. All read paths in this class
   * (`checkInstalled`, `getStatus`, `isRunning`, `listModelsRaw`) should call this instead of the
   * raw prober.
   */
  async probeCached(): Promise<{
    ok: boolean
    serverReachable: boolean
    baseUrl: string
    modelCount: number
  }> {
    const now = Date.now()
    if (this._probeCache) {
      // Cache/backoff is keyed on `serverReachable`, not `ok` — a disk-only match must not
      // reset the backoff clock as if the server had actually answered.
      const ttl = this._probeCache.result.serverReachable ? this.PROBE_OK_TTL_MS : this._probeBackoffMs
      if (now - this._probeCache.at < ttl) {
        return this._probeCache.result
      }
    }
    if (this._probeInFlight) return this._probeInFlight
    this._probeInFlight = this.probeHttpModelsWithLogging().then(
      (result) => {
        this._probeCache = { at: Date.now(), result }
        this._probeBackoffMs = result.serverReachable
          ? this.PROBE_BACKOFF_BASE_MS
          : Math.min(this._probeBackoffMs * 2, this.PROBE_BACKOFF_MAX_MS)
        this._probeInFlight = null
        return result
      },
      (err) => {
        this._probeInFlight = null
        throw err
      },
    )
    return this._probeInFlight
  }

  /** Force the next {@link probeCached} call to re-probe immediately (e.g. after install/start). */
  invalidateProbeCache(): void {
    this._probeCache = null
    this._probeInFlight = null
    this._probeBackoffMs = this.PROBE_BACKOFF_BASE_MS
  }

  async checkInstalled(): Promise<boolean> {
    if (!this.isBinaryAvailable()) {
      return this.scanGgufModelsOnDisk().length > 0
    }
    try {
      return (await this.probeCached()).ok || this.scanGgufModelsOnDisk().length > 0
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
    // B2: read the shared cached probe only — do not layer an extra uncached `/health`
    // fetch on top (that previously defeated the cache/backoff for every caller of isRunning).
    // Uses `serverReachable` (real HTTP signal), never `ok` (which also covers disk-only).
    const r = await this.probeCached()
    return r.serverReachable
  }

  async stop(): Promise<void> {
    this.clearRestartTimer()
    this.serverLogWriter?.close()
    this.serverLogWriter = null
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
    // B2: `running`/`installed` both derive from the single shared cached probe — no
    // separate uncached `/health` round trip per status call. `running` uses the strict
    // `serverReachable` signal; `installed` keeps the broader "usable somehow" (server OR
    // disk) semantics that `checkInstalled()` also uses, via `probe.ok`.
    const probe = await this.probeCached()
    const installed = probe.ok
    const running = probe.serverReachable
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

    const localRuntime = await buildLocalLlmRuntimeInfo({ localLlmRunning: probe.serverReachable, activeModel })

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
    // B2: consult the shared cached probe first — while backed off (server known-down), skip
    // the direct network attempt entirely and serve from disk instead of firing an independent
    // uncached fetch every time the model list is requested.
    const pr = await this.probeCached()
    if (!pr.serverReachable) {
      return this.scanGgufModelsOnDisk()
    }
    try {
      const data = await fetchModels(this.baseUrl)
      if (data) return this.parseOpenAiModelsResponse(data)
    } catch (error) {
      console.error('[LocalLlm] Error listing models from server:', error)
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
    this.invalidateProbeCache()
  }

  /** Re-resolve the server binary path (bundled → Windows install dir → PATH) after a fresh B0 install. */
  refreshServerBinaryPath(): void {
    this.initializeServerBinaryPath()
    this.invalidateProbeCache()
    this.helpTextCache = null
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
    // llama-server's OpenAI-compatible endpoint has no `keep_alive` concept (Ollama-specific);
    // kept as a no-op read so callers passing `opts.keepAlive` don't need updating yet.
    void (opts?.keepAlive ?? getAdaptiveKeepAlive())
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

  getPort(): number {
    return this.serverPort
  }

  getModelsDirectory(): string {
    return getLocalLlmModelsDirectory()
  }
}

export const localLlmManager = new LocalLlmManager()
