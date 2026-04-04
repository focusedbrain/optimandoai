/**
 * PopupChatView
 *
 * Full-featured WR Chat for the popup window — mirrors the docked sidepanel's
 * chat pipeline exactly: LLM routing via processFlow, drag-and-drop with visual
 * overlay, orchestrator-side PDF extraction, pending-doc injection, OCR for images.
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { WrChatCaptureButton } from './WrChatCaptureButton'
import { normaliseTriggerTag } from '../../utils/normaliseTriggerTag'
import { enrichRouteTextWithOcr } from '../../services/processFlow'
import { mergeTaggedTriggersFromHost } from '../../utils/mergeTaggedTriggersFromHost'

const BASE_URL = 'http://127.0.0.1:51248'

// ─── Types ───────────────────────────────────────────────────────────────────

interface ChatMessage {
  role: 'user' | 'assistant'
  /** User messages may pair `text` + `imageUrl` / `videoUrl` in one bubble (capture Save path). */
  text?: string
  imageUrl?: string
  videoUrl?: string
  timestamp?: number
}

export interface PopupChatViewProps {
  theme?: 'pro' | 'dark' | 'standard'
  availableModels?: Array<{ name: string; size?: string }>
  activeLlmModel?: string
  onModelSelect?: (name: string) => void
  onRefreshModels?: () => Promise<void>
  sessionName?: string
  /** When set (e.g. Electron dashboard), persist message list to localStorage for this key. */
  persistTranscriptStorageKey?: string
  /** Mark Electron dashboard embed — optional defensive branches (no popup window). */
  wrChatEmbedContext?: 'dashboard'
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getLaunchSecret(): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: 'GET_LAUNCH_SECRET' }, (resp: any) => {
        if (chrome.runtime.lastError) { resolve(null); return }
        resolve(resp?.secret ?? null)
      })
    } catch { resolve(null) }
  })
}

/** Dashboard embed can send capture before the mount-time secret retry runs — refresh before OCR/LLM. */
async function ensureLaunchSecret(secretRef: { current: string | null }): Promise<string | null> {
  if (secretRef.current) return secretRef.current
  const s = await getLaunchSecret()
  if (s) secretRef.current = s
  return secretRef.current
}

function buildHeaders(secret: string | null, extra?: Record<string, string>): Record<string, string> {
  return { 'Content-Type': 'application/json', 'X-Launch-Secret': secret ?? '', ...extra }
}

function toBase64ForOllama(dataUrl: string): string {
  const idx = dataUrl.indexOf(',')
  return idx !== -1 ? dataUrl.slice(idx + 1) : dataUrl
}

/** Reject paths / garbage passed as "base64" — Ollama vision + Gemma otherwise surface img-0 / can't-read-image behavior. */
function isPlausibleVisionBase64(b64: string): boolean {
  if (!b64 || b64.length < 48) return false
  if (/^[A-Za-z]:[\\/]/.test(b64)) return false
  if (b64.startsWith('\\\\')) return false
  return true
}

/** Blob / file paths are not valid OCR or vision payloads; normalize to a data URL (Electron dashboard often differs from extension popup). */
function isLikelyFilesystemPath(s: string): boolean {
  if (!s || s.length < 2) return false
  if (/^[A-Za-z]:[\\/]/.test(s)) return true
  if (s.startsWith('\\\\')) return true
  return false
}

function pathToFileUrlString(p: string): string {
  const normalized = p.replace(/\\/g, '/')
  if (/^[A-Za-z]:/.test(normalized)) return 'file:///' + normalized
  if (normalized.startsWith('//')) return 'file:' + normalized
  return 'file://' + normalized
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

async function resolveImageUrlForBackend(imageUrl: string): Promise<string> {
  if (!imageUrl) return ''
  if (imageUrl.startsWith('data:')) return imageUrl
  if (imageUrl.startsWith('blob:')) {
    try {
      const r = await fetch(imageUrl)
      const blob = await r.blob()
      return await blobToDataUrl(blob)
    } catch {
      return imageUrl
    }
  }
  if (imageUrl.startsWith('file:')) {
    try {
      const r = await fetch(imageUrl)
      const blob = await r.blob()
      return await blobToDataUrl(blob)
    } catch {
      return imageUrl
    }
  }
  if (isLikelyFilesystemPath(imageUrl)) {
    try {
      const r = await fetch(pathToFileUrlString(imageUrl))
      const blob = await r.blob()
      return await blobToDataUrl(blob)
    } catch {
      return imageUrl
    }
  }
  return imageUrl
}

const LLM_FETCH_TIMEOUT_MS = 600_000

/** Map chat UI messages to Ollama /api/llm/chat shape: attach vision base64 on the last user message that has an image (not only top-level `images`). */
async function mapChatToLlmMessages(
  newMessages: ChatMessage[],
  secret: string | null,
): Promise<Array<{ role: string; content: string; images?: string[] }>> {
  let lastUserImageIdx = -1
  for (let i = newMessages.length - 1; i >= 0; i--) {
    if (newMessages[i].role === 'user' && newMessages[i].imageUrl) {
      lastUserImageIdx = i
      break
    }
  }
  return Promise.all(
    newMessages.map(async (msg, idx) => {
      if (msg.imageUrl && msg.role === 'user') {
        const resolved = await resolveImageUrlForBackend(msg.imageUrl)
        const ocr = await runOcr(resolved, secret)
        const content = ocr
          ? `${msg.text || 'Image:'}\n\n[OCR extracted text]:\n${ocr}`
          : msg.text || '[Image attached - OCR unavailable]'
        const b64 = toBase64ForOllama(resolved)
        const attachVision =
          idx === lastUserImageIdx && !!msg.imageUrl && isPlausibleVisionBase64(b64)
        return {
          role: 'user',
          content,
          ...(attachVision ? { images: [b64] } : {}),
        }
      }
      if (msg.videoUrl && msg.role === 'user') {
        return { role: 'user', content: `${msg.text || 'Video:'}\n[Video attached]` }
      }
      return { role: msg.role as string, content: msg.text ?? '' }
    }),
  )
}

function resolveModelIdForChat(
  active: string | undefined,
  models: Array<{ name: string }> | undefined,
): string {
  const t = (active ?? '').trim()
  if (t) return t
  const m0 = models?.[0]?.name
  if (m0) return m0
  try {
    const w = (window as unknown as { llm?: { models?: Array<{ id?: string; name?: string }> } }).llm?.models?.[0]
    return (w?.id || w?.name || '') as string
  } catch {
    return ''
  }
}

async function parseDataTransfer(dt: DataTransfer): Promise<any[]> {
  const out: any[] = []
  try {
    for (const f of Array.from(dt.files || [])) {
      const t = (f.type || '').toLowerCase()
      const kind = t.startsWith('image/') ? 'image' : 'file'
      out.push({ kind, payload: f, mime: f.type, name: f.name })
    }
    const url = dt.getData('text/uri-list') || dt.getData('text/url')
    if (url) out.push({ kind: 'url', payload: url })
    const txt = dt.getData('text/plain')
    if (txt && !url) out.push({ kind: 'text', payload: txt })
  } catch {}
  return out
}

async function extractPdfText(file: File, secret: string | null): Promise<string> {
  try {
    const arrayBuffer = await file.arrayBuffer()
    const bytes = new Uint8Array(arrayBuffer)
    let binary = ''
    const chunkSize = 8192
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
    }
    const base64 = btoa(binary)
    const attachmentId = `popup-drop-${file.name.replace(/[^a-zA-Z0-9]/g, '_')}-${file.size}`
    const response = await fetch(`${BASE_URL}/api/parser/pdf/extract`, {
      method: 'POST',
      headers: buildHeaders(secret),
      body: JSON.stringify({ attachmentId, base64 }),
      signal: AbortSignal.timeout(60_000)
    })
    if (!response.ok) return ''
    const result = await response.json()
    if (result.success && result.extractedText?.trim().length > 0) return result.extractedText.trim()
    return ''
  } catch { return '' }
}

async function runOcr(imageUrl: string, secret: string | null): Promise<string> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    const res: Response = await fetch(`${BASE_URL}/api/ocr/process`, {
      method: 'POST',
      headers: buildHeaders(secret),
      body: JSON.stringify({ image: imageUrl }),
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (!res.ok) return ''
    const json = await res.json()
    return json.ok && json.data?.text ? (json.data.text as string) : ''
  } catch { return '' }
}

// ─── Component ────────────────────────────────────────────────────────────────

export const PopupChatView: React.FC<PopupChatViewProps> = ({
  theme = 'pro',
  availableModels = [],
  activeLlmModel,
  onModelSelect,
  onRefreshModels,
  sessionName = 'Active Session',
  persistTranscriptStorageKey,
  wrChatEmbedContext,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [pendingDoc, setPendingDoc] = useState<{ name: string; text: string } | null>(null)
  const [showModelDropdown, setShowModelDropdown] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  /** Saved area triggers — same storage key as docked WR Chat */
  const [triggers, setTriggers] = useState<any[]>([])
  const [showTagsMenu, setShowTagsMenu] = useState(false)
  /** When false, skip persisting until localStorage transcript has been read (dashboard embed). */
  const [transcriptHydrated, setTranscriptHydrated] = useState(() => !persistTranscriptStorageKey)
  /** Capture tag/command prompt — same surface as sidepanel, filtered by promptContext (popup vs dashboard). */
  const [showTriggerPrompt, setShowTriggerPrompt] = useState<{
    mode: string
    rect: unknown
    imageUrl?: string
    videoUrl?: string
    createTrigger: boolean
    addCommand: boolean
    name?: string
    command?: string
    bounds?: unknown
  } | null>(null)

  const secretRef = useRef<string | null>(null)
  const chatRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const modelDropdownRef = useRef<HTMLDivElement>(null)
  const tagsMenuRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pendingTriggerRef = useRef<{ trigger: any; command?: string; autoProcess: boolean } | null>(null)
  const sendWithTriggerAndImageRef = useRef<
    (
      displayText: string,
      routeText: string,
      mediaUrl: string | undefined,
      captureMode: 'screenshot' | 'stream',
    ) => Promise<void>
  | null>(null)
  const processPopupElectronSelectionRef = useRef<
    (message: { promptContext?: string; dataUrl?: string; url?: string }) => void
  >(() => {})

  // Fetch launch secret once on mount
  useEffect(() => {
    let cancelled = false
    const fetch_ = async () => {
      const secret = await getLaunchSecret()
      if (!cancelled) secretRef.current = secret
    }
    fetch_()
    // Retry once after 3 s in case background hasn't received handshake yet
    const timer = setTimeout(async () => {
      if (!secretRef.current) {
        const secret = await getLaunchSecret()
        if (!cancelled) secretRef.current = secret
      }
    }, 3000)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [])

  // Check connection status
  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (r: any) => {
      if (!chrome.runtime.lastError) setIsConnected(!!r?.data?.isConnected)
    })
  }, [])

  // Close model dropdown on outside click
  useEffect(() => {
    if (!showModelDropdown) return
    const handler = (e: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setShowModelDropdown(false)
      }
    }
    const t = setTimeout(() => document.addEventListener('click', handler), 0)
    return () => { clearTimeout(t); document.removeEventListener('click', handler) }
  }, [showModelDropdown])

  // Tags list — parity with docked WR Chat (sidepanel); merge from host keeps dashboard ↔ extension in sync.
  useEffect(() => {
    const load = () => {
      try {
        chrome.storage?.local?.get(['optimando-tagged-triggers'], (data: Record<string, unknown>) => {
          const list = Array.isArray(data?.['optimando-tagged-triggers'])
            ? (data['optimando-tagged-triggers'] as any[])
            : []
          setTriggers(list)
        })
      } catch {
        setTriggers([])
      }
    }
    load()
    const onUpd = () => load()
    window.addEventListener('optimando-triggers-updated', onUpd)
    const onStorage: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (changes, area) => {
      if (area !== 'local' || !changes['optimando-tagged-triggers']) return
      load()
    }
    try {
      chrome.storage?.onChanged?.addListener(onStorage)
    } catch {
      /* noop */
    }
    return () => {
      window.removeEventListener('optimando-triggers-updated', onUpd)
      try {
        chrome.storage?.onChanged?.removeListener(onStorage)
      } catch {
        /* noop */
      }
    }
  }, [])

  useEffect(() => {
    void mergeTaggedTriggersFromHost()
    const t = setInterval(() => void mergeTaggedTriggersFromHost(), 45_000)
    const onVis = () => {
      if (document.visibilityState === 'visible') void mergeTaggedTriggersFromHost()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  // Agent box broadcast: only the originating WR Chat surface should react (popup vs dashboard embed).
  useEffect(() => {
    try {
      if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage?.addListener) return
    } catch {
      return
    }
    const expected = wrChatEmbedContext === 'dashboard' ? 'dashboard' : 'popup'
    const onMsg = (message: { type?: string; data?: { sourceSurface?: string } }) => {
      if (message.type !== 'UPDATE_AGENT_BOX_OUTPUT' || !message.data) return
      const src = message.data.sourceSurface
      if (src !== undefined && src !== expected) return
      /* No agent-box grid in this view; gate prevents mis-attributed live updates if extended later. */
    }
    chrome.runtime.onMessage.addListener(onMsg)
    return () => {
      try {
        chrome.runtime.onMessage.removeListener(onMsg)
      } catch {
        /* noop */
      }
    }
  }, [wrChatEmbedContext])

  // Extension popup WR Chat: SHOW_TRIGGER_PROMPT only — thread messages come exclusively from Save (sendWithTriggerAndImage).
  useEffect(() => {
    if (wrChatEmbedContext === 'dashboard') return
    const onMsg = (message: any) => {
      if (message.type === 'SHOW_TRIGGER_PROMPT') {
        const pc = message.promptContext as string | undefined
        // Accept if promptContext matches this surface OR is absent (backward-compat with overlay paths that don't set lmgtfyLastSelectionSource).
        if (pc !== undefined && pc !== 'popup') return
        setShowTriggerPrompt({
          mode: message.mode || 'screenshot',
          rect: message.rect,
          bounds: message.bounds,
          imageUrl: message.imageUrl,
          videoUrl: message.videoUrl,
          createTrigger: !!message.createTrigger,
          addCommand: !!message.addCommand,
          name: '',
          command: '',
        })
        return
      }
    }
    try {
      chrome.runtime.onMessage.addListener(onMsg)
      return () => {
        try { chrome.runtime.onMessage.removeListener(onMsg) } catch { /* noop */ }
      }
    } catch {
      return undefined
    }
  }, [wrChatEmbedContext])

  // Electron dashboard embed: same capture UI via preload IPC (no chrome.runtime)
  useEffect(() => {
    if (wrChatEmbedContext !== 'dashboard') return
    const bridge =
      typeof window !== 'undefined'
        ? (window as Window & { LETmeGIRAFFETHATFORYOU?: {
            onDashboardCommandAppend?: (cb: (p: unknown) => void) => () => void
            onDashboardTriggerPrompt?: (cb: (p: unknown) => void) => () => void
          } }).LETmeGIRAFFETHATFORYOU
        : undefined
    if (!bridge?.onDashboardTriggerPrompt) return
    const unsubTrig = bridge.onDashboardTriggerPrompt((payload: unknown) => {
      const p = payload as {
        promptContext?: string
        mode?: string
        rect?: unknown
        bounds?: unknown
        imageUrl?: string
        videoUrl?: string
        createTrigger?: boolean
        addCommand?: boolean
      }
      if (p?.promptContext && p.promptContext !== 'dashboard') return
      setShowTriggerPrompt({
        mode: p?.mode || 'screenshot',
        rect: p?.rect,
        bounds: p?.bounds,
        imageUrl: p?.imageUrl,
        videoUrl: p?.videoUrl,
        createTrigger: !!p?.createTrigger,
        addCommand: !!p?.addCommand,
        name: '',
        command: '',
      })
    })
    return () => {
      try { unsubTrig() } catch { /* noop */ }
    }
  }, [wrChatEmbedContext])

  // Dashboard embed: restore / persist transcript (optional)
  useEffect(() => {
    if (!persistTranscriptStorageKey) {
      setTranscriptHydrated(true)
      return
    }
    setTranscriptHydrated(false)
    try {
      const raw = localStorage.getItem(persistTranscriptStorageKey)
      if (raw) {
        const parsed = JSON.parse(raw) as ChatMessage[]
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed)
        }
      }
    } catch {
      /* noop */
    }
    setTranscriptHydrated(true)
  }, [persistTranscriptStorageKey])

  useEffect(() => {
    if (!persistTranscriptStorageKey || !transcriptHydrated) return
    try {
      localStorage.setItem(persistTranscriptStorageKey, JSON.stringify(messages))
    } catch {
      /* quota / private mode */
    }
  }, [messages, persistTranscriptStorageKey, transcriptHydrated])

  useEffect(() => {
    if (!showTagsMenu) return
    const handler = (e: MouseEvent) => {
      if (tagsMenuRef.current && !tagsMenuRef.current.contains(e.target as Node)) {
        setShowTagsMenu(false)
      }
    }
    const t = setTimeout(() => document.addEventListener('click', handler), 0)
    return () => { clearTimeout(t); document.removeEventListener('click', handler) }
  }, [showTagsMenu])

  const handlePopupTriggerClick = (trigger: any) => {
    setShowTagsMenu(false)
    pendingTriggerRef.current = {
      trigger,
      command: trigger.command || trigger.name,
      autoProcess: true,
    }
    if (wrChatEmbedContext === 'dashboard') {
      void (async () => {
        try {
          const secret = await getLaunchSecret()
          await fetch(`${BASE_URL}/api/lmgtfy/execute-trigger`, {
            method: 'POST',
            headers: buildHeaders(secret),
            body: JSON.stringify({ trigger, targetSurface: 'dashboard' }),
          })
        } catch {
          /* noop */
        }
      })()
      return
    }
    try {
      chrome.runtime?.sendMessage({
        type: 'ELECTRON_EXECUTE_TRIGGER',
        trigger,
        targetSurface: 'popup',
      })
    } catch {
      /* noop */
    }
  }

  const handleDeleteTrigger = useCallback(
    (index: number) => {
      const t = triggers[index]
      const label = String(t?.name ?? t?.command ?? `Trigger ${index + 1}`)
      if (!confirm(`Delete trigger "${label}"?`)) return
      const key = 'optimando-tagged-triggers'
      chrome.storage?.local?.get([key], (data: Record<string, unknown>) => {
        const list = Array.isArray(data?.[key]) ? [...(data[key] as unknown[])] : []
        list.splice(index, 1)
        chrome.storage?.local?.set({ [key]: list }, () => {
          setTriggers(list as any[])
          try {
            chrome.runtime?.sendMessage({ type: 'TRIGGERS_UPDATED' })
          } catch {
            /* noop */
          }
          try {
            window.dispatchEvent(new CustomEvent('optimando-triggers-updated'))
          } catch {
            /* noop */
          }
        })
      })
    },
    [triggers],
  )

  const scrollToBottom = () => {
    setTimeout(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight }, 0)
  }

  // ── Drag & Drop ─────────────────────────────────────────────────────────────

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false)
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const items = await parseDataTransfer(e.dataTransfer)
    if (!items.length) return

    for (const item of items) {
      if (item.kind === 'image' && item.payload instanceof File) {
        const reader = new FileReader()
        reader.onload = () => {
          const dataUrl = reader.result as string
          setMessages(prev => [...prev, { role: 'user', text: `📎 ${item.name || 'image'}`, imageUrl: dataUrl }])
          scrollToBottom()
        }
        reader.readAsDataURL(item.payload)
        continue
      }

      if (item.kind === 'text') {
        setPendingDoc({ name: 'Dropped text', text: (item.payload as string).slice(0, 6000) })
        setMessages(prev => [...prev, { role: 'user', text: `📄 **Dropped text** attached — send your question below.` }])
        continue
      }

      if (item.kind === 'url') {
        setMessages(prev => [...prev, { role: 'user', text: `🔗 ${item.payload}` }])
        continue
      }

      if (item.payload instanceof File) {
        const file = item.payload as File
        const ext = file.name.split('.').pop()?.toLowerCase() || ''
        const isText = ['txt','md','csv','json','js','ts','py','html','css','xml','log','yaml','yml'].includes(ext)

        if (isText) {
          const reader = new FileReader()
          reader.onload = () => {
            setPendingDoc({ name: file.name, text: (reader.result as string).slice(0, 6000) })
            setMessages(prev => [...prev, { role: 'user', text: `📄 **${file.name}** attached (${Math.round(file.size / 1024)} KB) — send your question below.` }])
            scrollToBottom()
          }
          reader.readAsText(file)
        } else {
          // PDF / binary — send to orchestrator parser
          setMessages(prev => [...prev, { role: 'user', text: `📄 **${file.name}** attached (${Math.round(file.size / 1024)} KB) — extracting text…` }])
          scrollToBottom()
          extractPdfText(file, secretRef.current).then(extracted => {
            if (extracted && extracted.length > 50) {
              setPendingDoc({ name: file.name, text: extracted.slice(0, 8000) })
              setMessages(prev => {
                const updated = [...prev]
                const last = updated[updated.length - 1]
                if (last?.text?.includes('extracting text')) {
                  updated[updated.length - 1] = { ...last, text: `📄 **${file.name}** attached (${Math.round(file.size / 1024)} KB) — ${extracted.split(/\s+/).length.toLocaleString()} words extracted. Send your question below.` }
                }
                return updated
              })
            } else {
              setMessages(prev => {
                const updated = [...prev]
                const last = updated[updated.length - 1]
                if (last?.text?.includes('extracting text')) {
                  updated[updated.length - 1] = { ...last, text: `📄 **${file.name}** attached (${Math.round(file.size / 1024)} KB) — no selectable text found (scanned PDF?). Send your question below.` }
                }
                return updated
              })
            }
          })
        }
      }
    }
    scrollToBottom()
  }, [])

  // ── File input (upload button) ───────────────────────────────────────────────

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    const ext = file.name.split('.').pop()?.toLowerCase() || ''
    const isImage = file.type.startsWith('image/')
    const isText = ['txt','md','csv','json','js','ts','py','html','css','xml','log','yaml','yml'].includes(ext)

    if (isImage) {
      const reader = new FileReader()
      reader.onload = () => {
        setMessages(prev => [...prev, { role: 'user', text: `📎 ${file.name}`, imageUrl: reader.result as string }])
        scrollToBottom()
      }
      reader.readAsDataURL(file)
      return
    }

    if (isText) {
      const reader = new FileReader()
      reader.onload = () => {
        setPendingDoc({ name: file.name, text: (reader.result as string).slice(0, 6000) })
        setMessages(prev => [...prev, { role: 'user', text: `📄 **${file.name}** attached (${Math.round(file.size / 1024)} KB) — send your question below.` }])
        scrollToBottom()
      }
      reader.readAsText(file)
      return
    }

    // PDF / binary
    const fileCopy = file
    setMessages(prev => [...prev, { role: 'user', text: `📄 **${file.name}** attached (${Math.round(file.size / 1024)} KB) — extracting text…` }])
    scrollToBottom()
    extractPdfText(fileCopy, secretRef.current).then(extracted => {
      if (extracted && extracted.length > 50) {
        setPendingDoc({ name: fileCopy.name, text: extracted.slice(0, 8000) })
        setMessages(prev => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last?.text?.includes('extracting text')) {
            updated[updated.length - 1] = { ...last, text: `📄 **${fileCopy.name}** attached (${Math.round(fileCopy.size / 1024)} KB) — ${extracted.split(/\s+/).length.toLocaleString()} words extracted. Send your question below.` }
          }
          return updated
        })
      } else {
        setMessages(prev => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last?.text?.includes('extracting text')) {
            updated[updated.length - 1] = { ...last, text: `📄 **${fileCopy.name}** attached (${Math.round(fileCopy.size / 1024)} KB) — no selectable text found (scanned PDF?). Send your question below.` }
          }
          return updated
        })
      }
    })
  }, [])

  // ── Send message ─────────────────────────────────────────────────────────────

  const handleSend = useCallback(async () => {
    const text = input.trim()
    const docCtx = pendingDoc
    if (docCtx) setPendingDoc(null)

    const lastUserMsgWithImage = [...messages].reverse().find(m => m.role === 'user' && m.imageUrl)
    const currentTurnImageUrl = lastUserMsgWithImage?.imageUrl
    const hasImage = !!currentTurnImageUrl

    if (!text && !hasImage && !docCtx) {
      if (isLoading) return
      setMessages(prev => [...prev, {
        role: 'assistant',
        text: `💡 **How to use WR Chat:**\n\n• Ask questions about the orchestrator or your workflow\n• Trigger automations using **#tagname** (e.g., "#summarize")\n• Drop or upload a file 📎 to attach it, then ask a question about it\n\nTry: "What can you help me with?"`
      }])
      scrollToBottom()
      return
    }

    if (isLoading) return

    const modelId = resolveModelIdForChat(activeLlmModel, availableModels)
    if (!modelId) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        text: `⚠️ No LLM model available. Please go to Admin panel → LLM Settings and install a model.`
      }])
      scrollToBottom()
      return
    }

    // Build the text we send to the LLM (with doc content injected)
    const llmText = docCtx
      ? `[Attached document: ${docCtx.name}]\n\n${docCtx.text}\n\n---\n${text}`
      : text

    const userDisplayText = text || (docCtx ? `📄 ${docCtx.name}` : '')
    const newMessages: ChatMessage[] = userDisplayText
      ? [...messages, { role: 'user' as const, text: userDisplayText }]
      : [...messages]

    setMessages(newMessages)
    setInput('')
    setIsLoading(true)
    scrollToBottom()

    try {
      const secret = await ensureLaunchSecret(secretRef)
      // OCR for image if present
      let ocrText = ''
      if (hasImage && currentTurnImageUrl) {
        const resolvedImg = await resolveImageUrlForBackend(currentTurnImageUrl)
        ocrText = await runOcr(resolvedImg, secret)
      }

      // Build messages array for LLM (vision base64 on the last user image message — not only top-level `images`)
      let processedMessages = await mapChatToLlmMessages(newMessages, secret)

      // Inject doc content into last user message
      if (docCtx) {
        processedMessages = [...processedMessages]
        for (let i = processedMessages.length - 1; i >= 0; i--) {
          if (processedMessages[i].role === 'user') {
            processedMessages[i] = {
              ...processedMessages[i],
              content: `[Attached document: ${docCtx.name}]\n\n${docCtx.text}\n\n---\n${processedMessages[i].content}`
            }
            break
          }
        }
      }

      // Try routing via processFlow agents, fall back to Butler
      let answered = false
      try {
        const { routeInput, wrapInputForAgent, updateAgentBoxOutput, loadAgentsFromSession, getButlerSystemPrompt: _getButler } = await import('../../services/processFlow')
        const enrichedText = enrichRouteTextWithOcr(llmText, ocrText)

        let currentUrl = ''
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
          currentUrl = tab?.url || ''
        } catch {}

        const routingDecision = await routeInput(
          enrichedText,
          hasImage,
          { isConnected },
          sessionName,
          modelId,
          currentUrl,
        )

        if (routingDecision.shouldForwardToAgent && routingDecision.matchedAgents.length > 0) {
          // Show Butler's forwarding confirmation first
          if (routingDecision.butlerResponse) {
            setMessages(prev => [...prev, { role: 'assistant', text: routingDecision.butlerResponse }])
          }

          // Load full agent configs so reasoning/system-prompt is applied (same as docked sidepanel)
          let allAgents: any[] = []
          try { allAgents = await loadAgentsFromSession() } catch {}

          // PATH A: Agent processing
          for (const match of routingDecision.matchedAgents) {
            // Find the full AgentConfig so wrapInputForAgent gets reasoning/role/goals
            const agentConfig = allAgents.find((a: any) => a.id === match.agentId)
            const agentInput = agentConfig
              ? wrapInputForAgent(llmText, agentConfig, ocrText)
              : enrichedText

            const agentMessages = [
              { role: 'system', content: agentInput },
              ...processedMessages.filter(m => m.role === 'user')
            ]
            // Use agent's own model if configured, otherwise fall back to active model
            const modelToUse = match.agentBoxModel || modelId
            const agentRes: Response = await fetch(`${BASE_URL}/api/llm/chat`, {
              method: 'POST',
              headers: buildHeaders(secret),
              body: JSON.stringify({
                modelId: modelToUse,
                messages: agentMessages,
              }),
              signal: AbortSignal.timeout(LLM_FETCH_TIMEOUT_MS),
            })
            if (agentRes.ok) {
              const agentJson = await agentRes.json()
              const agentReply = (agentJson.ok && agentJson.data?.content) ? agentJson.data.content : ''
              if (agentReply) {
                // Send to ALL target boxes (sidebar + display grid), same as docked sidepanel
                const allBoxIds = match.targetBoxIds && match.targetBoxIds.length > 0
                  ? match.targetBoxIds
                  : match.agentBoxId ? [match.agentBoxId] : []

                if (allBoxIds.length > 0) {
                  try {
                    for (const boxId of allBoxIds) {
                      await updateAgentBoxOutput(
                        boxId,
                        agentReply,
                        undefined,
                        undefined,
                        wrChatEmbedContext === 'dashboard' ? 'dashboard' : 'popup',
                      )
                    }
                  } catch {}
                  const confirm = `[Agent: ${match.agentName}] responded. See agent box.`
                  setMessages(prev => [...prev, { role: 'assistant', text: confirm }])
                } else {
                  // No Agent Box configured — print full reply inline
                  setMessages(prev => [...prev, { role: 'assistant', text: `${match.agentIcon} **${match.agentName}**:\n\n${agentReply}` }])
                }
                answered = true
              }
            }
          }
        }
      } catch (e) {
        console.warn('[PopupChat] Agent routing failed, falling back to Butler:', e)
      }

      if (!answered) {
        // PATH B: Butler (general assistant)
        const { getButlerSystemPrompt } = await import('../../services/processFlow')
        const agentCount = 0
        const butlerPrompt = getButlerSystemPrompt(sessionName, agentCount, isConnected)
        const butlerMessages = [
          { role: 'system', content: butlerPrompt },
          ...processedMessages
        ]
        const butlerRes: Response = await fetch(`${BASE_URL}/api/llm/chat`, {
          method: 'POST',
          headers: buildHeaders(secret),
          body: JSON.stringify({
            modelId,
            messages: butlerMessages,
          }),
          signal: AbortSignal.timeout(LLM_FETCH_TIMEOUT_MS),
        })
        if (butlerRes.ok) {
          const butlerJson = await butlerRes.json()
          const butlerReply = (butlerJson.ok && butlerJson.data?.content) ? butlerJson.data.content : ''
          if (butlerReply) {
            setMessages(prev => [...prev, { role: 'assistant', text: butlerReply }])
          } else {
            setMessages(prev => [...prev, { role: 'assistant', text: `⚠️ LLM returned an empty response. The model may still be loading — please try again.` }])
          }
        } else {
          const errText = await butlerRes.text().catch(() => butlerRes.statusText)
          setMessages(prev => [...prev, { role: 'assistant', text: `❌ LLM error (${butlerRes.status}): ${errText}` }])
        }
      }
    } catch (err: any) {
      console.error('[PopupChat] handleSend error:', err)
      setMessages(prev => [...prev, { role: 'assistant', text: `❌ Error: ${err?.message || 'Unknown error'}` }])
    } finally {
      setIsLoading(false)
      scrollToBottom()
    }
  }, [input, messages, pendingDoc, activeLlmModel, availableModels, isLoading, isConnected, sessionName, wrChatEmbedContext])

  /** After capture Save with tag/command — displayText is what appears in chat; routeText drives routing/LLM. */
  const sendWithTriggerAndImage = useCallback(
    async (
      displayText: string,
      routeText: string,
      mediaUrl: string | undefined,
      captureMode: 'screenshot' | 'stream',
    ) => {
      const isVideo = captureMode === 'stream'
      const modelId = resolveModelIdForChat(activeLlmModel, availableModels)
      if (!modelId) {
        setMessages(prev => [
          ...prev,
          { role: 'assistant', text: `⚠️ No LLM model available. Please go to Admin panel → LLM Settings and install a model.` },
        ])
        return
      }
      if (isLoading) return

      const routeTag = normaliseTriggerTag(routeText)
      const displayLabel =
        (displayText || '').trim() || routeTag || (isVideo ? '[Stream]' : '[Screenshot]')
      const userMsg: ChatMessage = isVideo
        ? { role: 'user', text: displayLabel, videoUrl: mediaUrl }
        : { role: 'user', text: displayLabel, imageUrl: mediaUrl }

      const newMessages = [...messages, userMsg]
      setMessages(newMessages)
      setInput('')
      setIsLoading(true)
      scrollToBottom()

      try {
        const secret = await ensureLaunchSecret(secretRef)
        let ocrText = ''
        if (!isVideo && mediaUrl) {
          const resolvedMedia = await resolveImageUrlForBackend(mediaUrl)
          ocrText = await runOcr(resolvedMedia, secret)
        }
        const enrichedText = enrichRouteTextWithOcr(routeText, ocrText)
        const hasImage = !isVideo && !!mediaUrl

        const processedMessages = await mapChatToLlmMessages(newMessages, secret)

        let answered = false
        try {
          const { routeInput, wrapInputForAgent, updateAgentBoxOutput, loadAgentsFromSession } = await import(
            '../../services/processFlow',
          )
          let currentUrl = ''
          try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
            currentUrl = tab?.url || ''
          } catch {
            /* noop */
          }

          const routingDecision = await routeInput(
            enrichedText,
            hasImage,
            { isConnected },
            sessionName,
            modelId,
            currentUrl,
          )

          if (routingDecision.shouldForwardToAgent && routingDecision.matchedAgents.length > 0) {
            if (routingDecision.butlerResponse) {
              setMessages(prev => [...prev, { role: 'assistant', text: routingDecision.butlerResponse }])
            }
            let allAgents: any[] = []
            try {
              allAgents = await loadAgentsFromSession()
            } catch {
              /* noop */
            }
            for (const match of routingDecision.matchedAgents) {
              const agentConfig = allAgents.find((a: any) => a.id === match.agentId)
              const agentInput = agentConfig ? wrapInputForAgent(routeText, agentConfig, ocrText) : enrichedText
              const agentMessages = [
                { role: 'system', content: agentInput },
                ...processedMessages.filter(m => m.role === 'user'),
              ]
              const modelToUse = match.agentBoxModel || modelId
              const agentRes: Response = await fetch(`${BASE_URL}/api/llm/chat`, {
                method: 'POST',
                headers: buildHeaders(secret),
                body: JSON.stringify({
                  modelId: modelToUse,
                  messages: agentMessages,
                }),
                signal: AbortSignal.timeout(LLM_FETCH_TIMEOUT_MS),
              })
              if (agentRes.ok) {
                const agentJson = await agentRes.json()
                const agentReply = agentJson.ok && agentJson.data?.content ? agentJson.data.content : ''
                if (agentReply) {
                  const allBoxIds =
                    match.targetBoxIds && match.targetBoxIds.length > 0
                      ? match.targetBoxIds
                      : match.agentBoxId
                        ? [match.agentBoxId]
                        : []
                  if (allBoxIds.length > 0) {
                    try {
                      for (const boxId of allBoxIds) {
                        await updateAgentBoxOutput(
                          boxId,
                          agentReply,
                          undefined,
                          undefined,
                          wrChatEmbedContext === 'dashboard' ? 'dashboard' : 'popup',
                        )
                      }
                    } catch {
                      /* noop */
                    }
                    const confirm = `[Agent: ${match.agentName}] responded. See agent box.`
                    setMessages(prev => [...prev, { role: 'assistant', text: confirm }])
                  } else {
                    setMessages(prev => [
                      ...prev,
                      { role: 'assistant', text: `${match.agentIcon} **${match.agentName}**:\n\n${agentReply}` },
                    ])
                  }
                  answered = true
                }
              }
            }
          }
        } catch (e) {
          console.warn('[PopupChat] sendWithTriggerAndImage agent routing failed:', e)
        }

        if (!answered) {
          const { getButlerSystemPrompt } = await import('../../services/processFlow')
          const butlerPrompt = getButlerSystemPrompt(sessionName, 0, isConnected)
          const butlerMessages = [{ role: 'system', content: butlerPrompt }, ...processedMessages]
          const butlerRes: Response = await fetch(`${BASE_URL}/api/llm/chat`, {
            method: 'POST',
            headers: buildHeaders(secret),
            body: JSON.stringify({
              modelId,
              messages: butlerMessages,
            }),
            signal: AbortSignal.timeout(LLM_FETCH_TIMEOUT_MS),
          })
          if (butlerRes.ok) {
            const butlerJson = await butlerRes.json()
            const butlerReply = butlerJson.ok && butlerJson.data?.content ? butlerJson.data.content : ''
            if (butlerReply) {
              setMessages(prev => [...prev, { role: 'assistant', text: butlerReply }])
            } else {
              setMessages(prev => [
                ...prev,
                { role: 'assistant', text: `⚠️ LLM returned an empty response. The model may still be loading — please try again.` },
              ])
            }
          } else {
            const errText = await butlerRes.text().catch(() => butlerRes.statusText)
            setMessages(prev => [...prev, { role: 'assistant', text: `❌ LLM error (${butlerRes.status}): ${errText}` }])
          }
        }
      } catch (err: any) {
        console.error('[PopupChat] sendWithTriggerAndImage error:', err)
        setMessages(prev => [...prev, { role: 'assistant', text: `❌ Error: ${err?.message || 'Unknown error'}` }])
      } finally {
        setIsLoading(false)
        scrollToBottom()
      }
    },
    [messages, activeLlmModel, availableModels, isLoading, isConnected, sessionName, wrChatEmbedContext],
  )

  sendWithTriggerAndImageRef.current = sendWithTriggerAndImage

  processPopupElectronSelectionRef.current = (message: {
    promptContext?: string
    dataUrl?: string
    url?: string
  }) => {
    const pc = message.promptContext
    if (pc !== undefined && pc !== 'popup') return
    const url = message.dataUrl || message.url
    if (!url) return
    const pending = pendingTriggerRef.current
    if (!pending?.autoProcess) return
    const tr = pending.trigger
    const nameT = String(tr?.name ?? '').trim()
    const commandT = String(pending.command ?? tr?.command ?? '').trim()
    const tagFromName = normaliseTriggerTag(nameT)
    const routeForLlm = commandT || tagFromName
    const displayForChat = commandT || (nameT ? nameT : '') || tagFromName
    pendingTriggerRef.current = null
    const displayLine = (displayForChat || tagFromName || '[Screenshot]').trim()
    const routeLine = (routeForLlm || tagFromName).trim() || displayLine
    void sendWithTriggerAndImageRef.current?.(displayLine, routeLine, url, 'screenshot')
  }

  // Extension popup: headless capture result → same #tag + command routing as docked sidepanel.
  useEffect(() => {
    if (wrChatEmbedContext === 'dashboard') return
    const onMsg = (message: { type?: string; promptContext?: string; dataUrl?: string; url?: string }) => {
      if (message.type !== 'ELECTRON_SELECTION_RESULT') return
      processPopupElectronSelectionRef.current(message)
    }
    try {
      chrome.runtime.onMessage.addListener(onMsg)
      return () => {
        try {
          chrome.runtime.onMessage.removeListener(onMsg)
        } catch {
          /* noop */
        }
      }
    } catch {
      return undefined
    }
  }, [wrChatEmbedContext])

  // Service worker often does not deliver sendMessage to sidepanel/popup; background also writes chrome.storage.
  useEffect(() => {
    if (wrChatEmbedContext === 'dashboard') return
    const KEY = 'optimando-wrchat-selection-fallback'
    const onStorage = (changes: chrome.storage.StorageChange, area: string) => {
      if (area !== 'local' || !changes[KEY]?.newValue) return
      const message = changes[KEY].newValue as { promptContext?: string; dataUrl?: string; url?: string }
      try {
        processPopupElectronSelectionRef.current(message)
      } finally {
        void chrome.storage.local.remove(KEY)
      }
    }
    chrome.storage.onChanged.addListener(onStorage)
    return () => chrome.storage.onChanged.removeListener(onStorage)
  }, [wrChatEmbedContext])

  // Dashboard embed: IPC relay from main when promptContext is dashboard (no chrome.runtime).
  useEffect(() => {
    if (wrChatEmbedContext !== 'dashboard') return
    const bridge = (
      typeof window !== 'undefined'
        ? (window as Window & {
            LETmeGIRAFFETHATFORYOU?: { onDashboardSelectionResult?: (cb: (p: unknown) => void) => () => void }
          }).LETmeGIRAFFETHATFORYOU
        : undefined
    )
    if (!bridge?.onDashboardSelectionResult) return
    const unsub = bridge.onDashboardSelectionResult((payload: unknown) => {
      const p = payload as { dataUrl?: string; promptContext?: string; kind?: string }
      if (p?.promptContext && p.promptContext !== 'dashboard') return
      const url = p?.dataUrl
      if (!url || p?.kind !== 'image') return
      const pending = pendingTriggerRef.current
      if (!pending?.autoProcess) return
      const tr = pending.trigger
      const nameT = String(tr?.name ?? '').trim()
      const commandT = String(pending.command ?? tr?.command ?? '').trim()
      const tagFromName = normaliseTriggerTag(nameT)
      const routeForLlm = commandT || tagFromName
      const displayForChat = commandT || (nameT ? nameT : '') || tagFromName
      pendingTriggerRef.current = null
      const displayLine = (displayForChat || tagFromName || '[Screenshot]').trim()
      const routeLine = (routeForLlm || tagFromName).trim() || displayLine
      void sendWithTriggerAndImageRef.current?.(displayLine, routeLine, url, 'screenshot')
    })
    return () => {
      try {
        unsub()
      } catch {
        /* noop */
      }
    }
  }, [wrChatEmbedContext])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  const handleClearChat = useCallback(() => {
    setMessages([])
    setInput('')
    setPendingDoc(null)
    setIsLoading(false)
    setShowTagsMenu(false)
    setShowTriggerPrompt(null)
    if (persistTranscriptStorageKey) {
      try {
        localStorage.removeItem(persistTranscriptStorageKey)
      } catch {
        /* noop */
      }
    }
  }, [persistTranscriptStorageKey])

  // ── Theme ────────────────────────────────────────────────────────────────────

  const isLight = theme === 'standard'
  const isDark = theme === 'dark'
  const isPro = theme === 'pro'

  const colors = {
    bg: isLight ? '#f8f9fb' : 'transparent',
    header: isLight ? '#ffffff' : isPro ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.2)',
    headerBorder: isLight ? '#94a3b8' : 'rgba(255,255,255,0.1)',
    headerText: isLight ? '#0f172a' : 'white',
    badgeBg: isLight ? 'rgba(59,130,246,0.1)' : 'rgba(255,255,255,0.15)',
    badgeText: isLight ? '#2563eb' : 'white',
    composerBorder: isLight ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.12)',
    composerBg: isLight ? '#ffffff' : 'transparent',
    inputBg: isLight ? '#ffffff' : 'rgba(255,255,255,0.08)',
    inputBorder: isLight ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.18)',
    inputText: isLight ? '#0f172a' : '#f1f5f9',
    userBubbleBg: isLight ? 'rgba(34,197,94,0.1)' : 'rgba(34,197,94,0.14)',
    userBubbleBorder: isLight ? '1px solid rgba(34,197,94,0.3)' : '1px solid rgba(34,197,94,0.5)',
    aiBubbleBg: isLight ? '#ffffff' : 'rgba(255,255,255,0.1)',
    aiBubbleBorder: isLight ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.2)',
    bubbleText: isLight ? '#0f172a' : '#f1f5f9',
    muted: isLight ? '#64748b' : 'rgba(255,255,255,0.5)',
    pendingBg: isLight ? 'rgba(99,102,241,0.08)' : 'rgba(99,102,241,0.15)',
    pendingBorder: isLight ? '#c7d2fe' : 'rgba(99,102,241,0.4)',
    pendingText: isLight ? '#4338ca' : '#a5b4fc',
    dragOverlay: 'rgba(99,102,241,0.85)',
    btnBg: isLight ? '#f1f5f9' : 'rgba(255,255,255,0.08)',
    btnBorder: isLight ? '#94a3b8' : 'rgba(255,255,255,0.18)',
    btnText: isLight ? '#374151' : 'rgba(255,255,255,0.75)',
  }

  const noModels = availableModels.length === 0
  const canSend = !isLoading && (!!input.trim() || !!pendingDoc)

  const captureSource = useMemo(
    () => (wrChatEmbedContext === 'dashboard' ? 'wr-chat-dashboard' : 'wr-chat-popup'),
    [wrChatEmbedContext],
  )

  const captureBorderDefault = isLight ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.45)'
  const captureBorderFocus = isLight ? '1px solid #6366f1' : '1px solid rgba(255,255,255,0.80)'
  const captureLabelColor = isLight ? '#475569' : 'rgba(255,255,255,0.70)'

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', position: 'relative', background: colors.bg }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <style>{`
        .wr-capture-field::placeholder { color: rgba(150,150,150,0.7); }
      `}</style>
      {/* Drag overlay */}
      {isDragging && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 50,
          background: colors.dragOverlay,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none', borderRadius: '8px'
        }}>
          <span style={{ fontSize: 32, marginRight: 10 }}>📎</span>
          <span style={{ color: '#fff', fontSize: 18, fontWeight: 700 }}>Drop file or image here</span>
        </div>
      )}

      {/* Header — Clear, Tags, screen capture (LmGTFY) */}
      <div style={{
        padding: '8px 12px', fontSize: '11px', fontWeight: 600,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
        background: colors.header, borderBottom: `1px solid ${colors.headerBorder}`, color: colors.headerText
      }}>
        <span style={{
          padding: '3px 8px', borderRadius: '4px', fontSize: '10px',
          background: colors.badgeBg, color: colors.badgeText
        }}>⚡ Command Session</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <WrChatCaptureButton
            variant="comfortable"
            theme={theme}
            source={captureSource}
            createTrigger={true}
            addCommand={true}
          />
          <button
            type="button"
            onClick={handleClearChat}
            title="Clear chat"
            style={{
              padding: '0 8px',
              height: '22px',
              fontSize: '10px',
              fontWeight: 500,
              opacity: 0.55,
              borderRadius: '6px',
              cursor: 'pointer',
              border: isLight ? '1px solid #94a3b8' : `1px solid ${colors.btnBorder}`,
              background: isLight ? '#ffffff' : colors.btnBg,
              color: isLight ? '#0f172a' : colors.headerText,
              transition: 'background 0.2s ease',
            }}
            onMouseEnter={(e) => {
              if (isLight) {
                e.currentTarget.style.background = '#eef3f6'
                e.currentTarget.style.color = '#0f172a'
              } else {
                e.currentTarget.style.background = isPro ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.15)'
              }
            }}
            onMouseLeave={(e) => {
              if (isLight) {
                e.currentTarget.style.background = '#ffffff'
                e.currentTarget.style.color = '#0f172a'
              } else {
                e.currentTarget.style.background = colors.btnBg
                e.currentTarget.style.color = colors.headerText
              }
            }}
          >
            Clear
          </button>
          <div ref={tagsMenuRef} style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => setShowTagsMenu(!showTagsMenu)}
              title="Tags - Quick access to saved triggers"
              style={{
                padding: '0 10px',
                height: '22px',
                fontSize: '10px',
                fontWeight: 500,
                borderRadius: '6px',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                border: isLight
                  ? '1px solid #94a3b8'
                  : isDark
                    ? '1px solid rgba(255,255,255,0.2)'
                    : '1px solid rgba(255,255,255,0.45)',
                background: isLight ? '#ffffff' : isDark ? 'rgba(255,255,255,0.1)' : 'rgba(118,75,162,0.35)',
                color: isLight ? '#0f172a' : isDark ? '#f1f5f9' : '#ffffff',
                transition: 'background 0.2s ease',
              }}
              onMouseEnter={(e) => {
                if (isLight) {
                  e.currentTarget.style.background = '#eef3f6'
                  e.currentTarget.style.color = '#0f172a'
                } else if (isDark) {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.2)'
                } else {
                  e.currentTarget.style.background = 'rgba(118,75,162,0.6)'
                }
              }}
              onMouseLeave={(e) => {
                if (isLight) {
                  e.currentTarget.style.background = '#ffffff'
                  e.currentTarget.style.color = '#0f172a'
                } else if (isDark) {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.1)'
                } else {
                  e.currentTarget.style.background = 'rgba(118,75,162,0.35)'
                }
              }}
            >
              Tags{' '}
              <span style={{ fontSize: 11, opacity: 0.9, color: isLight ? '#0f172a' : undefined }}>▾</span>
            </button>
            {showTagsMenu && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: 4,
                  minWidth: 180,
                  width: 240,
                  maxHeight: 300,
                  overflowY: 'auto',
                  zIndex: 2147483647,
                  background: '#111827',
                  color: 'white',
                  border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: 8,
                  boxShadow: '0 10px 22px rgba(0,0,0,0.35)',
                }}
              >
                {triggers.length === 0 ? (
                  <div style={{ padding: '8px 10px', fontSize: 12, opacity: 0.8 }}>No tags yet</div>
                ) : (
                  triggers.map((trigger, i) => (
                    <div
                      key={i}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        padding: '6px 8px',
                        borderBottom: i < triggers.length - 1 ? '1px solid rgba(255,255,255,0.2)' : 'none',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(255,255,255,0.06)'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent'
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => handlePopupTriggerClick(trigger)}
                        style={{
                          flex: 1,
                          minWidth: 0,
                          textAlign: 'left',
                          padding: '2px 0',
                          fontSize: 12,
                          cursor: 'pointer',
                          background: 'transparent',
                          border: 'none',
                          color: 'inherit',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {trigger.name || trigger.command || `Trigger ${i + 1}`}
                      </button>
                      <button
                        type="button"
                        title="Delete trigger"
                        aria-label={`Delete trigger ${trigger.name || trigger.command || i + 1}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDeleteTrigger(i)
                        }}
                        style={{
                          width: 22,
                          height: 22,
                          flexShrink: 0,
                          border: 'none',
                          background: 'rgba(239,68,68,0.22)',
                          color: '#f87171',
                          borderRadius: 4,
                          cursor: 'pointer',
                          fontSize: 16,
                          lineHeight: 1,
                          padding: 0,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'rgba(239,68,68,0.45)'
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'rgba(239,68,68,0.22)'
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div ref={chatRef} style={{
        flex: 1, overflowY: 'auto', overflowX: 'hidden',
        padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px'
      }}>
        {messages.length === 0 && (
          <div style={{ opacity: 0.5, textAlign: 'center', padding: '20px', fontSize: '12px', color: colors.muted }}>
            Type a command to get started…
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} style={{
            maxWidth: '85%', padding: '10px 12px', borderRadius: '10px',
            fontSize: '12px', lineHeight: 1.45,
            alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
            wordBreak: 'break-word', overflowWrap: 'anywhere',
            background: msg.role === 'user' ? colors.userBubbleBg : colors.aiBubbleBg,
            border: msg.role === 'user' ? colors.userBubbleBorder : colors.aiBubbleBorder,
            color: colors.bubbleText
          }}>
            {msg.videoUrl && (
              <video
                src={msg.videoUrl}
                controls
                style={{ maxWidth: '100%', borderRadius: 6, display: 'block', marginBottom: msg.text ? 6 : 0 }}
              />
            )}
            {msg.imageUrl && !msg.videoUrl && (
              <img src={msg.imageUrl} alt="attachment" style={{ maxWidth: '100%', borderRadius: 6, display: 'block', marginBottom: msg.text ? 6 : 0 }} />
            )}
            {msg.text && <span style={{ whiteSpace: 'pre-wrap' }}>{msg.text}</span>}
          </div>
        ))}
        {isLoading && (
          <div style={{
            maxWidth: '85%', padding: '10px 12px', borderRadius: '10px',
            fontSize: '12px', alignSelf: 'flex-start',
            background: colors.aiBubbleBg, border: colors.aiBubbleBorder, color: colors.muted
          }}>
            ⏳ Thinking…
          </div>
        )}
      </div>

      {/* Pending doc indicator */}
      {pendingDoc && (
        <div style={{
          margin: '0 8px', padding: '6px 10px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8,
          background: colors.pendingBg, border: `1px solid ${colors.pendingBorder}`, color: colors.pendingText, fontSize: 11
        }}>
          <span>📎</span>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <strong>{pendingDoc.name}</strong> attached — type your question and Send
          </span>
          <button onClick={() => setPendingDoc(null)} style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px', color: 'inherit', fontSize: 13
          }}>×</button>
        </div>
      )}

      {/* Capture tag/command — same panel as docked sidepanel; only for this surface (popup vs dashboard) */}
      {showTriggerPrompt && (
        <div style={{
          padding: '12px 14px',
          background: isLight ? '#f8fafc' : 'rgba(0,0,0,0.35)',
          borderTop: isLight ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.20)',
        }}>
          <div style={{
            marginBottom: '8px',
            fontSize: '12px',
            fontWeight: 700,
            color: isLight ? '#0f172a' : captureLabelColor,
            opacity: isLight ? 1 : 1,
          }}>
            {showTriggerPrompt.mode === 'screenshot' ? '📸 Screenshot' : '🎥 Stream'}
          </div>
          {showTriggerPrompt.createTrigger && (
            <>
              <label
                htmlFor="wr-capture-trigger-name"
                style={{ display: 'block', fontSize: '11px', fontWeight: 600, marginBottom: 4, color: isLight ? '#475569' : 'rgba(255,255,255,0.70)' }}
              >
                Trigger Name
              </label>
              <input
                id="wr-capture-trigger-name"
                type="text"
                className="wr-capture-field"
                placeholder="Trigger Name"
                value={showTriggerPrompt.name || ''}
                onChange={(e) => setShowTriggerPrompt({ ...showTriggerPrompt, name: e.target.value })}
                onFocus={(e) => { e.currentTarget.style.border = captureBorderFocus }}
                onBlur={(e) => { e.currentTarget.style.border = captureBorderDefault }}
                style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '8px 10px',
                background: isLight ? '#ffffff' : 'rgba(255,255,255,0.12)',
                border: captureBorderDefault,
                color: isLight ? '#0f172a' : '#f8fafc',
                borderRadius: '6px',
                fontSize: '12px',
                marginBottom: '8px',
              }}
              />
            </>
          )}
          {showTriggerPrompt.addCommand && (
            <>
              <label
                htmlFor="wr-capture-optional-command"
                style={{ display: 'block', fontSize: '11px', fontWeight: 600, marginBottom: 4, color: isLight ? '#475569' : 'rgba(255,255,255,0.70)' }}
              >
                Optional Command
              </label>
              <textarea
                id="wr-capture-optional-command"
                className="wr-capture-field"
                placeholder="Optional Command"
                value={showTriggerPrompt.command || ''}
                onChange={(e) => setShowTriggerPrompt({ ...showTriggerPrompt, command: e.target.value })}
                onFocus={(e) => { e.currentTarget.style.border = captureBorderFocus }}
                onBlur={(e) => { e.currentTarget.style.border = captureBorderDefault }}
                style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '8px 10px',
                background: isLight ? '#ffffff' : 'rgba(255,255,255,0.12)',
                border: captureBorderDefault,
                color: isLight ? '#0f172a' : '#f8fafc',
                borderRadius: '6px',
                fontSize: '12px',
                minHeight: '60px',
                marginBottom: '8px',
                resize: 'vertical',
                fontFamily: 'inherit',
              }}
              />
            </>
          )}
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={() => setShowTriggerPrompt(null)}
              style={{
                padding: '6px 12px',
                background: isLight ? '#ffffff' : 'rgba(255,255,255,0.15)',
                border: isLight ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.25)',
                color: isLight ? '#0f172a' : '#ffffff',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={async () => {
                const name = showTriggerPrompt.name?.trim() || ''
                const command = showTriggerPrompt.command?.trim() || ''
                const mode = showTriggerPrompt.mode === 'stream' ? 'stream' : 'screenshot'
                const mediaUrl = mode === 'stream' ? showTriggerPrompt.videoUrl : showTriggerPrompt.imageUrl

                if (showTriggerPrompt.createTrigger) {
                  if (!name) {
                    alert('Please enter a trigger name')
                    return
                  }
                  const triggerData = {
                    name,
                    command,
                    at: Date.now(),
                    rect: showTriggerPrompt.rect,
                    bounds: showTriggerPrompt.bounds,
                    mode: showTriggerPrompt.mode,
                  }
                  try {
                    chrome.storage?.local?.get(['optimando-tagged-triggers'], (result: Record<string, unknown>) => {
                      const triggers = Array.isArray(result['optimando-tagged-triggers'])
                        ? [...(result['optimando-tagged-triggers'] as unknown[])]
                        : []
                      triggers.push(triggerData)
                      chrome.storage?.local?.set({ 'optimando-tagged-triggers': triggers }, () => {
                        setTriggers(triggers as any[])
                        try { chrome.runtime?.sendMessage({ type: 'TRIGGERS_UPDATED' }) } catch { /* noop */ }
                        try { window.dispatchEvent(new CustomEvent('optimando-triggers-updated')) } catch { /* noop */ }
                      })
                    })
                  } catch {
                    /* noop */
                  }
                  try {
                    chrome.runtime?.sendMessage({
                      type: 'ELECTRON_SAVE_TRIGGER',
                      name,
                      mode: showTriggerPrompt.mode,
                      rect: showTriggerPrompt.rect,
                      displayId: 0,
                      imageUrl: showTriggerPrompt.imageUrl,
                      videoUrl: showTriggerPrompt.videoUrl,
                      command: command || undefined,
                    })
                  } catch {
                    /* noop */
                  }
                }

                const triggerNameToUse = name || command
                const nameT = name.trim()
                const commandT = command.trim()
                const tagFromName = normaliseTriggerTag(nameT)
                const triggerTagFallback = normaliseTriggerTag(triggerNameToUse.trim())
                const displayForChat = commandT || (nameT ? nameT : '') || triggerTagFallback
                const routeForLlm = commandT || tagFromName || triggerTagFallback

                const shouldAutoProcess =
                  showTriggerPrompt.addCommand || (showTriggerPrompt.createTrigger && !!triggerNameToUse)

                // Invariant: one new user bubble per Save — combined text + image/video only here or in the non-auto branch below (never from ELECTRON_SELECTION_RESULT).
                if (shouldAutoProcess && triggerNameToUse && mediaUrl) {
                  setShowTriggerPrompt(null)
                  await sendWithTriggerAndImage(
                    displayForChat,
                    routeForLlm,
                    mediaUrl,
                    mode === 'stream' ? 'stream' : 'screenshot',
                  )
                } else if (mediaUrl) {
                  const caption =
                    (commandT || (nameT ? nameT : '') || tagFromName || (mode === 'stream' ? '[Stream]' : '[Screenshot]')).trim() ||
                    (mode === 'stream' ? '[Stream]' : '[Screenshot]')
                  if (mode === 'stream') {
                    setMessages(prev => [...prev, { role: 'user', text: caption, videoUrl: mediaUrl }])
                  } else {
                    setMessages(prev => [...prev, { role: 'user', text: caption, imageUrl: mediaUrl }])
                  }
                  setShowTriggerPrompt(null)
                  setTimeout(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight }, 0)
                } else {
                  setShowTriggerPrompt(null)
                }
              }}
              style={{
                padding: '6px 12px',
                background: '#22c55e',
                border: '1px solid #16a34a',
                color: '#0b1e12',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: 700,
              }}
            >
              Save
            </button>
          </div>
        </div>
      )}

      {/* Composer */}
      <div style={{
        padding: '8px 12px 12px', display: 'flex', flexDirection: 'column', gap: '8px',
        background: colors.composerBg, borderTop: colors.composerBorder
      }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
          {/* Hidden file input */}
          <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={handleFileChange} />

          {/* Attach button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            title="Attach file or PDF"
            style={{
              width: 44, height: 44, borderRadius: 8, flexShrink: 0, cursor: 'pointer',
              background: colors.btnBg, border: `1px solid ${colors.btnBorder}`, color: colors.btnText,
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18
            }}
          >
            📎
          </button>

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Start a conversation… or Command the Orchestrator… or Upload a BEAP™ Message"
            disabled={isLoading}
            style={{
              flex: 1, minHeight: 42, maxHeight: 120, resize: 'vertical',
              padding: '10px', borderRadius: 8, fontSize: 12, fontFamily: 'inherit', outline: 'none',
              background: colors.inputBg, border: colors.inputBorder, color: colors.inputText
            }}
          />

          {/* Send / model selector */}
          <div ref={modelDropdownRef} style={{ position: 'relative', display: 'flex', flexShrink: 0 }}>
            <button
              onClick={handleSend}
              disabled={!canSend}
              style={{
                height: 44, padding: '4px 14px', cursor: canSend ? 'pointer' : 'not-allowed',
                border: 'none', fontWeight: 700, fontSize: 13, transition: 'all 0.2s ease',
                background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)', color: '#052e16',
                borderRadius: onModelSelect ? '10px 0 0 10px' : '10px',
                opacity: canSend ? 1 : 0.65,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1
              }}
            >
              <span>{isLoading ? '…' : 'Run'}</span>
              {activeLlmModel && (
                <span style={{ fontSize: 9, opacity: 0.85, maxWidth: 70, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {activeLlmModel}
                </span>
              )}
            </button>

            {onModelSelect && onRefreshModels && (
              <>
                <button
                  onClick={async () => {
                    if (!showModelDropdown && onRefreshModels) await onRefreshModels()
                    setShowModelDropdown(s => !s)
                  }}
                  disabled={isLoading}
                  style={{
                    height: 44, padding: '4px 10px', border: 'none', fontWeight: 700, cursor: 'pointer',
                    background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)', color: '#052e16',
                    borderRadius: '0 10px 10px 0', borderLeft: '1px solid rgba(0,0,0,0.1)', minWidth: 36,
                    opacity: isLoading ? 0.65 : 1, fontSize: 13
                  }}
                >▾</button>

                {showModelDropdown && (
                  <div style={{
                    position: 'absolute', bottom: '100%', right: 0, marginBottom: 6,
                    background: isLight ? '#ffffff' : '#1e293b',
                    border: isLight ? '1px solid #e2e8f0' : '1px solid rgba(255,255,255,0.2)',
                    borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
                    zIndex: 1000, minWidth: 180, maxHeight: 220, overflowY: 'auto'
                  }}>
                    <div style={{
                      padding: '8px 12px', fontSize: 10, fontWeight: 700,
                      color: isLight ? '#475569' : 'rgba(255,255,255,0.7)',
                      borderBottom: isLight ? '1px solid #e2e8f0' : '1px solid rgba(255,255,255,0.1)'
                    }}>SELECT MODEL</div>
                    {noModels && (
                      <div style={{ padding: '10px 12px', fontSize: 11, color: colors.muted }}>
                        No models available. Install models in LLM Settings.
                      </div>
                    )}
                    {availableModels.map(m => (
                      <div
                        key={m.name}
                        onClick={() => { onModelSelect(m.name); setShowModelDropdown(false) }}
                        style={{
                          padding: '10px 12px', fontSize: 12, cursor: 'pointer',
                          color: isLight ? '#0f172a' : '#f1f5f9',
                          background: m.name === activeLlmModel ? 'rgba(34,197,94,0.12)' : 'transparent',
                          borderLeft: m.name === activeLlmModel ? '3px solid #22c55e' : '3px solid transparent'
                        }}
                      >{m.name}</div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default PopupChatView
