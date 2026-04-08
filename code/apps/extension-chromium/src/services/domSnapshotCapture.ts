/**
 * DOM snapshot capture for grid-display-v2 (and compatible grid pages).
 * Runs in the grid tab content-script context; responds to CAPTURE_DOM_SNAPSHOT.
 */

import type { DomSlotCapture, DomSnapshot } from '../types/optimizationTypes'
import { CAPTURE_DOM_SNAPSHOT_MESSAGE_TYPE } from './domSnapshotMessageTypes'

const PER_SLOT_MAX_BYTES = 32 * 1024
const TOTAL_PAYLOAD_MAX_BYTES = 256 * 1024

const LISTENER_FLAG = '__wrDomSnapshotCaptureListenerRegistered'

function utf8ByteLength(s: string): number {
  return new TextEncoder().encode(s).length
}

function truncateUtf8Bytes(str: string, maxBytes: number): { text: string; truncated: boolean } {
  const enc = new TextEncoder()
  if (enc.encode(str).length <= maxBytes) return { text: str, truncated: false }
  let lo = 0
  let hi = str.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    const slice = str.slice(0, mid)
    if (enc.encode(slice).length <= maxBytes) lo = mid
    else hi = mid - 1
  }
  const cut = str.slice(0, lo)
  const suffix = ' [… truncated]'
  const text = cut + suffix
  if (utf8ByteLength(text) > maxBytes) {
    return truncateUtf8Bytes(cut, Math.max(0, maxBytes - utf8ByteLength(suffix)))
  }
  return { text, truncated: true }
}

function redactSensitive(raw: string): string {
  let out = raw.replace(/Bearer\s+[A-Za-z0-9._\-=]+/gi, '[redacted]')
  out = out.replace(/[A-Za-z0-9+/=]{51,}/g, '[redacted]')
  return out
}

function deriveLayoutDescriptor(): string {
  const w = window as Window & { gridLayout?: string; layout?: string }
  const fromUrl = new URLSearchParams(window.location.search).get('layout')
  return (w.gridLayout || w.layout || fromUrl || 'unknown').trim()
}

function deriveGridId(): string | null {
  const w = window as Window & {
    GRID_CONFIG?: { sessionId?: string }
    gridSessionId?: string
    sessionId?: string
  }
  const u = new URLSearchParams(window.location.search)
  const a =
    w.GRID_CONFIG?.sessionId ||
    w.gridSessionId ||
    w.sessionId ||
    u.get('session') ||
    u.get('sessionId')
  const t = typeof a === 'string' ? a.trim() : ''
  return t.length > 0 ? t : null
}

function parseSlotConfig(slot: Element): Record<string, unknown> | null {
  const raw = slot.getAttribute('data-slot-config')
  if (!raw) return null
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
}

function getBoxNumber(slot: Element): number {
  const cfg = parseSlotConfig(slot)
  const bn = cfg && typeof cfg.boxNumber === 'number' ? cfg.boxNumber : NaN
  if (Number.isFinite(bn) && bn > 0) return bn
  const sid = slot.getAttribute('data-slot-id')
  if (sid) {
    const n = parseInt(sid, 10)
    if (Number.isFinite(n)) return n
  }
  return 0
}

function getAgentLabel(slot: Element): string | null {
  const el = slot.querySelector('.slot-display-text')
  const t = el?.textContent?.trim()
  return t && t.length > 0 ? t : null
}

function inferStatus(slot: Element, cfg: Record<string, unknown> | null): DomSlotCapture['status'] {
  if (cfg) {
    const s = String(cfg.status ?? cfg.runStatus ?? cfg.agentStatus ?? '').toLowerCase()
    if (s.includes('run') || s === 'running' || s === 'busy') return 'running'
    if (s.includes('err') || s === 'failed' || s === 'error') return 'error'
    if (s === 'idle' || s === 'ready' || s === 'complete' || s === 'done') return 'idle'
  }
  if (slot.classList.contains('slot-status-error') || slot.querySelector?.('[data-agent-status="error"]')) {
    return 'error'
  }
  if (slot.classList.contains('slot-status-running')) return 'running'
  if (slot.classList.contains('slot-status-idle')) return 'idle'
  const content = slot.children[1] as HTMLElement | undefined
  if (content) {
    const low = (content.innerText || '').toLowerCase()
    if (low.includes('error:') || low.includes('failed to')) return 'error'
  }
  return 'unknown'
}

/**
 * Build plain-text digest from the slot body (second child: output region in grid-display-v2).
 */
function extractTextDigestFromContentRoot(root: HTMLElement): { text: string; truncated: boolean } {
  const clone = root.cloneNode(true) as HTMLElement
  clone.querySelectorAll('script,style').forEach((el) => el.remove())

  clone.querySelectorAll('iframe').forEach((frame) => {
    let host = 'unknown'
    try {
      const u = (frame as HTMLIFrameElement).src
      if (u) host = new URL(u).hostname || host
    } catch {
      /* noop */
    }
    const tn = document.createTextNode(`[iframe: ${host}]`)
    frame.parentNode?.replaceChild(tn, frame)
  })

  clone.querySelectorAll('img').forEach((img) => {
    const el = img as HTMLImageElement
    const w = el.naturalWidth || el.width || Number(el.getAttribute('width')) || 0
    const h = el.naturalHeight || el.height || Number(el.getAttribute('height')) || 0
    const tn = document.createTextNode(`[image: ${w}x${h}]`)
    img.parentNode?.replaceChild(tn, img)
  })

  clone.querySelectorAll('input,textarea').forEach((el) => {
    if ((el as HTMLElement).hasAttribute('data-user-visible')) return
    const tn = document.createTextNode('[input]')
    el.parentNode?.replaceChild(tn, el)
  })

  let text = clone.innerText || ''
  text = redactSensitive(text)
  return truncateUtf8Bytes(text, PER_SLOT_MAX_BYTES)
}

function enforceTotalPayloadMax(snapshot: DomSnapshot): DomSnapshot {
  let guard = 0
  while (utf8ByteLength(JSON.stringify(snapshot)) > TOTAL_PAYLOAD_MAX_BYTES && guard < 500) {
    guard++
    let bestIdx = -1
    let bestLen = -1
    snapshot.slots.forEach((s, i) => {
      const L = utf8ByteLength(s.textDigest)
      if (L > bestLen) {
        bestLen = L
        bestIdx = i
      }
    })
    if (bestIdx < 0 || bestLen <= 0) break
    const s = snapshot.slots[bestIdx]
    const half = Math.max(1, Math.floor(s.textDigest.length / 2))
    snapshot.slots[bestIdx] = {
      ...s,
      textDigest: s.textDigest.slice(0, half) + ' [… truncated]',
      truncated: true,
    }
  }
  return snapshot
}

/**
 * Serializes the display grid under `#grid-root` (default) into a structured payload.
 * Returns null when no grid root exists (non-grid tab).
 */
export function captureDomSnapshot(gridRootSelector = '#grid-root'): DomSnapshot | null {
  const root = document.querySelector(gridRootSelector)
  if (!root) return null

  const slotEls = root.querySelectorAll('[data-slot-id]')
  const slots: DomSlotCapture[] = []

  slotEls.forEach((slotEl) => {
    const cfg = parseSlotConfig(slotEl)
    const boxNumber = getBoxNumber(slotEl)
    const agentLabel = getAgentLabel(slotEl)
    const status = inferStatus(slotEl, cfg)

    const contentRoot = slotEl.children[1] as HTMLElement | undefined
    let textDigest = ''
    let truncated = false
    if (contentRoot) {
      const r = extractTextDigestFromContentRoot(contentRoot)
      textDigest = r.text
      truncated = r.truncated
    }

    slots.push({
      boxNumber,
      agentLabel,
      status,
      textDigest,
      truncated,
    })
  })

  const snapshot: DomSnapshot = {
    capturedAt: new Date().toISOString(),
    gridId: deriveGridId(),
    layout: deriveLayoutDescriptor(),
    slots,
  }

  return enforceTotalPayloadMax(snapshot)
}

function registerDomSnapshotMessageListener(): void {
  try {
    const g = globalThis as typeof globalThis & { [LISTENER_FLAG]?: boolean }
    if (g[LISTENER_FLAG]) return
    if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage) return

    g[LISTENER_FLAG] = true
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || message.type !== CAPTURE_DOM_SNAPSHOT_MESSAGE_TYPE) {
        return false
      }
      try {
        const sel =
          typeof message.gridRootSelector === 'string' && message.gridRootSelector.trim()
            ? message.gridRootSelector.trim()
            : '#grid-root'
        const snapshot = captureDomSnapshot(sel)
        sendResponse({ ok: true, snapshot })
      } catch (e) {
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) })
      }
      return false
    })
  } catch {
    /* noop */
  }
}

registerDomSnapshotMessageListener()
