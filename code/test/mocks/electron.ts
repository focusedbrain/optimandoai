/**
 * Global Electron API mock for Vitest workspace-root runs.
 *
 * This file is aliased as `electron` in the root vitest.config.ts so that
 * any production module importing `electron` (app.getPath, safeStorage, etc.)
 * gets a deterministic, no-op mock rather than crashing because the real
 * Electron runtime is not present in the Node/Vitest environment.
 *
 * Tests that need more specific behaviour can override with a local
 * `vi.mock('electron', () => ({...}))` which takes precedence over this alias.
 *
 * B-8.4d-iii-5a: unblocks ~25 suite-load failures caused by
 * `Cannot read properties of undefined (reading 'getPath')`.
 */
import os from 'node:os'
import path from 'node:path'

const testUserData = path.join(os.tmpdir(), 'vitest-electron-mock')

// ---------------------------------------------------------------------------
// app
// ---------------------------------------------------------------------------
export const app = {
  getPath: (name: string): string => {
    switch (name) {
      case 'userData':    return testUserData
      case 'appData':     return path.join(testUserData, 'appData')
      case 'home':        return os.homedir()
      case 'temp':        return os.tmpdir()
      case 'downloads':   return path.join(testUserData, 'downloads')
      case 'documents':   return path.join(testUserData, 'documents')
      case 'desktop':     return path.join(testUserData, 'desktop')
      case 'logs':        return path.join(testUserData, 'logs')
      case 'exe':         return path.join(testUserData, 'electron')
      case 'module':      return path.join(testUserData, 'module')
      case 'crashDumps':  return path.join(testUserData, 'crashDumps')
      default:            return path.join(testUserData, name)
    }
  },
  getName: () => 'optimando-test',
  getVersion: () => '0.0.0-test',
  getLocale: () => 'en-US',
  getLocaleCountryCode: () => 'US',
  isReady: () => Promise.resolve(true),
  whenReady: () => Promise.resolve(),
  quit: () => undefined,
  exit: (_code?: number) => undefined,
  relaunch: () => undefined,
  focus: () => undefined,
  hide: () => undefined,
  show: () => undefined,
  setName: (_name: string) => undefined,
  isPackaged: false,
  isDefaultProtocolClient: () => false,
  setAsDefaultProtocolClient: () => false,
  removeAsDefaultProtocolClient: () => false,
  getAppPath: () => testUserData,
  setPath: (_name: string, _p: string) => undefined,
  getFileIcon: () => Promise.resolve(null),
  dock: {
    setBadge: () => undefined,
    getBadge: () => '',
    hide: () => Promise.resolve(),
    show: () => Promise.resolve(),
  },
  commandLine: {
    appendSwitch: () => undefined,
    appendArgument: () => undefined,
    hasSwitch: () => false,
    getSwitchValue: () => '',
  },
  on: (_event: string, _listener: (...args: unknown[]) => void) => app,
  once: (_event: string, _listener: (...args: unknown[]) => void) => app,
  off: (_event: string, _listener: (...args: unknown[]) => void) => app,
  removeListener: (_event: string, _listener: (...args: unknown[]) => void) => app,
  removeAllListeners: (_event?: string) => app,
  emit: (_event: string, ..._args: unknown[]) => false as boolean,
}

// ---------------------------------------------------------------------------
// safeStorage
// ---------------------------------------------------------------------------
export const safeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: (s: string) => Buffer.from(s),
  decryptString: (b: Buffer) => b.toString(),
}

// ---------------------------------------------------------------------------
// ipcMain
// ---------------------------------------------------------------------------
export const ipcMain = {
  handle: (_channel: string, _listener: (...args: unknown[]) => unknown) => undefined,
  handleOnce: (_channel: string, _listener: (...args: unknown[]) => unknown) => undefined,
  removeHandler: (_channel: string) => undefined,
  on: (_channel: string, _listener: (...args: unknown[]) => void) => ipcMain,
  once: (_channel: string, _listener: (...args: unknown[]) => void) => ipcMain,
  off: (_channel: string, _listener: (...args: unknown[]) => void) => ipcMain,
  removeListener: (_channel: string, _listener: (...args: unknown[]) => void) => ipcMain,
  removeAllListeners: (_channel?: string) => ipcMain,
  emit: (_event: string, ..._args: unknown[]) => false as boolean,
  eventNames: () => [] as string[],
}

// ---------------------------------------------------------------------------
// ipcRenderer
// ---------------------------------------------------------------------------
export const ipcRenderer = {
  on: (_channel: string, _listener: (...args: unknown[]) => void) => ipcRenderer,
  once: (_channel: string, _listener: (...args: unknown[]) => void) => ipcRenderer,
  off: (_channel: string, _listener: (...args: unknown[]) => void) => ipcRenderer,
  send: (_channel: string, ..._args: unknown[]) => undefined,
  sendSync: (_channel: string, ..._args: unknown[]) => undefined,
  invoke: (_channel: string, ..._args: unknown[]) => Promise.resolve(undefined),
  removeListener: (_channel: string, _listener: (...args: unknown[]) => void) => ipcRenderer,
  removeAllListeners: (_channel?: string) => ipcRenderer,
  sendToHost: (_channel: string, ..._args: unknown[]) => undefined,
}

// ---------------------------------------------------------------------------
// BrowserWindow
// ---------------------------------------------------------------------------
const mockWebContents = {
  send: (_channel: string, ..._args: unknown[]) => undefined,
  executeJavaScript: (_code: string) => Promise.resolve(undefined),
  openDevTools: () => undefined,
  closeDevTools: () => undefined,
  isDevToolsOpened: () => false,
  getURL: () => 'about:blank',
  reload: () => undefined,
  on: (..._args: unknown[]) => mockWebContents,
  once: (..._args: unknown[]) => mockWebContents,
  removeListener: (..._args: unknown[]) => mockWebContents,
  setWindowOpenHandler: () => undefined,
}

export class BrowserWindow {
  webContents = { ...mockWebContents }

  static getAllWindows(): BrowserWindow[] { return [] }
  static getFocusedWindow(): BrowserWindow | null { return null }
  static fromId(_id: number): BrowserWindow | null { return null }
  static fromWebContents(_wc: unknown): BrowserWindow | null { return null }

  loadURL(_url: string) { return Promise.resolve() }
  loadFile(_path: string) { return Promise.resolve() }
  show() {}
  hide() {}
  close() {}
  destroy() {}
  focus() {}
  blur() {}
  isFocused() { return false }
  isDestroyed() { return false }
  isVisible() { return false }
  minimize() {}
  maximize() {}
  unmaximize() {}
  isMaximized() { return false }
  isMinimized() { return false }
  restore() {}
  setSize(_w: number, _h: number) {}
  getSize(): [number, number] { return [1280, 800] }
  setTitle(_title: string) {}
  getTitle() { return 'test' }
  center() {}
  setBounds(_bounds: object) {}
  getBounds() { return { x: 0, y: 0, width: 1280, height: 800 } }
  on(_event: string, _listener: (...args: unknown[]) => void): this { return this }
  once(_event: string, _listener: (...args: unknown[]) => void): this { return this }
  removeListener(_event: string, _listener: (...args: unknown[]) => void): this { return this }
  removeAllListeners(_event?: string): this { return this }
  emit(_event: string, ..._args: unknown[]): boolean { return false }
}

// ---------------------------------------------------------------------------
// shell
// ---------------------------------------------------------------------------
export const shell = {
  openExternal: (_url: string) => Promise.resolve(),
  openPath: (_p: string) => Promise.resolve(''),
  showItemInFolder: (_p: string) => undefined,
  moveItemToTrash: (_p: string) => Promise.resolve(true),
  beep: () => undefined,
}

// ---------------------------------------------------------------------------
// dialog
// ---------------------------------------------------------------------------
export const dialog = {
  showOpenDialog: (_opts?: object) => Promise.resolve({ canceled: true, filePaths: [] }),
  showSaveDialog: (_opts?: object) => Promise.resolve({ canceled: true, filePath: undefined }),
  showMessageBox: (_opts?: object) => Promise.resolve({ response: 0, checkboxChecked: false }),
  showErrorBox: (_title: string, _content: string) => undefined,
}

// ---------------------------------------------------------------------------
// nativeTheme
// ---------------------------------------------------------------------------
export const nativeTheme = {
  shouldUseDarkColors: false,
  themeSource: 'system' as const,
  on: () => undefined,
  removeListener: () => undefined,
}

// ---------------------------------------------------------------------------
// powerMonitor
// ---------------------------------------------------------------------------
export const powerMonitor = {
  on: () => undefined,
  off: () => undefined,
  removeListener: () => undefined,
  getSystemIdleState: (_threshold: number) => 'active' as const,
  getSystemIdleTime: () => 0,
}

// ---------------------------------------------------------------------------
// screen
// ---------------------------------------------------------------------------
export const screen = {
  getPrimaryDisplay: () => ({
    id: 1,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    workAreaSize: { width: 1920, height: 1040 },
    size: { width: 1920, height: 1080 },
    scaleFactor: 1,
    rotation: 0,
    internal: false,
  }),
  getAllDisplays: () => [],
  on: () => undefined,
}

// ---------------------------------------------------------------------------
// clipboard
// ---------------------------------------------------------------------------
export const clipboard = {
  readText: (_type?: string) => '',
  writeText: (_text: string, _type?: string) => undefined,
  readHTML: () => '',
  writeHTML: (_html: string) => undefined,
  readRTF: () => '',
  writeRTF: (_rtf: string) => undefined,
  clear: (_type?: string) => undefined,
  availableFormats: (_type?: string) => [] as string[],
  has: (_format: string, _type?: string) => false,
}

// ---------------------------------------------------------------------------
// nativeImage
// ---------------------------------------------------------------------------
export const nativeImage = {
  createEmpty: () => ({ toPNG: () => Buffer.alloc(0), isEmpty: () => true }),
  createFromPath: (_p: string) => ({ toPNG: () => Buffer.alloc(0), isEmpty: () => false }),
  createFromBuffer: (_b: Buffer) => ({ toPNG: () => Buffer.alloc(0), isEmpty: () => false }),
  createFromDataURL: (_url: string) => ({ toPNG: () => Buffer.alloc(0), isEmpty: () => false }),
}

// ---------------------------------------------------------------------------
// contextBridge
// ---------------------------------------------------------------------------
export const contextBridge = {
  exposeInMainWorld: (_key: string, _api: unknown) => undefined,
}

// ---------------------------------------------------------------------------
// Menu / MenuItem / Tray
// ---------------------------------------------------------------------------
export class Menu {
  static setApplicationMenu(_menu: Menu | null) {}
  static getApplicationMenu() { return null }
  static buildFromTemplate(_template: unknown[]) { return new Menu() }
  popup(_opts?: object) {}
  closePopup(_win?: BrowserWindow) {}
  append(_item: unknown) {}
  insert(_pos: number, _item: unknown) {}
  items: unknown[] = []
}

export class MenuItem {
  constructor(_opts?: object) {}
}

export class Tray {
  constructor(_icon: unknown) {}
  destroy() {}
  setImage(_image: unknown) {}
  setToolTip(_text: string) {}
  setContextMenu(_menu: Menu | null) {}
  on(_event: string, _listener: (...args: unknown[]) => void): this { return this }
}

// ---------------------------------------------------------------------------
// Notification
// ---------------------------------------------------------------------------
export class Notification {
  static isSupported() { return false }
  show() {}
  close() {}
  on(_event: string, _listener: (...args: unknown[]) => void): this { return this }
}

// ---------------------------------------------------------------------------
// session (minimal)
// ---------------------------------------------------------------------------
export const session = {
  defaultSession: {
    clearCache: () => Promise.resolve(),
    clearStorageData: () => Promise.resolve(),
    cookies: { get: () => Promise.resolve([]) },
    protocol: {
      registerFileProtocol: () => {},
      unregisterProtocol: () => {},
      isProtocolRegistered: () => false,
    },
  },
}

// ---------------------------------------------------------------------------
// powerSaveBlocker
// ---------------------------------------------------------------------------
export const powerSaveBlocker = {
  start: (_type: string) => 1,
  stop: (_id: number) => undefined,
  isStarted: (_id: number) => false,
}

// ---------------------------------------------------------------------------
// net (minimal)
// ---------------------------------------------------------------------------
export const net = {
  request: () => ({
    on: () => undefined,
    write: () => undefined,
    end: () => undefined,
    abort: () => undefined,
  }),
  isOnline: () => true,
  fetch: (url: string, opts?: RequestInit) => fetch(url, opts),
}

// ---------------------------------------------------------------------------
// Default export (some code does `import electron from 'electron'`)
// ---------------------------------------------------------------------------
const electron = {
  app,
  safeStorage,
  ipcMain,
  ipcRenderer,
  BrowserWindow,
  shell,
  dialog,
  nativeTheme,
  powerMonitor,
  screen,
  clipboard,
  nativeImage,
  contextBridge,
  Menu,
  MenuItem,
  Tray,
  Notification,
  session,
  powerSaveBlocker,
  net,
}

export default electron
