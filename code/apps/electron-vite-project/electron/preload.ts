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

// LLM API
contextBridge.exposeInMainWorld('llm', {
  checkHardware: () => ipcRenderer.invoke('llm:checkHardware'),
  getStatus: () => ipcRenderer.invoke('llm:getStatus'),
  startOllama: () => ipcRenderer.invoke('llm:startOllama'),
  stopOllama: () => ipcRenderer.invoke('llm:stopOllama'),
  downloadModel: (modelName: string) => ipcRenderer.invoke('llm:downloadModel', modelName),
  listModels: () => ipcRenderer.invoke('llm:listModels'),
  chat: (request: any) => ipcRenderer.invoke('llm:chat', request),
  isReady: () => ipcRenderer.invoke('llm:isReady'),
  getConfig: () => ipcRenderer.invoke('llm:getConfig'),
  updateConfig: (updates: any) => ipcRenderer.invoke('llm:updateConfig', updates),
  onDownloadProgress: (cb: (data: any) => void) => 
    ipcRenderer.on('llm:downloadProgress', (_e, d) => cb(d))
})