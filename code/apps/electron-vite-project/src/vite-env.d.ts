/// <reference types="vite/client" />

declare module 'ws'

interface Window {
  lmgtfy?: {
    selectScreenshot: () => Promise<any>
    selectStream: () => Promise<any>
    stopStream: () => Promise<any>
    getPresets: () => Promise<any>
    capturePreset: (payload: any) => Promise<any>
    savePreset: (payload: any) => Promise<any>
    onCapture: (cb: (payload: any) => void) => void
    onHotkey: (cb: (kind: string) => void) => void
  }
  LETmeGIRAFFETHATFORYOU?: Window['lmgtfy']
}