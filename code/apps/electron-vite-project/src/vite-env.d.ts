/// <reference types="vite/client" />

declare module 'ws'

interface CapturePresetPayload {
  mode: 'screenshot' | 'stream'
  rect: { x: number; y: number; w: number; h: number }
  displayId?: string
}

interface LmgtfyBridge {
  selectScreenshot: () => Promise<unknown>
  selectStream: () => Promise<unknown>
  stopStream: () => Promise<unknown>
  getPresets: () => Promise<{ regions?: unknown[] }>
  capturePreset: (payload: CapturePresetPayload) => Promise<unknown>
  savePreset: (payload: object) => Promise<unknown>
  onCapture: (cb: (payload: unknown) => void) => () => void
  onHotkey: (cb: (kind: string) => void) => () => void
  onTriggersUpdated: (cb: () => void) => () => void
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
}

interface LifecycleBridge {
  onMainProcessMessage: (cb: (message: string) => void) => () => void
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
  integrity?: IntegrityBridge
  debugLogs?: DebugLogsBridge
  orchestrator?: OrchestratorBridge
  beap?: BeapBridge
}
