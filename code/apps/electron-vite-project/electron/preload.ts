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

/** IMAP/SMTP passwords & app passwords (bounded for IPC). */
function assertSecretString(v: unknown, name: string, maxLen = 512): string {
  if (typeof v !== 'string' || v.length === 0 || v.length > maxLen) {
    throw new Error(`${name}: expected non-empty string (max ${maxLen} chars)`)
  }
  return v
}

function assertSecurityMode(v: unknown, field: string): 'ssl' | 'starttls' | 'none' {
  if (v === 'ssl' || v === 'starttls' || v === 'none') return v
  throw new Error(`${field}: expected ssl | starttls | none`)
}

function assertMailboxPort(v: unknown, field: string): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseInt(String(v).trim(), 10) : NaN
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`${field}: expected integer port 1–65535`)
  }
  return n
}

function assertHostLike(v: unknown, name: string): string {
  const s = typeof v === 'string' ? v.trim() : ''
  if (s.length < 1 || s.length > 253) {
    throw new Error(`${name}: invalid host (1–253 chars)`)
  }
  if (/\s/.test(s)) {
    throw new Error(`${name}: host must not contain whitespace`)
  }
  return s
}

function optionalImapLifecycleMailbox(v: unknown, field: string): string | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'string') throw new Error(`${field}: expected string or omit`)
  const t = v.trim()
  if (!t) return undefined
  if (t.length > 200) throw new Error(`${field}: max 200 characters`)
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(t)) throw new Error(`${field}: invalid characters`)
  return t
}

function assertCustomMailboxPayload(v: unknown): {
  displayName?: string
  email: string
  imapHost: string
  imapPort: number
  imapSecurity: 'ssl' | 'starttls' | 'none'
  imapUsername?: string
  imapPassword: string
  smtpHost: string
  smtpPort: number
  smtpSecurity: 'ssl' | 'starttls' | 'none'
  smtpUseSameCredentials: boolean
  smtpUsername?: string
  smtpPassword?: string
  imapLifecycleArchiveMailbox?: string
  imapLifecyclePendingReviewMailbox?: string
  imapLifecyclePendingDeleteMailbox?: string
  imapLifecycleTrashMailbox?: string
  syncWindowDays: number
} {
  if (!v || typeof v !== 'object') throw new Error('customMailbox: expected object')
  const o = v as Record<string, unknown>
  const emailRaw = typeof o.email === 'string' ? o.email.trim() : ''
  if (!emailRaw || emailRaw.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
    throw new Error('customMailbox.email: valid email required')
  }
  const displayName =
    typeof o.displayName === 'string' && o.displayName.trim()
      ? o.displayName.trim().slice(0, 200)
      : undefined
  const imapHost = assertHostLike(o.imapHost, 'imapHost')
  const smtpHost = assertHostLike(o.smtpHost, 'smtpHost')
  /** Default: same as IMAP (unless explicitly `false`). */
  const useSame = o.smtpUseSameCredentials !== false
  const imapUser =
    typeof o.imapUsername === 'string' && o.imapUsername.trim()
      ? o.imapUsername.trim().slice(0, 320)
      : undefined
  let smtpUser: string | undefined
  let smtpPass: string | undefined
  if (!useSame) {
    if (typeof o.smtpUsername !== 'string' || !o.smtpUsername.trim()) {
      throw new Error('customMailbox.smtpUsername required when not using same credentials as IMAP')
    }
    smtpUser = o.smtpUsername.trim().slice(0, 320)
    smtpPass = assertSecretString(o.smtpPassword, 'smtpPassword')
  }
  const lifeArchive = optionalImapLifecycleMailbox(o.imapLifecycleArchiveMailbox, 'imapLifecycleArchiveMailbox')
  const lifeReview = optionalImapLifecycleMailbox(o.imapLifecyclePendingReviewMailbox, 'imapLifecyclePendingReviewMailbox')
  const lifeDelete = optionalImapLifecycleMailbox(o.imapLifecyclePendingDeleteMailbox, 'imapLifecyclePendingDeleteMailbox')
  const lifeTrash = optionalImapLifecycleMailbox(o.imapLifecycleTrashMailbox, 'imapLifecycleTrashMailbox')
  let syncWindowDays = 30
  if (o.syncWindowDays !== undefined && o.syncWindowDays !== null) {
    const n = typeof o.syncWindowDays === 'number' ? o.syncWindowDays : parseInt(String(o.syncWindowDays).trim(), 10)
    if (!Number.isInteger(n) || n < 0) {
      throw new Error('customMailbox.syncWindowDays: expected non-negative integer')
    }
    syncWindowDays = n
  }
  return {
    ...(displayName ? { displayName } : {}),
    email: emailRaw,
    imapHost,
    imapPort: assertMailboxPort(o.imapPort, 'imapPort'),
    imapSecurity: assertSecurityMode(o.imapSecurity, 'imapSecurity'),
    ...(imapUser ? { imapUsername: imapUser } : {}),
    imapPassword: assertSecretString(o.imapPassword, 'imapPassword'),
    smtpHost,
    smtpPort: assertMailboxPort(o.smtpPort, 'smtpPort'),
    smtpSecurity: assertSecurityMode(o.smtpSecurity, 'smtpSecurity'),
    smtpUseSameCredentials: useSame,
    ...(smtpUser ? { smtpUsername: smtpUser } : {}),
    ...(smtpPass ? { smtpPassword: smtpPass } : {}),
    ...(lifeArchive ? { imapLifecycleArchiveMailbox: lifeArchive } : {}),
    ...(lifeReview ? { imapLifecyclePendingReviewMailbox: lifeReview } : {}),
    ...(lifeDelete ? { imapLifecyclePendingDeleteMailbox: lifeDelete } : {}),
    ...(lifeTrash ? { imapLifecycleTrashMailbox: lifeTrash } : {}),
    syncWindowDays,
  }
}

/** DevTools IMAP wire test — forwards plaintext credentials to main (debug only). */
function assertDiagnoseImapParams(v: unknown): {
  host: string
  port: number
  security: 'ssl' | 'starttls' | 'none'
  username: string
  password: string
} {
  if (!v || typeof v !== 'object') throw new Error('diagnoseImap: expected object')
  const o = v as Record<string, unknown>
  return {
    host: assertHostLike(o.host, 'host'),
    port: assertMailboxPort(o.port, 'port'),
    security: assertSecurityMode(o.security, 'security'),
    username: (() => {
      const u = typeof o.username === 'string' ? o.username.trim() : ''
      if (!u || u.length > 320) throw new Error('diagnoseImap.username: non-empty string required (max 320)')
      return u
    })(),
    password: (() => {
      const pwd = typeof o.password === 'string' ? o.password : ''
      if (!pwd || pwd.length > 2048) {
        throw new Error('diagnoseImap.password: non-empty string required (max 2048 chars)')
      }
      return pwd
    })(),
  }
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

function assertBeapSessionImportPayload(v: unknown): {
  sessionId: string
  sessionName: string
  config: Record<string, unknown>
  sourceMessageId: string
  handshakeId: string | null
} {
  if (!v || typeof v !== 'object') throw new Error('importSessionFromBeap: expected object')
  const o = v as Record<string, unknown>
  const sessionId = typeof o.sessionId === 'string' ? o.sessionId.trim() : String(o.sessionId ?? '').trim()
  if (!sessionId || sessionId.length > 500) throw new Error('importSessionFromBeap: sessionId required')
  const sessionName =
    typeof o.sessionName === 'string' && o.sessionName.trim()
      ? o.sessionName.trim().slice(0, 500)
      : sessionId
  const sourceMessageId =
    typeof o.sourceMessageId === 'string' ? o.sourceMessageId.trim() : String(o.sourceMessageId ?? '').trim()
  if (!sourceMessageId || sourceMessageId.length > 500) {
    throw new Error('importSessionFromBeap: sourceMessageId required')
  }
  const config =
    o.config && typeof o.config === 'object' && o.config !== null
      ? (o.config as Record<string, unknown>)
      : {}
  let handshakeId: string | null = null
  if (o.handshakeId !== undefined && o.handshakeId !== null) {
    handshakeId = String(o.handshakeId).slice(0, 500)
  }
  return { sessionId, sessionName, config, sourceMessageId, handshakeId }
}

/**
 * Same contract as `background.ts` `UPDATE_BOX_OUTPUT_SQLITE` → `chrome.runtime.sendMessage` payload:
 * - `agentBoxId`: canonical (`identifier || id || msg.agentBoxId`)
 * - `agentBoxUuid`: original `msg.agentBoxId` from processFlow (UUID or short id — never the canonical-only fallback alone)
 * - `output`: same string written to the box
 * - `allBoxes`: `session.agentBoxes` after mutation
 */
function assertRelayAgentBoxOutputData(v: unknown): {
  agentBoxId: string
  agentBoxUuid: string
  output: string
  allBoxes: unknown[]
  sourceSurface: 'dashboard' | 'sidepanel' | 'popup'
} {
  if (!v || typeof v !== 'object') throw new Error('relayAgentBoxOutput: expected object')
  const o = v as Record<string, unknown>
  const agentBoxId =
    typeof o.agentBoxId === 'string' && o.agentBoxId.length > 0 && o.agentBoxId.length <= 512
      ? o.agentBoxId
      : (() => {
          throw new Error('relayAgentBoxOutput.agentBoxId: required string (max 512)')
        })()
  if (typeof o.agentBoxUuid !== 'string' || o.agentBoxUuid.length === 0 || o.agentBoxUuid.length > 512) {
    throw new Error('relayAgentBoxOutput.agentBoxUuid: required non-empty string (max 512)')
  }
  if (typeof o.output !== 'string') throw new Error('relayAgentBoxOutput.output: expected string')
  if (o.output.length > 4_000_000) throw new Error('relayAgentBoxOutput.output: exceeds max length')
  if (!Array.isArray(o.allBoxes)) throw new Error('relayAgentBoxOutput.allBoxes: expected array')
  if (o.allBoxes.length > 500) throw new Error('relayAgentBoxOutput.allBoxes: array too large')
  const raw = o.sourceSurface
  const sourceSurface =
    raw === 'dashboard' || raw === 'sidepanel' || raw === 'popup'
      ? raw
      : 'dashboard'
  return { agentBoxId, agentBoxUuid: o.agentBoxUuid, output: o.output, allBoxes: o.allBoxes, sourceSurface }
}

// ============================================================================
// §2  Channel Allowlists (compile-time constants)
// ============================================================================

// Allowed channel documentation (not enforced at runtime — kept for audit):
// INVOKE:  lmgtfy/select-screenshot, lmgtfy/select-stream, lmgtfy/stop-stream,
//          lmgtfy/get-presets, lmgtfy/capture-preset, lmgtfy/save-preset, integrity:status
// SEND:    REQUEST_THEME, SET_THEME, OPEN_BEAP_INBOX, RELAY_UPDATE_AGENT_BOX_OUTPUT
// LISTEN:  main-process-message, lmgtfy.capture, hotkey, TRIGGERS_UPDATED,
//          OPEN_ANALYSIS_DASHBOARD, THEME_CHANGED

// ============================================================================
// §3  Exposed Bridges
// ============================================================================

// ── LETmeGIRAFFETHATFORYOU (screen capture) ──────────────────────────────
const lmgtfyBridge = {
  selectScreenshot: (opts?: { createTrigger?: boolean; addCommand?: boolean }) =>
    ipcRenderer.invoke('lmgtfy/select-screenshot', opts ?? {}),
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
  /** Dashboard WR Chat: append capture media in the same window (no chrome.runtime). */
  onDashboardCommandAppend: (cb: (payload: unknown) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, d: unknown) => cb(d)
    ipcRenderer.on('COMMAND_POPUP_APPEND', handler)
    return () => { ipcRenderer.removeListener('COMMAND_POPUP_APPEND', handler) }
  },
  onDashboardTriggerPrompt: (cb: (payload: unknown) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, d: unknown) => cb(d)
    ipcRenderer.on('lmgtfy-show-trigger-prompt', handler)
    return () => { ipcRenderer.removeListener('lmgtfy-show-trigger-prompt', handler) }
  },
  /** Dashboard WR Chat: headless capture result (same payload shape as extension SELECTION_RESULT). */
  onDashboardSelectionResult: (cb: (payload: unknown) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, d: unknown) => cb(d)
    ipcRenderer.on('lmgtfy-dashboard-selection-result', handler)
    return () => { ipcRenderer.removeListener('lmgtfy-dashboard-selection-result', handler) }
  },
}

contextBridge.exposeInMainWorld('LETmeGIRAFFETHATFORYOU', lmgtfyBridge)

// ── Orchestrator (local automation DB) ───────────────────────────────────
contextBridge.exposeInMainWorld('orchestrator', {
  importSessionFromBeap: (payload: unknown) => {
    const validated = assertBeapSessionImportPayload(payload)
    return ipcRenderer.invoke('orchestrator:importSessionFromBeap', validated)
  },
  connect: () => ipcRenderer.invoke('orchestrator:connect'),
  listSessions: () => ipcRenderer.invoke('orchestrator:listSessions'),
})

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
  openBeapDraft: () => {
    ipcRenderer.send('OPEN_BEAP_DRAFT')
  },
  openEmailCompose: () => {
    ipcRenderer.send('OPEN_EMAIL_COMPOSE')
  },
  openHandshakeRequest: () => {
    ipcRenderer.send('OPEN_HANDSHAKE_REQUEST')
  },
  openWrChat: () => {
    ipcRenderer.send('OPEN_WR_CHAT')
  },
  /** After dashboard WR Chat persists agent box output via HTTP shim, relay live UI update to the extension (WS → background → runtime). */
  relayAgentBoxOutputLive: (payload: unknown) => {
    const validated = assertRelayAgentBoxOutputData(payload)
    ipcRenderer.send('RELAY_UPDATE_AGENT_BOX_OUTPUT', validated)
  },
})

// ── Handshake list refresh (main → renderer when coordination receives capsule) ─
ipcRenderer.on('handshake-list-refresh', () => {
  window.dispatchEvent(new CustomEvent('handshake-list-refresh'))
})
ipcRenderer.on('vault-status-changed', () => {
  window.dispatchEvent(new CustomEvent('vault-status-changed'))
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
  importCapsule: (jsonString: unknown) => {
    if (typeof jsonString !== 'string' || jsonString.length === 0 || jsonString.length > 65536) {
      throw new Error('capsuleJson: expected non-empty string (max 64KB)')
    }
    return ipcRenderer.invoke('handshake:importCapsule', jsonString)
  },
  acceptHandshake: (id: unknown, sharingMode: unknown, fromAccountId: unknown, contextOpts?: unknown) => {
    const opts = contextOpts && typeof contextOpts === 'object' ? contextOpts as Record<string, unknown> : undefined
    const safeOpts = opts ? {
      ...(Array.isArray(opts.context_blocks) ? { context_blocks: opts.context_blocks } : {}),
      ...(Array.isArray(opts.profile_ids) ? { profile_ids: opts.profile_ids } : {}),
      ...(Array.isArray(opts.profile_items) ? { profile_items: opts.profile_items } : {}),
      ...(opts.policy_selections && typeof opts.policy_selections === 'object' ? { policy_selections: opts.policy_selections } : {}),
    } : undefined
    return ipcRenderer.invoke('handshake:accept', assertString(id, 'id'), assertString(sharingMode, 'sharingMode'), typeof fromAccountId === 'string' ? fromAccountId : '', safeOpts)
  },
  declineHandshake: (id: unknown) => {
    return ipcRenderer.invoke('handshake:decline', assertString(id, 'id'))
  },
  deleteHandshake: (id: unknown) => {
    return ipcRenderer.invoke('handshake:delete', assertString(id, 'id'))
  },
  getPendingP2PBeapMessages: () => {
    return ipcRenderer.invoke('handshake:getPendingP2PBeapMessages')
  },
  ackPendingP2PBeap: (id: unknown) => {
    return ipcRenderer.invoke('handshake:ackPendingP2PBeap', typeof id === 'number' ? id : 0)
  },
  getPendingPlainEmails: () => {
    return ipcRenderer.invoke('handshake:getPendingPlainEmails')
  },
  ackPendingPlainEmail: (id: unknown) => {
    return ipcRenderer.invoke('handshake:ackPendingPlainEmail', typeof id === 'number' ? id : 0)
  },
  importBeapMessage: (packageJson: unknown) => {
    if (typeof packageJson !== 'string' || packageJson.length === 0 || packageJson.length > 512 * 1024) {
      return Promise.resolve({ success: false, error: 'Invalid package: expected non-empty string (max 512KB)' })
    }
    return ipcRenderer.invoke('handshake:importBeapMessage', packageJson)
  },
  sendBeapViaP2P: (handshakeId: unknown, packageJson: unknown) => {
    const id = assertString(handshakeId, 'handshakeId')
    const P2P_MAX = 100 * 1024 * 1024
    let json: string
    if (typeof packageJson === 'string') {
      json = packageJson
    } else if (packageJson !== null && typeof packageJson === 'object') {
      try {
        const s = JSON.stringify(packageJson)
        if (typeof s !== 'string') {
          throw new Error('packageJson: object did not serialize to a string')
        }
        json = s
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        throw new Error(`packageJson: failed to serialize (${msg})`)
      }
    } else {
      throw new Error(
        `packageJson: expected string or serializable object, got ${packageJson === null ? 'null' : typeof packageJson}`,
      )
    }
    if (json.length === 0) {
      throw new Error('packageJson: empty string')
    }
    if (json.length > P2P_MAX) {
      throw new Error(`packageJson: exceeds ${P2P_MAX} bytes (got ${json.length})`)
    }
    return ipcRenderer.invoke('handshake:sendBeapViaP2P', {
      handshakeId: id,
      packageJson: json,
      sendSource: 'user_package_builder',
    })
  },
  checkHandshakeSendReady: (handshakeId: unknown) => {
    return ipcRenderer.invoke('handshake:checkSendReady', { handshakeId: assertString(handshakeId, 'handshakeId') })
  },
  requestUnlockVault: () => {
    return ipcRenderer.invoke('vault:unlockForHandshake')
  },
  unlockVaultWithPassword: (password: unknown, vaultId?: unknown) => {
    const pwd = typeof password === 'string' ? password : ''
    const vid = typeof vaultId === 'string' ? vaultId : undefined
    return ipcRenderer.invoke('vault:unlockWithPassword', pwd, vid)
  },
  getVaultStatus: () => {
    return ipcRenderer.invoke('vault:getStatus')
  },
  listHsContextProfiles: (includeArchived?: boolean) => {
    return ipcRenderer.invoke('vault:listHsContextProfiles', includeArchived === true)
  },
  getDocumentPageCount: (documentId: unknown) => {
    return ipcRenderer.invoke('vault:getDocumentPageCount', assertString(documentId, 'documentId'))
  },
  getDocumentPage: (documentId: unknown, pageNumber: unknown) => {
    const docId = assertString(documentId, 'documentId')
    const pn = typeof pageNumber === 'number' && Number.isInteger(pageNumber) && pageNumber >= 1 ? pageNumber : 1
    return ipcRenderer.invoke('vault:getDocumentPage', docId, pn)
  },
  getDocumentPageList: (documentId: unknown) => {
    return ipcRenderer.invoke('vault:getDocumentPageList', assertString(documentId, 'documentId'))
  },
  getDocumentFullText: (documentId: unknown) => {
    return ipcRenderer.invoke('vault:getDocumentFullText', assertString(documentId, 'documentId'))
  },
  searchDocumentPages: (documentId: unknown, query: unknown) => {
    const q = typeof query === 'string' ? query : ''
    return ipcRenderer.invoke('vault:searchDocumentPages', assertString(documentId, 'documentId'), q)
  },
  updateHandshakePolicies: (handshakeId: unknown, policies: unknown) => {
    return ipcRenderer.invoke('handshake:updatePolicies', assertString(handshakeId, 'handshakeId'), policies)
  },
  updateContextItemGovernance: (
    handshakeId: unknown,
    blockId: unknown,
    blockHash: unknown,
    senderUserId: unknown,
    governance: unknown,
  ) => {
    return ipcRenderer.invoke(
      'handshake:updateContextItemGovernance',
      assertString(handshakeId, 'handshakeId'),
      assertString(blockId, 'blockId'),
      assertString(blockHash, 'blockHash'),
      assertString(senderUserId, 'senderUserId'),
      governance && typeof governance === 'object' ? governance as Record<string, unknown> : {},
    )
  },
  setBlockVisibility: (args: {
    sender_wrdesk_user_id: string
    block_id: string
    block_hash: string
    visibility: 'public' | 'private'
  }) => ipcRenderer.invoke('handshake:setBlockVisibility', args),
  setBulkBlockVisibility: (args: { handshake_id: string; visibility: 'public' | 'private' }) =>
    ipcRenderer.invoke('handshake:setBulkBlockVisibility', args),
  forceRevokeHandshake: (id: unknown) => {
    return ipcRenderer.invoke('handshake:forceRevoke', assertString(id, 'id'))
  },
  getContextBlockCount: (handshakeId: unknown) => {
    return ipcRenderer.invoke('handshake:contextBlockCount', assertString(handshakeId, 'handshakeId'))
  },
  queryContextBlocks: (handshakeId: unknown, purpose?: string) => {
    return ipcRenderer.invoke('handshake:queryContextBlocks', assertString(handshakeId, 'handshakeId'), purpose)
  },
  requestOriginalDocument: (documentId: unknown, acknowledgedWarning: boolean, handshakeId?: string | null) => {
    return ipcRenderer.invoke('handshake:requestOriginalDocument', assertString(documentId, 'documentId'), acknowledgedWarning, handshakeId ?? null)
  },
  requestLinkOpenApproval: (linkEntityId: unknown, acknowledgedWarning: boolean, handshakeId?: string | null) => {
    return ipcRenderer.invoke('handshake:requestLinkOpenApproval', assertString(linkEntityId, 'linkEntityId'), acknowledgedWarning, handshakeId ?? null)
  },
  semanticSearch: async (query: string, scope?: string, limit?: number) => {
    return ipcRenderer.invoke('handshake:semanticSearch', query, scope, limit)
  },
  getAvailableModels: () => ipcRenderer.invoke('handshake:getAvailableModels'),
  generateDraft: (prompt: string) => ipcRenderer.invoke('handshake:generateDraft', prompt),
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
  chatWithContextRag: (params: { query: string; scope?: string; model: string; provider: string; stream?: boolean; debug?: boolean; conversationContext?: { lastAnswer?: string }; selectedDocumentId?: string; selectedAttachmentId?: string }) => {
    if (!params || typeof params !== 'object' || typeof params.query !== 'string') {
      throw new Error('chatWithContextRag: expected { query, scope?, model, provider }')
    }
    return ipcRenderer.invoke('handshake:chatWithContextRag', {
      query: params.query,
      scope: typeof params.scope === 'string' ? params.scope : undefined,
      model: typeof params.model === 'string' ? params.model : 'llama3',
      provider: typeof params.provider === 'string' ? params.provider : 'ollama',
      stream: params.stream === true,
      debug: params.debug === true,
      conversationContext: params.conversationContext && typeof params.conversationContext === 'object'
        ? { lastAnswer: typeof params.conversationContext.lastAnswer === 'string' ? params.conversationContext.lastAnswer : undefined }
        : undefined,
      selectedDocumentId: typeof params.selectedDocumentId === 'string' && params.selectedDocumentId.trim() ? params.selectedDocumentId.trim() : undefined,
      selectedAttachmentId: typeof params.selectedAttachmentId === 'string' && params.selectedAttachmentId.trim() ? params.selectedAttachmentId.trim() : undefined,
    })
  },
  chatDirect: (params: { model: string; provider: string; systemPrompt: string; userPrompt: string; stream?: boolean }) => {
    if (!params || typeof params !== 'object' || typeof params.userPrompt !== 'string') {
      throw new Error('chatDirect: expected { model, provider, systemPrompt, userPrompt }')
    }
    return ipcRenderer.invoke('handshake:chatDirect', {
      model: typeof params.model === 'string' ? params.model : 'llama3',
      provider: typeof params.provider === 'string' ? params.provider : 'ollama',
      systemPrompt: typeof params.systemPrompt === 'string' ? params.systemPrompt : '',
      userPrompt: typeof params.userPrompt === 'string' ? params.userPrompt : '',
      stream: params.stream === true,
    })
  },
  onChatStreamStart: (callback: (data: { contextBlocks: string[]; sources: unknown[] }) => void) => {
    const handler = (_: unknown, data: unknown) => callback(data as { contextBlocks: string[]; sources: unknown[] })
    ipcRenderer.on('handshake:chatStreamStart', handler)
    return () => ipcRenderer.removeListener('handshake:chatStreamStart', handler)
  },
  onChatStreamToken: (callback: (data: { token: string }) => void) => {
    const handler = (_: unknown, data: unknown) => callback(data as { token: string })
    ipcRenderer.on('handshake:chatStreamToken', handler)
    return () => ipcRenderer.removeListener('handshake:chatStreamToken', handler)
  },
  initiateHandshake: (receiverEmail: unknown, fromAccountId: unknown, contextOpts?: unknown) => {
    const email = assertString(receiverEmail, 'receiverEmail')
    const acct = typeof fromAccountId === 'string' ? fromAccountId : ''
    const opts = contextOpts && typeof contextOpts === 'object' ? contextOpts as Record<string, unknown> : undefined
    const safeOpts = opts ? {
      ...(typeof opts.skipVaultContext === 'boolean' ? { skipVaultContext: opts.skipVaultContext } : {}),
      ...(typeof opts.message === 'string' && opts.message.trim() ? { message: opts.message.trim() } : {}),
      ...(Array.isArray(opts.context_blocks) ? { context_blocks: opts.context_blocks } : {}),
      ...(Array.isArray(opts.profile_ids) ? { profile_ids: opts.profile_ids } : {}),
      ...(Array.isArray(opts.profile_items) ? { profile_items: opts.profile_items } : {}),
      ...(opts.policy_selections && typeof opts.policy_selections === 'object' ? { policy_selections: opts.policy_selections } : {}),
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
      ...(Array.isArray(opts.profile_ids) ? { profile_ids: opts.profile_ids } : {}),
      ...(Array.isArray(opts.profile_items) ? { profile_items: opts.profile_items } : {}),
      ...(opts.policy_selections && typeof opts.policy_selections === 'object' ? { policy_selections: opts.policy_selections } : {}),
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
  /** Headers for authenticated POSTs to localhost PQ crypto routes (same secret as HTTP middleware). */
  pqHeaders: () =>
    ipcRenderer.invoke('crypto:getPqHeaders') as Promise<Record<string, string>>,
})

// ── BEAP capsule reply (optional IPC relay when package is pre-built in renderer) ──
contextBridge.exposeInMainWorld('beap', {
  sendCapsuleReply: (payload: unknown) => ipcRenderer.invoke('beap:sendCapsuleReply', payload),
  /**
   * PDF text extract in main process (same engine as POST /api/parser/pdf/extract).
   * Renderer cannot send X-Launch-Secret to localhost HTTP — use this IPC instead.
   */
  extractPdfText: (payload: { attachmentId: string; base64: string }) => {
    if (!payload || typeof payload !== 'object') throw new Error('extractPdfText: expected object')
    const id = typeof payload.attachmentId === 'string' ? payload.attachmentId : ''
    const b64 = typeof payload.base64 === 'string' ? payload.base64 : ''
    if (!id || id.length > 200) throw new Error('attachmentId: expected string 1–200 chars')
    if (!b64 || b64.length > 120 * 1024 * 1024) throw new Error('base64: expected string (max ~120MB)')
    return ipcRenderer.invoke('parser:extractPdfText', { attachmentId: id, base64: b64 }) as Promise<{
      success?: boolean
      extractedText?: string
      error?: string
    }>
  },
})

// ── Sent BEAP outbox (ledger DB; previews only) ────────────────────────────
contextBridge.exposeInMainWorld('outbox', {
  insertSent: (record: unknown) => ipcRenderer.invoke('outbox:insertSent', record),
  listSent: (opts?: unknown) => ipcRenderer.invoke('outbox:listSent', opts ?? {}),
})

// ── P2P Health & Queue ─────────────────────────────────────────────────────
contextBridge.exposeInMainWorld('p2p', {
  getHealth: () => ipcRenderer.invoke('p2p:getHealth'),
  getQueueStatus: (handshakeId: unknown) => {
    const id = typeof handshakeId === 'string' && handshakeId.length <= 128 ? handshakeId : ''
    return ipcRenderer.invoke('p2p:getQueueStatus', id)
  },
  flushOutboundQueue: () => ipcRenderer.invoke('p2p:flushOutboundQueue'),
})

// ── Auth Status (tier for relay gating) ─────────────────────────────────────
contextBridge.exposeInMainWorld('auth', {
  getStatus: () => ipcRenderer.invoke('auth:status'),
})

// ── Relay Setup Wizard ─────────────────────────────────────────────────────
function assertRelayUrl(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : ''
  if (s.length === 0 || s.length > 500) throw new Error('relay_url: expected non-empty string (max 500 chars)')
  return s
}
contextBridge.exposeInMainWorld('relay', {
  generateSecret: () => ipcRenderer.invoke('relay:generateSecret'),
  testConnection: (url: unknown) => ipcRenderer.invoke('relay:testConnection', assertRelayUrl(url)),
  verifyEndToEnd: (url: unknown, secret: unknown) => {
    const u = assertRelayUrl(url)
    const s = typeof secret === 'string' && secret.length > 0 ? secret : ''
    if (!s) throw new Error('secret: required for verifyEndToEnd')
    return ipcRenderer.invoke('relay:verifyEndToEnd', u, s)
  },
  activate: (config: unknown) => {
    const c = config && typeof config === 'object' && config !== null ? config as Record<string, unknown> : {}
    const url = typeof c.relay_url === 'string' ? c.relay_url.trim() : ''
    const pull = typeof c.relay_pull_url === 'string' ? c.relay_pull_url.trim() : undefined
    if (!url) throw new Error('relay_url: required for activate')
    return ipcRenderer.invoke('relay:activate', { relay_url: url, relay_pull_url: pull })
  },
  getSetupStatus: () => ipcRenderer.invoke('relay:getSetupStatus'),
  deactivate: () => ipcRenderer.invoke('relay:deactivate'),
  getSecret: () => ipcRenderer.invoke('relay:getSecret'),
  testTlsConnection: (url: unknown) => ipcRenderer.invoke('relay:testTlsConnection', assertRelayUrl(url)),
  acceptCertFingerprint: (fingerprint: unknown) => {
    const fp = typeof fingerprint === 'string' && fingerprint.trim().length > 0 ? fingerprint.trim() : ''
    if (!fp) throw new Error('fingerprint: required for acceptCertFingerprint')
    return ipcRenderer.invoke('relay:acceptCertFingerprint', fp)
  },
})

// ── Email (BEAP send) ─────────────────────────────────────────────────────
contextBridge.exposeInMainWorld('email', {
  sendBeapEmail: (contract: { to: string; subject: string; body: string; attachments: { name: string; data: string; mime: string }[] }) =>
    ipcRenderer.invoke('email:sendBeapEmail', contract),
})

// ── Email Accounts ─────────────────────────────────────────────────────────
contextBridge.exposeInMainWorld('emailAccounts', {
  listAccounts: () => ipcRenderer.invoke('email:listAccounts'),
  getAccount: (accountId: string) => ipcRenderer.invoke('email:getAccount', accountId),
  setProcessingPaused: (accountId: string, paused: boolean) =>
    ipcRenderer.invoke('email:setProcessingPaused', accountId, paused),
  testConnection: (accountId: string) => ipcRenderer.invoke('email:testConnection', accountId),
  getImapReconnectHints: (accountId: string) => ipcRenderer.invoke('email:getImapReconnectHints', accountId),
  updateImapCredentials: (
    accountId: string,
    creds: { imapPassword: string; smtpPassword?: string; smtpUseSameCredentials?: boolean },
  ) => ipcRenderer.invoke('email:updateImapCredentials', accountId, creds),
  sendEmail: (accountId: string, payload: { to: string[]; subject: string; bodyText: string; attachments?: { filename: string; mimeType: string; contentBase64: string }[] }) =>
    ipcRenderer.invoke('email:sendEmail', accountId, payload),
  deleteAccount: (accountId: string) => ipcRenderer.invoke('email:deleteAccount', accountId),
  connectGmail: (displayName?: string, syncWindowDays?: number, gmailOAuthCredentialSource?: 'builtin_public' | 'developer_saved') =>
    ipcRenderer.invoke('email:connectGmail', displayName, syncWindowDays, gmailOAuthCredentialSource),
  connectOutlook: (displayName?: string, syncWindowDays?: number) =>
    ipcRenderer.invoke('email:connectOutlook', displayName, syncWindowDays),
  connectZoho: (displayName?: string, syncWindowDays?: number) =>
    ipcRenderer.invoke('email:connectZoho', displayName, syncWindowDays),
  connectCustomMailbox: (payload: unknown) =>
    ipcRenderer.invoke('email:connectCustomMailbox', assertCustomMailboxPayload(payload)),
  resetSyncState: (accountId: string) => ipcRenderer.invoke('inbox:resetSyncState', accountId),
  /** Wipes all inbox + sync state for this account (messages, attachments, queue, sync row). Gateway credentials unchanged. */
  fullResetAccount: (accountId: string) => ipcRenderer.invoke('inbox:fullResetAccount', accountId),
  /** DevTools: dump sync/state-related table schemas + sample rows (see inbox:debugDumpSyncState). */
  debugDumpSyncState: () => ipcRenderer.invoke('inbox:debugDumpSyncState'),
  /** Dev only — raw node-imap session (IPC not registered in production main). */
  ...(import.meta.env.DEV
    ? {
        diagnoseImap: (params: unknown) =>
          ipcRenderer.invoke('email:diagnoseImap', assertDiagnoseImapParams(params)),
      }
    : {}),
  validateImapLifecycleRemote: (accountId: string) =>
    ipcRenderer.invoke('email:validateImapLifecycleRemote', accountId),
  setGmailCredentials: (clientId: string, clientSecret?: string, storeInVault?: boolean) =>
    ipcRenderer.invoke('email:setGmailCredentials', clientId, clientSecret, storeInVault ?? true),
  setOutlookCredentials: (clientId: string, clientSecret?: string, tenantId?: string, storeInVault?: boolean) =>
    ipcRenderer.invoke('email:setOutlookCredentials', clientId, clientSecret, tenantId, storeInVault ?? true),
  setZohoCredentials: (
    clientId: string,
    clientSecret: string,
    datacenter?: 'com' | 'eu',
    storeInVault?: boolean,
  ) =>
    ipcRenderer.invoke(
      'email:setZohoCredentials',
      clientId,
      clientSecret,
      datacenter ?? 'com',
      storeInVault ?? true,
    ),
  checkGmailCredentials: () => ipcRenderer.invoke('email:checkGmailCredentials'),
  /** Packaged Gmail OAuth runtime proof (fingerprints only — see main process gmail_standard_connect_flow_proof logs). */
  getGmailOAuthRuntimeDiagnostics: () => ipcRenderer.invoke('email:getGmailOAuthRuntimeDiagnostics'),
  checkOutlookCredentials: () => ipcRenderer.invoke('email:checkOutlookCredentials'),
  checkZohoCredentials: () => ipcRenderer.invoke('email:checkZohoCredentials'),
  checkVaultStatus: () => ipcRenderer.invoke('vault:getStatus'),
  onAccountConnected: (cb: (data: { provider: string; email: string; accountId?: string }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, data: { provider: string; email: string; accountId?: string }) =>
      cb(data)
    ipcRenderer.on('email:accountConnected', handler)
    return () => { ipcRenderer.removeListener('email:accountConnected', handler) }
  },
  onCredentialError: (cb: (data: { accountId: string; provider: string; message: string }) => void) => {
    const handler = (
      _e: Electron.IpcRendererEvent,
      data: { accountId: string; provider: string; message: string },
    ) => cb(data)
    ipcRenderer.on('email:credentialError', handler)
    return () => {
      ipcRenderer.removeListener('email:credentialError', handler)
    }
  },
})

// ── Email Inbox ───────────────────────────────────────────────────────────
contextBridge.exposeInMainWorld('emailInbox', {
  /** DevTools: `window.emailInbox.debugQueueStatus().then(console.log)` */
  debugQueueStatus: () => ipcRenderer.invoke('debug:queueStatus'),
  /** Debug: main-inbox rows + why they may still be in server Inbox (optional accountId). */
  debugMainInboxRows: (accountId?: string | null) =>
    ipcRenderer.invoke('inbox:debugMainInboxRows', accountId ?? null),
  /** IMAP: server folder LIST + STATUS counts + lifecycle exact-match (read-only). */
  verifyImapRemoteFolders: (accountId: string) => ipcRenderer.invoke('inbox:verifyImapRemoteFolders', accountId),
  /** Debug: gateway account ids vs orphan inbox_messages.account_id (reconnect mismatch). */
  debugAccountMigrationStatus: () => ipcRenderer.invoke('inbox:debugAccountMigrationStatus'),
  /** Repoint inbox_messages from stale account_id to a connected id; deletes queue rows for old id only. */
  migrateInboxAccountId: (fromAccountId: string, toAccountId: string) =>
    ipcRenderer.invoke('inbox:migrateInboxAccountId', fromAccountId, toAccountId),
  syncAccount: (accountId: string) => ipcRenderer.invoke('inbox:syncAccount', accountId),
  pullMoreAccount: (accountId: string) => ipcRenderer.invoke('inbox:pullMore', accountId),
  patchAccountSyncPreferences: (accountId: string, partial: { syncWindowDays?: number; maxMessagesPerPull?: number }) =>
    ipcRenderer.invoke('inbox:patchAccountSyncPreferences', accountId, partial),
  toggleAutoSync: (accountId: string, enabled: boolean) => ipcRenderer.invoke('inbox:toggleAutoSync', accountId, enabled),
  getSyncState: (accountId: string) => ipcRenderer.invoke('inbox:getSyncState', accountId),
  fullResetAccount: (accountId: string) => ipcRenderer.invoke('inbox:fullResetAccount', accountId),
  onNewMessages: (handler: (data: unknown) => void) => {
    const fn = (_e: Electron.IpcRendererEvent, data: unknown) => handler(data)
    ipcRenderer.on('inbox:newMessages', fn)
    return () => { ipcRenderer.removeListener('inbox:newMessages', fn) }
  },
  /** P2P BEAP rows imported into inbox_messages (main → renderer refresh). */
  onBeapInboxUpdated: (handler: (data: { handshakeId: string | null }) => void) => {
    const fn = (_e: Electron.IpcRendererEvent, data: { handshakeId: string | null }) => handler(data)
    ipcRenderer.on('inbox:beapInboxUpdated', fn)
    return () => {
      ipcRenderer.removeListener('inbox:beapInboxUpdated', fn)
    }
  },
  /** Remote orchestrator drain batch progress (main → renderer debug activity log). */
  onDrainProgress: (handler: (data: unknown) => void) => {
    const fn = (_e: Electron.IpcRendererEvent, data: unknown) => handler(data)
    ipcRenderer.on('inbox:drainProgress', fn)
    return () => {
      ipcRenderer.removeListener('inbox:drainProgress', fn)
    }
  },
  /** Per-row simple drain outcome (moved vs idempotent skip) — optional UI diagnostics. */
  onSimpleDrainRow: (handler: (data: unknown) => void) => {
    const fn = (_e: Electron.IpcRendererEvent, data: unknown) => handler(data)
    ipcRenderer.on('inbox:simpleDrainRow', fn)
    return () => {
      ipcRenderer.removeListener('inbox:simpleDrainRow', fn)
    }
  },
  listMessages: (options?: {
    filter?: string
    sourceType?: string
    messageKind?: 'handshake' | 'depackaged'
    handshakeId?: string
    category?: string
    limit?: number
    offset?: number
    search?: string
  }) => ipcRenderer.invoke('inbox:listMessages', options),
  /** Read-only dashboard aggregate (inbox tab counts, message-kind totals, latest autosort + urgent rows). */
  dashboardSnapshot: (options?: { urgentMessageLimit?: number }) =>
    ipcRenderer.invoke('inbox:dashboardSnapshot', options ?? {}),
  listMessageIds: (options?: {
    filter?: string
    sourceType?: string
    messageKind?: 'handshake' | 'depackaged'
    handshakeId?: string
    category?: string
    limit?: number
    offset?: number
    search?: string
  }) => ipcRenderer.invoke('inbox:listMessageIds', options),
  getMessage: (messageId: string) => ipcRenderer.invoke('inbox:getMessage', messageId),
  markRead: (ids: string[], read: boolean) => ipcRenderer.invoke('inbox:markRead', ids, read),
  toggleStar: (id: string) => ipcRenderer.invoke('inbox:toggleStar', id),
  archiveMessages: (ids: string[]) => ipcRenderer.invoke('inbox:archiveMessages', ids),
  setCategory: (ids: string[], category: string) => ipcRenderer.invoke('inbox:setCategory', ids, category),
  deleteMessages: (ids: string[], gracePeriodHours?: number) => ipcRenderer.invoke('inbox:deleteMessages', ids, gracePeriodHours),
  /** Dev: remove all native BEAP (`direct_beap`) rows from local DB. */
  deleteAllDirectBeap: () => ipcRenderer.invoke('inbox:deleteAllDirectBeap'),
  cancelDeletion: (id: string) => ipcRenderer.invoke('inbox:cancelDeletion', id),
  getDeletedMessages: () => ipcRenderer.invoke('inbox:getDeletedMessages'),
  getAttachment: (id: string) => ipcRenderer.invoke('inbox:getAttachment', id),
  getAttachmentText: (id: string) => ipcRenderer.invoke('inbox:getAttachmentText', id),
  openAttachmentOriginal: (id: string) => ipcRenderer.invoke('inbox:openAttachmentOriginal', id),
  aiSummarize: (id: string) => ipcRenderer.invoke('inbox:aiSummarize', id),
  aiDraftReply: (id: string) => ipcRenderer.invoke('inbox:aiDraftReply', id),
  aiAnalyzeMessage: (id: string) => ipcRenderer.invoke('inbox:aiAnalyzeMessage', id),
  aiAnalyzeMessageStream: (messageId: string) => ipcRenderer.invoke('inbox:aiAnalyzeMessageStream', messageId),
  onAiAnalyzeChunk: (cb: (data: { messageId: string; chunk: string }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, data: { messageId: string; chunk: string }) => cb(data)
    ipcRenderer.on('inbox:aiAnalyzeMessageChunk', handler)
    return () => ipcRenderer.removeListener('inbox:aiAnalyzeMessageChunk', handler)
  },
  onAiAnalyzeDone: (cb: (data: { messageId: string }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, data: { messageId: string }) => cb(data)
    ipcRenderer.on('inbox:aiAnalyzeMessageDone', handler)
    return () => ipcRenderer.removeListener('inbox:aiAnalyzeMessageDone', handler)
  },
  onAiAnalyzeError: (cb: (data: { messageId: string; error: string; message: string }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, data: { messageId: string; error: string; message: string }) => cb(data)
    ipcRenderer.on('inbox:aiAnalyzeMessageError', handler)
    return () => ipcRenderer.removeListener('inbox:aiAnalyzeMessageError', handler)
  },
  aiCategorize: (ids: string[]) => ipcRenderer.invoke('inbox:aiCategorize', ids),
  aiClassifySingle: (messageId: string, sessionId?: string) =>
    ipcRenderer.invoke('inbox:aiClassifySingle', messageId, sessionId),
  /**
   * Batch classify: one IPC call for a chunk of message IDs.
   * The renderer controls chunk size (`sortConcurrency`); optional `ollamaMaxConcurrent` caps in-flight
   * local Ollama classifies per chunk (env `WRDESK_OLLAMA_CLASSIFY_MAX_CONCURRENT` overrides when set).
   */
  aiClassifyBatch: (
    ids: string[],
    sessionId?: string,
    runId?: string,
    chunkIndex?: number,
    ollamaMaxConcurrent?: number,
  ) => ipcRenderer.invoke('inbox:aiClassifyBatch', ids, sessionId, runId, chunkIndex, ollamaMaxConcurrent),
  /** Dev-only correlation: sync bulk Auto-Sort run id to main for lockVault / stream diagnostics. */
  autosortDiagSync: (payload: { runId: string | null; bulkSortActive: boolean }) =>
    ipcRenderer.invoke('inbox:autosortDiagSync', payload),
  enqueueRemoteLifecycleMirror: (messageIds: string[]) =>
    ipcRenderer.invoke('inbox:enqueueRemoteLifecycleMirror', messageIds),
  /** After Auto-Sort batch: enqueue remote moves from local lifecycle state + chained background drain. */
  enqueueRemoteSync: (messageIds: string[]) => ipcRenderer.invoke('inbox:enqueueRemoteSync', messageIds),
  fullRemoteSync: (accountId: string) => ipcRenderer.invoke('inbox:fullRemoteSync', accountId),
  fullRemoteSyncForMessages: (messageIds: string[]) =>
    ipcRenderer.invoke('inbox:fullRemoteSyncForMessages', messageIds),
  /** Enqueue full lifecycle reconcile for every connected account + background drain (debug / force sync). */
  fullRemoteSyncAllAccounts: () => ipcRenderer.invoke('inbox:fullRemoteSyncAllAccounts'),
  /** Dev: enqueue + synchronously drain batches for one message (in-app remote pipeline test). */
  debugTestMoveOne: (messageId: string) => ipcRenderer.invoke('inbox:debugTestMoveOne', messageId),
  /** Reset every `failed` row in `remote_orchestrator_mutation_queue` to `pending` and schedule drain. */
  retryFailedRemoteOps: (accountId?: string) => ipcRenderer.invoke('inbox:retryFailedRemoteOps', accountId),
  /** Delete `failed` rows for one `account_id` (orphan queue after disconnect / reconnect). */
  clearFailedRemoteOps: (accountId: string) => ipcRenderer.invoke('inbox:clearFailedRemoteOps', accountId),
  persistManualBulkAnalysis: (messageId: string, analysisJson: string) =>
    ipcRenderer.invoke('inbox:persistManualBulkAnalysis', messageId, analysisJson),
  markPendingDelete: (ids: string[]) => ipcRenderer.invoke('inbox:markPendingDelete', ids),
  moveToPendingReview: (ids: string[]) => ipcRenderer.invoke('inbox:moveToPendingReview', ids),
  cancelPendingDelete: (messageId: string) => ipcRenderer.invoke('inbox:cancelPendingDelete', messageId),
  cancelPendingReview: (messageId: string) => ipcRenderer.invoke('inbox:cancelPendingReview', messageId),
  unarchive: (messageId: string) => ipcRenderer.invoke('inbox:unarchive', messageId),
  getInboxSettings: () => ipcRenderer.invoke('inbox:getInboxSettings'),
  setInboxSettings: (partial: { tone?: string; sortRules?: string; batchSize?: number }) => ipcRenderer.invoke('inbox:setInboxSettings', partial),
  selectAndUploadContextDoc: () => ipcRenderer.invoke('inbox:selectAndUploadContextDoc'),
  deleteContextDoc: (docId: string) => ipcRenderer.invoke('inbox:deleteContextDoc', docId),
  listContextDocs: () => ipcRenderer.invoke('inbox:listContextDocs'),
  getAiRules: () => ipcRenderer.invoke('inbox:getAiRules'),
  saveAiRules: (content: string) => ipcRenderer.invoke('inbox:saveAiRules', content),
  getAiRulesDefault: () => ipcRenderer.invoke('inbox:getAiRulesDefault'),
  showOpenDialogForAttachments: () => ipcRenderer.invoke('inbox:showOpenDialogForAttachments'),
  readFileForAttachment: (filePath: string) => ipcRenderer.invoke('inbox:readFileForAttachment', filePath),
  reconcileImapRemoteLifecycle: (accountId: string) =>
    ipcRenderer.invoke('inbox:reconcileImapRemoteLifecycle', accountId),
})

contextBridge.exposeInMainWorld('autosortSession', {
  create: () => ipcRenderer.invoke('autosort:createSession'),
  finalize: (id: string, stats: any) => ipcRenderer.invoke('autosort:finalizeSession', id, stats),
  generateSummary: (id: string) => ipcRenderer.invoke('autosort:generateSummary', id),
  getSession: (id: string) => ipcRenderer.invoke('autosort:getSession', id),
  listSessions: (limit?: number) => ipcRenderer.invoke('autosort:listSessions', limit),
  deleteSession: (id: string) => ipcRenderer.invoke('autosort:deleteSession', id),
  getSessionMessages: (id: string) => ipcRenderer.invoke('autosort:getSessionMessages', id),
})

// ── Build Integrity (offline verification) ────────────────────────────────
contextBridge.exposeInMainWorld('integrity', {
  getStatus: () => ipcRenderer.invoke('integrity:status'),
})

// ── Local LLM (Ollama) — status + active model (shared with Backend Configuration persistence) ──
contextBridge.exposeInMainWorld('llm', {
  getStatus: () => ipcRenderer.invoke('llm:getStatus'),
  setActiveModel: (modelId: string) => {
    assertString(modelId, 'modelId')
    return ipcRenderer.invoke('llm:setActiveModel', modelId)
  },
  onActiveModelChanged: (handler: (data: { modelId: string }) => void) => {
    const fn = (_e: Electron.IpcRendererEvent, data: unknown) => {
      if (!data || typeof data !== 'object') return
      const m = (data as Record<string, unknown>).modelId
      if (typeof m === 'string' && m.length > 0) handler({ modelId: m })
    }
    ipcRenderer.on('llm:activeModelChanged', fn)
    return () => {
      ipcRenderer.removeListener('llm:activeModelChanged', fn)
    }
  },
  resolveAutosortRuntime: () => ipcRenderer.invoke('llm:resolveAutosortRuntime'),
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

// === TEMPORARY DEBUG LOG BRIDGE (remove before production) ===
contextBridge.exposeInMainWorld('debugLogs', {
  onLog: (callback: (entry: { ts: string; level: string; line: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, entry: unknown) => {
      if (!entry || typeof entry !== 'object') return
      const o = entry as Record<string, unknown>
      if (typeof o.ts === 'string' && typeof o.level === 'string' && typeof o.line === 'string') {
        callback({ ts: o.ts, level: o.level, line: o.line })
      }
    }
    ipcRenderer.on('main-process-log', handler)
    return () => {
      ipcRenderer.removeListener('main-process-log', handler)
    }
  },
  removeLogListener: () => {
    ipcRenderer.removeAllListeners('main-process-log')
  },
})
// === END TEMPORARY DEBUG LOG BRIDGE ===

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
