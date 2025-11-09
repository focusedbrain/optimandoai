import { app, BrowserWindow, globalShortcut, Tray, Menu, Notification, screen } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import { WebSocketServer } from 'ws'
import express from 'express'
// WS bridge removed to avoid port conflicts; extension fallback/deep-link is used
import { registerHandler, LmgtfyChannels, emitCapture } from './lmgtfy/ipc'
import { beginOverlay, closeAllOverlays, showStreamTriggerOverlay } from './lmgtfy/overlay'
import { captureScreenshot, startRegionStream } from './lmgtfy/capture'
import { loadPresets, upsertRegion } from './lmgtfy/presets'
import { registerDbHandlers, testConnection, syncChromeDataToPostgres, getConfig, getPostgresAdapter } from './ipc/db.js'

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
    show: true, // Show window immediately to prevent crash
    width: 800,
    height: 600,
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
  
  // Database IPC handlers
  registerDbHandlers()
  
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
          if (msg.createTrigger || msg.addCommand) {
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
                    imageUrl: filePath, // Send the file path so extension can display the image
                    createTrigger: !!msg.createTrigger,
                    addCommand: !!msg.addCommand
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
          console.log('[MAIN] Starting stream recording... createTrigger:', msg.createTrigger, 'addCommand:', msg.addCommand)
          const rect = msg.rect || { x:0,y:0,w:0,h:0 }
          const displayId = Number(msg.displayId)||0
          const sel = { displayId, x: rect.x, y: rect.y, w: rect.w, h: rect.h, dpr: 1 }
          // Store trigger info if needed (will show prompt after stream stops)
          const shouldCreateTrigger = msg.createTrigger
          const shouldAddCommand = msg.addCommand
          try {
            const controller = await startRegionStream(sel as any)
            activeStop = controller.stop
            // Store trigger info for after recording
            if (shouldCreateTrigger || shouldAddCommand) {
              (activeStop as any)._triggerInfo = { mode: 'stream', rect, displayId, createTrigger: !!shouldCreateTrigger, addCommand: !!shouldAddCommand }
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
                    videoUrl: out, // Send the video file path
                    createTrigger: !!triggerInfo.createTrigger,
                    addCommand: !!triggerInfo.addCommand
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
    console.log('[MAIN] ===== CapturePreset CALLED =====')
    console.log('[MAIN] Payload received:', JSON.stringify(payload, null, 2))
    try {
      // If no displayId or displayId is 0 (invalid), use primary display
      const displayId = (payload.displayId && payload.displayId !== 0) ? payload.displayId : screen.getPrimaryDisplay().id
      console.log('[MAIN] Final displayId to use:', displayId)
      const sel = { displayId: displayId, x: payload.rect.x, y: payload.rect.y, w: payload.rect.w, h: payload.rect.h, dpr: 1 }
      console.log('[MAIN] Selection object:', JSON.stringify(sel, null, 2))
      
      if (payload.mode === 'screenshot') {
        // Screenshot triggers are HEADLESS - capture directly and post to command chat
        console.log('[MAIN] Executing headless screenshot trigger:', sel)
        const { filePath, thumbnailPath } = await captureScreenshot(sel as any)
        console.log('[MAIN] Screenshot captured:', filePath)
        await postScreenshotToPopup(filePath, { x: sel.x, y: sel.y, w: sel.w, h: sel.h, dpr: 1 })
        console.log('[MAIN] Screenshot posted to popup')
        emitCapture(win, { event: LmgtfyChannels.OnCaptureEvent, mode: 'screenshot', filePath, thumbnailPath, meta: { x: sel.x, y: sel.y, w: sel.w, h: sel.h, dpr: sel.dpr, displayId: sel.displayId } })
        return { filePath, thumbnailPath }
      } else {
        // Stream triggers are VISIBLE - show overlay and start recording
        console.log('[MAIN] Executing visible stream trigger:', sel)
        // Show visible overlay at the saved position
        showStreamTriggerOverlay(sel.displayId, { x: sel.x, y: sel.y, w: sel.w, h: sel.h })
        console.log('[MAIN] Stream overlay shown')
        // Start recording immediately
        const controller = await startRegionStream(sel as any)
        activeStop = controller.stop
        console.log('[MAIN] Stream recording started')
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
// Disabled in development to avoid conflicts with Vite hot-reload
const isDev = process.env.NODE_ENV !== 'production'
const gotLock = isDev ? true : app.requestSingleInstanceLock()
if (!gotLock) {
  console.log('[MAIN] Another instance is already running, quitting...')
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

// Setup console logging to file for debugging (before app.whenReady)
let logPath: string = ''
let logFileSetup = false
async function setupFileLogging() {
  if (logFileSetup) return
  try {
    const fs = await import('fs')
    const os = await import('os')
    logPath = path.join(os.default.homedir(), '.opengiraffe', 'electron-console.log')
    const logDir = path.dirname(logPath)
    if (!fs.default.existsSync(logDir)) {
      fs.default.mkdirSync(logDir, { recursive: true })
    }
    // Write initial marker
    fs.default.appendFileSync(logPath, `\n===== Electron Console Log Started: ${new Date().toISOString()} =====\n`)
    
    // Redirect console.log and console.error to both console and file
    const originalLog = console.log
    const originalError = console.error
    console.log = (...args: any[]) => {
      originalLog(...args)
      try {
        const logLine = `[${new Date().toISOString()}] ${args.map((a: any) => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ')}\n`
        fs.default.appendFileSync(logPath, logLine)
      } catch (e) {
        originalError('[LOG ERROR]', e)
      }
    }
    console.error = (...args: any[]) => {
      originalError(...args)
      try {
        const logLine = `[${new Date().toISOString()}] ERROR: ${args.map((a: any) => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ')}\n`
        fs.default.appendFileSync(logPath, logLine)
      } catch (e) {
        originalError('[LOG ERROR]', e)
      }
    }
    logFileSetup = true
    console.log('[MAIN] Console logging to file:', logPath)
  } catch (err) {
    console.error('[MAIN] Failed to setup file logging:', err)
  }
}

// Fix Windows cache permission errors by setting a custom user data directory
const customUserDataPath = path.join(os.homedir(), '.opengiraffe', 'electron-data')
app.setPath('userData', customUserDataPath)
// Disable GPU to prevent crashes on some Windows systems
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-gpu-compositing')
app.commandLine.appendSwitch('no-sandbox')

// Add crash handlers
process.on('uncaughtException', (error) => {
  console.error('[MAIN] Uncaught exception:', error)
})

process.on('unhandledRejection', (reason) => {
  console.error('[MAIN] Unhandled rejection:', reason)
})

// Prevent app from quitting when all windows are closed
app.on('window-all-closed', () => {
  console.log('[MAIN] All windows closed, but keeping app running')
  // Don't quit - keep the app and WebSocket server running
})

console.log('[MAIN] About to call app.whenReady()')

app.whenReady().then(async () => {
  console.log('[MAIN] ===== APP READY =====')
  try {
    // Setup console logging to file for debugging
    await setupFileLogging()
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
  console.log('[MAIN] Window and tray created')
  
  // WS bridge for extension (127.0.0.1:51247) with safe startup
  try {
    console.log('[MAIN] ===== ATTEMPTING TO START WEBSOCKET SERVER =====')
    console.log('[MAIN] WebSocketServer available:', !!WebSocketServer)
    if (WebSocketServer) {
      console.log('[MAIN] Creating WebSocket server on 127.0.0.1:51247')
      const wss = new WebSocketServer({ host: '127.0.0.1', port: 51247 })
      console.log('[MAIN] WebSocket server created!')
      console.log('[MAIN] WebSocket server listening and ready for connections')
      
      wss.on('error', (err: any) => {
        console.error('[MAIN] WebSocket server error:', err)
        try {
          const msg = String((err && (err.code || err.message)) || '')
          if (msg.includes('EADDRINUSE')) { try { wss.close() } catch {} }
        } catch {}
      })
      wss.on('connection', (socket: any) => {
        console.log('[MAIN] ===== NEW WEBSOCKET CONNECTION =====')
        console.log('[MAIN] Socket readyState:', socket.readyState)
        try { wsClients.push(socket) } catch {}
        
        // Send immediate test message to verify connection works
        try {
          socket.send(JSON.stringify({ 
            type: 'ELECTRON_LOG', 
            message: '[MAIN] ✅ WebSocket connection established - ready to receive messages'
          }))
          console.log('[MAIN] ✅ Test ELECTRON_LOG sent on connection')
        } catch (testErr) {
          console.error('[MAIN] ❌ Failed to send test ELECTRON_LOG:', testErr)
        }
        
        socket.on('close', () => { console.log('[MAIN] WebSocket connection closed'); try { wsClients = wsClients.filter(s => s !== socket) } catch {} })
        socket.on('error', (err: any) => {
          console.error('[MAIN] WebSocket error:', err)
        })
        socket.on('message', async (raw: any) => {
          try {
            const rawStr = String(raw)
            console.log('[MAIN] ===== RAW WEBSOCKET MESSAGE RECEIVED =====')
            console.log('[MAIN] Raw message:', rawStr)
            
            // ALWAYS send log back to extension - this proves Electron is running new code
            try {
              const logMsg = JSON.stringify({ 
                type: 'ELECTRON_LOG', 
                message: '[MAIN] ===== RAW WEBSOCKET MESSAGE RECEIVED =====',
                rawMessage: rawStr.substring(0, 200) // Limit size
              })
              socket.send(logMsg)
              console.log('[MAIN] ✅ ELECTRON_LOG sent for raw message')
            } catch (logErr) {
              console.error('[MAIN] ❌ FAILED to send ELECTRON_LOG:', logErr)
            }
            
            const msg = JSON.parse(rawStr)
            console.log('[MAIN] Parsed message:', JSON.stringify(msg, null, 2))
            
            // Send parsed message log
            try {
              socket.send(JSON.stringify({ 
                type: 'ELECTRON_LOG', 
                message: '[MAIN] Parsed message',
                parsedMessage: { type: msg.type, hasConfig: !!msg.config }
              }))
              console.log('[MAIN] ✅ ELECTRON_LOG sent for parsed message')
            } catch (logErr) {
              console.error('[MAIN] ❌ FAILED to send parsed message log:', logErr)
            }
            
            if (!msg || !msg.type) {
              console.warn('[MAIN] Message has no type, ignoring:', msg)
              try {
                socket.send(JSON.stringify({ 
                  type: 'ELECTRON_LOG', 
                  message: '[MAIN] ⚠️ Message has no type, ignoring'
                }))
              } catch {}
              return
            }
            console.log(`[MAIN] Processing message type: ${msg.type}`)
            
            // Send message type log for ALL messages - CRITICAL for debugging
            try {
              const typeLogMsg = JSON.stringify({ 
                type: 'ELECTRON_LOG', 
                message: `[MAIN] Processing message type: ${msg.type}`,
                messageType: msg.type,
                timestamp: new Date().toISOString()
              })
              socket.send(typeLogMsg)
              console.log(`[MAIN] ✅ ELECTRON_LOG sent for message type: ${msg.type}`)
            } catch (logErr) {
              console.error('[MAIN] ❌ FAILED to send message type log:', logErr)
              console.error('[MAIN] Socket state:', {
                readyState: socket.readyState,
                OPEN: socket.OPEN,
                isOpen: socket.readyState === socket.OPEN
              })
            }
            
            if (msg.type === 'ping') { 
              console.log('[MAIN] Ping received, sending pong'); 
              try { socket.send(JSON.stringify({ type: 'pong' })) } catch (e) {
                console.error('[MAIN] Error sending pong:', e)
              }
              return // Don't process further handlers for ping
            }
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
              // (can be from Electron overlay with displayId, or extension-native without displayId)
              console.log('[MAIN] Received SAVE_TRIGGER from extension:', msg)
              try {
                let displayId = msg.displayId
                
                // If no displayId provided (extension-native trigger), try to detect it
                if (!displayId) {
                  // Get the cursor position to determine which display the user is on
                  const cursorPoint = screen.getCursorScreenPoint()
                  const displayAtCursor = screen.getDisplayNearestPoint(cursorPoint)
                  displayId = displayAtCursor.id
                  console.log('[MAIN] No displayId provided, detected display from cursor:', displayId)
                }
                
                upsertRegion({
                  id: undefined,
                  name: msg.name,
                  displayId: displayId,
                  x: msg.rect.x,
                  y: msg.rect.y,
                  w: msg.rect.w,
                  h: msg.rect.h,
                  mode: msg.mode,
                  headless: msg.mode === 'screenshot'
                })
                updateTrayMenu()
                console.log('[MAIN] Trigger saved to Electron presets with displayId:', displayId)
              } catch (err) {
                console.log('[MAIN] Error saving trigger:', err)
              }
            }
            if (msg.type === 'EXECUTE_TRIGGER') {
              // Extension requests execution of a saved trigger
              console.log('[MAIN] Received EXECUTE_TRIGGER from extension:', msg.trigger)
              try {
                const t = msg.trigger
                // If no displayId (extension-native trigger), use primary display
                const displayId = t.displayId ?? screen.getPrimaryDisplay().id
                const sel = { displayId: displayId, x: t.rect.x, y: t.rect.y, w: t.rect.w, h: t.rect.h, dpr: 1 }
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
            // Database operations via WebSocket
            if (msg.type === 'DB_TEST_CONNECTION') {
              console.log('[MAIN] ===== DB_TEST_CONNECTION HANDLER STARTED =====')
              console.log('[MAIN] Full message:', JSON.stringify(msg, null, 2))
              
              // Send log to extension immediately - CRITICAL for debugging
              try {
                const handlerLogMsg = JSON.stringify({ 
                  type: 'ELECTRON_LOG', 
                  message: '[MAIN] ===== DB_TEST_CONNECTION HANDLER STARTED =====',
                  hasConfig: !!msg.config,
                  configKeys: msg.config ? Object.keys(msg.config) : [],
                  msgKeys: Object.keys(msg)
                })
                socket.send(handlerLogMsg)
                console.log('[MAIN] ✅ ELECTRON_LOG sent for DB_TEST_CONNECTION handler start')
              } catch (logErr) {
                console.error('[MAIN] ❌ FAILED to send DB_TEST_CONNECTION handler log:', logErr)
                console.error('[MAIN] Socket readyState:', socket.readyState)
              }
              try {
                const { testConnection } = await import('./ipc/db.js')
                console.log('[MAIN] testConnection function imported successfully')
                
                // Support both msg.config and msg.data.config for compatibility
                const config = msg.config || msg.data?.config
                console.log('[MAIN] Extracted config:', config ? {
                  ...config,
                  password: '***REDACTED***'
                } : 'NO CONFIG FOUND')
                console.log('[MAIN] Config source - msg.config:', !!msg.config, 'msg.data?.config:', !!msg.data?.config)
                
                if (!config) {
                  console.error('[MAIN] DB_TEST_CONNECTION: No config provided')
                  console.error('[MAIN] Message structure:', {
                    hasType: !!msg.type,
                    hasConfig: !!msg.config,
                    hasData: !!msg.data,
                    dataKeys: msg.data ? Object.keys(msg.data) : [],
                    fullMsg: msg
                  })
                  const errorResponse = { 
                    type: 'DB_TEST_CONNECTION_RESULT', 
                    ok: false, 
                    message: 'No config provided',
                    details: {
                      receivedMessage: msg,
                      availableKeys: Object.keys(msg)
                    }
                  }
                  console.log('[MAIN] Sending error response:', JSON.stringify(errorResponse, null, 2))
                  try { 
                    socket.send(JSON.stringify(errorResponse))
                    console.log('[MAIN] Error response sent successfully')
                  } catch (sendErr) {
                    console.error('[MAIN] Error sending error response:', sendErr)
                  }
                  return
                }
                
                console.log('[MAIN] Testing connection with config:', { ...config, password: '***REDACTED***' })
                const testStartTime = Date.now()
                const result = await testConnection(config)
                const testDuration = Date.now() - testStartTime
                console.log('[MAIN] Connection test completed in', testDuration, 'ms')
                console.log('[MAIN] Connection test result:', JSON.stringify(result, null, 2))
                
                const response = { type: 'DB_TEST_CONNECTION_RESULT', ...result }
                console.log('[MAIN] Preparing to send response:', JSON.stringify(response, null, 2))
                try { 
                  socket.send(JSON.stringify(response))
                  console.log('[MAIN] ===== DB_TEST_CONNECTION_RESULT SENT SUCCESSFULLY =====')
                } catch (sendErr) {
                  console.error('[MAIN] ===== ERROR SENDING DB_TEST_CONNECTION_RESULT =====')
                  console.error('[MAIN] Send error:', sendErr)
                  console.error('[MAIN] Socket readyState:', socket.readyState)
                  console.error('[MAIN] Socket state:', {
                    readyState: socket.readyState,
                    OPEN: socket.OPEN,
                    isOpen: socket.readyState === socket.OPEN
                  })
                }
              } catch (err: any) {
                console.error('[MAIN] ===== EXCEPTION IN DB_TEST_CONNECTION HANDLER =====')
                console.error('[MAIN] Error:', err)
                console.error('[MAIN] Error message:', err?.message)
                console.error('[MAIN] Error stack:', err?.stack)
                const errorResponse = {
                  type: 'DB_TEST_CONNECTION_RESULT',
                  ok: false,
                  message: String(err?.message || err),
                  details: {
                    error: err.toString(),
                    stack: err.stack,
                    name: err?.name
                  }
                }
                console.log('[MAIN] Sending error response:', JSON.stringify(errorResponse, null, 2))
                try { 
                  socket.send(JSON.stringify(errorResponse))
                  console.log('[MAIN] Error response sent')
                } catch (sendErr) {
                  console.error('[MAIN] Failed to send error response:', sendErr)
                }
              }
            }
            if (msg.type === 'DB_SYNC') {
              try {
                const { syncChromeDataToPostgres } = await import('./ipc/db.js')
                const result = await syncChromeDataToPostgres(msg.data || {})
                try { socket.send(JSON.stringify({ type: 'DB_SYNC_RESULT', ...result })) } catch {}
              } catch (err: any) {
                console.log('[MAIN] Error handling DB_SYNC:', err)
                try { socket.send(JSON.stringify({ type: 'DB_SYNC_RESULT', ok: false, message: String(err?.message || err) })) } catch {}
              }
            }
            if (msg.type === 'DB_SET_ACTIVE') {
              try {
                // Store active backend in a way that can be accessed
                // For now, just acknowledge
                try { socket.send(JSON.stringify({ type: 'DB_SET_ACTIVE_RESULT', ok: true, message: 'Backend set to ' + msg.backend })) } catch {}
              } catch (err: any) {
                console.log('[MAIN] Error handling DB_SET_ACTIVE:', err)
                try { socket.send(JSON.stringify({ type: 'DB_SET_ACTIVE_RESULT', ok: false, message: String(err?.message || err) })) } catch {}
              }
            }
            if (msg.type === 'DB_GET_CONFIG') {
              try {
                const { getConfig } = await import('./ipc/db.js')
                const result = await getConfig()
                try { socket.send(JSON.stringify({ type: 'DB_GET_CONFIG_RESULT', ...result })) } catch {}
              } catch (err: any) {
                console.log('[MAIN] Error handling DB_GET_CONFIG:', err)
                try { socket.send(JSON.stringify({ type: 'DB_GET_CONFIG_RESULT', ok: false, message: String(err?.message || err) })) } catch {}
              }
            }
            if (msg.type === 'DB_GET') {
              try {
                const { getPostgresAdapter } = await import('./ipc/db.js')
                const adapter = getPostgresAdapter()
                if (!adapter) {
                  try { socket.send(JSON.stringify({ type: 'DB_GET_RESULT', ok: false, message: 'Postgres adapter not initialized' })) } catch {}
                  return
                }
                const value = await adapter.get(msg.key)
                try { socket.send(JSON.stringify({ type: 'DB_GET_RESULT', ok: true, value })) } catch {}
              } catch (err: any) {
                console.log('[MAIN] Error handling DB_GET:', err)
                try { socket.send(JSON.stringify({ type: 'DB_GET_RESULT', ok: false, message: String(err?.message || err) })) } catch {}
              }
            }
            if (msg.type === 'DB_SET') {
              try {
                const { getPostgresAdapter } = await import('./ipc/db.js')
                const adapter = getPostgresAdapter()
                if (!adapter) {
                  try { socket.send(JSON.stringify({ type: 'DB_SET_RESULT', ok: false, message: 'Postgres adapter not initialized' })) } catch {}
                  return
                }
                await adapter.set(msg.key, msg.value)
                try { socket.send(JSON.stringify({ type: 'DB_SET_RESULT', ok: true })) } catch {}
              } catch (err: any) {
                console.log('[MAIN] Error handling DB_SET:', err)
                try { socket.send(JSON.stringify({ type: 'DB_SET_RESULT', ok: false, message: String(err?.message || err) })) } catch {}
              }
            }
            if (msg.type === 'DB_GET_ALL') {
              try {
                const { getPostgresAdapter } = await import('./ipc/db.js')
                const adapter = getPostgresAdapter()
                if (!adapter) {
                  try { socket.send(JSON.stringify({ type: 'DB_GET_ALL_RESULT', ok: false, message: 'Postgres adapter not initialized' })) } catch {}
                  return
                }
                const data = await adapter.getAll()
                try { socket.send(JSON.stringify({ type: 'DB_GET_ALL_RESULT', ok: true, data })) } catch {}
              } catch (err: any) {
                console.log('[MAIN] Error handling DB_GET_ALL:', err)
                try { socket.send(JSON.stringify({ type: 'DB_GET_ALL_RESULT', ok: false, message: String(err?.message || err) })) } catch {}
              }
            }
            if (msg.type === 'DB_SET_ALL') {
              try {
                const { getPostgresAdapter } = await import('./ipc/db.js')
                const adapter = getPostgresAdapter()
                if (!adapter) {
                  try { socket.send(JSON.stringify({ type: 'DB_SET_ALL_RESULT', ok: false, message: 'Postgres adapter not initialized' })) } catch {}
                  return
                }
                await adapter.setAll(msg.payload || {})
                try { socket.send(JSON.stringify({ type: 'DB_SET_ALL_RESULT', ok: true })) } catch {}
              } catch (err: any) {
                console.log('[MAIN] Error handling DB_SET_ALL:', err)
                try { socket.send(JSON.stringify({ type: 'DB_SET_ALL_RESULT', ok: false, message: String(err?.message || err) })) } catch {}
              }
            }
          } catch {}
        })
      })
    }
  } catch (err) {
    console.error('[MAIN] Error in WebSocket setup:', err)
  }

  // HTTP API server for database operations (faster than WebSocket)
  try {
    console.log('[MAIN] ===== STARTING HTTP API SERVER =====')
    const httpApp = express()
    httpApp.use(express.json({ limit: '50mb' }))
    
    // CORS middleware - allow extension origin
    httpApp.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*')
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
      res.header('Access-Control-Allow-Headers', 'Content-Type')
      if (req.method === 'OPTIONS') {
        res.sendStatus(200)
        return
      }
      next()
    })

    // POST /api/db/test-connection - Test PostgreSQL connection
    httpApp.post('/api/db/test-connection', async (req, res) => {
      try {
        console.log('[HTTP] POST /api/db/test-connection')
        const result = await testConnection(req.body)
        res.json(result)
      } catch (error: any) {
        console.error('[HTTP] Error in test-connection:', error)
        res.status(500).json({
          ok: false,
          message: error.message || 'Connection test failed',
          details: { error: error.toString() }
        })
      }
    })

    // GET /api/db/get?keys=key1,key2 - Get specific keys
    httpApp.get('/api/db/get', async (req, res) => {
      try {
        const keys = req.query.keys ? String(req.query.keys).split(',') : []
        console.log('[HTTP] GET /api/db/get', keys)
        const adapter = getPostgresAdapter()
        if (!adapter) {
          res.status(500).json({ ok: false, message: 'Postgres adapter not initialized' })
          return
        }
        const results: Record<string, any> = {}
        if (keys.length === 0) {
          const allItems = await adapter.getAll()
          res.json({ ok: true, data: allItems })
          return
        }
        // Fetch keys in parallel
        await Promise.all(keys.map(async (key: string) => {
          try {
            const value = await adapter.get(key)
            if (value !== undefined) {
              results[key] = value
            }
          } catch (err) {
            console.error(`[HTTP] Error getting key ${key}:`, err)
          }
        }))
        res.json({ ok: true, data: results })
      } catch (error: any) {
        console.error('[HTTP] Error in get:', error)
        res.status(500).json({ ok: false, message: error.message || 'Failed to get values' })
      }
    })

    // POST /api/db/set - Set key-value pair
    httpApp.post('/api/db/set', async (req, res) => {
      try {
        const { key, value } = req.body
        console.log('[HTTP] POST /api/db/set', key)
        const adapter = getPostgresAdapter()
        if (!adapter) {
          res.status(500).json({ ok: false, message: 'Postgres adapter not initialized' })
          return
        }
        await adapter.set(key, value)
        res.json({ ok: true })
      } catch (error: any) {
        console.error('[HTTP] Error in set:', error)
        res.status(500).json({ ok: false, message: error.message || 'Failed to set value' })
      }
    })

    // GET /api/db/get-all - Get all keys
    httpApp.get('/api/db/get-all', async (_req, res) => {
      try {
        console.log('[HTTP] GET /api/db/get-all')
        const adapter = getPostgresAdapter()
        if (!adapter) {
          res.status(500).json({ ok: false, message: 'Postgres adapter not initialized' })
          return
        }
        const data = await adapter.getAll()
        res.json({ ok: true, data })
      } catch (error: any) {
        console.error('[HTTP] Error in get-all:', error)
        res.status(500).json({ ok: false, message: error.message || 'Failed to get all values' })
      }
    })

    // POST /api/db/set-all - Batch set multiple keys
    httpApp.post('/api/db/set-all', async (req, res) => {
      try {
        const payload = req.body.payload || req.body
        const keyCount = Object.keys(payload).length
        console.log('[HTTP] POST /api/db/set-all', keyCount, 'keys')
        const { getPostgresAdapter } = await import('./ipc/db.js')
        const adapter = getPostgresAdapter()
        if (!adapter) {
          res.status(500).json({ ok: false, message: 'Postgres adapter not initialized' })
          return
        }
        await adapter.setAll(payload)
        res.json({ ok: true })
      } catch (error: any) {
        console.error('[HTTP] Error in set-all:', error)
        res.status(500).json({ ok: false, message: error.message || 'Failed to set all values' })
      }
    })

    // POST /api/db/sync - Sync Chrome storage to PostgreSQL
    httpApp.post('/api/db/sync', async (req, res) => {
      try {
        const data = req.body.data || req.body
        console.log('[HTTP] POST /api/db/sync', Object.keys(data).length, 'items')
        const result = await syncChromeDataToPostgres(data)
        res.json(result)
      } catch (error: any) {
        console.error('[HTTP] Error in sync:', error)
        res.status(500).json({
          ok: false,
          message: error.message || 'Sync failed',
          details: { error: error.toString() }
        })
      }
    })

    // GET /api/db/config - Get current backend config
    httpApp.get('/api/db/config', async (_req, res) => {
      try {
        console.log('[HTTP] GET /api/db/config')
        const result = await getConfig()
        res.json(result)
      } catch (error: any) {
        console.error('[HTTP] Error in config:', error)
        res.status(500).json({
          ok: false,
          message: error.message || 'Failed to get config',
          details: { error: error.toString() }
        })
      }
    })

    const HTTP_PORT = 51248
    httpApp.listen(HTTP_PORT, '127.0.0.1', () => {
      console.log(`[MAIN] ✅ HTTP API server listening on http://127.0.0.1:${HTTP_PORT}`)
    })

    // Error handling is done via try-catch and httpApp.listen callback
  } catch (err) {
    console.error('[MAIN] Error in HTTP API setup:', err)
  }
  } catch (err) {
    console.error('[MAIN] Error in app.whenReady:', err)
  }
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
