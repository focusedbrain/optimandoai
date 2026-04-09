import { wrChatDashboardWarn } from '../lib/wrChatDashboardLog'

/**
 * Minimal chrome.* shim for running `PopupChatView` + `processFlow` inside the Electron
 * dashboard renderer. Extension pages keep the real MV3 `chrome` global — we only install when
 * `chrome.runtime.id` is absent (Electron).
 *
 * Bridges:
 * - GET_LAUNCH_SECRET / HTTP headers → `window.handshakeView.pqHeaders()` (same X-Launch-Secret as localhost middleware)
 * - BEAP_ENSURE_LAUNCH_SECRET / BEAP_GET_PQ_HEADERS → warm `pqHeaders`; BEAP flows expect `{ ok }` / `{ headers }` like extension background
 * - VAULT_RPC → `window.handshakeView.vaultRpc` → `dashboard:vaultRpc` IPC (same dispatch as WebSocket VAULT_RPC)
 * - GET_ALL_SESSIONS_FROM_SQLITE / GET_SESSION_FROM_SQLITE / UPDATE_BOX_OUTPUT_SQLITE → same HTTP as extension background
 * - GET_STATUS → dashboard is always backed by a running app
 * - chrome.storage.local → localStorage for keys WR Chat reads/writes
 * - chrome.tabs.query → empty synthetic tab (dashboard has no real website URL context)
 * - ELECTRON_EXECUTE_TRIGGER → no-op (extension background would handle automation)
 */

const BASE_URL = 'http://127.0.0.1:51248'

let installed = false

/**
 * Same payload as `background.ts` `UPDATE_BOX_OUTPUT_SQLITE` success branch (broadcast `data` object).
 * See extension `background.ts` ~4336–4354.
 */
function buildUpdateAgentBoxOutputRelayData(
  session: {
    agentBoxes: Array<{ id?: string; identifier?: string; output?: string; lastUpdated?: string }>
  },
  msgAgentBoxId: string,
  output: string,
): {
  agentBoxId: string
  agentBoxUuid: string
  output: string
  allBoxes: typeof session.agentBoxes
  sourceSurface: 'dashboard'
} {
  const updatedBox = session.agentBoxes.find(
    (b) => b.id === msgAgentBoxId || b.identifier === msgAgentBoxId,
  )
  const canonicalId = updatedBox?.identifier || updatedBox?.id || msgAgentBoxId
  return {
    agentBoxId: canonicalId,
    agentBoxUuid: msgAgentBoxId,
    output,
    allBoxes: session.agentBoxes,
    sourceSurface: 'dashboard',
  }
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  try {
    const fn = window.handshakeView?.pqHeaders
    if (typeof fn !== 'function') {
      wrChatDashboardWarn('handshakeView.pqHeaders missing — localhost API calls may fail (sign in / handshake bridge)')
      return { 'Content-Type': 'application/json' }
    }
    const h = await fn()
    const out: Record<string, string> = { 'Content-Type': 'application/json' }
    if (h && typeof h === 'object') {
      for (const [k, v] of Object.entries(h)) {
        if (typeof v === 'string') out[k] = v
      }
    }
    if (!out['X-Launch-Secret']?.trim()) {
      wrChatDashboardWarn('X-Launch-Secret not in pqHeaders — orchestrator/LLM HTTP may return 401')
    }
    return out
  } catch (e) {
    wrChatDashboardWarn('getAuthHeaders failed:', e instanceof Error ? e.message : e)
    return { 'Content-Type': 'application/json' }
  }
}

function readStorageKey(key: string): unknown {
  if (key === 'optimando-active-session-key') {
    return (
      localStorage.getItem('optimando-active-session-key') ??
      localStorage.getItem('optimando-global-active-session')
    )
  }
  if (key === 'optimando-tagged-triggers') {
    try {
      const raw = localStorage.getItem('optimando-tagged-triggers')
      const parsed = raw ? JSON.parse(raw) : []
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  if (key === 'optimando-cloud-api-keys') {
    try {
      const raw = localStorage.getItem('optimando-cloud-api-keys')
      return raw ? JSON.parse(raw) : {}
    } catch {
      return {}
    }
  }
  const raw = localStorage.getItem(key)
  if (raw == null) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

/** Same fallback as extension `background.ts` when SQLite returns no rows: `session_*` mirrors in storage. */
function readSessionMirrorsFromLocalStorage(): Record<string, unknown> {
  const chromeSessions: Record<string, unknown> = {}
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k || !k.startsWith('session_')) continue
      const raw = localStorage.getItem(k)
      if (!raw) continue
      try {
        chromeSessions[k] = JSON.parse(raw)
      } catch {
        chromeSessions[k] = raw
      }
    }
  } catch {
    /* noop */
  }
  return chromeSessions
}

function writeStorageItems(items: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(items)) {
    if (v === undefined || v === null) {
      localStorage.removeItem(k)
      continue
    }
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      localStorage.setItem(k, String(v))
    } else {
      localStorage.setItem(k, JSON.stringify(v))
    }
    if (k === 'optimando-tagged-triggers') {
      void (async () => {
        const headers = await getAuthHeaders()
        const triggers = Array.isArray(v) ? v : []
        const body = JSON.stringify({ triggers })

        const attemptPost = async (): Promise<boolean> => {
          try {
            const r = await fetch(`${BASE_URL}/api/wrchat/tagged-triggers`, {
              method: 'POST',
              headers,
              body,
            })
            return r.ok
          } catch {
            return false
          }
        }

        let ok = await attemptPost()
        if (!ok) {
          // Retry once after 2 s.
          await new Promise(res => setTimeout(res, 2000))
          ok = await attemptPost()
          if (!ok) {
            console.warn('[wrChatDashboardChrome] POST /api/wrchat/tagged-triggers failed after retry — host file may be stale')
          }
        }
        if (ok) {
          // Notify other open surfaces that the host copy was refreshed.
          try { window.dispatchEvent(new CustomEvent('optimando-triggers-synced-to-host')) } catch { /* noop */ }
        }
      })()
    }
  }
}

let lastError: chrome.runtime.LastError | undefined

function clearLastError(): void {
  lastError = undefined
}

function setLastError(message: string): void {
  lastError = { message }
}

export function ensureWrdeskChromeShim(): void {
  if (installed) return
  const w = globalThis as unknown as { chrome?: typeof chrome }
  if (w.chrome?.runtime?.id) return

  installed = true

  const storageLocal = {
    get(keys: string | string[] | Record<string, unknown> | null, cb?: (data: Record<string, unknown>) => void) {
      const keyList: string[] = !keys
        ? []
        : typeof keys === 'string'
          ? [keys]
          : Array.isArray(keys)
            ? keys
            : Object.keys(keys)
      const data: Record<string, unknown> = {}
      for (const k of keyList) {
        const v = readStorageKey(k)
        if (v !== undefined) data[k] = v
      }
      const run = () => {
        try {
          cb?.(data)
        } catch {
          /* noop */
        }
      }
      if (typeof queueMicrotask === 'function') queueMicrotask(run)
      else Promise.resolve().then(run)
    },
    set(items: Record<string, unknown>, cb?: () => void) {
      writeStorageItems(items)
      try {
        window.dispatchEvent(new CustomEvent('optimando-triggers-updated'))
      } catch {
        /* noop */
      }
      const run = () => {
        try {
          cb?.()
        } catch {
          /* noop */
        }
      }
      if (typeof queueMicrotask === 'function') queueMicrotask(run)
      else Promise.resolve().then(run)
    },
  }

  const tabs = {
    query(
      _queryInfo: chrome.tabs.QueryInfo,
      callback?: (result: chrome.tabs.Tab[]) => void,
    ): Promise<chrome.tabs.Tab[]> {
      const result: chrome.tabs.Tab[] = [
        {
          url: '',
          active: true,
        } as chrome.tabs.Tab,
      ]
      const p = Promise.resolve(result)
      if (callback) void p.then(callback)
      return p
    },
  }

  const runtime = {
    get id(): undefined {
      return undefined
    },
    get lastError(): chrome.runtime.LastError | undefined {
      return lastError
    },
    sendMessage(message: unknown, responseCallback?: (response: unknown) => void): void {
      clearLastError()
      const msg = message && typeof message === 'object' ? (message as { type?: string }) : {}
      const t = msg.type

      const finish = (response: unknown, err?: string) => {
        if (err) setLastError(err)
        else clearLastError()
        try {
          responseCallback?.(response)
        } catch {
          /* noop */
        }
      }

      if (t === 'GET_LAUNCH_SECRET') {
        void (async () => {
          try {
            const h = await getAuthHeaders()
            const secret = h['X-Launch-Secret'] ?? null
            finish({ secret })
          } catch (e) {
            finish({ secret: null }, e instanceof Error ? e.message : 'GET_LAUNCH_SECRET failed')
          }
        })()
        return
      }

      if (t === 'GET_STATUS') {
        finish({ success: true, data: { isConnected: true, readyState: 1 } })
        return
      }

      if (t === 'GET_ALL_SESSIONS_FROM_SQLITE') {
        const chromeStorageFallback = () => {
          const sessions = readSessionMirrorsFromLocalStorage()
          finish({ success: true, sessions })
        }
        void (async () => {
          try {
            const headers = await getAuthHeaders()
            const r = await fetch(`${BASE_URL}/api/orchestrator/get-all`, { headers })
            if (!r.ok) throw new Error(`HTTP ${r.status}`)
            const result = (await r.json()) as { data?: Record<string, unknown> }
            const allData = result.data || {}
            const sessionsMap: Record<string, unknown> = {}
            Object.entries(allData).forEach(([k, v]) => {
              if ((k.startsWith('session_') || k.startsWith('archive_session_')) && v) sessionsMap[k] = v
            })
            if (Object.keys(sessionsMap).length > 0) {
              finish({ success: true, sessions: sessionsMap })
            } else {
              chromeStorageFallback()
            }
          } catch {
            chromeStorageFallback()
          }
        })()
        return
      }

      if (t === 'GET_SESSION_FROM_SQLITE') {
        const sessionKey = (msg as { sessionKey?: string }).sessionKey
        if (!sessionKey) {
          finish({ success: false, error: 'No session key' })
          return
        }
        void (async () => {
          try {
            const headers = await getAuthHeaders()
            const r = await fetch(
              `${BASE_URL}/api/orchestrator/get?key=${encodeURIComponent(sessionKey)}`,
              { headers },
            )
            if (!r.ok) throw new Error(`HTTP ${r.status}`)
            const result = (await r.json()) as { success?: boolean; data?: unknown }
            const session = result.data ?? null
            finish({ success: true, session })
          } catch {
            storageLocal.get([sessionKey], (data) => {
              const session = data[sessionKey] ?? null
              finish({ success: !!session, session })
            })
          }
        })()
        return
      }

      if (t === 'UPDATE_BOX_OUTPUT_SQLITE') {
        const m = msg as { sessionKey?: string; agentBoxId?: string; output?: string; sourceSurface?: string }
        if (!m.sessionKey || !m.agentBoxId || m.output === undefined) {
          finish({ success: false, error: 'Missing required data' })
          return
        }
        void (async () => {
          try {
            const headers = await getAuthHeaders()
            const gr = await fetch(
              `${BASE_URL}/api/orchestrator/get?key=${encodeURIComponent(m.sessionKey!)}`,
              { headers },
            )
            if (!gr.ok) throw new Error(`GET HTTP ${gr.status}`)
            const gj = (await gr.json()) as { data?: { agentBoxes?: unknown[] } }
            const session = (gj.data || {}) as {
              agentBoxes?: Array<{ id?: string; identifier?: string; output?: string; lastUpdated?: string }>
            }
            if (!session.agentBoxes || !Array.isArray(session.agentBoxes)) {
              throw new Error('No agentBoxes array in session')
            }
            const boxIndex = session.agentBoxes.findIndex(
              (b) => b.id === m.agentBoxId || b.identifier === m.agentBoxId,
            )
            if (boxIndex === -1) throw new Error('Box not found: ' + m.agentBoxId)
            session.agentBoxes[boxIndex].output = m.output
            session.agentBoxes[boxIndex].lastUpdated = new Date().toISOString()
            const relayPreview = buildUpdateAgentBoxOutputRelayData(session, m.agentBoxId, m.output)
            console.log('[AgentBoxFix] shim:before-sqlite-write', {
              sessionKey: m.sessionKey,
              agentBoxId: m.agentBoxId,
              canonicalId: relayPreview.agentBoxId,
              agentBoxUuid: relayPreview.agentBoxUuid,
              outputLen: m.output.length,
              allBoxesLen: session.agentBoxes.length,
            })
            const sr = await fetch(`${BASE_URL}/api/orchestrator/set`, {
              method: 'POST',
              headers,
              body: JSON.stringify({ key: m.sessionKey, value: session }),
            })
            if (!sr.ok) throw new Error(`Save HTTP ${sr.status}`)
            console.log('[AgentBoxFix] shim:after-sqlite-write', { ok: sr.ok, status: sr.status })

            try {
              const relay = relayPreview
              console.log('[AgentBoxFix] shim:before-relay', {
                sessionKey: m.sessionKey,
                agentBoxId: m.agentBoxId,
                canonicalId: relay.agentBoxId,
                agentBoxUuid: relay.agentBoxUuid,
                outputLen: relay.output.length,
                allBoxesLen: relay.allBoxes.length,
              })
              const dash = (globalThis as unknown as { analysisDashboard?: { relayAgentBoxOutputLive?: (p: unknown) => void } })
                .analysisDashboard
              dash?.relayAgentBoxOutputLive?.(relay)
            } catch {
              /* non-fatal: persistence already succeeded */
            }

            finish({ success: true })
          } catch (e) {
            finish(
              { success: false, error: e instanceof Error ? e.message : String(e) },
              e instanceof Error ? e.message : String(e),
            )
          }
        })()
        return
      }

      if (t === 'ELECTRON_EXECUTE_TRIGGER') {
        finish({ ok: true })
        return
      }

      // BEAP / qBEAP: extension background ensures WS + X-Launch-Secret before PQ HTTP to Electron.
      // Dashboard talks to main via preload; warm auth headers and report success so crypto can proceed.
      if (t === 'BEAP_ENSURE_LAUNCH_SECRET') {
        void (async () => {
          try {
            await getAuthHeaders()
          } catch {
            /* non-fatal */
          }
          finish({ ok: true })
        })()
        return
      }

      // Same contract as extension `background.ts` BEAP_GET_PQ_HEADERS (used by initBeapPqAuth).
      if (t === 'BEAP_GET_PQ_HEADERS') {
        void (async () => {
          try {
            const h = await getAuthHeaders()
            const headers: Record<string, string> = {}
            const secret = h['X-Launch-Secret']
            if (typeof secret === 'string' && secret.trim()) headers['X-Launch-Secret'] = secret
            finish({ headers })
          } catch {
            finish({ headers: {} })
          }
        })()
        return
      }

      // Extension `sendHandshakeRpc` → VAULT_RPC → background → WebSocket → main. Dashboard uses the same
      // method/params wire format; forward everything through `handshakeView.vaultRpc` (dashboard:vaultRpc IPC).
      if (t === 'VAULT_RPC') {
        const m = msg as { id?: string; method?: string; params?: Record<string, unknown> }
        const method = typeof m.method === 'string' ? m.method : ''
        const params = m.params && typeof m.params === 'object' ? m.params : {}
        void (async () => {
          try {
            const fn = window.handshakeView?.vaultRpc
            if (typeof fn !== 'function') {
              finish({ success: false, error: 'handshakeView.vaultRpc unavailable (preload bridge missing)' })
              return
            }
            const res = await fn({ method, params, id: m.id })
            finish(res)
          } catch (e) {
            const msgErr = e instanceof Error ? e.message : String(e)
            finish({ success: false, error: msgErr }, msgErr)
          }
        })()
        return
      }

      if (t === 'UPDATE_AGENT_BOX_OUTPUT') {
        finish(undefined)
        return
      }

      if (t === 'ACTIVATE_SESSION_FOR_OPTIMIZATION') {
        const raw = msg as { project?: { id?: string; linkedSessionIds?: unknown } }
        const p = raw.project
        const id = typeof p?.id === 'string' ? p.id : ''
        const linked = Array.isArray(p?.linkedSessionIds)
          ? (p!.linkedSessionIds as unknown[]).filter((x): x is string => typeof x === 'string')
          : []
        if (!id.trim() || linked.length === 0) {
          finish({ success: false, error: 'Invalid project payload' })
          return
        }
        console.log(`[AutoOpt] Shim: activating session for project=${id}, linkedSessions=${JSON.stringify(linked)}`)
        try {
          for (const sessionKey of linked) {
            const k = sessionKey.trim()
            if (!k) continue
            localStorage.setItem('optimando-active-session-key', k)
            localStorage.setItem('optimando-global-active-session', k)
          }
        } catch (e) {
          const msgErr = e instanceof Error ? e.message : String(e)
          finish({ success: false, error: msgErr }, msgErr)
          return
        }
        const activationResult = { ok: true, tabId: null, gridId: null }
        console.log('[AutoOpt] Shim: activation result', activationResult)
        finish({
          success: true,
          result: activationResult,
        })
        return
      }

      if (responseCallback) {
        wrChatDashboardWarn('chrome shim: unhandled runtime.sendMessage type', t)
        finish(undefined)
      }
    },
  }

  w.chrome = {
    ...w.chrome,
    runtime: runtime as unknown as typeof chrome.runtime,
    storage: { local: storageLocal } as unknown as typeof chrome.storage,
    tabs: tabs as unknown as typeof chrome.tabs,
  } as typeof chrome
}
