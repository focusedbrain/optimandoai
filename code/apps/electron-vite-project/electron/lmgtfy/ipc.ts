import { BrowserWindow, ipcMain, IpcMainInvokeEvent } from 'electron'

export const LmgtfyChannels = {
  SelectScreenshot: 'lmgtfy/select-screenshot',
  SelectStream: 'lmgtfy/select-stream',
  StopStream: 'lmgtfy/stop-stream',
  CapturePreset: 'lmgtfy/capture-preset',
  GetPresets: 'lmgtfy/get-presets',
  SavePreset: 'lmgtfy/save-preset',
  OnCaptureEvent: 'lmgtfy.capture',
} as const

export type CaptureMode = 'screenshot' | 'stream'

export interface CaptureMeta {
  presetName?: string
  x: number
  y: number
  w: number
  h: number
  dpr: number
  displayId?: number
  createTrigger?: boolean
}

export interface CaptureEventPayload {
  event: typeof LmgtfyChannels.OnCaptureEvent
  mode: CaptureMode
  filePath: string
  thumbnailPath?: string
  meta: CaptureMeta
}

export function emitCapture(targetWindow: BrowserWindow, payload: CaptureEventPayload): void {
  if (!targetWindow?.webContents) return
  targetWindow.webContents.send(LmgtfyChannels.OnCaptureEvent, payload)
}

export function registerHandler<T extends any[]>(
  channel: string,
  handler: (e: IpcMainInvokeEvent, ...args: T) => any,
) {
  ipcMain.handle(channel, handler)
}

export function unregisterAll() {
  ipcMain.removeHandler(LmgtfyChannels.SelectScreenshot)
  ipcMain.removeHandler(LmgtfyChannels.SelectStream)
  ipcMain.removeHandler(LmgtfyChannels.StopStream)
  ipcMain.removeHandler(LmgtfyChannels.GetPresets)
  ipcMain.removeHandler(LmgtfyChannels.SavePreset)
}


