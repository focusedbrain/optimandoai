import { app, BrowserWindow, globalShortcut, Tray, Menu, Notification } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { WebSocketServer } from 'ws'
// WS bridge removed to avoid port conflicts; extension fallback/deep-link is used
import { registerHandler, LmgtfyChannels, emitCapture } from './lmgtfy/ipc'
import { beginOverlay, closeAllOverlays, showStreamTriggerOverlay } from './lmgtfy/overlay'
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
let activeStop: null | (() => Promise<string>) = null
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
  registerHandler(LmgtfyChannels.GetPresets, () => loadPresets())
  registerHandler(LmgtfyChannels.SavePreset, async (_e, payload) => upsertRegion(payload))
  
  // Overlay direct IPC (renderer->main) to drive capture + posting
  try {
    const { ipcMain } = await import('electron')
    ipcMain.on('overlay-log', (_e, msg: string) => {
      console.log(msg)
    })
    // Handle request for desktop sources (for video recording)
    ipcMain.handle('get-desktop-sources', async (_e, opts: any) => {
      try {
        const { desktopCapturer } = await import('electron')
        const sources = await desktopCapturer.getSources(opts)
        return sources.map(s => ({ id: s.id, name: s.name, display_id: s.display_id }))
      } catch (err) {
        console.log('[MAIN] Error getting desktop sources:', err)
        return []
      }
    })
    // Handle overlay cancel (X button or Escape key)
    ipcMain.on('overlay-selection', (_e, msg: any) => {
      try {
        if (msg && msg.cancel) {
          // Just close the overlay without posting anything
          console.log('[MAIN] Overlay cancelled by user')
          try { win?.webContents.send('overlay-close') } catch {}
        }
      } catch {}
    })
    // Handle trigger saved from UI
    ipcMain.on('TRIGGER_SAVED', async () => {
      try {
        console.log('[MAIN] Trigger saved, updating menus...')
        updateTrayMenu()
        // Notify all windows and extension
        try { const { webContents } = await import('electron'); webContents.getAllWebContents().forEach(c=>{ try{ c.send('TRIGGERS_UPDATED') }catch{} }) } catch {}
        try { wsClients.forEach(c=>{ try { c.send(JSON.stringify({ type: 'TRIGGERS_UPDATED' })) } catch {} }) } catch {}
      } catch (err) {
        console.log('[MAIN] Error updating after trigger save:', err)
      }
    })
    ipcMain.on('overlay-cmd', async (_e, msg: any) => {
      try {
        console.log('[MAIN] Overlay command received:', msg?.action)
        
        if (!msg || !msg.action) return
        if (msg.action === 'shot') {
          console.log('[MAIN] Screenshot action - createTrigger:', msg.createTrigger)
          const rect = msg.rect || { x:0,y:0,w:0,h:0 }
          const displayId = Number(msg.displayId)||0
          const sel = { displayId, x: rect.x, y: rect.y, w: rect.w, h: rect.h, dpr: 1 }
          const { filePath } = await captureScreenshot(sel as any)
          await postScreenshotToPopup(filePath, { x: sel.x, y: sel.y, w: sel.w, h: sel.h, dpr: 1 })
          // Close all overlay windows if requested
          if (msg.closeOverlay) {
            try { closeAllOverlays() } catch {}
          }
          // Show trigger prompt UI in extension popup if requested
          if (msg.createTrigger) {
            console.log('[MAIN] Requesting trigger prompt in extension for screenshot')
            try {
              // Send to extension via WebSocket to show trigger prompt in popup
              wsClients.forEach(client => {
                try {
                  client.send(JSON.stringify({
                    type: 'SHOW_TRIGGER_PROMPT',
                    mode: 'screenshot',
                    rect,
                    displayId,
                    imageUrl: filePath // Send the file path so extension can display the image
                  }))
                } catch {}
              })
              console.log('[MAIN] Trigger prompt request sent to extension')
            } catch (err) {
              console.log('[MAIN] Error sending trigger prompt request:', err)
            }
          }
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
          // Close all overlay windows after video is posted
          try { closeAllOverlays() } catch {}
          return
        }
        if (msg.action === 'stream-start') {
          console.log('[MAIN] Starting stream recording... createTrigger:', msg.createTrigger)
          const rect = msg.rect || { x:0,y:0,w:0,h:0 }
          const displayId = Number(msg.displayId)||0
          const sel = { displayId, x: rect.x, y: rect.y, w: rect.w, h: rect.h, dpr: 1 }
          // Store trigger info if needed (will show prompt after stream stops)
          const shouldCreateTrigger = msg.createTrigger
          try {
            const controller = await startRegionStream(sel as any)
            activeStop = controller.stop
            // Store trigger info for after recording
            if (shouldCreateTrigger) {
              (activeStop as any)._triggerInfo = { mode: 'stream', rect, displayId }
              console.log('[MAIN] Storing trigger info for after stream stops')
            }
            console.log('[MAIN] Stream recording started successfully')
            // Keep overlay visible during recording; notify UI
            if (win) emitCapture(win, { event: LmgtfyChannels.OnCaptureEvent, mode: 'stream', filePath: '', thumbnailPath: '', meta: { x: sel.x, y: sel.y, w: sel.w, h: sel.h, dpr: 1, displayId } })
          } catch (err) {
            console.log('[MAIN] Error starting stream:', err)
          }
          return
        }
        if (msg.action === 'stream-stop') {
          console.log('[MAIN] Stopping stream recording...')
          if (!activeStop) {
            console.log('[MAIN] No active recording to stop')
            return
          }
          const triggerInfo = (activeStop as any)._triggerInfo
          console.log('[MAIN] Trigger info:', triggerInfo)
          const out = await activeStop()
          activeStop = null
          console.log('[MAIN] Stream stopped, posting video...')
          await postStreamToPopup(out)
          console.log('[MAIN] Video posted, closing overlays...')
          try { closeAllOverlays() } catch {}
          // Show trigger prompt UI in extension popup if requested
          if (triggerInfo) {
            console.log('[MAIN] Requesting trigger prompt in extension for stream')
            try {
              // Send to extension via WebSocket to show trigger prompt in popup
              wsClients.forEach(client => {
                try {
                  client.send(JSON.stringify({
                    type: 'SHOW_TRIGGER_PROMPT',
                    mode: triggerInfo.mode,
                    rect: triggerInfo.rect,
                    displayId: triggerInfo.displayId,
                    videoUrl: out // Send the video file path
                  }))
                } catch {}
              })
              console.log('[MAIN] Trigger prompt request sent to extension')
            } catch (err) {
              console.log('[MAIN] Error sending trigger prompt request:', err)
            }
          }
          return
        }
      } catch {}
    })
  } catch {}
  // Old IPC handlers (now using simple overlay for screenshots)
  registerHandler(LmgtfyChannels.SelectScreenshot, async () => {
    // Using simple overlay now via WebSocket START_SELECTION
    return null
  })
  registerHandler(LmgtfyChannels.SelectStream, async () => {
    // Using simple overlay now via WebSocket START_SELECTION
    return null
  })
  registerHandler(LmgtfyChannels.StopStream, async () => {
    if (!activeStop || !win) return null
    const out = await activeStop()
    activeStop = null
    await postStreamToPopup(out)
    return { filePath: out }
  })
  // Execute saved trigger (headless for screenshots, visible for streams)
  registerHandler(LmgtfyChannels.CapturePreset, async (_e, payload: { mode: 'screenshot'|'stream', rect: { x:number,y:number,w:number,h:number }, displayId?: number }) => {
    if (!win) return null
    try {
      const sel = { displayId: payload.displayId ?? 0, x: payload.rect.x, y: payload.rect.y, w: payload.rect.w, h: payload.rect.h, dpr: 1 }
      
      if (payload.mode === 'screenshot') {
        // Screenshot triggers are HEADLESS - capture directly and post to command chat
        console.log('[MAIN] Executing headless screenshot trigger:', sel)
        const { filePath, thumbnailPath } = await captureScreenshot(sel as any)
        await postScreenshotToPopup(filePath, { x: sel.x, y: sel.y, w: sel.w, h: sel.h, dpr: 1 })
        emitCapture(win, { event: LmgtfyChannels.OnCaptureEvent, mode: 'screenshot', filePath, thumbnailPath, meta: { x: sel.x, y: sel.y, w: sel.w, h: sel.h, dpr: sel.dpr, displayId: sel.displayId } })
        return { filePath, thumbnailPath }
      } else {
        // Stream triggers are VISIBLE - show overlay and start recording
        console.log('[MAIN] Executing visible stream trigger:', sel)
        // Show visible overlay at the saved position
        showStreamTriggerOverlay(sel.displayId, { x: sel.x, y: sel.y, w: sel.w, h: sel.h })
        // Start recording immediately
        const controller = await startRegionStream(sel as any)
        activeStop = controller.stop
        return { ok: true }
      }
    } catch (err) {
      console.log('[MAIN] Error executing trigger:', err)
      return { error: String(err) }
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
    updateTrayMenu()
    tray.setToolTip('OpenGiraffe Orchestrator')
    tray.on('click', () => { if (!win) return; if (win.isVisible()) win.focus(); else win.show() })
    // Startup toast
    try {
      new Notification({ title: 'OpenGiraffe Orchestrator', body: 'Running in background. Use Alt+Shift+S or chat icons to capture.' }).show()
    } catch {}
  } catch {}
}

function updateTrayMenu() {
  if (!tray) return
  try {
    const presets = loadPresets()
    const triggerMenuItems: Electron.MenuItemConstructorOptions[] = []
    
    if (presets.regions && presets.regions.length > 0) {
      presets.regions.forEach((trigger) => {
        const icon = trigger.mode === 'screenshot' ? '📸' : '🎥'
        triggerMenuItems.push({
          label: `${icon} ${trigger.name}`,
          click: async () => {
            if (!win) return
            // Execute trigger directly
            try {
              const sel = { displayId: trigger.displayId ?? 0, x: trigger.x, y: trigger.y, w: trigger.w, h: trigger.h, dpr: 1 }
              if (trigger.mode === 'screenshot') {
                console.log('[TRAY] Executing screenshot trigger:', trigger.name)
                const { filePath } = await captureScreenshot(sel as any)
                await postScreenshotToPopup(filePath, { x: sel.x, y: sel.y, w: sel.w, h: sel.h, dpr: 1 })
              } else if (trigger.mode === 'stream') {
                console.log('[TRAY] Executing stream trigger:', trigger.name)
                // Show visible overlay at the saved position
                showStreamTriggerOverlay(sel.displayId, { x: sel.x, y: sel.y, w: sel.w, h: sel.h })
                // Start recording immediately
                const controller = await startRegionStream(sel as any)
                activeStop = controller.stop
              }
            } catch (err) {
              console.log('[TRAY] Error executing trigger:', err)
            }
          }
        })
      })
    }
    
    const menu = Menu.buildFromTemplate([
      { label: 'Show', click: () => { if (!win) return; win.show(); win.focus() } },
      { type: 'separator' },
      { label: 'Screenshot (Alt+Shift+S)', click: () => win?.webContents.send('hotkey', 'screenshot') },
      { label: 'Stream (Alt+Shift+V)', click: () => win?.webContents.send('hotkey', 'stream') },
      { label: 'Stop Stream (Alt+0)', click: () => win?.webContents.send('hotkey', 'stop') },
      ...(triggerMenuItems.length > 0 ? [
        { type: 'separator' as const },
        { label: '📌 Saved Triggers', enabled: false },
        ...triggerMenuItems,
      ] : []),
      { type: 'separator' },
      { label: 'Quit', role: 'quit' as const },
    ])
    tray.setContextMenu(menu)
  } catch (err) {
    console.log('[TRAY] Error updating menu:', err)
  }
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
    console.log('[MAIN] ===== ATTEMPTING TO START WEBSOCKET SERVER =====')
    console.log('[MAIN] WebSocketServer available:', !!WebSocketServer)
    if (WebSocketServer) {
      console.log('[MAIN] Creating WebSocket server on 127.0.0.1:51247')
      const wss = new WebSocketServer({ host: '127.0.0.1', port: 51247 })
      console.log('[MAIN] WebSocket server created!')
      wss.on('error', (err: any) => {
        try {
          const msg = String((err && (err.code || err.message)) || '')
          if (msg.includes('EADDRINUSE')) { try { wss.close() } catch {} }
        } catch {}
      })
      wss.on('connection', (socket: any) => {
        console.log('[MAIN] ===== NEW WEBSOCKET CONNECTION =====')
        try { wsClients.push(socket) } catch {}
        socket.on('close', () => { console.log('[MAIN] WebSocket connection closed'); try { wsClients = wsClients.filter(s => s !== socket) } catch {} })
        socket.on('message', async (raw: any) => {
          try {
            const msg = JSON.parse(String(raw))
            console.log('[MAIN] WebSocket message received:', msg)
            if (!msg || !msg.type) return
            if (msg.type === 'ping') { console.log('[MAIN] Ping received, sending pong'); try { socket.send(JSON.stringify({ type: 'pong' })) } catch {} }
            if (msg.type === 'START_SELECTION') {
              // Open full-featured overlay with all controls
              console.log('[MAIN] ===== RECEIVED START_SELECTION, LAUNCHING FULL OVERLAY =====')
              try {
                const fs = require('fs')
                const path = require('path')
                const os = require('os')
                fs.appendFileSync(path.join(os.homedir(), '.opengiraffe', 'main-debug.log'), '\n[MAIN] START_SELECTION received at ' + new Date().toISOString() + '\n')
              } catch {}
              beginOverlay()
            }
            if (msg.type === 'SAVE_TRIGGER') {
              // Extension sends back trigger to save in Electron's presets
              console.log('[MAIN] Received SAVE_TRIGGER from extension:', msg)
              try {
                upsertRegion({
                  id: undefined,
                  name: msg.name,
                  displayId: msg.displayId,
                  x: msg.rect.x,
                  y: msg.rect.y,
                  w: msg.rect.w,
                  h: msg.rect.h,
                  mode: msg.mode,
                  headless: msg.mode === 'screenshot'
                })
                updateTrayMenu()
                console.log('[MAIN] Trigger saved to Electron presets')
              } catch (err) {
                console.log('[MAIN] Error saving trigger:', err)
              }
            }
            if (msg.type === 'EXECUTE_TRIGGER') {
              // Extension requests execution of a saved trigger
              console.log('[MAIN] Received EXECUTE_TRIGGER from extension:', msg.trigger)
              try {
                const t = msg.trigger
                const sel = { displayId: t.displayId ?? 0, x: t.rect.x, y: t.rect.y, w: t.rect.w, h: t.rect.h, dpr: 1 }
                if (t.mode === 'screenshot') {
                  // Headless screenshot
                  console.log('[MAIN] Executing screenshot trigger headlessly')
                  ;(async () => {
                    try {
                      const { filePath } = await captureScreenshot(sel as any)
                      await postScreenshotToPopup(filePath, { x: sel.x, y: sel.y, w: sel.w, h: sel.h, dpr: 1 })
                      console.log('[MAIN] Screenshot trigger executed and posted')
                    } catch (err) {
                      console.log('[MAIN] Error executing screenshot trigger:', err)
                    }
                  })()
                } else if (t.mode === 'stream') {
                  // Visible stream overlay
                  console.log('[MAIN] Executing stream trigger with visible overlay')
                  ;(async () => {
                    try {
                      showStreamTriggerOverlay(sel.displayId, { x: sel.x, y: sel.y, w: sel.w, h: sel.h })
                      const controller = await startRegionStream(sel as any)
                      activeStop = controller.stop
                      console.log('[MAIN] Stream trigger started')
                    } catch (err) {
                      console.log('[MAIN] Error executing stream trigger:', err)
                    }
                  })()
                }
              } catch (err) {
                console.log('[MAIN] Error processing EXECUTE_TRIGGER:', err)
              }
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
