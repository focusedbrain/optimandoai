/**
 * Watchdog security scanner — multi-display capture + DOM snapshots (from extension)
 * and LLM-based threat analysis.
 *
 * **LLM path:** calls `ollamaManager.chat()` directly (same underlying stack as
 * `POST /api/llm/chat` for local Ollama) via dynamic `import('../main/llm/ollama-manager')`.
 * Avoids HTTP loopback and keeps `X-Launch-Secret` out of the scan hot path.
 */

import { app, nativeImage, screen } from 'electron'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { captureScreenshot } from '../lmgtfy/capture'
import type { Selection } from '../lmgtfy/overlay'
import type { ChatMessage } from '../main/llm/types'

// ─── Types ───────────────────────────────────────────────────────────────────

export type WatchdogScanRequest = {
  scanId: string
  timestamp: number
  screenshots: {
    displayId: number
    displayName: string
    base64: string
    width: number
    height: number
  }[]
  domSnapshots: { tabId: number; url: string; title: string; textContent: string }[]
}

export type WatchdogThreat = {
  severity: 'low' | 'medium' | 'high' | 'critical'
  category: string
  source: string
  summary: string
  advice: string
}

export type WatchdogResult = {
  scanId: string
  timestamp: number
  threats: WatchdogThreat[]
  clean: boolean
}

export type WatchdogConfig = {
  enabled: boolean
  intervalMs: number
  modelId?: string
  maxScreenshotWidth: number
  maxDomCharsPerTab: number
  maxTabs: number
}

const DEFAULT_WATCHDOG_CONFIG: WatchdogConfig = {
  enabled: false,
  intervalMs: 15_000,
  modelId: undefined,
  maxScreenshotWidth: 1280,
  maxDomCharsPerTab: 8000,
  maxTabs: 20,
}

/** Fallback when no vision model is configured — align with dashboard heuristics. */
const DEFAULT_WATCHDOG_MODEL_ID = 'llava'

const DOM_WAIT_MS = 10_000
const THREAT_FILE_RETENTION_MS = 5 * 60 * 1000

/** Minimum time between scan starts (manual / HTTP spam). */
const MIN_SCAN_INTERVAL_MS = 10_000
/** Continuous polling cannot fire faster than this (also enforced in setConfig). */
const MIN_CONTINUOUS_INTERVAL_MS = 10_000
/** If `watchdog-temp` grows beyond this, wipe it before the next scan. */
const MAX_WATCHDOG_TEMP_BYTES = 100 * 1024 * 1024
/** Defense-in-depth cap on DOM text in the prompt (matches extension `maxTotalDomChars`). */
const MAX_DOM_TEXT_TOTAL_CHARS = 100_000

/** Rough vision-token estimate from base64 payload length (~4 chars per token for base64). */
function estimateImageTokensFromBase64Length(base64Len: number): number {
  if (base64Len <= 0) return 0
  return Math.round(base64Len / 4)
}

function getDirSizeBytesRecursive(dir: string): number {
  if (!fs.existsSync(dir)) return 0
  let total = 0
  const walk = (d: string) => {
    let names: string[]
    try {
      names = fs.readdirSync(d)
    } catch {
      return
    }
    for (const name of names) {
      const p = path.join(d, name)
      try {
        const st = fs.statSync(p)
        if (st.isDirectory()) walk(p)
        else total += st.size
      } catch {
        /* noop */
      }
    }
  }
  try {
    walk(dir)
  } catch {
    /* noop */
  }
  return total
}

function wipeDirContents(dir: string): void {
  if (!fs.existsSync(dir)) return
  let names: string[]
  try {
    names = fs.readdirSync(dir)
  } catch {
    return
  }
  for (const name of names) {
    const p = path.join(dir, name)
    try {
      const st = fs.statSync(p)
      if (st.isDirectory()) {
        fs.rmSync(p, { recursive: true, force: true })
      } else {
        fs.unlinkSync(p)
      }
    } catch {
      /* noop */
    }
  }
}

function maybeGlobalGc(): void {
  try {
    const gc = (globalThis as { gc?: () => void }).gc
    gc?.()
  } catch {
    /* noop */
  }
}

export const WATCHDOG_SYSTEM_PROMPT = `You are a cybersecurity watchdog assistant. You are shown screenshots of a user's computer screens and text content from their open browser tabs.
Analyse ALL content for security threats including but not limited to:

Phishing attempts (fake login pages, credential harvesting)
Scam websites or messages (fake prizes, urgency tactics, too-good-to-be-true offers)
Fraud indicators (fake invoices, impersonation, business email compromise)
Suspicious or malicious links (URL mismatches, homograph attacks, shortened URLs to unknown destinations)
Chat fraud (romance scams, fake tech support, social engineering in messaging apps)
Social engineering (urgency, impersonation, manipulation outside chat contexts)
Malware indicators (fake download buttons, deceptive install prompts, suspicious executables)
Fishy emails (spoofed senders, urgent action requests, unexpected attachments)
Fake or spoofed websites (banking, social media, government impersonation)
Suspicious browser extensions or popups

Respond ONLY with a JSON object. No markdown, no explanation outside the JSON.
If threats are found:
{
"threats": [
{
"severity": "low|medium|high|critical",
"category": "phishing|scam|malware|social_engineering|suspicious_link|fake_login|chat_fraud|fraud|other",
"source": "Screen 1|Tab: example.com|etc",
"summary": "Brief description of what was detected",
"advice": "What the user should do"
}
]
}
If everything looks safe:
{ "threats": [] }`

/** Smart Summary — executive workspace overview (same capture as Watchdog; plain-text reply). */
const SMART_SUMMARY_SYSTEM_PROMPT = `You are a workspace activity summarizer for WR Desk, a secure business communication platform. Analyze the user's current workspace and provide a concise executive summary.

Include:
- What tabs/applications are currently open and what the user appears to be working on
- Any notable inbox activity (unread counts, urgent items, pending reviews)
- Current project or task context if visible
- Key numbers or metrics visible on dashboards
- Any items that may need attention

Format: Write 3-5 short paragraphs. Be specific about what you see. Use a professional but friendly tone. Do not speculate beyond what is visible.`

const SEVERITIES = new Set(['low', 'medium', 'high', 'critical'])

function watchdogTempRoot(): string {
  return path.join(app.getPath('home'), '.opengiraffe', 'lmgtfy', 'watchdog-temp')
}

function displayLabel(d: Electron.Display): string {
  const label = (d as Electron.Display & { label?: string }).label
  return typeof label === 'string' && label.trim() ? label.trim() : `Display ${d.id}`
}

function llmFailureThreat(): WatchdogThreat {
  return {
    severity: 'low',
    category: 'other',
    source: 'Watchdog',
    summary: 'Scan failed — could not reach AI model',
    advice: 'Check that your local LLM is running',
  }
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class WatchdogService {
  private config: WatchdogConfig = { ...DEFAULT_WATCHDOG_CONFIG }
  private intervalHandle: NodeJS.Timeout | null = null
  private scanInFlight = false
  /** Mutually exclusive with {@link scanInFlight} — same DOM/screenshot pipeline. */
  private smartSummaryInFlight = false
  private readonly tempDir = watchdogTempRoot()

  /**
   * Populated during `captureAllScreens` — PNG paths from `lmgtfy/capture.ts` (dated under
   * `~/.opengiraffe/lmgtfy/captures/`). `tempDir` (`watchdog-temp`) is enforced separately for size/cleanup.
   */
  private capturePathsBuffer: string[] = []

  private domResolve: ((snapshots: WatchdogScanRequest['domSnapshots']) => void) | null = null
  private domTimeout: NodeJS.Timeout | null = null

  private broadcastFn: ((msg: Record<string, unknown>) => void) | null = null

  private onScanCompleteCb: ((result: WatchdogResult) => void) | null = null

  private readonly pendingDeletionTimeouts = new Set<NodeJS.Timeout>()

  /** Last time `runScan` actually started work (after rate-limit checks). */
  private lastScanStartTimeMs = 0
  /** Consecutive skips because `scanInFlight` (continuous overlap). */
  private consecutiveOverlapSkips = 0

  /** Injected from main.ts — must call `broadcastToExtensions` for extension clients. */
  setBroadcast(fn: (msg: Record<string, unknown>) => void): void {
    this.broadcastFn = fn
  }

  setOnScanComplete(cb: (result: WatchdogResult) => void): void {
    this.onScanCompleteCb = cb
  }

  setConfig(partial: Partial<WatchdogConfig>): void {
    const wasRunning = this.intervalHandle !== null
    const prevInterval = this.config.intervalMs
    this.config = { ...this.config, ...partial }
    if (partial.intervalMs !== undefined) {
      this.config.intervalMs = Math.max(MIN_CONTINUOUS_INTERVAL_MS, this.config.intervalMs)
    }

    if (partial.enabled === false && wasRunning) {
      this.stopContinuous()
    }

    if (
      wasRunning &&
      this.intervalHandle !== null &&
      partial.intervalMs !== undefined &&
      partial.intervalMs !== prevInterval
    ) {
      clearInterval(this.intervalHandle)
      this.intervalHandle = setInterval(() => {
        void this.runScan()
      }, Math.max(MIN_CONTINUOUS_INTERVAL_MS, this.config.intervalMs))
    }
  }

  getConfig(): WatchdogConfig {
    return { ...this.config }
  }

  async captureAllScreens(): Promise<WatchdogScanRequest['screenshots']> {
    this.capturePathsBuffer = []
    const out: WatchdogScanRequest['screenshots'] = []
    const maxW = this.config.maxScreenshotWidth

    let displays: Electron.Display[]
    try {
      displays = screen.getAllDisplays()
    } catch (e) {
      console.warn('[Watchdog] getAllDisplays failed:', e)
      return out
    }

    for (const d of displays) {
      const sel: Selection = {
        displayId: d.id,
        x: 0,
        y: 0,
        w: d.size.width,
        h: d.size.height,
        dpr: d.scaleFactor,
      }
      const displayName = displayLabel(d)

      try {
        const { filePath, thumbnailPath } = await captureScreenshot(sel)
        this.capturePathsBuffer.push(filePath, thumbnailPath)

        let img = nativeImage.createFromPath(filePath)
        try {
          const sz = img.getSize()
          if (sz.width > maxW) {
            img = img.resize({ width: maxW })
          }
        } catch (e) {
          console.warn('[Watchdog] resize failed, using original:', e)
        }

        const pngBuf = img.toPNG()
        const base64 = pngBuf.toString('base64')
        const { width, height } = img.getSize()

        out.push({
          displayId: d.id,
          displayName,
          base64,
          width,
          height,
        })
      } catch (e) {
        console.warn('[Watchdog] captureScreenshot failed for display', d.id, e instanceof Error ? e.message : e)
      }
    }

    let totalBase64Chars = 0
    for (const s of out) {
      totalBase64Chars += s.base64.length
    }
    const estImgTokens = estimateImageTokensFromBase64Length(totalBase64Chars)
    console.log(
      '[Watchdog] screenshots:',
      out.length,
      'display(s); estimated image tokens (from base64 length) ≈',
      estImgTokens,
    )

    return out
  }

  handleDomResponse(snapshots: WatchdogScanRequest['domSnapshots']): void {
    const fn = this.domResolve
    this.domResolve = null
    if (this.domTimeout) {
      clearTimeout(this.domTimeout)
      this.domTimeout = null
    }
    if (fn) {
      try {
        fn(Array.isArray(snapshots) ? snapshots : [])
      } catch (e) {
        console.warn('[Watchdog] domResolve callback error:', e)
      }
    }
  }

  async requestDomSnapshots(): Promise<WatchdogScanRequest['domSnapshots']> {
    if (!this.broadcastFn) {
      console.warn('[Watchdog] requestDomSnapshots: setBroadcast not configured')
      return []
    }

    return new Promise((resolve) => {
      if (this.domTimeout) {
        clearTimeout(this.domTimeout)
        this.domTimeout = null
      }
      this.domResolve = null

      this.domTimeout = setTimeout(() => {
        this.domTimeout = null
        this.domResolve = null
        resolve([])
      }, DOM_WAIT_MS)

      this.domResolve = (snapshots) => {
        if (this.domTimeout) {
          clearTimeout(this.domTimeout)
          this.domTimeout = null
        }
        this.domResolve = null
        resolve(snapshots)
      }

      try {
        this.broadcastFn({
          type: 'WATCHDOG_REQUEST_DOM',
          maxTabs: this.config.maxTabs,
          /** Extension `background.ts` reads `maxCharsPerTab`; keep alias for clarity. */
          maxCharsPerTab: this.config.maxDomCharsPerTab,
          maxDomCharsPerTab: this.config.maxDomCharsPerTab,
          maxTotalDomChars: MAX_DOM_TEXT_TOTAL_CHARS,
        })
      } catch (e) {
        console.warn('[Watchdog] broadcast WATCHDOG_REQUEST_DOM failed:', e instanceof Error ? e.message : e)
        if (this.domTimeout) {
          clearTimeout(this.domTimeout)
          this.domTimeout = null
        }
        this.domResolve = null
        resolve([])
      }
    })
  }

  /** Returns `messages` for Ollama chat; `modelId` is config preference (effective model resolved in `runScan`). */
  buildWatchdogPrompt(scan: WatchdogScanRequest): { messages: ChatMessage[]; modelId?: string } {
    const maxTabs = Math.max(1, this.config.maxTabs)
    const maxChars = Math.max(0, this.config.maxDomCharsPerTab)
    const domSlice = scan.domSnapshots.slice(0, maxTabs)

    const textBlocks: string[] = []
    for (const tab of domSlice) {
      const text = (tab.textContent ?? '').slice(0, maxChars)
      textBlocks.push(`[Tab: ${tab.title} | ${tab.url}]\n${text}\n---`)
    }
    const joined = textBlocks.join('\n\n')
    const userText =
      joined.length > MAX_DOM_TEXT_TOTAL_CHARS ? joined.slice(0, MAX_DOM_TEXT_TOTAL_CHARS) : joined

    const imageB64s = scan.screenshots.map((s) => s.base64)

    const userMsg: ChatMessage = {
      role: 'user',
      content:
        userText.length > 0
          ? `Browser tab text (truncated per settings):\n\n${userText}`
          : 'No browser tab text was provided for this scan.',
      ...(imageB64s.length > 0 ? { images: imageB64s } : {}),
    }

    const messages: ChatMessage[] = [{ role: 'system', content: WATCHDOG_SYSTEM_PROMPT }, userMsg]

    const modelId = this.config.modelId?.trim()
    return { messages, ...(modelId ? { modelId } : {}) }
  }

  /** Same tab truncation rules as {@link buildWatchdogPrompt}; user message is plain text + optional vision images. */
  private buildSummaryPrompt(scan: WatchdogScanRequest): ChatMessage[] {
    const maxTabs = Math.max(1, this.config.maxTabs)
    const maxChars = Math.max(0, this.config.maxDomCharsPerTab)
    const domSlice = scan.domSnapshots.slice(0, maxTabs)

    const textBlocks: string[] = []
    for (const tab of domSlice) {
      const text = (tab.textContent ?? '').slice(0, maxChars)
      textBlocks.push(`[Tab: ${tab.title} | ${tab.url}]\n${text}\n---`)
    }
    const joined = textBlocks.join('\n\n')
    const userText =
      joined.length > MAX_DOM_TEXT_TOTAL_CHARS ? joined.slice(0, MAX_DOM_TEXT_TOTAL_CHARS) : joined

    const imageB64s = scan.screenshots.map((s) => s.base64)

    const userMsg: ChatMessage = {
      role: 'user',
      content: userText.length > 0 ? userText : '(No tab content captured)',
      ...(imageB64s.length > 0 ? { images: imageB64s } : {}),
    }

    return [{ role: 'system', content: SMART_SUMMARY_SYSTEM_PROMPT }, userMsg]
  }

  parseWatchdogResponse(responseText: string): WatchdogThreat[] {
    const raw = stripMarkdownFences(responseText.trim())
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      console.warn('[Watchdog] parseWatchdogResponse JSON parse failed (non-JSON model output)')
      return []
    }

    if (!parsed || typeof parsed !== 'object') return []
    const threats = (parsed as { threats?: unknown }).threats
    if (!Array.isArray(threats)) return []

    const out: WatchdogThreat[] = []
    for (const t of threats) {
      if (!t || typeof t !== 'object') continue
      const o = t as Record<string, unknown>
      const severity = o.severity
      const category = o.category
      const source = o.source
      const summary = o.summary
      const advice = o.advice
      if (
        typeof severity !== 'string' ||
        !SEVERITIES.has(severity as WatchdogThreat['severity']) ||
        typeof category !== 'string' ||
        typeof source !== 'string' ||
        typeof summary !== 'string' ||
        typeof advice !== 'string'
      ) {
        continue
      }
      out.push({
        severity: severity as WatchdogThreat['severity'],
        category,
        source,
        summary,
        advice,
      })
    }
    return out
  }

  async runScan(): Promise<WatchdogResult> {
    if (this.smartSummaryInFlight) {
      console.warn('[Watchdog] scan skipped — smart summary in progress')
      return { scanId: '', timestamp: Date.now(), threats: [], clean: true }
    }

    if (this.scanInFlight) {
      this.consecutiveOverlapSkips++
      console.warn('[Watchdog] scan skipped — previous scan still in progress')
      if (this.consecutiveOverlapSkips >= 3) {
        this.autoIncreaseIntervalAfterSlowScans()
      }
      return { scanId: '', timestamp: Date.now(), threats: [], clean: true }
    }

    const now = Date.now()
    if (this.lastScanStartTimeMs > 0 && now - this.lastScanStartTimeMs < MIN_SCAN_INTERVAL_MS) {
      console.warn('[Watchdog] scan rate-limited: minimum interval', MIN_SCAN_INTERVAL_MS, 'ms between starts')
      return { scanId: '', timestamp: now, threats: [], clean: true }
    }

    this.enforceTempDirSizeLimitBeforeScan()

    this.scanInFlight = true
    this.lastScanStartTimeMs = now
    this.consecutiveOverlapSkips = 0
    const scanStartedAt = Date.now()
    const scanId = randomUUID()
    const timestamp = Date.now()

    let scan: WatchdogScanRequest | null = null
    let metaScreens = 0
    let metaDomTabs = 0
    let responseLen = 0
    let threatCount = 0

    try {
      const [screenshots, domSnapshots] = await Promise.all([
        this.captureAllScreens(),
        this.requestDomSnapshots(),
      ])
      const capturePaths = [...this.capturePathsBuffer]
      metaScreens = screenshots.length
      metaDomTabs = domSnapshots.length

      console.log('[Watchdog] scan start', { scanId, screens: metaScreens, domTabs: metaDomTabs })

      scan = {
        scanId,
        timestamp,
        screenshots,
        domSnapshots,
      }

      const { messages } = this.buildWatchdogPrompt(scan)

      let responseText = ''
      try {
        const { ollamaManager } = await import('../main/llm/ollama-manager')
        this.logWatchdogRemotePrivacyNote(ollamaManager)

        const configured = this.config.modelId?.trim()
        const effective =
          configured || (await ollamaManager.getEffectiveChatModelName()) || DEFAULT_WATCHDOG_MODEL_ID
        const chatRes = await ollamaManager.chat(effective, messages)
        responseText = typeof chatRes?.content === 'string' ? chatRes.content : ''
        responseLen = responseText.length
        if (!responseText) {
          this.scheduleDeletion(capturePaths)
          const result: WatchdogResult = {
            scanId,
            timestamp,
            threats: [llmFailureThreat()],
            clean: false,
          }
          this.onScanCompleteCb?.(result)
          return result
        }
      } catch (e) {
        console.warn('[Watchdog] ollamaManager.chat failed:', e instanceof Error ? e.message : e)
        this.scheduleDeletion(capturePaths)
        const result: WatchdogResult = {
          scanId,
          timestamp,
          threats: [llmFailureThreat()],
          clean: false,
        }
        this.onScanCompleteCb?.(result)
        return result
      }

      const threats = this.parseWatchdogResponse(responseText)
      threatCount = threats.length
      const clean = threats.length === 0
      const result: WatchdogResult = { scanId, timestamp, threats, clean }

      if (clean) {
        this.deletePaths(capturePaths)
      } else {
        this.scheduleDeletion(capturePaths)
      }

      this.onScanCompleteCb?.(result)
      return result
    } catch (e) {
      console.warn('[Watchdog] runScan error:', e instanceof Error ? e.message : e)
      const paths = [...this.capturePathsBuffer]
      this.scheduleDeletion(paths)
      const result: WatchdogResult = {
        scanId,
        timestamp,
        threats: [llmFailureThreat()],
        clean: false,
      }
      this.onScanCompleteCb?.(result)
      return result
    } finally {
      const durationMs = Date.now() - scanStartedAt
      console.log('[Watchdog] scan end', {
        durationMs,
        scanId,
        screens: metaScreens,
        domTabs: metaDomTabs,
        responseChars: responseLen,
        threatCount,
      })
      this.clearScanSensitivePayload(scan)
      this.scanInFlight = false
      this.consecutiveOverlapSkips = 0
      maybeGlobalGc()
    }
  }

  /**
   * One-shot workspace summary: same multi-display + DOM capture as {@link runScan}, different system prompt; returns plain text.
   * Excludes from running concurrently with {@link runScan} (shared extension DOM handshake).
   */
  async runSmartSummary(): Promise<string> {
    if (this.scanInFlight || this.smartSummaryInFlight) {
      throw new Error('Capture pipeline busy')
    }

    this.enforceTempDirSizeLimitBeforeScan()

    const scanStartedAt = Date.now()
    const scanId = randomUUID()
    const timestamp = Date.now()
    let scan: WatchdogScanRequest | null = null

    this.smartSummaryInFlight = true
    try {
      const [screenshots, domSnapshots] = await Promise.all([
        this.captureAllScreens(),
        this.requestDomSnapshots(),
      ])
      const capturePaths = [...this.capturePathsBuffer]

      console.log('[SmartSummary] start', { scanId, screens: screenshots.length, domTabs: domSnapshots.length })

      scan = {
        scanId,
        timestamp,
        screenshots,
        domSnapshots,
      }

      const messages = this.buildSummaryPrompt(scan)

      const { ollamaManager } = await import('../main/llm/ollama-manager')
      this.logWatchdogRemotePrivacyNote(ollamaManager)

      const configured = this.config.modelId?.trim()
      const effective =
        configured || (await ollamaManager.getEffectiveChatModelName()) || DEFAULT_WATCHDOG_MODEL_ID
      const chatRes = await ollamaManager.chat(effective, messages)
      const responseText = typeof chatRes?.content === 'string' ? chatRes.content.trim() : ''

      this.deletePaths(capturePaths)

      if (!responseText) {
        return 'No summary available.'
      }
      return responseText
    } catch (e) {
      console.warn('[SmartSummary] failed:', e instanceof Error ? e.message : e)
      const paths = [...this.capturePathsBuffer]
      if (paths.length > 0) this.scheduleDeletion(paths)
      throw e instanceof Error ? e : new Error(String(e))
    } finally {
      console.log('[SmartSummary] end', { scanId, durationMs: Date.now() - scanStartedAt })
      this.clearScanSensitivePayload(scan)
      this.smartSummaryInFlight = false
      maybeGlobalGc()
    }
  }

  /**
   * Extension `buildLlmRequestBody` routes cloud when `!isLocal` and adds `provider` + `apiKey`.
   * Watchdog uses `ollamaManager.chat()` only (no provider/apiKey on the request body). Warn if the
   * configured Ollama base URL is not localhost (e.g. remote Ollama tunnel).
   */
  private logWatchdogRemotePrivacyNote(ollamaManager: { getBaseUrl: () => string }): void {
    try {
      const u = new URL(ollamaManager.getBaseUrl())
      const host = u.hostname.toLowerCase()
      if (host !== '127.0.0.1' && host !== 'localhost') {
        console.warn(
          '[Watchdog] WARNING: Watchdog is sending screen captures to a remote API. Consider using a local model.',
        )
      }
    } catch {
      /* ignore */
    }
  }

  private enforceTempDirSizeLimitBeforeScan(): void {
    try {
      fs.mkdirSync(this.tempDir, { recursive: true })
    } catch {
      /* noop */
    }
    const size = getDirSizeBytesRecursive(this.tempDir)
    if (size > MAX_WATCHDOG_TEMP_BYTES) {
      console.warn(
        '[Watchdog] watchdog-temp exceeds',
        MAX_WATCHDOG_TEMP_BYTES,
        'bytes (actual',
        size,
        ') — forcing cleanup',
      )
      wipeDirContents(this.tempDir)
    }
  }

  private clearScanSensitivePayload(scan: WatchdogScanRequest | null): void {
    if (!scan) return
    for (const s of scan.screenshots) {
      s.base64 = ''
    }
    for (const d of scan.domSnapshots) {
      d.textContent = ''
    }
  }

  private autoIncreaseIntervalAfterSlowScans(): void {
    const old = this.config.intervalMs
    const doubled = Math.min(old * 2, 3_600_000)
    this.config.intervalMs = Math.max(MIN_CONTINUOUS_INTERVAL_MS, doubled)
    console.warn('[Watchdog] interval auto-increased to', this.config.intervalMs, 'ms due to slow scans')
    this.consecutiveOverlapSkips = 0
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle)
      this.intervalHandle = setInterval(() => {
        void this.runScan()
      }, Math.max(MIN_CONTINUOUS_INTERVAL_MS, this.config.intervalMs))
    }
  }

  private deletePaths(paths: string[]): void {
    for (const p of paths) {
      try {
        if (fs.existsSync(p)) fs.unlinkSync(p)
      } catch {
        /* noop */
      }
    }
  }

  private scheduleDeletion(paths: string[]): void {
    if (paths.length === 0) return
    const t = setTimeout(() => {
      this.pendingDeletionTimeouts.delete(t)
      this.deletePaths(paths)
    }, THREAT_FILE_RETENTION_MS)
    this.pendingDeletionTimeouts.add(t)
  }

  startContinuous(): void {
    if (this.intervalHandle) return
    this.config.enabled = true
    this.config.intervalMs = Math.max(MIN_CONTINUOUS_INTERVAL_MS, this.config.intervalMs)
    this.intervalHandle = setInterval(() => {
      void this.runScan()
    }, Math.max(MIN_CONTINUOUS_INTERVAL_MS, this.config.intervalMs))
  }

  stopContinuous(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle)
      this.intervalHandle = null
    }
    this.config.enabled = false
  }

  isContinuousRunning(): boolean {
    return this.intervalHandle !== null
  }

  isScanning(): boolean {
    return this.scanInFlight
  }

  isSmartSummaryRunning(): boolean {
    return this.smartSummaryInFlight
  }

  cleanup(): void {
    this.stopContinuous()
    for (const t of this.pendingDeletionTimeouts) {
      clearTimeout(t)
    }
    this.pendingDeletionTimeouts.clear()
    try {
      wipeDirContents(this.tempDir)
    } catch (e) {
      console.warn('[Watchdog] cleanup tempDir failed:', e instanceof Error ? e.message : e)
    }
  }
}

function stripMarkdownFences(s: string): string {
  let t = s.trim()
  if (t.startsWith('```')) {
    const firstNl = t.indexOf('\n')
    if (firstNl !== -1) t = t.slice(firstNl + 1)
    if (t.endsWith('```')) {
      t = t.slice(0, -3).trim()
    }
  }
  return t
}

export const watchdogService = new WatchdogService()
