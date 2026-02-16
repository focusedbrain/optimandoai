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
}

interface LifecycleBridge {
  onMainProcessMessage: (cb: (message: string) => void) => () => void
}

interface Window {
  LETmeGIRAFFETHATFORYOU?: LmgtfyBridge
  analysisDashboard?: AnalysisDashboardBridge
  lifecycle?: LifecycleBridge
}
