import { app, BrowserWindow, globalShortcut, Tray, Menu, Notification } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
// WS bridge removed to avoid port conflicts; extension fallback/deep-link is used
import { registerHandler, LmgtfyChannels, emitCapture } from './lmgtfy/ipc'
import { selectRegion, beginOverlay } from './lmgtfy/overlay'
import { captureScreenshot, startRegionStream } from './lmgtfy/capture'
import { loadPresets, upsertRegion } from './lmgtfy/presets'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null
let pendingLaunchMode: 'screenshot' | 'stream' | null = null
let tray: Tray | null = null
// Track connected WS clients (extension bridge)
var wsClients: any[] = (globalThis as any).__og_ws_clients__ || [];
(globalThis as any).__og_ws_clients__ = wsClients;


function handleDeepLink(raw: string) {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'opengiraffe:') return
    const action = url.hostname // e.g., lmgtfy
    const mode = url.searchParams.get('mode') || ''
    if (action === 'lmgtfy') {
      if (mode === 'screenshot' || mode === 'stream') pendingLaunchMode = mode as any
      if (win) {
        const fire = () => {
          if (!pendingLaunchMode) return
          win?.webContents.send('hotkey', pendingLaunchMode === 'screenshot' ? 'screenshot' : 'stream')
          pendingLaunchMode = null
        }
        if (win.webContents.isLoading()) {
          win.webContents.once('did-finish-load', fire)
        } else {
          fire()
        }
      }
    }
  } catch {}
}

async function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
    show: false,
  })

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }

  if (pendingLaunchMode) {
    win.webContents.once('did-finish-load', () => {
      if (!pendingLaunchMode) return
      win?.webContents.send('hotkey', pendingLaunchMode === 'screenshot' ? 'screenshot' : 'stream')
      pendingLaunchMode = null
    })
  }

  // LmGTFY IPC wiring
  let activeStop: null | (() => Promise<string>) = null
  registerHandler(LmgtfyChannels.GetPresets, () => loadPresets())
  registerHandler(LmgtfyChannels.SavePreset, async (_e, payload) => upsertRegion(payload))
  // Overlay direct IPC (renderer->main) to drive capture + posting
  try {
    const { ipcMain } = await import('electron')
    ipcMain.on('overlay-cmd', async (_e, msg: any) => {
      try {
        if (!msg || !msg.action) return
        if (msg.action === 'shot') {
          const rect = msg.rect || { x:0,y:0,w:0,h:0 }
          const displayId = Number(msg.displayId)||0
          const sel = { displayId, x: rect.x, y: rect.y, w: rect.w, h: rect.h, dpr: 1 }
          const { filePath } = await captureScreenshot(sel as any)
          await postScreenshotToPopup(filePath, { x: sel.x, y: sel.y, w: sel.w, h: sel.h, dpr: 1 })
          // Optionally save tagged trigger
          try {
            if (msg.createTrigger && typeof msg.triggerName === 'string' && msg.triggerName.trim()) {
              upsertRegion({ id: undefined, name: String(msg.triggerName).trim(), displayId, x: rect.x, y: rect.y, w: rect.w, h: rect.h, mode: 'screenshot', headless: true })
              // notify extension to refresh dropdown
              try { const { webContents } = await import('electron'); webContents.getAllWebContents().forEach(c=>{ try{ c.send('TRIGGERS_UPDATED') }catch{} }) } catch {}
              try { wsClients.forEach(c=>{ try { c.send(JSON.stringify({ type: 'TRIGGERS_UPDATED' })) } catch {} }) } catch {}
            }
          } catch {}
          // Close overlay only after successful posting is enqueued
          try { win?.webContents.send('overlay-close') } catch {}
          return
        }
        if (msg.action === 'stream-post') {
          const dataUrl = typeof msg.dataUrl === 'string' ? msg.dataUrl : ''
          if (dataUrl) {
            try {
              const payload = JSON.stringify({ type: 'SELECTION_RESULT_VIDEO', kind: 'video', dataUrl })
              wsClients.forEach((c) => { try { c.send(payload) } catch {} })
            } catch {}
            try { const { webContents } = await import('electron'); webContents.getAllWebContents().forEach(c=>{ try{ c.send('COMMAND_POPUP_APPEND',{ kind:'video', url: dataUrl }) }catch{} }) } catch {}
          }
          // Close overlay only after posting is sent
          try { win?.webContents.send('overlay-close') } catch {}
          return
        }
        if (msg.action === 'stream-start') {
          const rect = msg.rect || { x:0,y:0,w:0,h:0 }
          const displayId = Number(msg.displayId)||0
          const sel = { displayId, x: rect.x, y: rect.y, w: rect.w, h: rect.h, dpr: 1 }
          const controller = await startRegionStream(sel as any)
          activeStop = controller.stop
          // Keep overlay visible during recording; notify UI
          emitCapture(win!, { event: LmgtfyChannels.OnCaptureEvent, mode: 'stream', filePath: '', thumbnailPath: '', meta: { x: sel.x, y: sel.y, w: sel.w, h: sel.h, dpr: 1, displayId } })
          // Optionally save tagged trigger (non-headless stream)
          try {
            if (msg.createTrigger && typeof msg.triggerName === 'string' && msg.triggerName.trim()) {
              upsertRegion({ id: undefined, name: String(msg.triggerName).trim(), displayId, x: rect.x, y: rect.y, w: rect.w, h: rect.h, mode: 'stream', headless: false })
              try { const { webContents } = await import('electron'); webContents.getAllWebContents().forEach(c=>{ try{ c.send('TRIGGERS_UPDATED') }catch{} }) } catch {}
              try { wsClients.forEach(c=>{ try { c.send(JSON.stringify({ type: 'TRIGGERS_UPDATED' })) } catch {} }) } catch {}
            }
          } catch {}
          return
        }
        if (msg.action === 'stream-stop') {
          if (!activeStop) return
          const out = await activeStop()
          activeStop = null
          await postStreamToPopup(out)
          try { win?.webContents.send('overlay-close') } catch {}
          return
        }
      } catch {}
    })
  } catch {}
  registerHandler(LmgtfyChannels.SelectScreenshot, async () => {
    const sel = await selectRegion('screenshot')
    if (!sel || !win) return null
    const { filePath, thumbnailPath } = await captureScreenshot(sel)
    await postScreenshotToPopup(filePath, sel)
    return { filePath, thumbnailPath }
  })
  registerHandler(LmgtfyChannels.SelectStream, async () => {
    const sel = await selectRegion('stream')
    if (!sel || !win) return null
    const controller = await startRegionStream(sel)
    activeStop = controller.stop
    emitCapture(win, {
      event: LmgtfyChannels.OnCaptureEvent,
      mode: 'stream',
      filePath: '',
      thumbnailPath: '',
      meta: { x: sel.x, y: sel.y, w: sel.w, h: sel.h, dpr: sel.dpr, displayId: sel.displayId },
    })
    return { ok: true }
  })
  registerHandler(LmgtfyChannels.StopStream, async () => {
    if (!activeStop || !win) return null
    const out = await activeStop()
    activeStop = null
    await postStreamToPopup(out)
    return { filePath: out }
  })
  registerHandler(LmgtfyChannels.CapturePreset, async (_e, payload: { mode: 'screenshot'|'stream', rect: { x:number,y:number,w:number,h:number }, displayId?: number }) => {
    if (!win) return null
    // Bypass interactive selector; directly emit capture or stream marker
    if (payload.mode === 'screenshot') {
      const sel = { displayId: payload.displayId ?? 0, x: payload.rect.x, y: payload.rect.y, w: payload.rect.w, h: payload.rect.h, dpr: 1 }
      const { filePath, thumbnailPath } = await captureScreenshot(sel as any)
      emitCapture(win, { event: LmgtfyChannels.OnCaptureEvent, mode: 'screenshot', filePath, thumbnailPath, meta: { x: sel.x, y: sel.y, w: sel.w, h: sel.h, dpr: sel.dpr, displayId: sel.displayId } })
      return { filePath, thumbnailPath }
    } else {
      const sel = { displayId: payload.displayId ?? 0, x: payload.rect.x, y: payload.rect.y, w: payload.rect.w, h: payload.rect.h, dpr: 1 }
      const controller = await startRegionStream(sel as any)
      activeStop = controller.stop
      emitCapture(win, { event: LmgtfyChannels.OnCaptureEvent, mode: 'stream', filePath: '', thumbnailPath: '', meta: { x: sel.x, y: sel.y, w: sel.w, h: sel.h, dpr: sel.dpr, displayId: sel.displayId } })
      return { ok: true }
    }
  })

  // Global hotkeys
  globalShortcut.register('Alt+Shift+S', () => win?.webContents.send('hotkey', 'screenshot'))
  globalShortcut.register('Alt+Shift+V', () => win?.webContents.send('hotkey', 'stream'))
  globalShortcut.register('Alt+0', () => win?.webContents.send('hotkey', 'stop'))

  // Process deep link passed on first launch (Windows passes in argv)
  const arg = process.argv.find(a => a.startsWith('opengiraffe://'))
  if (arg) handleDeepLink(arg)
}

function createTray() {
  try {
    tray = new Tray(path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'))
    const menu = Menu.buildFromTemplate([
      { label: 'Show', click: () => { if (!win) return; win.show(); win.focus() } },
      { type: 'separator' },
      { label: 'Screenshot (Alt+Shift+S)', click: () => win?.webContents.send('hotkey', 'screenshot') },
      { label: 'Stream (Alt+Shift+V)', click: () => win?.webContents.send('hotkey', 'stream') },
      { label: 'Stop Stream (Alt+0)', click: () => win?.webContents.send('hotkey', 'stop') },
      { type: 'separator' },
      { label: 'Quit', role: 'quit' },
    ])
    tray.setToolTip('OpenGiraffe Orchestrator')
    tray.setContextMenu(menu)
    tray.on('click', () => { if (!win) return; if (win.isVisible()) win.focus(); else win.show() })
    // Startup toast
    try {
      new Notification({ title: 'OpenGiraffe Orchestrator', body: 'Running in background. Use Alt+Shift+S or chat icons to capture.' }).show()
    } catch {}
  } catch {}
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
// Single instance + protocol
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
    const arg = argv.find(a => a.startsWith('opengiraffe://'))
    if (arg) handleDeepLink(arg)
  })
}

app.setAsDefaultProtocolClient('opengiraffe')

app.on('open-url', (event, url) => {
  event.preventDefault()
  handleDeepLink(url)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(async () => {
  try { process.env.WS_NO_BUFFER_UTIL = '1'; process.env.WS_NO_UTF_8_VALIDATE = '1' } catch {}
  // Auto-start on login (Windows/macOS). Pass --hidden so it starts in background.
  try {
    if (process.platform === 'win32' || process.platform === 'darwin') {
      app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] })
    }
    if (process.platform === 'win32') {
      app.setAppUserModelId('com.opengiraffe.desktop')
    }
  } catch {}
  createWindow()
  createTray()
  // WS bridge for extension (127.0.0.1:51247) with safe startup
  try {
    const mod = await import('ws').catch(() => null)
    const WebSocketServer = (mod && (mod as any).WebSocketServer) || null
    if (WebSocketServer) {
      const wss = new WebSocketServer({ host: '127.0.0.1', port: 51247 })
      wss.on('error', (err: any) => {
        try {
          const msg = String((err && (err.code || err.message)) || '')
          if (msg.includes('EADDRINUSE')) { try { wss.close() } catch {} }
        } catch {}
      })
      wss.on('connection', (socket: any) => {
        try { wsClients.push(socket) } catch {}
        socket.on('close', () => { try { wsClients = wsClients.filter(s => s !== socket) } catch {} })
        socket.on('message', async (raw: any) => {
          try {
            const msg = JSON.parse(String(raw))
            if (!msg || !msg.type) return
            if (msg.type === 'ping') { try { socket.send(JSON.stringify({ type: 'pong' })) } catch {} }
            if (msg.type === 'START_SELECTION') {
              const mode = msg.mode === 'stream' ? 'stream' : 'screenshot'
              // Open interactive overlay that mirrors extension UX; overlay drives posting via IPC
              beginOverlay(mode)
            }
          } catch {}
        })
      })
    }
  } catch {}
})

// Helpers to post to popup chat and close overlay via background
async function postScreenshotToPopup(filePath: string, sel: { x:number,y:number,w:number,h:number,dpr:number }){
  try {
    emitCapture(win!, { event: LmgtfyChannels.OnCaptureEvent, mode: 'screenshot', filePath, thumbnailPath: '', meta: { x: sel.x, y: sel.y, w: sel.w, h: sel.h, dpr: sel.dpr } })
  } catch {}
  try {
    const fs = await import('node:fs')
    const data = fs.readFileSync(filePath)
    const dataUrl = 'data:image/png;base64,' + data.toString('base64')
    const payload = JSON.stringify({ type: 'SELECTION_RESULT_IMAGE', kind: 'image', dataUrl })
    wsClients.forEach((c) => { try { c.send(payload) } catch {} })
    // Ask popup to append directly and show thumbnail
    try { const { webContents } = await import('electron'); webContents.getAllWebContents().forEach(c=>{ try{ c.send('COMMAND_POPUP_APPEND',{ kind:'image', url: dataUrl, thumbnail: dataUrl }) }catch{} }) } catch {}
    try { win?.webContents.send('overlay-close') } catch {}
  } catch {}
}

async function postStreamToPopup(filePath: string){
  try {
    emitCapture(win!, { event: LmgtfyChannels.OnCaptureEvent, mode: 'stream', filePath, thumbnailPath: '', meta: { presetName: 'finalized', x: 0, y: 0, w: 0, h: 0, dpr: 1 } })
  } catch {}
  try {
    const fs = await import('node:fs')
    let dataUrl = ''
    try {
      const data = fs.readFileSync(filePath)
      const base64 = data.toString('base64')
      dataUrl = 'data:video/mp4;base64,' + base64
    } catch {}
    const payload = JSON.stringify({ type: 'SELECTION_RESULT_VIDEO', kind: 'video', dataUrl })
    wsClients.forEach((c) => { try { c.send(payload) } catch {} })
    try { const { webContents } = await import('electron'); webContents.getAllWebContents().forEach(c=>{ try{ c.send('COMMAND_POPUP_APPEND',{ kind:'video', url: dataUrl, thumbnail: dataUrl }) }catch{} }) } catch {}
    try { win?.webContents.send('overlay-close') } catch {}
  } catch {}
}
