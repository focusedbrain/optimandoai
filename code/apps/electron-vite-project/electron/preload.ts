import { ipcRenderer, contextBridge } from 'electron'

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },

  // You can expose other APTs you need here.
  // ...
})

// LmGTFY bridge
contextBridge.exposeInMainWorld('lmgtfy', {
  selectScreenshot: () => ipcRenderer.invoke('lmgtfy/select-screenshot'),
  selectStream: () => ipcRenderer.invoke('lmgtfy/select-stream'),
  stopStream: () => ipcRenderer.invoke('lmgtfy/stop-stream'),
  getPresets: () => ipcRenderer.invoke('lmgtfy/get-presets'),
  capturePreset: (payload: any) => ipcRenderer.invoke('lmgtfy/capture-preset', payload),
  savePreset: (payload: any) => ipcRenderer.invoke('lmgtfy/save-preset', payload),
  onCapture: (cb: (payload: any) => void) => ipcRenderer.on('lmgtfy.capture', (_e, d) => cb(d)),
  onHotkey: (cb: (kind: string) => void) => ipcRenderer.on('hotkey', (_e, k) => cb(k)),
})

// Alias with requested name
contextBridge.exposeInMainWorld('LETmeGIRAFFETHATFORYOU', {
  selectScreenshot: () => ipcRenderer.invoke('lmgtfy/select-screenshot'),
  selectStream: () => ipcRenderer.invoke('lmgtfy/select-stream'),
  stopStream: () => ipcRenderer.invoke('lmgtfy/stop-stream'),
  getPresets: () => ipcRenderer.invoke('lmgtfy/get-presets'),
  capturePreset: (payload: any) => ipcRenderer.invoke('lmgtfy/capture-preset', payload),
  savePreset: (payload: any) => ipcRenderer.invoke('lmgtfy/save-preset', payload),
  onCapture: (cb: (payload: any) => void) => ipcRenderer.on('lmgtfy.capture', (_e, d) => cb(d)),
  onHotkey: (cb: (kind: string) => void) => ipcRenderer.on('hotkey', (_e, k) => cb(k)),
})

// Database API
contextBridge.exposeInMainWorld('db', {
  testConnection: (config: any) => ipcRenderer.invoke('db:testConnection', config),
  sync: (data: Record<string, any>) => ipcRenderer.invoke('db:sync', data),
  getConfig: () => ipcRenderer.invoke('db:getConfig'),
})

// Analysis Dashboard API - safe, scoped listener for main->renderer signaling
// Payload is passed as-is; renderer is responsible for validation/sanitization
contextBridge.exposeInMainWorld('analysisDashboard', {
  onOpen: (callback: (rawPayload: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, rawPayload: unknown) => {
      callback(rawPayload)
    }
    ipcRenderer.on('OPEN_ANALYSIS_DASHBOARD', handler)
    // Return cleanup function
    return () => {
      ipcRenderer.removeListener('OPEN_ANALYSIS_DASHBOARD', handler)
    }
  },
  onThemeChange: (callback: (theme: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: { theme: string }) => {
      callback(payload.theme)
    }
    ipcRenderer.on('THEME_CHANGED', handler)
    // Return cleanup function
    return () => {
      ipcRenderer.removeListener('THEME_CHANGED', handler)
    }
  },
  // Request current theme from main process
  requestTheme: () => {
    ipcRenderer.send('REQUEST_THEME')
  },
  // Send theme change from renderer to main process
  setTheme: (theme: string) => {
    ipcRenderer.send('SET_THEME', theme)
  },
  // Open BEAP Inbox popup (triggers Chrome extension popup via WebSocket)
  openBeapInbox: () => {
    ipcRenderer.send('OPEN_BEAP_INBOX')
  }
})