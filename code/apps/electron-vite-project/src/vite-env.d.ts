/// <reference types="vite/client" />

declare module 'ws'

interface CapturePresetPayload {
  mode: 'screenshot' | 'stream'
  rect: { x: number; y: number; w: number; h: number }
  displayId?: string
}

interface LmgtfyBridge {
  selectScreenshot: (opts?: { createTrigger?: boolean; addCommand?: boolean }) => Promise<unknown>
  selectStream: () => Promise<unknown>
  stopStream: () => Promise<unknown>
  getPresets: () => Promise<{ regions?: unknown[] }>
  capturePreset: (payload: CapturePresetPayload) => Promise<unknown>
  savePreset: (payload: object) => Promise<unknown>
  onCapture: (cb: (payload: unknown) => void) => () => void
  onHotkey: (cb: (kind: string) => void) => () => void
  onTriggersUpdated: (cb: () => void) => () => void
  onDashboardCommandAppend: (cb: (payload: unknown) => void) => () => void
  onDashboardTriggerPrompt: (cb: (payload: unknown) => void) => () => void
  onDashboardSelectionResult?: (cb: (payload: unknown) => void) => () => void
  onDashboardDiffResult?: (cb: (payload: unknown) => void) => () => void
  /** Main sends `{ scanId, threats }` when Electron watchdog completes a scan with threats. */
  onDashboardWatchdogAlert?: (cb: (payload: unknown) => void) => () => void
  /** Alias of `onDashboardWatchdogAlert` (same `watchdog-alert` IPC). */
  onWatchdogAlert?: (cb: (payload: unknown) => void) => () => void
  /** Removes all `watchdog-alert` listeners. */
  removeWatchdogAlertListener?: () => void
}

interface AnalysisDashboardBridge {
  onOpen: (cb: (rawPayload: unknown) => void) => () => void
  onThemeChange: (cb: (theme: string) => void) => () => void
  requestTheme: () => void
  setTheme: (theme: string) => void
  openBeapInbox: () => void
  openBeapDraft: () => void
  openEmailCompose: () => void
  openHandshakeRequest: () => void
  openWrChat: () => void
  /** Relay live Agent Box refresh to extension after dashboard WR Chat persists output (matches MV3 background broadcast). */
  relayAgentBoxOutputLive: (data: {
    agentBoxId: string
    agentBoxUuid: string
    output: string
    allBoxes: unknown[]
    sourceSurface?: 'dashboard' | 'sidepanel' | 'popup'
  }) => void
}

interface LifecycleBridge {
  onMainProcessMessage: (cb: (message: string) => void) => () => void
}

/** WR Chat dashboard helpers (`PICK_DIRECTORY` IPC). */
interface WrChatBridge {
  pickDirectory: () => Promise<string | null>
}

interface IntegrityCheck {
  name: string
  status: 'pass' | 'fail' | 'skip'
  detail: string
}

interface IntegrityStatus {
  verified: boolean
  timestamp: number
  checks: IntegrityCheck[]
  summary: string
}

interface IntegrityBridge {
  getStatus: () => Promise<IntegrityStatus>
}

/** Ollama status payload from `ollamaManager.getStatus()` / `llm:getStatus`. */
interface LlmOllamaStatus {
  installed: boolean
  running: boolean
  version?: string
  port: number
  modelsInstalled: Array<{
    name: string
    size: number
    modified: string
    digest?: string
    isActive?: boolean
  }>
  activeModel?: string
  /** Evidence-based local acceleration hints (optional for older backends). */
  localRuntime?: {
    classification: 'gpu_capable' | 'gpu_unconfirmed' | 'cpu_likely' | 'unknown'
    summary: string
    evidence?: string
    runtimeObservation?: 'none' | 'recent_warm_loads'
  }
}

/** Block reason returned by `llm:resolveAutosortRuntime`. */
type AutosortBlockReason =
  | 'provider_not_ollama'
  | 'ollama_not_running'
  | 'no_model_installed'
  | 'no_stored_model_preference'
  | 'stored_model_not_installed'
  | 'gpu_not_verified'

/** Full resolved runtime state for inbox Auto-Sort. Returned by `llm:resolveAutosortRuntime`. */
interface ResolvedInboxRuntime {
  provider: string
  model: string | null
  endpoint: string
  storedModelId: string | null
  storedModelInstalled: boolean
  installedModels: string[]
  ollamaRunning: boolean
  gpuClassification: 'gpu_capable' | 'gpu_unconfirmed' | 'cpu_likely' | 'unknown'
  gpuEvidence: string | undefined
  autosortAllowed: boolean
  blockReason: AutosortBlockReason | null
  blockMessage: string | null
}

interface LlmBridge {
  getStatus: () => Promise<{ ok: true; data: LlmOllamaStatus } | { ok: false; error: string }>
  setActiveModel: (modelId: string) => Promise<{ ok: true } | { ok: false; error: string }>
  onActiveModelChanged: (cb: (data: { modelId: string }) => void) => () => void
  resolveAutosortRuntime: () => Promise<
    { ok: true; data: ResolvedInboxRuntime } | { ok: false; error: string }
  >
}

/** TEMPORARY — main process log viewer (remove before production) */
interface MainProcessLogEntry {
  ts: string
  level: string
  line: string
}

interface DebugLogsBridge {
  onLog: (callback: (entry: MainProcessLogEntry) => void) => () => void
  removeLogListener: () => void
}

interface OrchestratorBridge {
  importSessionFromBeap: (payload: {
    sessionId: string
    sessionName: string
    config: Record<string, unknown>
    sourceMessageId: string
    handshakeId: string | null
  }) => Promise<{ success: boolean; sessionId?: string; error?: string }>
  /** Opens orchestrator SQLite (same as POST /api/orchestrator/connect). */
  connect: () => Promise<{ success: boolean; data?: unknown; error?: string }>
  listSessions: () => Promise<{ success: boolean; data?: unknown[]; error?: string }>
}

/** BEAP capsule / inline composer bridge (preload). */
interface BeapBridge {
  sendCapsuleReply: (payload: unknown) => Promise<unknown>
  extractPdfText: (payload: {
    attachmentId: string
    base64: string
  }) => Promise<{
    success?: boolean
    extractedText?: string
    error?: string
    pageCount?: number
    pagesProcessed?: number
  }>
}

interface Window {
  LETmeGIRAFFETHATFORYOU?: LmgtfyBridge
  analysisDashboard?: AnalysisDashboardBridge
  lifecycle?: LifecycleBridge
  /** Native folder picker for WR Chat Diff — `await window.wrChat?.pickDirectory()`. */
  wrChat?: WrChatBridge
  integrity?: IntegrityBridge
  debugLogs?: DebugLogsBridge
  orchestrator?: OrchestratorBridge
  beap?: BeapBridge
  /** Preload: local Ollama status and persisted active model (same store as Backend Configuration). */
  llm?: LlmBridge
}
