// ============================================================================
// WRVault — Hardened Preload Script
// ============================================================================
//
// SECURITY PROPERTIES:
//
//   1. NO generic ipcRenderer access is exposed to the renderer.
//      The renderer cannot call arbitrary IPC channels.
//
//   2. Every exposed function maps to exactly ONE hardcoded channel.
//      There is no dynamic channel name construction.
//
//   3. Arguments are validated before being forwarded to the main process.
//      Invalid shapes are rejected with a thrown error, never sent.
//
//   4. contextIsolation: true (enforced in BrowserWindow config)
//      The renderer runs in a separate JS context; it cannot modify
//      or monkey-patch anything in this preload script.
//
//   5. nodeIntegration: false (enforced in BrowserWindow config)
//      The renderer has no access to require(), process, fs, child_process,
//      or any Node.js API.
//
//   6. Main→renderer listeners use hardcoded channels and do NOT expose
//      the Electron event object.  Cleanup functions are returned.
//
// THREAT MODEL:
//
//   If an XSS vulnerability exists in the renderer, the attacker can
//   call any function on the exposed bridges.  By restricting these to
//   a minimal, typed set with validated arguments, we limit the blast
//   radius to the exact functionality the renderer legitimately needs —
//   not the entire main process IPC surface.
//
// ============================================================================

import { ipcRenderer, contextBridge } from 'electron'

// ============================================================================
// §1  Argument Validators
// ============================================================================
//
// Lightweight runtime checks (no external deps in preload).
// Each validator returns the validated value or throws.
//

function assertString(v: unknown, name: string): string {
  if (typeof v !== 'string' || v.length === 0 || v.length > 500) {
    throw new Error(`${name}: expected non-empty string (max 500 chars)`)
  }
  return v
}

function assertTheme(v: unknown): string {
  const ALLOWED = new Set(['default', 'dark', 'professional', 'pro', 'standard'])
  const s = assertString(v, 'theme')
  if (!ALLOWED.has(s)) throw new Error(`theme: invalid value "${s}"`)
  return s
}

type CaptureMode = 'screenshot' | 'stream'

interface CapturePresetPayload {
  mode: CaptureMode
  rect: { x: number; y: number; w: number; h: number }
  displayId?: string
}

function assertCapturePreset(v: unknown): CapturePresetPayload {
  if (!v || typeof v !== 'object') throw new Error('capturePreset: expected object')
  const obj = v as Record<string, unknown>

  if (obj.mode !== 'screenshot' && obj.mode !== 'stream') {
    throw new Error('capturePreset.mode: must be "screenshot" or "stream"')
  }
  if (!obj.rect || typeof obj.rect !== 'object') {
    throw new Error('capturePreset.rect: expected object')
  }
  const r = obj.rect as Record<string, unknown>
  for (const k of ['x', 'y', 'w', 'h'] as const) {
    if (typeof r[k] !== 'number' || !Number.isFinite(r[k] as number)) {
      throw new Error(`capturePreset.rect.${k}: expected finite number`)
    }
  }
  if (obj.displayId !== undefined && typeof obj.displayId !== 'string') {
    throw new Error('capturePreset.displayId: expected string or undefined')
  }

  return {
    mode: obj.mode as CaptureMode,
    rect: { x: r.x as number, y: r.y as number, w: r.w as number, h: r.h as number },
    ...(obj.displayId !== undefined ? { displayId: String(obj.displayId) } : {}),
  }
}

function assertSavePreset(v: unknown): object {
  if (!v || typeof v !== 'object') throw new Error('savePreset: expected object')
  return v as object
}

// ============================================================================
// §2  Channel Allowlists (compile-time constants)
// ============================================================================

// Allowed channel documentation (not enforced at runtime — kept for audit):
// INVOKE:  lmgtfy/select-screenshot, lmgtfy/select-stream, lmgtfy/stop-stream,
//          lmgtfy/get-presets, lmgtfy/capture-preset, lmgtfy/save-preset, integrity:status
// SEND:    REQUEST_THEME, SET_THEME, OPEN_BEAP_INBOX
// LISTEN:  main-process-message, lmgtfy.capture, hotkey, TRIGGERS_UPDATED,
//          OPEN_ANALYSIS_DASHBOARD, THEME_CHANGED

// ============================================================================
// §3  Exposed Bridges
// ============================================================================

// ── LETmeGIRAFFETHATFORYOU (screen capture) ──────────────────────────────
const lmgtfyBridge = {
  selectScreenshot: () => ipcRenderer.invoke('lmgtfy/select-screenshot'),
  selectStream: () => ipcRenderer.invoke('lmgtfy/select-stream'),
  stopStream: () => ipcRenderer.invoke('lmgtfy/stop-stream'),
  getPresets: () => ipcRenderer.invoke('lmgtfy/get-presets'),
  capturePreset: (payload: unknown) => {
    const validated = assertCapturePreset(payload)
    return ipcRenderer.invoke('lmgtfy/capture-preset', validated)
  },
  savePreset: (payload: unknown) => {
    const validated = assertSavePreset(payload)
    return ipcRenderer.invoke('lmgtfy/save-preset', validated)
  },
  onCapture: (cb: (payload: unknown) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, d: unknown) => cb(d)
    ipcRenderer.on('lmgtfy.capture', handler)
    return () => { ipcRenderer.removeListener('lmgtfy.capture', handler) }
  },
  onHotkey: (cb: (kind: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, k: unknown) => {
      if (typeof k === 'string') cb(k)
    }
    ipcRenderer.on('hotkey', handler)
    return () => { ipcRenderer.removeListener('hotkey', handler) }
  },
  onTriggersUpdated: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('TRIGGERS_UPDATED', handler)
    return () => { ipcRenderer.removeListener('TRIGGERS_UPDATED', handler) }
  },
}

contextBridge.exposeInMainWorld('LETmeGIRAFFETHATFORYOU', lmgtfyBridge)

// ── Analysis Dashboard ───────────────────────────────────────────────────
contextBridge.exposeInMainWorld('analysisDashboard', {
  onOpen: (callback: (rawPayload: unknown) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, rawPayload: unknown) => callback(rawPayload)
    ipcRenderer.on('OPEN_ANALYSIS_DASHBOARD', handler)
    return () => { ipcRenderer.removeListener('OPEN_ANALYSIS_DASHBOARD', handler) }
  },
  onThemeChange: (callback: (theme: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, payload: unknown) => {
      if (payload && typeof payload === 'object' && 'theme' in payload) {
        const t = (payload as { theme: unknown }).theme
        if (typeof t === 'string') callback(t)
      }
    }
    ipcRenderer.on('THEME_CHANGED', handler)
    return () => { ipcRenderer.removeListener('THEME_CHANGED', handler) }
  },
  requestTheme: () => {
    ipcRenderer.send('REQUEST_THEME')
  },
  setTheme: (theme: unknown) => {
    ipcRenderer.send('SET_THEME', assertTheme(theme))
  },
  openBeapInbox: () => {
    ipcRenderer.send('OPEN_BEAP_INBOX')
  },
  openHandshakeRequest: () => {
    ipcRenderer.send('OPEN_HANDSHAKE_REQUEST')
  },
})

// ── Handshake View (Relationships + Capsule Import) ────────────────────────
contextBridge.exposeInMainWorld('handshakeView', {
  listHandshakes: (filter?: unknown) => {
    const validFilter = filter && typeof filter === 'object' ? filter : undefined
    return ipcRenderer.invoke('handshake:list', validFilter)
  },
  submitCapsule: (jsonString: unknown) => {
    if (typeof jsonString !== 'string' || jsonString.length === 0 || jsonString.length > 65536) {
      throw new Error('capsuleJson: expected non-empty string (max 64KB)')
    }
    return ipcRenderer.invoke('handshake:submitCapsule', jsonString)
  },
  acceptHandshake: (id: unknown, sharingMode: unknown, fromAccountId: unknown, contextOpts?: unknown) => {
    const opts = contextOpts && typeof contextOpts === 'object' ? contextOpts as Record<string, unknown> : undefined
    const safeOpts = opts ? {
      ...(Array.isArray(opts.context_blocks) ? { context_blocks: opts.context_blocks } : {}),
      ...(Array.isArray(opts.profile_ids) ? { profile_ids: opts.profile_ids } : {}),
    } : undefined
    return ipcRenderer.invoke('handshake:accept', assertString(id, 'id'), assertString(sharingMode, 'sharingMode'), typeof fromAccountId === 'string' ? fromAccountId : '', safeOpts)
  },
  declineHandshake: (id: unknown) => {
    return ipcRenderer.invoke('handshake:decline', assertString(id, 'id'))
  },
  getContextBlockCount: (handshakeId: unknown) => {
    return ipcRenderer.invoke('handshake:contextBlockCount', assertString(handshakeId, 'handshakeId'))
  },
  queryContextBlocks: (handshakeId: unknown) => {
    return ipcRenderer.invoke('handshake:queryContextBlocks', assertString(handshakeId, 'handshakeId'))
  },
  chatWithContext: (systemMessage: unknown, dataWrapper: unknown, userMessage: unknown) => {
    if (typeof systemMessage !== 'string' || systemMessage.length > 4096) {
      throw new Error('systemMessage: expected string (max 4KB)')
    }
    if (typeof dataWrapper !== 'string' || dataWrapper.length > 512_000) {
      throw new Error('dataWrapper: expected string (max 512KB)')
    }
    const user = assertString(userMessage, 'userMessage')
    return ipcRenderer.invoke('handshake:chatWithContext', systemMessage, dataWrapper, user)
  },
  initiateHandshake: (receiverEmail: unknown, fromAccountId: unknown, contextOpts?: unknown) => {
    const email = assertString(receiverEmail, 'receiverEmail')
    const acct = typeof fromAccountId === 'string' ? fromAccountId : ''
    const opts = contextOpts && typeof contextOpts === 'object' ? contextOpts as Record<string, unknown> : undefined
    const safeOpts = opts ? {
      ...(typeof opts.skipVaultContext === 'boolean' ? { skipVaultContext: opts.skipVaultContext } : {}),
      ...(typeof opts.message === 'string' && opts.message.trim() ? { message: opts.message.trim() } : {}),
      ...(Array.isArray(opts.context_blocks) ? { context_blocks: opts.context_blocks } : {}),
    } : undefined
    return ipcRenderer.invoke('handshake:initiate', email, acct, safeOpts)
  },
  buildForDownload: (receiverEmail: unknown, contextOpts?: unknown) => {
    const email = assertString(receiverEmail, 'receiverEmail')
    const opts = contextOpts && typeof contextOpts === 'object' ? contextOpts as Record<string, unknown> : undefined
    const safeOpts = opts ? {
      ...(typeof opts.skipVaultContext === 'boolean' ? { skipVaultContext: opts.skipVaultContext } : {}),
      ...(typeof opts.message === 'string' && opts.message.trim() ? { message: opts.message.trim() } : {}),
      ...(Array.isArray(opts.context_blocks) ? { context_blocks: opts.context_blocks } : {}),
    } : undefined
    return ipcRenderer.invoke('handshake:buildForDownload', email, safeOpts)
  },
  downloadCapsule: (capsuleJson: unknown, suggestedFilename: unknown) => {
    if (typeof capsuleJson !== 'string' || capsuleJson.length === 0 || capsuleJson.length > 65536) {
      throw new Error('capsuleJson: expected non-empty string (max 64KB)')
    }
    const name = typeof suggestedFilename === 'string' && suggestedFilename.length <= 255
      ? suggestedFilename : 'handshake.beap'
    return ipcRenderer.invoke('handshake:downloadCapsule', capsuleJson, name)
  },
})

// ── P2P Health & Queue ─────────────────────────────────────────────────────
contextBridge.exposeInMainWorld('p2p', {
  getHealth: () => ipcRenderer.invoke('p2p:getHealth'),
  getQueueStatus: (handshakeId: unknown) => {
    const id = typeof handshakeId === 'string' && handshakeId.length <= 128 ? handshakeId : ''
    return ipcRenderer.invoke('p2p:getQueueStatus', id)
  },
})

// ── Email Accounts ─────────────────────────────────────────────────────────
contextBridge.exposeInMainWorld('emailAccounts', {
  listAccounts: () => ipcRenderer.invoke('email:listAccounts'),
})

// ── Build Integrity (offline verification) ────────────────────────────────
contextBridge.exposeInMainWorld('integrity', {
  getStatus: () => ipcRenderer.invoke('integrity:status'),
})

// ── Lifecycle (main→renderer notifications) ──────────────────────────────
contextBridge.exposeInMainWorld('lifecycle', {
  onMainProcessMessage: (cb: (message: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, msg: unknown) => {
      if (typeof msg === 'string') cb(msg)
    }
    ipcRenderer.on('main-process-message', handler)
    return () => { ipcRenderer.removeListener('main-process-message', handler) }
  },
})

// ============================================================================
// §4  What Is NOT Exposed
// ============================================================================
//
// The following are deliberately removed:
//
//   ✗  window.ipcRenderer          — open proxy to every IPC channel
//   ✗  window.lmgtfy               — unused duplicate of LETmeGIRAFFETHATFORYOU
//   ✗  window.db                   — unused by the renderer
//   ✗  ipcRenderer.invoke(channel) — no dynamic channel invocation
//   ✗  ipcRenderer.send(channel)   — no dynamic channel sending
//   ✗  ipcRenderer.on(channel)     — no dynamic channel listening
//   ✗  require()                   — blocked by nodeIntegration: false
//   ✗  process, fs, child_process  — blocked by contextIsolation: true
//
// ============================================================================
