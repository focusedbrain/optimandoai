import { app, BrowserWindow, globalShortcut, Tray, Menu, Notification, screen } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import { exec } from 'node:child_process'
import { WebSocketServer } from 'ws'
import express from 'express'
// WS bridge removed to avoid port conflicts; extension fallback/deep-link is used
import { registerHandler, LmgtfyChannels, emitCapture } from './lmgtfy/ipc'
import { beginOverlay, closeAllOverlays, showStreamTriggerOverlay } from './lmgtfy/overlay'
import { captureScreenshot, startRegionStream } from './lmgtfy/capture'
import { loadPresets, upsertRegion } from './lmgtfy/presets'
import { registerDbHandlers, testConnection, syncChromeDataToPostgres, getConfig, getPostgresAdapter } from './ipc/db'
import { handleVaultRPC } from './main/vault/rpc'
import { registerLlmHandlers } from './main/llm/ipc'
import { llmConfigService } from './main/llm/config'
import { ollamaManager } from './main/llm/ollama-manager'
import { llmClientService } from './main/llm/client'

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
  
  // Initialize LLM services
  try {
    console.log('[MAIN] Initializing LLM services...')
    const config = await llmConfigService.load()
    llmClientService.setClient(config)
    
    // Auto-start Ollama if configured
    if (config.autoStartOllama) {
      console.log('[MAIN] Auto-starting Ollama...')
      ollamaManager.startOllama().catch((err: any) => {
        console.error('[MAIN] Failed to start Ollama:', err)
      })
    }
    
    // Register LLM IPC handlers
    if (win) {
      registerLlmHandlers(win)
    }
    
    console.log('[MAIN] LLM services initialized')
  } catch (error) {
    console.error('[MAIN] Error initializing LLM services:', error)
  }
  
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
                parsedMessage: { type: msg.type, method: msg.method, hasConfig: !!msg.config }
              }))
              console.log('[MAIN] ✅ ELECTRON_LOG sent for parsed message')
            } catch (logErr) {
              console.error('[MAIN] ❌ FAILED to send parsed message log:', logErr)
            }
            
            // ===== VAULT RPC HANDLING (BEFORE type check!) =====
            // Check if this is a vault RPC call - these have 'method' instead of 'type'
            if (msg.method && msg.method.startsWith('vault.')) {
              console.log('[MAIN] Processing vault RPC:', msg.method)
              try {
                const response = await handleVaultRPC(msg.method, msg.params)
                const reply = {
                  id: msg.id,
                  ...response
                }
                socket.send(JSON.stringify(reply))
                console.log('[MAIN] ✅ Vault RPC response sent:', msg.method)
              } catch (error: any) {
                console.error('[MAIN] ❌ Vault RPC error:', error)
                socket.send(JSON.stringify({
                  id: msg.id,
                  success: false,
                  error: error.message || 'Unknown error'
                }))
              }
              return // Don't process further handlers
            }
            
            if (!msg || !msg.type) {
              console.warn('[MAIN] Message has no type or method, ignoring:', msg)
              try {
                socket.send(JSON.stringify({ 
                  type: 'ELECTRON_LOG', 
                  message: '[MAIN] ⚠️ Message has no type or method, ignoring'
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
              try {
                // Close any existing overlays first
                console.log('[MAIN] Closing existing overlays before creating new ones')
                closeAllOverlays()
                console.log('[MAIN] Calling beginOverlay()...')
                beginOverlay()
                console.log('[MAIN] ✅ beginOverlay() completed successfully')
              } catch (overlayErr: any) {
                console.error('[MAIN] ❌ ERROR in beginOverlay():', overlayErr)
                console.error('[MAIN] Error stack:', overlayErr?.stack)
                try {
                  socket.send(JSON.stringify({
                    type: 'ELECTRON_LOG',
                    message: `[MAIN] ❌ ERROR launching overlay: ${overlayErr?.message || 'Unknown error'}`,
                    error: overlayErr?.message || 'Unknown error'
                  }))
                } catch {}
              }
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
                const { testConnection } = await import('./ipc/db')
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
                const { syncChromeDataToPostgres } = await import('./ipc/db')
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
                const { getConfig } = await import('./ipc/db')
                const result = await getConfig()
                try { socket.send(JSON.stringify({ type: 'DB_GET_CONFIG_RESULT', ...result })) } catch {}
              } catch (err: any) {
                console.log('[MAIN] Error handling DB_GET_CONFIG:', err)
                try { socket.send(JSON.stringify({ type: 'DB_GET_CONFIG_RESULT', ok: false, message: String(err?.message || err) })) } catch {}
              }
            }
            if (msg.type === 'DB_GET') {
              try {
                const { getPostgresAdapter } = await import('./ipc/db')
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
                const { getPostgresAdapter } = await import('./ipc/db')
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
                const { getPostgresAdapter } = await import('./ipc/db')
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
            if (msg.type === 'LAUNCH_DBEAVER') {
              try {
                const { spawn } = await import('child_process');
                const path = await import('path');
                const fs = await import('fs');
                
                // Common DBeaver installation paths
                const dbeaverPaths = [
                  path.join(process.env.LOCALAPPDATA || '', 'DBeaver', 'dbeaver.exe'), // Most common location
                  'C:\\Program Files\\DBeaver\\dbeaver.exe',
                  'C:\\Program Files (x86)\\DBeaver\\dbeaver.exe',
                  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'dbeaver-ce', 'dbeaver.exe'),
                  path.join(process.env.APPDATA || '', 'DBeaver', 'dbeaver.exe')
                ];
                
                let launched = false;
                for (const dbeaverPath of dbeaverPaths) {
                  try {
                    if (fs.existsSync(dbeaverPath)) {
                      console.log('[MAIN] Launching DBeaver from:', dbeaverPath);
                      spawn(dbeaverPath, [], { detached: true, stdio: 'ignore' });
                      launched = true;
                      try { socket.send(JSON.stringify({ type: 'LAUNCH_DBEAVER_RESULT', ok: true, message: 'DBeaver launched' })) } catch {}
                      break;
                    }
                  } catch (err) {
                    console.error('[MAIN] Error checking/launching DBeaver path:', dbeaverPath, err);
                  }
                }
                
                if (!launched) {
                  // Try using Windows start command as fallback
                  try {
                    const { exec } = await import('child_process');
                    exec('start dbeaver', (error) => {
                      if (error) {
                        console.error('[MAIN] Failed to launch DBeaver:', error);
                        try { socket.send(JSON.stringify({ type: 'LAUNCH_DBEAVER_RESULT', ok: false, message: 'DBeaver not found. Please install it or open manually from Start Menu.' })) } catch {}
                      } else {
                        try { socket.send(JSON.stringify({ type: 'LAUNCH_DBEAVER_RESULT', ok: true, message: 'DBeaver launched' })) } catch {}
                      }
                    });
                  } catch (err) {
                    console.error('[MAIN] Failed to launch DBeaver:', err);
                    try { socket.send(JSON.stringify({ type: 'LAUNCH_DBEAVER_RESULT', ok: false, message: String(err) })) } catch {}
                  }
                }
              } catch (err: any) {
                console.error('[MAIN] Error handling LAUNCH_DBEAVER:', err);
                try { socket.send(JSON.stringify({ type: 'LAUNCH_DBEAVER_RESULT', ok: false, message: String(err?.message || err) })) } catch {}
              }
            }
            if (msg.type === 'DB_SET_ALL') {
              try {
                const { getPostgresAdapter } = await import('./ipc/db')
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

    // GET /api/llm/status - Get LLM status
    httpApp.get('/api/llm/status', async (_req, res) => {
      try {
        console.log('[HTTP] GET /api/llm/status')
        const { ollamaManager } = await import('./main/llm/ollama-manager')
        const status = await ollamaManager.getStatus()
        res.json(status)
      } catch (error: any) {
        console.error('[HTTP] Error in llm/status:', error)
        res.status(500).json({ error: error.message })
      }
    })

    // GET /api/llm/hardware - Get hardware info
    httpApp.get('/api/llm/hardware', async (_req, res) => {
      try {
        console.log('[HTTP] GET /api/llm/hardware')
        const { hardwareService } = await import('./main/llm/hardware')
        const hardware = await hardwareService.checkHardware()
        res.json(hardware)
      } catch (error: any) {
        console.error('[HTTP] Error in llm/hardware:', error)
        res.status(500).json({ error: error.message })
      }
    })

    // POST /api/llm/start - Start Ollama server
    httpApp.post('/api/llm/start', async (_req, res) => {
      try {
        console.log('[HTTP] POST /api/llm/start')
        const { ollamaManager } = await import('./main/llm/ollama-manager')
        await ollamaManager.startOllama()
        res.json({ ok: true })
      } catch (error: any) {
        console.error('[HTTP] Error in llm/start:', error)
        res.status(500).json({ ok: false, error: error.message })
      }
    })

    // POST /api/llm/download-model - Download a model
    httpApp.post('/api/llm/download-model', async (req, res) => {
      try {
        const { modelName } = req.body
        console.log('[HTTP] POST /api/llm/download-model', modelName)
        const { ollamaManager } = await import('./main/llm/ollama-manager')
        await ollamaManager.pullModel(modelName)
        res.json({ ok: true })
      } catch (error: any) {
        console.error('[HTTP] Error in llm/download-model:', error)
        res.status(500).json({ ok: false, error: error.message })
      }
    })

    // DELETE /api/llm/model - Delete a model
    httpApp.delete('/api/llm/model', async (req, res) => {
      try {
        const { modelName } = req.body
        console.log('[HTTP] DELETE /api/llm/model', modelName)
        const { ollamaManager } = await import('./main/llm/ollama-manager')
        await ollamaManager.deleteModel(modelName)
        res.json({ ok: true, message: `Model ${modelName} deleted successfully` })
      } catch (error: any) {
        console.error('[HTTP] Error in llm/delete-model:', error)
        res.status(500).json({ ok: false, error: error.message })
      }
    })
    
    // GET /api/llm/models - Get detailed model information
    httpApp.get('/api/llm/models', async (_req, res) => {
      try {
        console.log('[HTTP] GET /api/llm/models')
        const { ollamaManager } = await import('./main/llm/ollama-manager')
        const models = await ollamaManager.getModelDetails()
        res.json({ ok: true, data: models })
      } catch (error: any) {
        console.error('[HTTP] Error in llm/models:', error)
        res.status(500).json({ ok: false, error: error.message })
      }
    })

    // POST /api/llm/chat - Chat completion
    httpApp.post('/api/llm/chat', async (req, res) => {
      try {
        console.log('[HTTP] POST /api/llm/chat', {
          modelId: req.body.modelId,
          messageCount: req.body.messages?.length
        })
        
        // Ensure client is initialized with current config
        const config = await llmConfigService.load()
        llmClientService.setClient(config)
        
        // Check if Ollama is ready
        const ready = await llmClientService.isReady()
        if (!ready) {
          console.error('[HTTP] Ollama is not ready')
          return res.status(503).json({ 
            ok: false, 
            message: 'Ollama server is not running or not ready. Please start Ollama first.' 
          })
        }
        
        const result = await llmClientService.chat(req.body)
        console.log('[HTTP] LLM response:', { contentLength: result.content.length })
        res.json({ ok: true, data: result })
      } catch (error: any) {
        console.error('[HTTP] Error in llm/chat:', error)
        res.status(500).json({ ok: false, message: error.message })
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
        const { getPostgresAdapter } = await import('./ipc/db')
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

    // POST /api/db/insert-test-data - Insert test data for testing PostgreSQL
    httpApp.post('/api/db/insert-test-data', async (req, res) => {
      try {
        console.log('[HTTP] POST /api/db/insert-test-data')
        let adapter = getPostgresAdapter()
        
        // If adapter not initialized, try to initialize it from request config or stored config
        if (!adapter) {
          console.log('[HTTP] Adapter not initialized, attempting to initialize...')
          const postgresConfig = req.body.postgresConfig || req.body.config
          
          if (postgresConfig) {
            console.log('[HTTP] Using config from request body')
            const { testConnection } = await import('./ipc/db')
            const testResult = await testConnection(postgresConfig)
            if (testResult.ok) {
              adapter = getPostgresAdapter()
              console.log('[HTTP] Successfully initialized adapter from request config')
            } else {
              res.status(500).json({ 
                ok: false, 
                message: 'PostgreSQL connection failed. Please click "Connect Local PostgreSQL" first and ensure the connection succeeds.',
                details: { error: testResult.message }
              })
              return
            }
          } else {
            res.status(500).json({ 
              ok: false, 
              message: 'PostgreSQL not connected. Please click "Connect Local PostgreSQL" first and ensure the connection succeeds.',
              details: { error: 'No PostgreSQL configuration provided' }
            })
            return
          }
        }
        
        if (!adapter) {
          res.status(500).json({ 
            ok: false, 
            message: 'PostgreSQL not connected. Please click "Connect Local PostgreSQL" first and ensure the connection succeeds.'
          })
          return
        }

        // Generate test data matching POSTGRES_KEY_PATTERNS
        const testData: Record<string, any> = {
          // Vault entries
          'vault_github': {
            service: 'GitHub',
            username: 'testuser',
            password: 'test_password_123',
            url: 'https://github.com',
            notes: 'Test GitHub account',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          },
          'vault_email': {
            service: 'Email',
            username: 'test@example.com',
            password: 'email_password_456',
            url: 'https://mail.example.com',
            notes: 'Test email account',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          },
          'vault_database': {
            service: 'PostgreSQL',
            username: 'postgres',
            password: 'test_db_password',
            url: 'postgresql://localhost:5432/testdb',
            notes: 'Test database connection',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          },
          // Log entries
          'log_session_start': {
            level: 'info',
            message: 'Session started',
            timestamp: new Date().toISOString(),
            metadata: {
              sessionId: 'test_session_001',
              userId: 'test_user',
              action: 'session_start'
            }
          },
          'log_agent_execution': {
            level: 'info',
            message: 'Agent executed successfully',
            timestamp: new Date().toISOString(),
            metadata: {
              agentId: 'summarize',
              executionTime: 1234,
              result: 'success'
            }
          },
          'log_error': {
            level: 'error',
            message: 'Test error log entry',
            timestamp: new Date().toISOString(),
            metadata: {
              errorCode: 'TEST_001',
              stack: 'Test stack trace'
            }
          },
          // Vector embeddings
          'vector_document_1': {
            id: 'doc_001',
            content: 'This is a test document for vector search',
            embedding: Array.from({ length: 1536 }, () => Math.random()),
            metadata: {
              title: 'Test Document 1',
              category: 'test',
              createdAt: new Date().toISOString()
            }
          },
          'vector_document_2': {
            id: 'doc_002',
            content: 'Another test document with different content',
            embedding: Array.from({ length: 1536 }, () => Math.random()),
            metadata: {
              title: 'Test Document 2',
              category: 'test',
              createdAt: new Date().toISOString()
            }
          },
          // GIS/spatial data
          'gis_location_1': {
            id: 'loc_001',
            name: 'Test Location',
            coordinates: {
              type: 'Point',
              coordinates: [-122.4194, 37.7749] // San Francisco
            },
            metadata: {
              address: '123 Test St',
              city: 'San Francisco',
              country: 'USA'
            }
          },
          'gis_location_2': {
            id: 'loc_002',
            name: 'Another Location',
            coordinates: {
              type: 'Point',
              coordinates: [-74.0060, 40.7128] // New York
            },
            metadata: {
              address: '456 Sample Ave',
              city: 'New York',
              country: 'USA'
            }
          },
          // Archived session
          'archive_session_test_001': {
            sessionId: 'test_session_001',
            sessionName: 'Test Archived Session',
            createdAt: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
            archivedAt: new Date().toISOString(),
            data: {
              agentBoxes: [],
              displayGrids: [],
              customAgents: []
            }
          }
        }

        // Insert all test data
        await adapter.setAll(testData)
        const keyCount = Object.keys(testData).length

        console.log(`[HTTP] Inserted ${keyCount} test data items`)
        res.json({
          ok: true,
          message: `Successfully inserted ${keyCount} test data items`,
          count: keyCount,
          keys: Object.keys(testData)
        })
      } catch (error: any) {
        console.error('[HTTP] Error in insert-test-data:', error)
        res.status(500).json({
          ok: false,
          message: error.message || 'Failed to insert test data',
          details: { error: error.toString() }
        })
      }
    })

    // POST /api/db/launch-dbeaver - Launch DBeaver application and configure connection
    httpApp.post('/api/db/launch-dbeaver', async (req, res) => {
      try {
        console.log('[HTTP] POST /api/db/launch-dbeaver')
        const postgresConfig = req.body.postgresConfig || req.body.config;
        const { spawn, execSync } = await import('child_process');
        const path = await import('path');
        const fs = await import('fs');
        
        // First, close any running DBeaver instances to ensure clean configuration
        if (postgresConfig) {
          try {
            execSync('taskkill /F /IM dbeaver.exe /T 2>nul', { stdio: 'ignore' });
            console.log('[HTTP] Closed existing DBeaver instances');
            // Wait a bit for the process to fully close
            await new Promise(resolve => setTimeout(resolve, 1500));
          } catch (e) {
            // Process might not be running, that's fine
            console.log('[HTTP] No DBeaver process to close or already closed');
          }
        }
        
        // Common DBeaver installation paths
        const dbeaverPaths = [
          path.join(process.env.LOCALAPPDATA || '', 'DBeaver', 'dbeaver.exe'), // Most common location
          'C:\\Program Files\\DBeaver\\dbeaver.exe',
          'C:\\Program Files (x86)\\DBeaver\\dbeaver.exe',
          path.join(process.env.LOCALAPPDATA || '', 'Programs', 'dbeaver-ce', 'dbeaver.exe'),
          path.join(process.env.APPDATA || '', 'DBeaver', 'dbeaver.exe')
        ];
        
        let launched = false;
        let launchPath = '';
        
        for (const dbeaverPath of dbeaverPaths) {
          try {
            if (fs.existsSync(dbeaverPath)) {
              console.log('[HTTP] Launching DBeaver from:', dbeaverPath);
              spawn(dbeaverPath, [], { detached: true, stdio: 'ignore' });
              launched = true;
              launchPath = dbeaverPath;
              break;
            }
          } catch (err) {
            console.error('[HTTP] Error checking/launching DBeaver path:', dbeaverPath, err);
          }
        }
        
        if (!launched) {
          // Try using Windows start command as fallback
          try {
            const { exec } = await import('child_process');
            exec('start dbeaver', (error) => {
              if (error) {
                console.error('[HTTP] Failed to launch DBeaver:', error);
              } else {
                console.log('[HTTP] DBeaver launched via start command');
              }
            });
            // Assume success for start command (it's async)
            res.json({
              ok: true,
              message: 'DBeaver launch attempted via start command',
              method: 'start_command'
            });
            return;
          } catch (err) {
            console.error('[HTTP] Failed to launch DBeaver:', err);
            res.status(500).json({
              ok: false,
              message: 'DBeaver not found. Please install it or open manually from Start Menu.',
              details: { error: String(err) }
            });
            return;
          }
        }
        
        // If PostgreSQL config is provided, also configure the connection and download drivers
        if (postgresConfig) {
          console.log('[HTTP] Configuring DBeaver connection and downloading drivers...');
          try {
            // Import the configure-dbeaver logic (we'll inline it here)
            const os = await import('os');
            const https = await import('https');
            
            const appDataPath = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
            const dbeaverDataPath = path.join(appDataPath, 'DBeaverData');
            
            // Download PostgreSQL JDBC driver if not already present
            const driversDir = path.join(dbeaverDataPath, 'drivers', 'maven', 'maven-central');
            const postgresDriverDir = path.join(driversDir, 'org.postgresql', 'postgresql');
            const driverVersion = '42.7.3';
            const driverJarName = `postgresql-${driverVersion}.jar`;
            const driverJarPath = path.join(postgresDriverDir, driverVersion, driverJarName);
            
            // Ensure driver directory exists
            if (!fs.existsSync(path.dirname(driverJarPath))) {
              fs.mkdirSync(path.dirname(driverJarPath), { recursive: true });
            }
            
            // Download driver if it doesn't exist
            if (!fs.existsSync(driverJarPath)) {
              console.log('[HTTP] Downloading PostgreSQL JDBC driver...');
              const driverUrl = `https://repo1.maven.org/maven2/org/postgresql/postgresql/${driverVersion}/${driverJarName}`;
              
              try {
                await new Promise<void>((resolve, reject) => {
                  const file = fs.createWriteStream(driverJarPath);
                  https.get(driverUrl, (response) => {
                    if (response.statusCode === 301 || response.statusCode === 302) {
                      https.get(response.headers.location!, (redirectResponse) => {
                        redirectResponse.pipe(file);
                        file.on('finish', () => {
                          file.close();
                          console.log('[HTTP] PostgreSQL JDBC driver downloaded successfully');
                          resolve();
                        });
                      }).on('error', (err) => {
                        if (fs.existsSync(driverJarPath)) {
                          fs.unlinkSync(driverJarPath);
                        }
                        reject(err);
                      });
                    } else if (response.statusCode === 200) {
                      response.pipe(file);
                      file.on('finish', () => {
                        file.close();
                        console.log('[HTTP] PostgreSQL JDBC driver downloaded successfully');
                        resolve();
                      });
                    } else {
                      if (fs.existsSync(driverJarPath)) {
                        fs.unlinkSync(driverJarPath);
                      }
                      reject(new Error(`Failed to download driver: HTTP ${response.statusCode}`));
                    }
                  }).on('error', (err) => {
                    if (fs.existsSync(driverJarPath)) {
                      fs.unlinkSync(driverJarPath);
                    }
                    reject(err);
                  });
                });
              } catch (downloadError: any) {
                console.error('[HTTP] Failed to download PostgreSQL JDBC driver:', downloadError);
                console.log('[HTTP] Continuing without driver download - DBeaver will prompt to download if needed');
              }
            } else {
              console.log('[HTTP] PostgreSQL JDBC driver already exists');
            }
            
            // Configure driver in DBeaver's drivers.xml - this ensures the driver is available
            const driversConfigPath = path.join(dbeaverDataPath, 'drivers.xml');
            try {
              // DBeaver will auto-download the driver if we just reference it correctly
              // We create a minimal drivers.xml that references the standard PostgreSQL driver
              let driversXml = `<?xml version="1.0" encoding="UTF-8"?>
<drivers>
</drivers>`;
              
              if (!fs.existsSync(driversConfigPath)) {
                fs.writeFileSync(driversConfigPath, driversXml, 'utf-8');
                console.log('[HTTP] Created minimal drivers.xml');
              }
            } catch (driverConfigError: any) {
              console.error('[HTTP] Error configuring drivers.xml:', driverConfigError);
              // Continue anyway
            }
            
            // Configure connection
            let workspacePath = null;
            try {
              const workspaceDirs = fs.readdirSync(dbeaverDataPath, { withFileTypes: true })
                .filter(dirent => dirent.isDirectory() && dirent.name.startsWith('workspace'))
                .map(dirent => path.join(dbeaverDataPath, dirent.name));
              
              if (workspaceDirs.length > 0) {
                workspacePath = workspaceDirs.sort().reverse()[0];
              }
            } catch (err) {
              console.error('[HTTP] Error finding workspace:', err);
            }
            
            if (workspacePath) {
              const dataSourcesPath = path.join(workspacePath, 'General', '.dbeaver', 'data-sources.json');
              const dataSourcesDir = path.dirname(dataSourcesPath);
              
              if (!fs.existsSync(dataSourcesDir)) {
                fs.mkdirSync(dataSourcesDir, { recursive: true });
              }
              
              let dataSources: any = {
                folders: {},
                connections: {},
                'connection-types': {
                  'dev': {
                    name: 'Development',
                    color: '255,255,255',
                    description: 'Regular development database',
                    'auto-commit': true,
                    'confirm-execute': false,
                    'confirm-data-change': false,
                    'smart-commit': false,
                    'smart-commit-recover': true,
                    'auto-close-transactions': true,
                    'close-transactions-period': 1800,
                    'auto-close-connections': true,
                    'close-connections-period': 14400
                  }
                }
              };
              
              if (fs.existsSync(dataSourcesPath)) {
                try {
                  const fileContent = fs.readFileSync(dataSourcesPath, 'utf-8');
                  dataSources = JSON.parse(fileContent);
                  if (!dataSources.connections) {
                    dataSources.connections = {};
                  }
                } catch (err) {
                  console.error('[HTTP] Error reading data-sources.json:', err);
                }
              }
              
              const connectionId = 'postgres-local-wr-code';
              const connectionName = 'Local PostgreSQL (WR Code)';
              // Include credentials in JDBC URL for automatic authentication
              const jdbcUrl = `jdbc:postgresql://${postgresConfig.host}:${postgresConfig.port}/${postgresConfig.database}?user=${encodeURIComponent(postgresConfig.user)}&password=${encodeURIComponent(postgresConfig.password)}`;
              
              const connectionConfig: any = {
                provider: 'postgresql',
                driver: 'postgres-jdbc',
                name: connectionName,
                'save-password': true,
                configuration: {
                  host: postgresConfig.host,
                  port: postgresConfig.port,
                  database: postgresConfig.database,
                  url: jdbcUrl,
                  type: 'dev',
                  provider: 'postgresql',
                  'configuration-type': 'MANUAL',
                  'auth-model': 'native',
                  handlers: {}
                },
                auth: {
                  properties: {
                    user: postgresConfig.user,
                    password: postgresConfig.password
                  },
                  'save-password': true
                }
              };
              
              dataSources.connections[connectionId] = connectionConfig;
              fs.writeFileSync(dataSourcesPath, JSON.stringify(dataSources, null, 2), 'utf-8');
              console.log('[HTTP] DBeaver connection configured successfully');
              
              // Also create credentials file for automatic authentication
              try {
                const credentialsPath = path.join(workspacePath, 'General', '.dbeaver', 'credentials-config.json');
                const credentialsDir = path.dirname(credentialsPath);
                
                if (!fs.existsSync(credentialsDir)) {
                  fs.mkdirSync(credentialsDir, { recursive: true });
                }
                
                const credentials = {
                  [connectionId]: {
                    '#connection': {
                      user: postgresConfig.user,
                      password: postgresConfig.password
                    }
                  }
                };
                
                fs.writeFileSync(credentialsPath, JSON.stringify(credentials, null, 2), 'utf-8');
                console.log('[HTTP] DBeaver credentials configured');
              } catch (credError: any) {
                console.error('[HTTP] Error configuring credentials:', credError);
                // Continue anyway
              }
            }
          } catch (configError: any) {
            console.error('[HTTP] Error configuring DBeaver connection:', configError);
            // Continue anyway - DBeaver is launched
          }
        }
        
        res.json({
          ok: true,
          message: postgresConfig 
            ? 'DBeaver launched and configured! The connection "Local PostgreSQL (WR Code)" is ready. Username is pre-filled. You may need to enter the password on first connect.'
            : 'DBeaver launched successfully',
          path: launchPath,
          configured: !!postgresConfig,
          connectionName: postgresConfig ? 'Local PostgreSQL (WR Code)' : undefined,
          username: postgresConfig?.user
        });
      } catch (error: any) {
        console.error('[HTTP] Error in launch-dbeaver:', error);
        res.status(500).json({
          ok: false,
          message: error.message || 'Failed to launch DBeaver',
          details: { error: error.toString() }
        });
      }
    })

    // POST /api/db/configure-dbeaver - Configure DBeaver with PostgreSQL connection
    httpApp.post('/api/db/configure-dbeaver', async (req, res) => {
      try {
        console.log('[HTTP] POST /api/db/configure-dbeaver')
        const postgresConfig = req.body.postgresConfig || req.body.config
        
        if (!postgresConfig) {
          res.status(400).json({
            ok: false,
            message: 'PostgreSQL configuration is required'
          })
          return
        }

        const path = await import('path');
        const fs = await import('fs');
        const os = await import('os');
        const https = await import('https');
        
        // Find DBeaver workspace directory
        const appDataPath = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
        const dbeaverDataPath = path.join(appDataPath, 'DBeaverData');
        
        // Download PostgreSQL JDBC driver if not already present
        const driversDir = path.join(dbeaverDataPath, 'drivers', 'maven', 'maven-central');
        const postgresDriverDir = path.join(driversDir, 'org.postgresql', 'postgresql');
        const driverVersion = '42.7.3'; // Latest stable version
        const driverJarName = `postgresql-${driverVersion}.jar`;
        const driverJarPath = path.join(postgresDriverDir, driverVersion, driverJarName);
        
        // Ensure driver directory exists
        if (!fs.existsSync(path.dirname(driverJarPath))) {
          fs.mkdirSync(path.dirname(driverJarPath), { recursive: true });
        }
        
        // Download driver if it doesn't exist
        if (!fs.existsSync(driverJarPath)) {
          console.log('[HTTP] Downloading PostgreSQL JDBC driver...');
          const driverUrl = `https://repo1.maven.org/maven2/org/postgresql/postgresql/${driverVersion}/${driverJarName}`;
          
          try {
            await new Promise<void>((resolve, reject) => {
              const file = fs.createWriteStream(driverJarPath);
              https.get(driverUrl, (response) => {
                if (response.statusCode === 301 || response.statusCode === 302) {
                  // Handle redirect
                  https.get(response.headers.location!, (redirectResponse) => {
                    redirectResponse.pipe(file);
                    file.on('finish', () => {
                      file.close();
                      console.log('[HTTP] PostgreSQL JDBC driver downloaded successfully');
                      resolve();
                    });
                  }).on('error', (err) => {
                    if (fs.existsSync(driverJarPath)) {
                      fs.unlinkSync(driverJarPath);
                    }
                    reject(err);
                  });
                } else if (response.statusCode === 200) {
                  response.pipe(file);
                  file.on('finish', () => {
                    file.close();
                    console.log('[HTTP] PostgreSQL JDBC driver downloaded successfully');
                    resolve();
                  });
                } else {
                  if (fs.existsSync(driverJarPath)) {
                    fs.unlinkSync(driverJarPath);
                  }
                  reject(new Error(`Failed to download driver: HTTP ${response.statusCode}`));
                }
              }).on('error', (err) => {
                if (fs.existsSync(driverJarPath)) {
                  fs.unlinkSync(driverJarPath);
                }
                reject(err);
              });
            });
          } catch (downloadError: any) {
            console.error('[HTTP] Failed to download PostgreSQL JDBC driver:', downloadError);
            // Continue anyway - DBeaver might prompt to download it
            console.log('[HTTP] Continuing without driver download - DBeaver will prompt to download if needed');
          }
        } else {
          console.log('[HTTP] PostgreSQL JDBC driver already exists');
        }
        
        // Find workspace directory
        let workspacePath = null;
        try {
          const workspaceDirs = fs.readdirSync(dbeaverDataPath, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory() && dirent.name.startsWith('workspace'))
            .map(dirent => path.join(dbeaverDataPath, dirent.name));
          
          if (workspaceDirs.length > 0) {
            // Use the most recent workspace (highest number)
            workspacePath = workspaceDirs.sort().reverse()[0];
          }
        } catch (err) {
          console.error('[HTTP] Error finding workspace:', err);
        }
        
        if (!workspacePath) {
          res.status(500).json({
            ok: false,
            message: 'Could not find DBeaver workspace. Please open DBeaver at least once first.'
          })
          return
        }
        
        const dataSourcesPath = path.join(workspacePath, 'General', '.dbeaver', 'data-sources.json');
        const dataSourcesDir = path.dirname(dataSourcesPath);
        
        // Ensure directory exists
        if (!fs.existsSync(dataSourcesDir)) {
          fs.mkdirSync(dataSourcesDir, { recursive: true });
        }
        
        // Read existing data-sources.json or create new
        let dataSources: any = {
          folders: {},
          connections: {},
          'connection-types': {
            'dev': {
              name: 'Development',
              color: '255,255,255',
              description: 'Regular development database',
              'auto-commit': true,
              'confirm-execute': false,
              'confirm-data-change': false,
              'smart-commit': false,
              'smart-commit-recover': true,
              'auto-close-transactions': true,
              'close-transactions-period': 1800,
              'auto-close-connections': true,
              'close-connections-period': 14400
            }
          }
        };
        
        if (fs.existsSync(dataSourcesPath)) {
          try {
            const fileContent = fs.readFileSync(dataSourcesPath, 'utf-8');
            dataSources = JSON.parse(fileContent);
            if (!dataSources.connections) {
              dataSources.connections = {};
            }
          } catch (err) {
            console.error('[HTTP] Error reading data-sources.json:', err);
            // Continue with default structure
          }
        }
        
        // Create connection ID
        const connectionId = 'postgres-local-wr-code';
        const connectionName = 'Local PostgreSQL (WR Code)';
        
        // Build JDBC URL
        const jdbcUrl = `jdbc:postgresql://${postgresConfig.host}:${postgresConfig.port}/${postgresConfig.database}`;
        
        // Create PostgreSQL connection configuration with driver library
        const connectionConfig: any = {
          provider: 'postgresql',
          driver: 'postgres_jdbc',
          name: connectionName,
          'save-password': true,
          'show-system-objects': true,
          'show-utility-objects': true,
          'read-only': false,
          configuration: {
            host: postgresConfig.host,
            port: postgresConfig.port,
            database: postgresConfig.database,
            url: jdbcUrl,
            type: 'dev',
            provider: 'postgresql',
            'driver-properties': {},
            'configuration-type': 'MANUAL',
            'close-idle-connection': true,
            'auth-model': 'native',
            'user-name': postgresConfig.user,
            'user-password': postgresConfig.password,
            'save-password': true,
            'show-all-schemas': false,
            'show-system-schemas': false,
            'show-utility-schemas': true,
            'public-show': true,
            'public-schema-filter': '',
            'public-schema': postgresConfig.schema || 'public',
            'show-database': true,
            'show-template-database': false,
            'template-database-filter': '',
            'show-default-database-only': false,
            'database-filter': '',
            'show-non-default-database': true,
            'database-pattern': '',
            'database-pattern-type': 'REGEX',
            'schema-pattern': '',
            'schema-pattern-type': 'REGEX',
            'include-schema': '',
            'exclude-schema': '',
            'include-database': '',
            'exclude-database': '',
            'driver-name': 'PostgreSQL',
            'driver-class': 'org.postgresql.Driver',
            'driver-library': driverJarPath.replace(/\\/g, '/'), // Normalize path for DBeaver
            'libraries': {
              'postgresql': [
                {
                  'type': 'maven',
                  'groupId': 'org.postgresql',
                  'artifactId': 'postgresql',
                  'version': driverVersion,
                  'path': driverJarPath.replace(/\\/g, '/')
                }
              ]
            }
          }
        };
        
        // Add or update the connection
        dataSources.connections[connectionId] = connectionConfig;
        
        // Write the updated data-sources.json
        fs.writeFileSync(dataSourcesPath, JSON.stringify(dataSources, null, 2), 'utf-8');
        
        console.log('[HTTP] DBeaver connection configured successfully');
        
        res.json({
          ok: true,
          message: `DBeaver connection configured successfully! PostgreSQL JDBC driver (v${driverVersion}) has been downloaded and configured. You can now connect to the database.`,
          connectionId,
          connectionName,
          driverDownloaded: fs.existsSync(driverJarPath)
        });
      } catch (error: any) {
        console.error('[HTTP] Failed to configure DBeaver:', error);
        res.status(500).json({
          ok: false,
          message: 'Failed to configure DBeaver connection',
          details: { error: error.toString() }
        });
      }
    });

    // GET /api/db/test-data-stats - Get statistics about test data
    httpApp.get('/api/db/test-data-stats', async (_req, res) => {
      try {
        console.log('[HTTP] GET /api/db/test-data-stats')
        let adapter = getPostgresAdapter()
        
        // If adapter not initialized, try to initialize it from config
        if (!adapter) {
          console.log('[HTTP] Adapter not initialized, attempting to initialize from config...')
          const { getConfig } = await import('./ipc/db')
          const configResult = await getConfig()
          
          if (configResult.ok && configResult.details?.postgres?.config) {
            const { testConnection } = await import('./ipc/db')
            const testResult = await testConnection(configResult.details.postgres.config)
            if (testResult.ok) {
              adapter = getPostgresAdapter()
              console.log('[HTTP] Successfully initialized adapter from config')
            } else {
              res.status(500).json({ 
                ok: false, 
                message: 'PostgreSQL not connected. Please click "Connect Local PostgreSQL" first.',
                details: { error: testResult.message }
              })
              return
            }
          } else {
            res.status(500).json({ 
              ok: false, 
              message: 'PostgreSQL not connected. Please click "Connect Local PostgreSQL" first.'
            })
            return
          }
        }
        
        if (!adapter) {
          res.status(500).json({ 
            ok: false, 
            message: 'PostgreSQL not connected. Please click "Connect Local PostgreSQL" first.'
          })
          return
        }

        const allData = await adapter.getAll()
        const stats = {
          total: Object.keys(allData).length,
          vault: Object.keys(allData).filter(k => k.startsWith('vault_')).length,
          logs: Object.keys(allData).filter(k => k.startsWith('log_')).length,
          vectors: Object.keys(allData).filter(k => k.startsWith('vector_')).length,
          gis: Object.keys(allData).filter(k => k.startsWith('gis_')).length,
          archived: Object.keys(allData).filter(k => k.startsWith('archive_session_')).length,
          sampleKeys: Object.keys(allData).slice(0, 10)
        }

        res.json({ ok: true, stats })
      } catch (error: any) {
        console.error('[HTTP] Error in test-data-stats:', error)
        res.status(500).json({
          ok: false,
          message: error.message || 'Failed to get test data stats',
          details: { error: error.toString() }
        })
      }
    })

    // ===== VAULT HTTP API ENDPOINTS (SQLCipher) =====
    // These are separate from PostgreSQL and use SQLCipher for encryption
    
    // GET /api/vault/health - Health check (lightweight, no vault service import)
    httpApp.get('/api/vault/health', (_req, res) => {
      res.json({ status: 'ok', timestamp: Date.now() })
    })
    
    // POST /api/vault/status - Get vault status
    httpApp.post('/api/vault/status', async (_req, res) => {
      try {
        console.log('[HTTP-VAULT] POST /api/vault/status')
        const { vaultService } = await import('./main/vault/rpc')
        console.log('[HTTP-VAULT] Vault service imported successfully')
        const status = await vaultService.getStatus()
        console.log('[HTTP-VAULT] Status retrieved:', { exists: status.exists, locked: status.locked })
        res.json({ success: true, data: status })
      } catch (error: any) {
        console.error('[HTTP-VAULT] Error in status:', error)
        console.error('[HTTP-VAULT] Error stack:', error?.stack)
        res.status(500).json({ success: false, error: error.message || 'Failed to get status', details: error?.stack })
      }
    })

    // POST /api/vault/create - Create new vault
    httpApp.post('/api/vault/create', async (req, res) => {
      try {
        console.log('[HTTP-VAULT] POST /api/vault/create', { vaultName: req.body.vaultName })
        const { vaultService } = await import('./main/vault/rpc')
        const vaultId = await vaultService.createVault(req.body.password, req.body.vaultName || 'My Vault', req.body.vaultId)
        res.json({ success: true, data: { vaultId } })
      } catch (error: any) {
        console.error('[HTTP-VAULT] Error in create:', error)
        console.error('[HTTP-VAULT] Error message:', error?.message)
        console.error('[HTTP-VAULT] Error stack:', error?.stack)
        res.status(500).json({ success: false, error: error?.message || error?.toString() || 'Failed to create vault' })
      }
    })

    // POST /api/vault/delete - Delete vault (must be unlocked)
    httpApp.post('/api/vault/delete', async (req, res) => {
      try {
        console.log('[HTTP-VAULT] POST /api/vault/delete', { vaultId: req.body.vaultId })
        const { vaultService } = await import('./main/vault/rpc')
        await vaultService.deleteVault(req.body.vaultId)
        res.json({ success: true })
      } catch (error: any) {
        console.error('[HTTP-VAULT] Error in delete:', error)
        res.status(500).json({ success: false, error: error.message || 'Failed to delete vault' })
      }
    })

    // POST /api/vault/unlock - Unlock vault
    httpApp.post('/api/vault/unlock', async (req, res) => {
      try {
        console.log('[HTTP-VAULT] POST /api/vault/unlock', { vaultId: req.body.vaultId })
        const { vaultService } = await import('./main/vault/rpc')
        await vaultService.unlock(req.body.password, req.body.vaultId || 'default')
        res.json({ success: true })
      } catch (error: any) {
        console.error('[HTTP-VAULT] Error in unlock:', error)
        res.status(500).json({ success: false, error: error.message || 'Failed to unlock vault' })
      }
    })

    // POST /api/vault/lock - Lock vault
    httpApp.post('/api/vault/lock', async (_req, res) => {
      try {
        console.log('[HTTP-VAULT] POST /api/vault/lock')
        const { vaultService } = await import('./main/vault/rpc')
        await vaultService.lock()
        res.json({ success: true })
      } catch (error: any) {
        console.error('[HTTP-VAULT] Error in lock:', error)
        res.status(500).json({ success: false, error: error.message || 'Failed to lock vault' })
      }
    })

    // POST /api/vault/items - List items
    httpApp.post('/api/vault/items', async (req, res) => {
      try {
        console.log('[HTTP-VAULT] POST /api/vault/items', req.body)
        const { vaultService } = await import('./main/vault/rpc')
        const filters = {
          container_id: req.body.containerId,
          category: req.body.category
        }
        const items = await vaultService.listItems(filters)
        console.log(`[HTTP-VAULT] Returning ${items.length} items`)
        res.json({ success: true, data: items })
      } catch (error: any) {
        console.error('[HTTP-VAULT] Error in items:', error)
        res.status(500).json({ success: false, error: error.message || 'Failed to list items' })
      }
    })

    // POST /api/vault/item/create - Create item
    httpApp.post('/api/vault/item/create', async (req, res) => {
      try {
        console.log('[HTTP-VAULT] POST /api/vault/item/create')
        console.log('[HTTP-VAULT] Request body:', JSON.stringify(req.body, null, 2))
        const { vaultService } = await import('./main/vault/rpc')
        const item = await vaultService.createItem(req.body)
        console.log('[HTTP-VAULT] ✅ Item created successfully:', item.id, 'category:', item.category)
        
        // Immediately verify the item can be retrieved
        try {
          const verifyItems = await vaultService.listItems({ category: item.category })
          const found = verifyItems.find(i => i.id === item.id)
          if (found) {
            console.log('[HTTP-VAULT] ✅ Verified: Item can be retrieved immediately after creation')
          } else {
            console.error('[HTTP-VAULT] ⚠️ WARNING: Item created but NOT found in listItems query!')
            console.error('[HTTP-VAULT] Created item ID:', item.id)
            console.error('[HTTP-VAULT] Items returned:', verifyItems.map(i => ({ id: i.id, title: i.title })))
          }
        } catch (verifyError: any) {
          console.error('[HTTP-VAULT] ⚠️ Verification query failed:', verifyError?.message)
        }
        
        res.json({ success: true, data: item })
      } catch (error: any) {
        console.error('[HTTP-VAULT] ❌ Error in create item:', error)
        console.error('[HTTP-VAULT] Error stack:', error?.stack)
        res.status(500).json({ success: false, error: error.message || 'Failed to create item' })
      }
    })

    // POST /api/vault/item/get - Get item by ID
    httpApp.post('/api/vault/item/get', async (req, res) => {
      try {
        console.log('[HTTP-VAULT] POST /api/vault/item/get')
        const { vaultService } = await import('./main/vault/rpc')
        const item = await vaultService.getItem(req.body.id)
        res.json({ success: true, data: item })
      } catch (error: any) {
        console.error('[HTTP-VAULT] Error in get item:', error)
        res.status(500).json({ success: false, error: error.message || 'Failed to get item' })
      }
    })

    // POST /api/vault/item/update - Update item
    httpApp.post('/api/vault/item/update', async (req, res) => {
      try {
        console.log('[HTTP-VAULT] POST /api/vault/item/update')
        const { vaultService } = await import('./main/vault/rpc')
        const item = await vaultService.updateItem(req.body.id, req.body.updates)
        res.json({ success: true, data: item })
      } catch (error: any) {
        console.error('[HTTP-VAULT] Error in update item:', error)
        res.status(500).json({ success: false, error: error.message || 'Failed to update item' })
      }
    })

    // POST /api/vault/item/delete - Delete item
    httpApp.post('/api/vault/item/delete', async (req, res) => {
      try {
        console.log('[HTTP-VAULT] POST /api/vault/item/delete')
        const { vaultService } = await import('./main/vault/rpc')
        await vaultService.deleteItem(req.body.id)
        res.json({ success: true })
      } catch (error: any) {
        console.error('[HTTP-VAULT] Error in delete item:', error)
        res.status(500).json({ success: false, error: error.message || 'Failed to delete item' })
      }
    })

    // POST /api/vault/containers - List containers
    httpApp.post('/api/vault/containers', async (_req, res) => {
      try {
        console.log('[HTTP-VAULT] POST /api/vault/containers')
        const { vaultService } = await import('./main/vault/rpc')
        const containers = await vaultService.listContainers()
        res.json({ success: true, data: containers })
      } catch (error: any) {
        console.error('[HTTP-VAULT] Error in containers:', error)
        res.status(500).json({ success: false, error: error.message || 'Failed to list containers' })
      }
    })

    // POST /api/vault/container/create - Create container
    httpApp.post('/api/vault/container/create', async (req, res) => {
      try {
        console.log('[HTTP-VAULT] POST /api/vault/container/create')
        const { vaultService } = await import('./main/vault/rpc')
        const { type, name, favorite } = req.body
        const container = vaultService.createContainer(type, name, favorite || false)
        res.json({ success: true, data: container })
      } catch (error: any) {
        console.error('[HTTP-VAULT] Error in create container:', error)
        res.status(500).json({ success: false, error: error.message || 'Failed to create container' })
      }
    })

    // POST /api/vault/settings - Get settings
    httpApp.post('/api/vault/settings/get', async (_req, res) => {
      try {
        console.log('[HTTP-VAULT] POST /api/vault/settings/get')
        const { vaultService } = await import('./main/vault/rpc')
        const settings = await vaultService.getSettings()
        res.json({ success: true, data: settings })
      } catch (error: any) {
        console.error('[HTTP-VAULT] Error in get settings:', error)
        res.status(500).json({ success: false, error: error.message || 'Failed to get settings' })
      }
    })

    // POST /api/vault/settings/update - Update settings
    httpApp.post('/api/vault/settings/update', async (req, res) => {
      try {
        console.log('[HTTP-VAULT] POST /api/vault/settings/update')
        const { vaultService } = await import('./main/vault/rpc')
        const settings = await vaultService.updateSettings(req.body)
        res.json({ success: true, data: settings })
      } catch (error: any) {
        console.error('[HTTP-VAULT] Error in update settings:', error)
        res.status(500).json({ success: false, error: error.message || 'Failed to update settings' })
      }
    })

    // ===== ORCHESTRATOR HTTP API ENDPOINTS (Encrypted SQLite Backend) =====
    // These endpoints provide encrypted storage for all orchestrator data
    
    // POST /api/orchestrator/connect - Connect to orchestrator database (auto-creates if doesn't exist)
    httpApp.post('/api/orchestrator/connect', async (_req, res) => {
      try {
        console.log('[HTTP-ORCHESTRATOR] POST /api/orchestrator/connect')
        const { getOrchestratorService } = await import('./main/orchestrator-db/service')
        const service = getOrchestratorService()
        await service.connect()
        const status = service.getStatus()
        res.json({ success: true, data: status })
      } catch (error: any) {
        console.error('[HTTP-ORCHESTRATOR] Error in connect:', error)
        res.status(500).json({ success: false, error: error.message || 'Failed to connect' })
      }
    })

    // GET /api/orchestrator/status - Get connection status
    httpApp.get('/api/orchestrator/status', async (_req, res) => {
      try {
        console.log('[HTTP-ORCHESTRATOR] GET /api/orchestrator/status')
        const { getOrchestratorService } = await import('./main/orchestrator-db/service')
        const service = getOrchestratorService()
        const status = service.getStatus()
        res.json({ success: true, data: status })
      } catch (error: any) {
        console.error('[HTTP-ORCHESTRATOR] Error in status:', error)
        res.status(500).json({ success: false, error: error.message || 'Failed to get status' })
      }
    })

    // GET /api/orchestrator/get - Get value by key
    httpApp.get('/api/orchestrator/get', async (req, res) => {
      try {
        const key = req.query.key as string
        console.log('[HTTP-ORCHESTRATOR] GET /api/orchestrator/get', { key })
        const { getOrchestratorService } = await import('./main/orchestrator-db/service')
        const service = getOrchestratorService()
        const value = await service.get(key)
        res.json({ success: true, data: value })
      } catch (error: any) {
        console.error('[HTTP-ORCHESTRATOR] Error in get:', error)
        res.status(500).json({ success: false, error: error.message || 'Failed to get value' })
      }
    })

    // POST /api/orchestrator/set - Set value by key
    httpApp.post('/api/orchestrator/set', async (req, res) => {
      try {
        const { key, value } = req.body
        console.log('[HTTP-ORCHESTRATOR] POST /api/orchestrator/set', { key })
        const { getOrchestratorService } = await import('./main/orchestrator-db/service')
        const service = getOrchestratorService()
        await service.set(key, value)
        res.json({ success: true })
      } catch (error: any) {
        console.error('[HTTP-ORCHESTRATOR] Error in set:', error)
        res.status(500).json({ success: false, error: error.message || 'Failed to set value' })
      }
    })

    // GET /api/orchestrator/get-all - Get all key-value pairs
    httpApp.get('/api/orchestrator/get-all', async (_req, res) => {
      try {
        console.log('[HTTP-ORCHESTRATOR] GET /api/orchestrator/get-all')
        const { getOrchestratorService } = await import('./main/orchestrator-db/service')
        const service = getOrchestratorService()
        const data = await service.getAll()
        res.json({ success: true, data })
      } catch (error: any) {
        console.error('[HTTP-ORCHESTRATOR] Error in get-all:', error)
        res.status(500).json({ success: false, error: error.message || 'Failed to get all data' })
      }
    })

    // POST /api/orchestrator/set-all - Set multiple key-value pairs
    httpApp.post('/api/orchestrator/set-all', async (req, res) => {
      try {
        const { data } = req.body
        console.log('[HTTP-ORCHESTRATOR] POST /api/orchestrator/set-all', { keyCount: Object.keys(data || {}).length })
        const { getOrchestratorService } = await import('./main/orchestrator-db/service')
        const service = getOrchestratorService()
        await service.setAll(data)
        res.json({ success: true })
      } catch (error: any) {
        console.error('[HTTP-ORCHESTRATOR] Error in set-all:', error)
        res.status(500).json({ success: false, error: error.message || 'Failed to set all data' })
      }
    })

    // POST /api/orchestrator/remove - Remove key(s)
    httpApp.post('/api/orchestrator/remove', async (req, res) => {
      try {
        const { keys } = req.body
        console.log('[HTTP-ORCHESTRATOR] POST /api/orchestrator/remove', { keys })
        const { getOrchestratorService } = await import('./main/orchestrator-db/service')
        const service = getOrchestratorService()
        await service.remove(keys)
        res.json({ success: true })
      } catch (error: any) {
        console.error('[HTTP-ORCHESTRATOR] Error in remove:', error)
        res.status(500).json({ success: false, error: error.message || 'Failed to remove keys' })
      }
    })

    // POST /api/orchestrator/migrate - Migrate data from Chrome storage
    httpApp.post('/api/orchestrator/migrate', async (req, res) => {
      try {
        const { chromeData } = req.body
        console.log('[HTTP-ORCHESTRATOR] POST /api/orchestrator/migrate', { keyCount: Object.keys(chromeData || {}).length })
        const { getOrchestratorService } = await import('./main/orchestrator-db/service')
        const service = getOrchestratorService()
        await service.migrateFromChromeStorage(chromeData)
        res.json({ success: true })
      } catch (error: any) {
        console.error('[HTTP-ORCHESTRATOR] Error in migrate:', error)
        res.status(500).json({ success: false, error: error.message || 'Failed to migrate data' })
      }
    })

    // POST /api/orchestrator/export - Export data (future-ready for JSON/YAML/MD)
    httpApp.post('/api/orchestrator/export', async (req, res) => {
      try {
        const options = req.body
        console.log('[HTTP-ORCHESTRATOR] POST /api/orchestrator/export', { format: options.format })
        const { getOrchestratorService } = await import('./main/orchestrator-db/service')
        const service = getOrchestratorService()
        const exportData = await service.exportData(options)
        res.json({ success: true, data: exportData })
      } catch (error: any) {
        console.error('[HTTP-ORCHESTRATOR] Error in export:', error)
        res.status(500).json({ success: false, error: error.message || 'Failed to export data' })
      }
    })

    // POST /api/orchestrator/import - Import data (future-ready for JSON/YAML/MD)
    httpApp.post('/api/orchestrator/import', async (req, res) => {
      try {
        const { data } = req.body
        console.log('[HTTP-ORCHESTRATOR] POST /api/orchestrator/import')
        const { getOrchestratorService } = await import('./main/orchestrator-db/service')
        const service = getOrchestratorService()
        await service.importData(data)
        res.json({ success: true })
      } catch (error: any) {
        console.error('[HTTP-ORCHESTRATOR] Error in import:', error)
        res.status(500).json({ success: false, error: error.message || 'Failed to import data' })
      }
    })

    const HTTP_PORT = 51248
    
    // Simple function to start HTTP server with error handling
    const startHttpServer = (port: number, attempt = 1): void => {
      console.log(`[MAIN] Starting HTTP API server on port ${port} (attempt ${attempt})...`)
      
      const server = httpApp.listen(port, '127.0.0.1', () => {
        console.log(`[MAIN] ✅ HTTP API server listening on http://127.0.0.1:${port}`)
        console.log(`[MAIN] HTTP server is now listening on port ${port}`)
      })
      
      server.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
          console.error(`[MAIN] Port ${port} is already in use`)
          
          // Try to free the port on Windows
          if (process.platform === 'win32' && attempt === 1) {
            console.log(`[MAIN] Attempting to free port ${port}...`)
            exec(`netstat -ano | findstr :${port}`, (_error: any, stdout: string) => {
              if (stdout) {
                const lines = stdout.trim().split('\n')
                const pids = new Set<string>()
                lines.forEach(line => {
                  const parts = line.trim().split(/\s+/)
                  if (parts.length > 0) {
                    const pid = parts[parts.length - 1]
                    if (pid && pid !== '0') pids.add(pid)
                  }
                })
                if (pids.size > 0) {
                  console.log(`[MAIN] Found processes using port ${port}: ${Array.from(pids).join(', ')}`)
                  pids.forEach(pid => {
                    exec(`taskkill /F /PID ${pid}`, () => {})
                  })
                  // Wait and retry
                  setTimeout(() => {
                    console.log(`[MAIN] Retrying after cleanup...`)
                    startHttpServer(port, attempt + 1)
                  }, 2000)
                  return
                }
              }
              // If cleanup didn't work, try alternative port
              console.log(`[MAIN] Trying alternative port ${port + 1}...`)
              startHttpServer(port + 1, 1)
            })
          } else {
            // Try alternative port
            if (attempt < 3) {
              console.log(`[MAIN] Trying alternative port ${port + 1}...`)
              startHttpServer(port + 1, attempt + 1)
            } else {
              console.error(`[MAIN] ❌ Failed to start HTTP server after ${attempt} attempts`)
            }
          }
        } else {
          console.error('[MAIN] HTTP server error:', err.message, err.stack)
        }
      })
    }
    
    // Start the server
    startHttpServer(HTTP_PORT)

    // Error handling is done via try-catch and httpApp.listen callback
  } catch (err) {
    console.error('[MAIN] Error in HTTP API setup:', err)
    console.error('[MAIN] Error details:', err instanceof Error ? err.message : String(err))
    console.error('[MAIN] Error stack:', err instanceof Error ? err.stack : 'No stack trace')
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
