/**
 * PopupChatView
 *
 * Full-featured WR Chat for the popup window — mirrors the docked sidepanel's
 * chat pipeline exactly: LLM routing via processFlow, drag-and-drop with visual
 * overlay, orchestrator-side PDF extraction, pending-doc injection, OCR for images.
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { WrChatCaptureButton } from './WrChatCaptureButton'
import { WrChatDiffButton } from './WrChatDiffButton'
import { formatWatchdogAlert, type WatchdogThreat } from '../../utils/formatWatchdogAlert'
import { normaliseTriggerTag } from '../../utils/normaliseTriggerTag'
import { enrichRouteTextWithOcr } from '../../services/processFlow'
import { WRCHAT_APPEND_ASSISTANT_EVENT, useChatFocusStore } from '../../stores/chatFocusStore'
import { useUIStore } from '../../stores/useUIStore'
import { useCustomModesStore } from '../../stores/useCustomModesStore'
import { CustomModeWizard } from './CustomModeWizard'
import { WRCHAT_OPEN_CUSTOM_MODE_WIZARD_EVENT } from './wrMultiTrigger/WrMultiTriggerBar'
import type { LightboxTheme } from '../../shared/ui/lightboxTheme'
import { getChatFocusLlmPrefix } from '../../utils/chatFocusLlmPrefix'
import { prependHiddenContextToLastUserContent } from '../../utils/prependChatFocusToLastUser'
import ChatFocusBanner from './ChatFocusBanner'
import { mergeTaggedTriggersFromHost } from '../../utils/mergeTaggedTriggersFromHost'
import {
  toBase64ForOllama,
  isPlausibleVisionBase64,
  resolveImageUrlForBackend,
} from '../../utils/image-resolve'

const BASE_URL = 'http://127.0.0.1:51248'

function dashboardThemeToLightbox(theme: string): LightboxTheme {
  const t = theme.toLowerCase()
  if (t === 'dark') return 'dark'
  if (t === 'pro') return 'professional'
  if (t === 'standard') return 'default'
  return 'default'
}

/** One emoji per pinned slot (heart, football, …) — not pill buttons. */
const PINNED_TRIGGER_EMOJIS = [
  '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '🟤',
  '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤',
  '⭐', '🌟', '✨', '💫', '🔥', '⚡', '🌈',
  '🎯', '🎨', '🎸', '🎵', '🚀', '🌿', '🍀',
  '💡', '🔔', '🦋', '🌙', '☀️', '⚽', '🎮',
] as const

/** Derives a stable 0-based colour index from a trigger key string. */
function stableIndexForKey(key: string): number {
  let h = 0
  for (let i = 0; i < key.length; i++) {
    h = (Math.imul(31, h) + key.charCodeAt(i)) >>> 0
  }
  return h % PINNED_TRIGGER_EMOJIS.length
}

function emojiForTriggerKey(key: string): string {
  return PINNED_TRIGGER_EMOJIS[stableIndexForKey(key)] ?? '📌'
}

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
        if (chrome.runtime.lastError) {
          resolveViaHandshakeBridge(resolve)
        } else {
          const s = resp?.secret?.trim() ? resp.secret : null
          if (s) resolve(s)
          else resolveViaHandshakeBridge(resolve)
        }
      })
    } catch {
      // chrome.runtime not available (Electron dashboard) — use preload bridge directly.
      resolveViaHandshakeBridge(resolve)
    }
  })
}

/** Electron-only fallback: pull X-Launch-Secret from window.handshakeView.pqHeaders(). */
function resolveViaHandshakeBridge(resolve: (v: string | null) => void): void {
  try {
    const pqHeaders = (window as any).handshakeView?.pqHeaders
    if (typeof pqHeaders === 'function') {
      ;(pqHeaders() as Promise<Record<string, string>>)
        .then((h) => resolve(h?.['X-Launch-Secret']?.trim() || null))
        .catch(() => resolve(null))
    } else {
      resolve(null)
    }
  } catch {
    resolve(null)
  }
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

const LLM_FETCH_TIMEOUT_MS = 600_000

/**
 * Map chat UI messages to Ollama /api/llm/chat shape: attach vision base64 on
 * the last user message that has an image (not only top-level `images`).
 *
 * When `opts.isDashboard` is true the resolver uses the orchestrator HTTP
 * fallback for blob:/file: URLs that cannot be fetched cross-process.
 */
async function mapChatToLlmMessages(
  newMessages: ChatMessage[],
  secret: string | null,
  opts?: {
    /**
     * When callers already resolved + OCR'd the last user image (handleSend / sendWithTriggerAndImage),
     * pass it here to avoid duplicate /api/ocr/process + fetch (often saves several seconds per turn).
     */
    lastImagePrecomputed?: { resolvedDataUrl: string; ocrText: string }
    /** Pass true when running inside the Electron dashboard embed. */
    isDashboard?: boolean
  },
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
        const pre = opts?.lastImagePrecomputed
        const usePre = !!pre && idx === lastUserImageIdx
        // resolveImageUrlForBackend now returns null on failure instead of falling through.
        const resolved = usePre
          ? pre.resolvedDataUrl
          : await resolveImageUrlForBackend(msg.imageUrl, { secret, isDashboard: opts?.isDashboard })
        const ocr = usePre ? pre.ocrText : await runOcr(resolved ?? '', secret)
        const b64 = resolved ? toBase64ForOllama(resolved) : null
        const attachVision = idx === lastUserImageIdx && isPlausibleVisionBase64(b64)
        const images = attachVision && b64 ? [b64] : []
        console.log('[mapChatToLlm] idx:', idx, '| lastUserImageIdx:', lastUserImageIdx, '| resolved length:', resolved?.length ?? 0, '| b64 length:', b64?.length ?? 0, '| attachVision:', attachVision, '| images count:', images.length)
        const baseText = msg.text || 'Screenshot'
        const enrichedContent = ocr
          ? `${baseText}\n\n[OCR extracted text]:\n${ocr}`
          : images.length > 0
            ? `${baseText}\n\n[A screenshot is attached. Please analyse it and describe what you see.]`
            : baseText
        return {
          role: 'user',
          content: enrichedContent,
          ...(images.length > 0 ? { images } : {}),
        }
      }
      if (msg.videoUrl && msg.role === 'user') {
        return { role: 'user', content: `${msg.text || 'Video:'}\n[Video attached]` }
      }
      return { role: msg.role as string, content: msg.text ?? '' }
    }),
  )
}

function sliceMessagesFromLastUserImage(messages: ChatMessage[]): ChatMessage[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user' && messages[i].imageUrl) {
      return messages.slice(i)
    }
  }
  return messages
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
    const timeout = setTimeout(() => controller.abort(), 60_000)
    console.log('[runOcr] calling /api/ocr/process | image length:', imageUrl?.length ?? 0, '| starts with data::', imageUrl?.startsWith('data:'))
    const res: Response = await fetch(`${BASE_URL}/api/ocr/process`, {
      method: 'POST',
      headers: buildHeaders(secret),
      body: JSON.stringify({ image: imageUrl }),
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (!res.ok) {
      const errBody = await res.text().catch(() => res.statusText)
      console.warn('[runOcr] HTTP error:', res.status, errBody.slice(0, 300))
      return ''
    }
    const json = await res.json()
    if (!json.ok) {
      console.warn('[runOcr] OCR returned ok:false |', json.error || 'no error message')
      return ''
    }
    const text = json.data?.text ?? ''
    console.log('[runOcr] OCR result | text length:', text.length, '| confidence:', json.data?.confidence, '| method:', json.data?.method)
    return text
  } catch (err) {
    console.warn('[runOcr] exception:', err instanceof Error ? err.message : err)
    return ''
  }
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
  const [pendingCaptureUrl, setPendingCaptureUrl] = useState<string | null>(null)
  const [showModelDropdown, setShowModelDropdown] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  /** Saved area triggers — same storage key as docked WR Chat */
  const [triggers, setTriggers] = useState<any[]>([])
  const [anchoredTriggerKeys, setAnchoredTriggerKeys] = useState<string[]>([])
  const [pinnedDiffIds, setPinnedDiffIds] = useState<string[]>([])
  const [diffWatchers, setDiffWatchers] = useState<any[]>([])
  const [showTagsMenu, setShowTagsMenu] = useState(false)
  /** When false, skip persisting until localStorage transcript has been read (dashboard embed). */
  const [transcriptHydrated, setTranscriptHydrated] = useState(() => !persistTranscriptStorageKey)
  /** Electron header "Add Mode" dispatches WRCHAT_OPEN_CUSTOM_MODE_WIZARD_EVENT — docked UI uses ModeSelect instead. */
  const [addModeWizardOpen, setAddModeWizardOpen] = useState(false)
  const setWorkspace = useUIStore((s) => s.setWorkspace)
  const setMode = useUIStore((s) => s.setMode)
  const addMode = useCustomModesStore((s) => s.addMode)
  /** Capture tag/command prompt — same surface as sidepanel, filtered by promptContext (popup vs dashboard). */
  const [showTriggerPrompt, setShowTriggerPrompt] = useState<{
    mode: string
    rect: unknown
    /** Display from Electron overlay (required for headless replay on the correct monitor). */
    displayId?: number
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
  const diffMessageQueueRef = useRef<string[]>([])
  const handleDiffMessageRef = useRef<(message: string) => void>(() => {})
  const diffDialogOpenRef = useRef<(() => void) | null>(null)
  /** Set after `sendWithTriggerAndImage` — dashboard tag HTTP + IPC share this. */
  const runDashboardPendingCaptureRef = useRef<(dataUrl: string, kind?: string) => void>(() => {})
  /** Timestamp (ms) of the last time a dashboard trigger was auto-processed.
   *  Used to discard duplicate screenshot deliveries from the IPC + HTTP race. */
  const dashboardTriggerLastConsumedAt = useRef<number>(0)
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

  useEffect(() => {
    const onAppend = (ev: Event) => {
      const d = (ev as CustomEvent<{ text?: string }>).detail
      const t = (d?.text ?? '').trim()
      if (!t) return
      setMessages((prev) => [...prev, { role: 'assistant', text: t }])
      setTimeout(() => {
        if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
      }, 0)
    }
    window.addEventListener(WRCHAT_APPEND_ASSISTANT_EVENT, onAppend as EventListener)
    return () => window.removeEventListener(WRCHAT_APPEND_ASSISTANT_EVENT, onAppend as EventListener)
  }, [])

  useEffect(() => {
    const onOpenWizard = () => setAddModeWizardOpen(true)
    window.addEventListener(WRCHAT_OPEN_CUSTOM_MODE_WIZARD_EVENT, onOpenWizard)
    return () => window.removeEventListener(WRCHAT_OPEN_CUSTOM_MODE_WIZARD_EVENT, onOpenWizard)
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
    const KEYS = ['optimando-tagged-triggers', 'optimando-anchored-trigger-keys', 'optimando-pinned-diff-ids']
    const load = () => {
      try {
        chrome.storage?.local?.get(KEYS, (data: Record<string, unknown>) => {
          const list = Array.isArray(data?.['optimando-tagged-triggers'])
            ? (data['optimando-tagged-triggers'] as any[])
            : []
          setTriggers(list)
          const anchored = Array.isArray(data?.['optimando-anchored-trigger-keys'])
            ? (data['optimando-anchored-trigger-keys'] as string[])
            : []
          setAnchoredTriggerKeys(anchored)
          const diffPinned = Array.isArray(data?.['optimando-pinned-diff-ids'])
            ? (data['optimando-pinned-diff-ids'] as string[])
            : []
          setPinnedDiffIds(diffPinned)
        })
      } catch {
        setTriggers([])
      }
    }
    load()
    const onUpd = () => load()
    window.addEventListener('optimando-triggers-updated', onUpd)
    const onStorage: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (changes, area) => {
      if (area !== 'local') return
      if (changes['optimando-tagged-triggers'] || changes['optimando-anchored-trigger-keys'] || changes['optimando-pinned-diff-ids']) load()
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
    // Re-sync when the dashboard broadcasts a successful host-file write.
    const onHostSynced = () => { void mergeTaggedTriggersFromHost() }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('optimando-triggers-synced-to-host', onHostSynced)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('optimando-triggers-synced-to-host', onHostSynced)
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
          displayId: typeof message.displayId === 'number' ? message.displayId : undefined,
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
        displayId?: number
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
        displayId: typeof p?.displayId === 'number' ? p.displayId : undefined,
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
    dashboardTriggerLastConsumedAt.current = 0
    if (wrChatEmbedContext === 'dashboard') {
      void (async () => {
        try {
          const secret = await getLaunchSecret()
          const res = await fetch(`${BASE_URL}/api/lmgtfy/execute-trigger`, {
            method: 'POST',
            headers: buildHeaders(secret),
            body: JSON.stringify({ trigger, targetSurface: 'dashboard' }),
          })
          const json = (await res.json().catch(() => null)) as {
            ok?: boolean
            dataUrl?: string
            kind?: string
            error?: string
          } | null
          console.log('[WRChat][dashboard-trigger] execute-trigger response ok:', json?.ok, '| dataUrl length:', json?.dataUrl?.length ?? 0)
          if (json?.ok && json.dataUrl && (!json.kind || json.kind === 'image')) {
            // Mark as consumed so the IPC listener (which may also fire) discards its copy.
            dashboardTriggerLastConsumedAt.current = Date.now()
            const tr = pendingTriggerRef.current?.trigger ?? trigger
            const nameT = String(tr?.name ?? '').trim()
            const commandT = String(pendingTriggerRef.current?.command ?? tr?.command ?? '').trim()
            const tagFromName = normaliseTriggerTag(nameT)
            const routeForLlm = commandT || tagFromName
            const displayForChat = commandT || (nameT ? nameT : '') || tagFromName
            pendingTriggerRef.current = null
            const displayLine = (displayForChat || tagFromName || '[Screenshot]').trim()
            const routeLine = (routeForLlm || tagFromName).trim() || displayLine
            void sendWithTriggerAndImageRef.current?.(displayLine, routeLine, json.dataUrl, 'screenshot')
          } else {
            // Server returned an explicit failure or no dataUrl — show user feedback.
            const errorText = json?.error || (json?.ok === false ? 'Trigger capture failed' : 'No screenshot received from trigger')
            console.error('[WRChat][dashboard-trigger] failed:', errorText)
            pendingTriggerRef.current = null
            setMessages(prev => [...prev, {
              role: 'assistant' as const,
              text: `⚠️ Trigger capture failed: ${errorText}. Check that the Electron app is running and the trigger region is valid.`,
            }])
            scrollToBottom()
          }
        } catch (err: any) {
          console.error('[WRChat][dashboard-trigger] fetch error:', err)
          pendingTriggerRef.current = null
          setMessages(prev => [...prev, {
            role: 'assistant' as const,
            text: `⚠️ Trigger capture failed: ${err?.message || 'Network error'}. Is the WR Desk app running?`,
          }])
          scrollToBottom()
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
      // Signal the storage-fallback poller that a trigger is now in flight.
      try { window.dispatchEvent(new CustomEvent('optimando-trigger-dispatched')) } catch { /* noop */ }
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

  /** Stable key for a trigger used as the anchor identifier. */
  const triggerAnchorKey = useCallback((t: any): string => {
    try {
      return String(t?.name ?? t?.command ?? '').trim() || JSON.stringify(t).slice(0, 60)
    } catch {
      return 'trigger'
    }
  }, [])

  const handleToggleAnchor = useCallback(
    (trigger: any) => {
      const key = triggerAnchorKey(trigger)
      setAnchoredTriggerKeys((prev) => {
        const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
        try {
          chrome.storage?.local?.set({ 'optimando-anchored-trigger-keys': next })
        } catch { /* noop */ }
        return next
      })
    },
    [triggerAnchorKey],
  )

  const handleToggleDiffPin = useCallback((id: string) => {
    setPinnedDiffIds((prev) => {
      const next = prev.includes(id) ? prev.filter((k) => k !== id) : [...prev, id]
      try {
        chrome.storage?.local?.set({ 'optimando-pinned-diff-ids': next })
      } catch { /* noop */ }
      return next
    })
  }, [])

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

    // Manual screenshot capture (dashboard Capture button) — treat as image attachment
    const captureUrl = pendingCaptureUrl
    if (captureUrl) setPendingCaptureUrl(null)

    const lastUserMsgWithImage = [...messages].reverse().find(m => m.role === 'user' && m.imageUrl)
    const currentTurnImageUrl = captureUrl || lastUserMsgWithImage?.imageUrl
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

    const userDisplayText = text || (captureUrl ? '📸 Screenshot' : docCtx ? `📄 ${docCtx.name}` : '')
    // When a manual capture is attached, embed imageUrl directly in the user message bubble.
    const newMessages: ChatMessage[] = userDisplayText
      ? [...messages, captureUrl
          ? { role: 'user' as const, text: userDisplayText, imageUrl: captureUrl }
          : { role: 'user' as const, text: userDisplayText }
        ]
      : [...messages]

    setMessages(newMessages)
    setInput('')
    setIsLoading(true)
    scrollToBottom()

    try {
      const secret = await ensureLaunchSecret(secretRef)
      const isDashboard = wrChatEmbedContext === 'dashboard'
      // OCR for image if present
      let resolvedImg: string | null = null
      let ocrText = ''
      if (hasImage && currentTurnImageUrl) {
        resolvedImg = await resolveImageUrlForBackend(currentTurnImageUrl, { secret, isDashboard })
        ocrText = await runOcr(resolvedImg ?? '', secret)
      }

      // For dashboard + screenshot, build a fresh 2-message payload (matching sidepanel's
      // handleSendMessageWithTrigger). For all other cases, build processedMessages as before.
      const useFreshPayload = isDashboard && hasImage

      const visionB64ForSend: string | null = (() => {
        if (!hasImage || !resolvedImg) return null
        const b64 = toBase64ForOllama(resolvedImg)
        return isPlausibleVisionBase64(b64) ? b64 : null
      })()

      const llmSourceMessages =
        isDashboard && hasImage ? sliceMessagesFromLastUserImage(newMessages) : newMessages

      const [processedMessagesRaw, processFlow] = await Promise.all([
        useFreshPayload
          ? Promise.resolve([])
          : mapChatToLlmMessages(
              llmSourceMessages,
              secret,
              hasImage && currentTurnImageUrl && resolvedImg
                ? { lastImagePrecomputed: { resolvedDataUrl: resolvedImg, ocrText }, isDashboard }
                : { isDashboard },
            ),
        import('../../services/processFlow'),
      ])
      let processedMessages = processedMessagesRaw

      // Inject doc content into last user message (only for non-fresh-payload path)
      if (docCtx && !useFreshPayload) {
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

      // When user typed nothing (screenshot-only send), use OCR text so agent tags in the image can match
      const effectiveLlmText = llmText || ocrText || (hasImage ? '[screenshot]' : '')
      const enrichedText = enrichRouteTextWithOcr(effectiveLlmText, ocrText)
      const focusPrefix = getChatFocusLlmPrefix(useChatFocusStore.getState())
      const enrichedForRoute = focusPrefix ? `${focusPrefix}\n\n${enrichedText}` : enrichedText

      if (focusPrefix && !useFreshPayload) {
        processedMessages = prependHiddenContextToLastUserContent(processedMessages, focusPrefix)
      }

      const freshUserMessage: Record<string, unknown> | null = useFreshPayload
        ? { role: 'user', content: enrichedForRoute, ...(visionB64ForSend ? { images: [visionB64ForSend] } : {}) }
        : null

      // Try routing via processFlow agents, fall back to Butler
      let answered = false
      try {
        const { routeInput, wrapInputForAgent, updateAgentBoxOutput, loadAgentsFromSession, getButlerSystemPrompt: _getButler } = processFlow

        let currentUrl = ''
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
          currentUrl = tab?.url || ''
        } catch {}

        const routingDecision = await routeInput(
          enrichedForRoute,
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
            const agentConfig = allAgents.find((a: any) => a.id === match.agentId)
            const effectiveInput = llmText || ocrText || '[screenshot]'
            const agentInput = agentConfig
              ? wrapInputForAgent(effectiveInput, agentConfig, ocrText)
              : enrichedForRoute

            const agentMessages = useFreshPayload
              ? [{ role: 'system', content: agentInput }, freshUserMessage!]
              : [
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
              const agentReply = (agentJson.ok && agentJson.data?.content) ? agentJson.data.content : ''
              if (agentReply) {
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
        const { getButlerSystemPrompt } = processFlow
        const agentCount = 0
        const butlerPrompt = getButlerSystemPrompt(sessionName, agentCount, isConnected)
        const butlerMessages = useFreshPayload
          ? [{ role: 'system', content: butlerPrompt }, freshUserMessage!]
          : [{ role: 'system', content: butlerPrompt }, ...processedMessages]
        console.log('[handleSend] butler call | model:', modelId,
          '| freshPayload:', useFreshPayload,
          '| contentLength:', enrichedText?.length,
          '| ocrText:', ocrText.length,
          '| has vision:', !!visionB64ForSend,
          '| msg count:', butlerMessages.length,
          '| secret:', !!secret)
        const butlerRes: Response = await fetch(`${BASE_URL}/api/llm/chat`, {
          method: 'POST',
          headers: buildHeaders(secret),
          body: JSON.stringify({
            modelId: modelId,
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
  }, [input, messages, pendingDoc, pendingCaptureUrl, activeLlmModel, availableModels, isLoading, isConnected, sessionName, wrChatEmbedContext])

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
        const isDashboard = wrChatEmbedContext === 'dashboard'
        let resolvedMedia: string | null = null
        let ocrText = ''
        if (!isVideo && mediaUrl) {
          resolvedMedia = await resolveImageUrlForBackend(mediaUrl, { secret, isDashboard })
          console.log('[sendWithTriggerAndImage] resolvedMedia length:', resolvedMedia?.length ?? 0, '| secret present:', !!secret, '| isDashboard:', isDashboard)
          ocrText = await runOcr(resolvedMedia ?? '', secret)
          console.log('[sendWithTriggerAndImage] ocrText length:', ocrText.length)
        }
        // When routeText is empty (manual capture from Capture button), use OCR text for routing so
        // agent tags embedded in the screenshot can be matched. Fall back to a generic hint.
        const hasImage = !isVideo && !!mediaUrl
        const effectiveRouteText = routeText || ocrText || (hasImage ? '[screenshot]' : '')
        const enrichedText = enrichRouteTextWithOcr(effectiveRouteText, ocrText)
        const focusPrefixTrig = getChatFocusLlmPrefix(useChatFocusStore.getState())
        const enrichedForRouteTrig = focusPrefixTrig ? `${focusPrefixTrig}\n\n${enrichedText}` : enrichedText

        // Pre-compute validated vision base64 for LLM calls (same as sidepanel's triggerVisionB64).
        const visionB64: string | null = (() => {
          if (!hasImage || !resolvedMedia) return null
          const b64 = toBase64ForOllama(resolvedMedia)
          return isPlausibleVisionBase64(b64) ? b64 : null
        })()

        // For dashboard + screenshot flows, build a fresh single user message (matching
        // sidepanel's handleSendMessageWithTrigger) instead of forwarding accumulated
        // conversation history via processedMessages. This prevents stale context from
        // watchdog alerts, prior captures, or agent responses contaminating the LLM input.
        // processedMessages is still built for popup context (which has no persistent state).
        const useFreshPayload = isDashboard && hasImage

        const llmSourceMessages =
          isDashboard && hasImage ? sliceMessagesFromLastUserImage(newMessages) : newMessages

        // NOTE: processedMessages is used for popup context and for non-image flows.
        // For dashboard screenshot+command flows we use a fresh 2-message payload below.
        const [processedMessagesRaw, processFlow] = await Promise.all([
          useFreshPayload
            ? Promise.resolve([])
            : mapChatToLlmMessages(
                llmSourceMessages,
                secret,
                !isVideo && mediaUrl && resolvedMedia
                  ? { lastImagePrecomputed: { resolvedDataUrl: resolvedMedia, ocrText }, isDashboard }
                  : { isDashboard },
              ),
          import('../../services/processFlow'),
        ])

        let processedMessages = processedMessagesRaw
        if (focusPrefixTrig && !useFreshPayload) {
          processedMessages = prependHiddenContextToLastUserContent(processedMessages, focusPrefixTrig)
        }

        if (!useFreshPayload) {
          const imagesInMessages = processedMessages.filter(m => (m as any).images?.length > 0).length
          console.log('[sendWithTriggerAndImage] processedMessages count:', processedMessages.length, '| messages with images:', imagesInMessages)
        }

        // Build the fresh user message once — reused by both agent and butler paths when
        const freshUserMessage: Record<string, unknown> | null = useFreshPayload
          ? { role: 'user', content: enrichedForRouteTrig, ...(visionB64 ? { images: [visionB64] } : {}) }
          : null

        let answered = false
        try {
          const { routeInput, wrapInputForAgent, updateAgentBoxOutput, loadAgentsFromSession } = processFlow
          let currentUrl = ''
          try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
            currentUrl = tab?.url || ''
          } catch {
            /* noop */
          }

          const routingDecision = await routeInput(
            enrichedForRouteTrig,
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
              const effectiveRouteText = routeText || ocrText || displayText
              const agentInput = agentConfig ? wrapInputForAgent(effectiveRouteText, agentConfig, ocrText) : enrichedForRouteTrig
              const agentMessages = useFreshPayload
                ? [{ role: 'system', content: agentInput }, freshUserMessage!]
                : [
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
          const { getButlerSystemPrompt } = processFlow
          const butlerPrompt = getButlerSystemPrompt(sessionName, 0, isConnected)
          const butlerMessages = useFreshPayload
            ? [{ role: 'system', content: butlerPrompt }, freshUserMessage!]
            : [{ role: 'system', content: butlerPrompt }, ...processedMessages]
          console.log('[sendWithTriggerAndImage] butler call | model:', modelId,
            '| freshPayload:', useFreshPayload,
            '| contentLength:', enrichedForRouteTrig?.length,
            '| ocrText:', ocrText.length,
            '| has vision:', !!visionB64,
            '| msg count:', butlerMessages.length,
            '| secret:', !!secret)
          const butlerRes: Response = await fetch(`${BASE_URL}/api/llm/chat`, {
            method: 'POST',
            headers: buildHeaders(secret),
            body: JSON.stringify({
              modelId: modelId,
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

  /** Folder diff from Electron — same LLM path as sendWithTriggerAndImage, text-only (no image). */
  const processDiffMessage = useCallback(
    async (message: string) => {
      const text = (message ?? '').trim()
      if (!text) return

      const modelId = resolveModelIdForChat(activeLlmModel, availableModels)
      if (!modelId) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            text: `⚠️ No LLM model available. Please go to Admin panel → LLM Settings and install a model.`,
          },
        ])
        return
      }

      const userMsg: ChatMessage = { role: 'user', text }
      const newMessages = [...messages, userMsg]
      setMessages(newMessages)
      setInput('')
      setIsLoading(true)
      scrollToBottom()

      try {
        const secret = await ensureLaunchSecret(secretRef)
        const isDashboard = wrChatEmbedContext === 'dashboard'
        const enrichedText = enrichRouteTextWithOcr(text, '')
        const focusPrefixDiff = getChatFocusLlmPrefix(useChatFocusStore.getState())
        const enrichedForRouteDiff = focusPrefixDiff ? `${focusPrefixDiff}\n\n${enrichedText}` : enrichedText
        const hasImage = false

        const [processedMessagesRaw, processFlow] = await Promise.all([
          mapChatToLlmMessages(newMessages, secret, { isDashboard }),
          import('../../services/processFlow'),
        ])

        let processedMessages = processedMessagesRaw
        if (focusPrefixDiff) {
          processedMessages = prependHiddenContextToLastUserContent(processedMessages, focusPrefixDiff)
        }

        let answered = false
        try {
          const { routeInput, wrapInputForAgent, updateAgentBoxOutput, loadAgentsFromSession } = processFlow
          let currentUrl = ''
          try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
            currentUrl = tab?.url || ''
          } catch {
            /* noop */
          }

          const routingDecision = await routeInput(
            enrichedForRouteDiff,
            hasImage,
            { isConnected },
            sessionName,
            modelId,
            currentUrl,
          )

          if (routingDecision.shouldForwardToAgent && routingDecision.matchedAgents.length > 0) {
            if (routingDecision.butlerResponse) {
              setMessages((prev) => [...prev, { role: 'assistant', text: routingDecision.butlerResponse }])
            }
            let allAgents: any[] = []
            try {
              allAgents = await loadAgentsFromSession()
            } catch {
              /* noop */
            }
            for (const match of routingDecision.matchedAgents) {
              const agentConfig = allAgents.find((a: any) => a.id === match.agentId)
              const agentInput = agentConfig ? wrapInputForAgent(text, agentConfig, '') : enrichedForRouteDiff
              const agentMessages = [
                { role: 'system', content: agentInput },
                ...processedMessages.filter((m) => m.role === 'user'),
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
                    setMessages((prev) => [...prev, { role: 'assistant', text: confirm }])
                  } else {
                    setMessages((prev) => [
                      ...prev,
                      {
                        role: 'assistant',
                        text: `${match.agentIcon} **${match.agentName}**:\n\n${agentReply}`,
                      },
                    ])
                  }
                  answered = true
                }
              }
            }
          }
        } catch (e) {
          console.warn('[PopupChat] handleDiffMessage agent routing failed:', e)
        }

        if (!answered) {
          const { getButlerSystemPrompt } = processFlow
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
              setMessages((prev) => [...prev, { role: 'assistant', text: butlerReply }])
            } else {
              setMessages((prev) => [
                ...prev,
                {
                  role: 'assistant',
                  text: `⚠️ LLM returned an empty response. The model may still be loading — please try again.`,
                },
              ])
            }
          } else {
            const errText = await butlerRes.text().catch(() => butlerRes.statusText)
            setMessages((prev) => [
              ...prev,
              { role: 'assistant', text: `❌ LLM error (${butlerRes.status}): ${errText}` },
            ])
          }
        }
      } catch (err: any) {
        console.error('[PopupChat] handleDiffMessage error:', err)
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', text: `❌ Error: ${err?.message || 'Unknown error'}` },
        ])
      } finally {
        setIsLoading(false)
        scrollToBottom()
      }
    },
    [messages, activeLlmModel, availableModels, isConnected, sessionName, wrChatEmbedContext],
  )

  const handleDiffMessage = useCallback(
    (message: string) => {
      const text = (message ?? '').trim()
      if (!text) return
      if (isLoading) {
        diffMessageQueueRef.current.push(text)
        return
      }
      void processDiffMessage(text).catch((err) => {
        console.error('[PopupChat] processDiffMessage:', err)
      })
    },
    [isLoading, processDiffMessage],
  )
  handleDiffMessageRef.current = handleDiffMessage

  /** Watchdog: show pre-computed threat analysis as an assistant bubble (no extra LLM call). */
  const handleWatchdogAlert = useCallback((threats: WatchdogThreat[]) => {
    const alertMessage = formatWatchdogAlert(threats)
    setMessages((prev) => [
      ...prev,
      {
        role: 'assistant' as const,
        text: alertMessage,
        timestamp: Date.now(),
      },
    ])
    scrollToBottom()
  }, [])
  const handleWatchdogAlertRef = useRef(handleWatchdogAlert)
  handleWatchdogAlertRef.current = handleWatchdogAlert

  useEffect(() => {
    if (isLoading) return
    const next = diffMessageQueueRef.current.shift()
    if (next) {
      void processDiffMessage(next).catch((err) => {
        console.error('[PopupChat] processDiffMessage (queued):', err)
      })
    }
  }, [isLoading, processDiffMessage])

  sendWithTriggerAndImageRef.current = sendWithTriggerAndImage

  runDashboardPendingCaptureRef.current = (dataUrl: string, kind?: string) => {
    if (kind === 'video' || kind === 'stream') return
    if (!dataUrl || !dataUrl.startsWith('data:')) {
      console.error('[WRChat][dashboard-trigger] runDashboardPendingCapture: invalid or missing dataUrl (length:', dataUrl?.length ?? 0, ')')
      setMessages(prev => [...prev, {
        role: 'assistant' as const,
        text: '⚠️ Trigger capture failed — the screenshot data was empty or invalid.',
      }])
      scrollToBottom()
      return
    }
    console.log('[WRChat][dashboard-trigger] runDashboardPendingCapture: dataUrl length:', dataUrl.length)
    const pending = pendingTriggerRef.current
    if (!pending?.autoProcess) {
      // pendingTriggerRef is null — either the HTTP path already processed this trigger
      // (dashboardTriggerLastConsumedAt was set), or this is a genuine manual Capture.
      const msSinceConsumed = Date.now() - dashboardTriggerLastConsumedAt.current
      if (msSinceConsumed < 10_000) {
        // HTTP path already handled it — discard IPC duplicate silently.
        console.log('[WRChat][dashboard-capture] IPC duplicate discarded — trigger consumed', msSinceConsumed, 'ms ago')
        return
      }
      // Dashboard manual capture should not append a user bubble yet. The dashboard
      // always opens the trigger prompt after Capture, and Save should produce the
      // single combined user bubble (image + command) via sendWithTriggerAndImage.
      // Keep a fallback pending attachment so direct Send still works if the prompt
      // is dismissed or never appears.
      console.log('[WRChat][dashboard-capture] no pending trigger — storing pending capture for prompt / direct send')
      dashboardTriggerLastConsumedAt.current = Date.now()
      setPendingCaptureUrl(dataUrl)
      return
    }
    const tr = pending.trigger
    const nameT = String(tr?.name ?? '').trim()
    const commandT = String(pending.command ?? tr?.command ?? '').trim()
    const tagFromName = normaliseTriggerTag(nameT)
    const routeForLlm = commandT || tagFromName
    const displayForChat = commandT || (nameT ? nameT : '') || tagFromName
    pendingTriggerRef.current = null
    dashboardTriggerLastConsumedAt.current = Date.now()
    const displayLine = (displayForChat || tagFromName || '[Screenshot]').trim()
    const routeLine = (routeForLlm || tagFromName).trim() || displayLine
    // dataUrl is already a resolved data: URL — passes straight through resolveImageUrlForBackend.
    void sendWithTriggerAndImageRef.current?.(displayLine, routeLine, dataUrl, 'screenshot')
  }

  processPopupElectronSelectionRef.current = (message: {
    promptContext?: string
    dataUrl?: string
    url?: string
  }) => {
    const pc = message.promptContext
    if (pc !== undefined && pc !== 'popup') return
    const url = message.dataUrl || message.url
    if (!url) return
    // Require a resolved data: URL — reject blob:, file:, or raw paths that
    // could cause [img-0] errors downstream. resolveImageUrlForBackend in
    // sendWithTriggerAndImage provides a second gate but this keeps parity
    // with the sidepanel's processElectronSelectionForTagsRef.
    if (!url.startsWith('data:')) {
      console.error('[WRChat][popup-trigger] received non-data: URL from trigger result — discarding', url.slice(0, 80))
      pendingTriggerRef.current = null
      try { window.dispatchEvent(new CustomEvent('optimando-trigger-result-received')) } catch { /* noop */ }
      setMessages(prev => [...prev, {
        role: 'assistant' as const,
        text: '⚠️ Trigger capture failed — screenshot was not a valid image. Please try again.',
      }])
      scrollToBottom()
      return
    }
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
    // Cancel the poll+timeout in the storage-fallback effect since we have the result now.
    try { window.dispatchEvent(new CustomEvent('optimando-trigger-result-received')) } catch { /* noop */ }
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

  // Storage-fallback delivery for trigger results:
  //   - Fires on chrome.storage.onChanged (covers SW sleep / popup re-open race).
  //   - Also checks on mount so a result written before the popup opened is consumed.
  //   - Enforces a 30-second TTL (entries with ts older than 30 s are discarded).
  //   - While a trigger is pending, polls every 500 ms and times out after 15 s.
  useEffect(() => {
    if (wrChatEmbedContext === 'dashboard') return
    const KEY = 'optimando-wrchat-selection-fallback'
    const STALE_MS = 30_000
    const TRIGGER_TIMEOUT_MS = 15_000
    const POLL_MS = 500

    let triggerPendingAt: number | null = null
    let pollInterval: ReturnType<typeof setInterval> | null = null
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null

    function clearPollAndTimeout() {
      if (pollInterval !== null) { clearInterval(pollInterval); pollInterval = null }
      if (timeoutHandle !== null) { clearTimeout(timeoutHandle); timeoutHandle = null }
      triggerPendingAt = null
    }

    function consumeFallbackEntry(entry: unknown) {
      if (!entry || typeof entry !== 'object') return false
      const rec = entry as { ts?: number; dataUrl?: string; promptContext?: string; url?: string; kind?: string }
      // TTL check — ignore entries older than STALE_MS.
      if (typeof rec.ts === 'number' && Date.now() - rec.ts > STALE_MS) {
        void chrome.storage.local.remove(KEY)
        return false
      }
      void chrome.storage.local.remove(KEY)
      clearPollAndTimeout()
      processPopupElectronSelectionRef.current(rec)
      return true
    }

    function checkStorage() {
      try {
        chrome.storage.local.get([KEY], (data: Record<string, unknown>) => {
          if (data?.[KEY]) consumeFallbackEntry(data[KEY])
        })
      } catch { /* noop */ }
    }

    // On-mount check — picks up results written before this popup instance existed.
    checkStorage()

    // onChanged fires synchronously whenever the value changes — most reliable delivery path.
    const onStorageChanged = (changes: chrome.storage.StorageChange, area: string) => {
      if (area !== 'local' || !changes[KEY]?.newValue) return
      consumeFallbackEntry(changes[KEY].newValue)
    }
    try { chrome.storage.onChanged.addListener(onStorageChanged) } catch { /* noop */ }

    // Listen for when a trigger is dispatched so we can start the poll + timeout.
    const onTriggerDispatched = () => {
      triggerPendingAt = Date.now()
      if (pollInterval !== null) clearInterval(pollInterval)
      pollInterval = setInterval(checkStorage, POLL_MS)
      if (timeoutHandle !== null) clearTimeout(timeoutHandle)
      timeoutHandle = setTimeout(() => {
        clearPollAndTimeout()
        // Only show timeout message if pendingTriggerRef still has an entry
        // (i.e. nothing consumed it via sendMessage path either).
        if (pendingTriggerRef.current?.autoProcess) {
          pendingTriggerRef.current = null
          setMessages(prev => [...prev, {
            role: 'assistant' as const,
            text: '⚠️ Trigger timed out — no screenshot was received within 15 seconds. Is the WR Desk app running?',
          }])
          scrollToBottom()
        }
      }, TRIGGER_TIMEOUT_MS)
    }
    window.addEventListener('optimando-trigger-dispatched', onTriggerDispatched)

    // Cancel the poll+timeout when a result arrives via the runtime sendMessage path.
    const onTriggerResultReceived = () => clearPollAndTimeout()
    window.addEventListener('optimando-trigger-result-received', onTriggerResultReceived)

    return () => {
      clearPollAndTimeout()
      try { chrome.storage.onChanged.removeListener(onStorageChanged) } catch { /* noop */ }
      window.removeEventListener('optimando-trigger-dispatched', onTriggerDispatched)
      window.removeEventListener('optimando-trigger-result-received', onTriggerResultReceived)
    }
  }, [wrChatEmbedContext]) // eslint-disable-line react-hooks/exhaustive-deps

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
      if (!url) return
      if (p?.kind && p.kind !== 'image') return
      runDashboardPendingCaptureRef.current(url, p?.kind || 'image')
    })
    return () => {
      try {
        unsub()
      } catch {
        /* noop */
      }
    }
  }, [wrChatEmbedContext])

  // Dashboard embed: IPC relay for folder-diff results (chrome.runtime unavailable in Electron webview).
  useEffect(() => {
    if (wrChatEmbedContext !== 'dashboard') return
    const bridge = (
      typeof window !== 'undefined'
        ? (window as Window & {
            LETmeGIRAFFETHATFORYOU?: { onDashboardDiffResult?: (cb: (p: unknown) => void) => () => void }
          }).LETmeGIRAFFETHATFORYOU
        : undefined
    )
    if (!bridge?.onDashboardDiffResult) return
    const unsub = bridge.onDashboardDiffResult((payload: unknown) => {
      const p = payload as { message?: string }
      const msg = p?.message
      if (typeof msg !== 'string' || !msg.trim()) return
      handleDiffMessageRef.current(msg)
    })
    return () => {
      try { unsub() } catch { /* noop */ }
    }
  }, [wrChatEmbedContext])

  // Dashboard embed: IPC relay for Watchdog threats (same pattern as onDashboardDiffResult).
  useEffect(() => {
    if (wrChatEmbedContext !== 'dashboard') return
    const bridge = (
      typeof window !== 'undefined'
        ? (window as Window & {
            LETmeGIRAFFETHATFORYOU?: { onDashboardWatchdogAlert?: (cb: (p: unknown) => void) => () => void }
          }).LETmeGIRAFFETHATFORYOU
        : undefined
    )
    if (!bridge?.onDashboardWatchdogAlert) return
    const unsub = bridge.onDashboardWatchdogAlert((payload: unknown) => {
      const p = payload as { threats?: unknown[] }
      const threats = p?.threats
      if (!Array.isArray(threats) || threats.length === 0) return
      handleWatchdogAlertRef.current(threats as WatchdogThreat[])
    })
    return () => {
      try { unsub() } catch { /* noop */ }
    }
  }, [wrChatEmbedContext])

  // Dashboard: header Watchdog (App.tsx) dispatches this — same handler as IPC path.
  useEffect(() => {
    if (wrChatEmbedContext !== 'dashboard') return
    const onWinAlert = (ev: Event) => {
      try {
        const ce = ev as CustomEvent
        const threats = ce.detail
        if (!Array.isArray(threats) || threats.length === 0) return
        handleWatchdogAlertRef.current(threats as WatchdogThreat[])
      } catch {
        /* never throw from alert UI */
      }
    }
    window.addEventListener('wrchat-watchdog-alert', onWinAlert as EventListener)
    return () => {
      try {
        window.removeEventListener('wrchat-watchdog-alert', onWinAlert as EventListener)
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
    setPendingCaptureUrl(null)
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
  const canSend = !isLoading && (!!input.trim() || !!pendingDoc || !!pendingCaptureUrl)

  const pinnedTriggersOnEdge = useMemo(() => {
    try {
      if (!Array.isArray(triggers) || anchoredTriggerKeys.length === 0) return []
      return triggers.filter((t) => {
        try {
          return anchoredTriggerKeys.includes(triggerAnchorKey(t))
        } catch {
          return false
        }
      })
    } catch {
      return []
    }
  }, [triggers, anchoredTriggerKeys, triggerAnchorKey])

  const pinnedDiffWatchers = useMemo(
    () => (Array.isArray(diffWatchers) ? diffWatchers.filter((w) => pinnedDiffIds.includes(w?.id ?? '')) : []),
    [diffWatchers, pinnedDiffIds],
  )

  const hasAnyPinnedEdgeItems = pinnedTriggersOnEdge.length > 0 || pinnedDiffWatchers.length > 0

  const captureSource = useMemo(
    () => (wrChatEmbedContext === 'dashboard' ? 'wr-chat-dashboard' : 'wr-chat-popup'),
    [wrChatEmbedContext],
  )

  const captureBorderDefault = isLight ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.45)'
  const captureBorderFocus = isLight ? '1px solid #6366f1' : '1px solid rgba(255,255,255,0.80)'
  const captureLabelColor = isLight ? '#475569' : 'rgba(255,255,255,0.70)'

  return (
    <>
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
          <WrChatDiffButton variant="comfortable" theme={theme} onDiffMessage={handleDiffMessage} pinnedDiffIds={pinnedDiffIds} onToggleDiffPin={handleToggleDiffPin} onWatchersChange={setDiffWatchers} openDialogRef={diffDialogOpenRef} />
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
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
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
            {/* Trash / eraser icon */}
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
              <polyline points="3 6 5 6 21 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M10 11v6M14 11v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Clear
          </button>
          <div ref={tagsMenuRef} style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => {
                const opening = !showTagsMenu
                setShowTagsMenu(opening)
                if (opening) void mergeTaggedTriggersFromHost()
              }}
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
              {/* Tag / label icon */}
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="7" cy="7" r="1.5" fill="currentColor" />
              </svg>
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
                        gap: 4,
                        padding: '5px 8px',
                        borderBottom: i < triggers.length - 1 ? '1px solid rgba(255,255,255,0.12)' : 'none',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(255,255,255,0.06)'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent'
                      }}
                    >
                      {/* Pin / anchor icon */}
                      <button
                        type="button"
                        title={anchoredTriggerKeys.includes(triggerAnchorKey(trigger)) ? 'Remove icon from top edge' : 'Show icon shortcut at top edge of chat'}
                        onClick={(e) => { e.stopPropagation(); handleToggleAnchor(trigger) }}
                        style={{
                          width: 22,
                          height: 20,
                          flexShrink: 0,
                          border: 'none',
                          borderRadius: 4,
                          cursor: 'pointer',
                          fontSize: 13,
                          padding: 0,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: anchoredTriggerKeys.includes(triggerAnchorKey(trigger))
                            ? 'rgba(99,102,241,0.45)'
                            : 'rgba(255,255,255,0.08)',
                          color: anchoredTriggerKeys.includes(triggerAnchorKey(trigger)) ? '#a5b4fc' : 'rgba(255,255,255,0.5)',
                          transition: 'background 0.15s',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(99,102,241,0.35)' }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = anchoredTriggerKeys.includes(triggerAnchorKey(trigger))
                            ? 'rgba(99,102,241,0.45)'
                            : 'rgba(255,255,255,0.08)'
                        }}
                      >
                        {anchoredTriggerKeys.includes(triggerAnchorKey(trigger))
                          ? emojiForTriggerKey(triggerAnchorKey(trigger))
                          : '◎'}
                      </button>
                      {/* Trigger name / run button */}
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
                      {/* Delete button */}
                      <button
                        type="button"
                        title="Delete trigger"
                        aria-label={`Delete trigger ${trigger.name || trigger.command || i + 1}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDeleteTrigger(i)
                        }}
                        style={{
                          width: 20,
                          height: 20,
                          flexShrink: 0,
                          border: 'none',
                          background: 'rgba(239,68,68,0.22)',
                          color: '#f87171',
                          borderRadius: 4,
                          cursor: 'pointer',
                          fontSize: 15,
                          lineHeight: 1,
                          padding: 0,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239,68,68,0.45)' }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(239,68,68,0.22)' }}
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

      {/* Messages area with top-edge icon strip for pinned triggers */}
      <div
        ref={chatRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          position: 'relative',
          minHeight: 0,
          paddingTop: hasAnyPinnedEdgeItems ? 42 : 12,
        }}
      >
        <ChatFocusBanner theme={theme} />
        {hasAnyPinnedEdgeItems && (
          <div
            role="toolbar"
            aria-label="Pinned tag shortcuts"
            style={{
              position: 'absolute',
              top: 4,
              left: 8,
              right: 8,
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              flexWrap: 'nowrap',
              gap: 6,
              zIndex: 6,
              overflowX: 'auto',
              overflowY: 'hidden',
              scrollbarWidth: 'none',
              paddingBottom: 2,
            }}
          >
            {pinnedTriggersOnEdge.map((trigger) => {
              const key = triggerAnchorKey(trigger)
              const emoji = emojiForTriggerKey(key)
              const label = String(trigger.name || trigger.command || 'Trigger').slice(0, 80)
              return (
                <span
                  key={key}
                  role="button"
                  tabIndex={0}
                  title={`Run: ${label}`}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    try { void handlePopupTriggerClick(trigger) } catch (err) {
                      console.warn('[PopupChatView] pinned trigger click failed:', err)
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return
                    e.preventDefault()
                    e.stopPropagation()
                    try { void handlePopupTriggerClick(trigger) } catch (err) {
                      console.warn('[PopupChatView] pinned trigger keydown failed:', err)
                    }
                  }}
                  style={{
                    fontSize: 18,
                    lineHeight: 1,
                    cursor: 'pointer',
                    userSelect: 'none',
                    flexShrink: 0,
                    filter: isLight
                      ? 'drop-shadow(0 1px 2px rgba(0,0,0,0.35))'
                      : 'drop-shadow(0 1px 3px rgba(0,0,0,0.55))',
                    transition: 'transform 0.12s',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLSpanElement).style.transform = 'scale(1.3)' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLSpanElement).style.transform = 'scale(1)' }}
                >
                  {emoji}
                </span>
              )
            })}
            {pinnedDiffWatchers.map((watcher) => {
              const emoji = emojiForTriggerKey(`diff:${watcher.id ?? watcher.name ?? ''}`)
              const label = String(watcher.name || watcher.tag || 'Diff').slice(0, 80)
              return (
                <span
                  key={`diff:${watcher.id}`}
                  role="button"
                  tabIndex={0}
                  title={`Diff: ${label} — click to run diff now`}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    const id = watcher.id as string
                    if (!id) return
                    void getLaunchSecret().then((secret) =>
                      fetch(`${BASE_URL}/api/wrchat/diff-watchers/${encodeURIComponent(id)}/run`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'X-Launch-Secret': secret ?? '' },
                        signal: AbortSignal.timeout(15000),
                      }).catch((err) => console.warn('[WRChat] diff runNow failed:', err))
                    )
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return
                    e.preventDefault()
                    e.stopPropagation()
                    const id = watcher.id as string
                    if (!id) return
                    void getLaunchSecret().then((secret) =>
                      fetch(`${BASE_URL}/api/wrchat/diff-watchers/${encodeURIComponent(id)}/run`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'X-Launch-Secret': secret ?? '' },
                        signal: AbortSignal.timeout(15000),
                      }).catch((err) => console.warn('[WRChat] diff runNow failed:', err))
                    )
                  }}
                  style={{
                    fontSize: 18,
                    lineHeight: 1,
                    cursor: 'pointer',
                    userSelect: 'none',
                    flexShrink: 0,
                    filter: isLight
                      ? 'drop-shadow(0 1px 2px rgba(0,0,0,0.35))'
                      : 'drop-shadow(0 1px 3px rgba(0,0,0,0.55))',
                    transition: 'transform 0.12s',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLSpanElement).style.transform = 'scale(1.3)' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLSpanElement).style.transform = 'scale(1)' }}
                >
                  {emoji}
                </span>
              )
            })}
          </div>
        )}
        {messages.length === 0 && (
          <div style={{ opacity: 0.5, textAlign: 'center', padding: '20px', fontSize: '12px', color: colors.muted }}>
            Type a command to get started…
          </div>
        )}
        {messages.map((msg, i) => {
          const hasImage = !!(msg.imageUrl && !msg.videoUrl)
          return (
          <div key={i} style={{
            maxWidth: '85%',
            padding: '10px 12px',
            borderRadius: '10px',
            fontSize: '12px', lineHeight: 1.45,
            alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
            wordBreak: 'break-word', overflowWrap: 'anywhere',
            background: msg.role === 'user' ? colors.userBubbleBg : colors.aiBubbleBg,
            border: msg.role === 'user' ? colors.userBubbleBorder : colors.aiBubbleBorder,
            color: colors.bubbleText,
            overflow: 'hidden',
          }}>
            {msg.videoUrl && (
              <video
                src={msg.videoUrl}
                controls
                style={{ maxWidth: '100%', borderRadius: 6, display: 'block', marginBottom: msg.text ? 6 : 0 }}
              />
            )}
            {msg.imageUrl && !msg.videoUrl && (
              <img
                src={msg.imageUrl}
                alt="screenshot"
                style={{
                  maxWidth: '75%',
                  borderRadius: 6,
                  display: 'block',
                  border: '1px solid rgba(255,255,255,0.12)',
                }}
              />
            )}
            {msg.text && (
              <div style={{
                marginTop: hasImage ? 6 : 0,
                fontSize: '11px',
                whiteSpace: 'pre-wrap',
              }}>{msg.text}</div>
            )}
          </div>
          )
        })}
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

      {pendingCaptureUrl && (
        <div style={{
          margin: '0 8px', padding: '6px 10px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8,
          background: colors.pendingBg, border: `1px solid ${colors.pendingBorder}`, color: colors.pendingText, fontSize: 11
        }}>
          <img
            src={pendingCaptureUrl}
            alt="Captured region"
            style={{ width: 44, height: 30, objectFit: 'cover', borderRadius: 3, flexShrink: 0, border: '1px solid rgba(255,255,255,0.15)' }}
          />
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            📸 <strong>Screenshot captured</strong> — type your question and Send (or just Send for OCR)
          </span>
          <button onClick={() => setPendingCaptureUrl(null)} style={{
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
                    ...(typeof showTriggerPrompt.displayId === 'number' && showTriggerPrompt.displayId > 0
                      ? { displayId: showTriggerPrompt.displayId }
                      : {}),
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
                      displayId:
                        typeof showTriggerPrompt.displayId === 'number' && showTriggerPrompt.displayId > 0
                          ? showTriggerPrompt.displayId
                          : undefined,
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
                  if (wrChatEmbedContext === 'dashboard') setPendingCaptureUrl(null)
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
                  if (wrChatEmbedContext === 'dashboard') setPendingCaptureUrl(null)
                  setShowTriggerPrompt(null)
                  setTimeout(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight }, 0)
                } else {
                  if (wrChatEmbedContext === 'dashboard') setPendingCaptureUrl(null)
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

    <CustomModeWizard
      open={addModeWizardOpen}
      onClose={() => setAddModeWizardOpen(false)}
      theme={dashboardThemeToLightbox(theme)}
      onSave={(draft) => {
        const id = addMode(draft)
        setWorkspace('wr-chat')
        setMode(id)
      }}
    />
    </>
  )
}

export default PopupChatView
