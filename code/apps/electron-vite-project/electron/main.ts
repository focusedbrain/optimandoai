import { app, BrowserWindow, globalShortcut, Tray, Menu, Notification } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { registerHandler, LmgtfyChannels, emitCapture } from './lmgtfy/ipc'
import { selectRegion } from './lmgtfy/overlay'
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

function createWindow() {
  const startHidden = process.argv.includes('--hidden')
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
    show: !startHidden,
  })

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    // win.loadFile('dist/index.html')
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
  registerHandler(LmgtfyChannels.SelectScreenshot, async () => {
    const sel = await selectRegion()
    if (!sel || !win) return null
    const { filePath, thumbnailPath } = await captureScreenshot(sel)
    emitCapture(win, {
      event: LmgtfyChannels.OnCaptureEvent,
      mode: 'screenshot',
      filePath,
      thumbnailPath,
      meta: { x: sel.x, y: sel.y, w: sel.w, h: sel.h, dpr: sel.dpr, displayId: sel.displayId },
    })
    return { filePath, thumbnailPath }
  })
  registerHandler(LmgtfyChannels.SelectStream, async () => {
    const sel = await selectRegion()
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
    emitCapture(win, {
      event: LmgtfyChannels.OnCaptureEvent,
      mode: 'stream',
      filePath: out,
      thumbnailPath: '',
      meta: { presetName: 'finalized', x: 0, y: 0, w: 0, h: 0, dpr: 1 },
    })
    return { filePath: out }
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
    tray.setToolTip('Optimando Orchestrator')
    tray.setContextMenu(menu)
    tray.on('click', () => { if (!win) return; if (win.isVisible()) win.focus(); else win.show() })
    // Startup toast
    try {
      new Notification({ title: 'Optimando Orchestrator', body: 'Running in background. Use Alt+Shift+S or chat icons to capture.' }).show()
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

app.whenReady().then(() => {
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
})
