import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import type { ChangeEvent } from 'react'
import './HybridSearch.css'
import './handshakeViewTypes'
import { useDraftRefineStore } from '../stores/useDraftRefineStore'
import { useEmailInboxStore } from '../stores/useEmailInboxStore'
import { useAiDraftContextStore } from '../stores/useAiDraftContextStore'
import { ingestAiContextFiles } from '../lib/ingestAiContextFiles'
import { extractTextForPackagePreview } from '../lib/beapPackageAttachmentPreview'
import { buildProjectSetupChatPrefix } from '../lib/buildProjectSetupChatPrefix'
import { WRDESK_FOCUS_AI_CHAT_EVENT } from '../lib/wrdeskUiEvents'
import { projectSetupChatHasBridgeableContent, useProjectSetupChatContextStore } from '../stores/useProjectSetupChatContextStore'
import { UI_BADGE } from '../styles/uiContrastTokens'

/** Derived focus context for inbox — distinguishes message vs draft vs attachment above chat. */
export type UiFocusContext =
  | { kind: 'message'; messageId: string }
  | { kind: 'draft'; messageId: string }
  | { kind: 'attachment'; messageId: string; attachmentId: string }
  | { kind: 'none' }

/** Stable reference for subFocus when not in beap-inbox — prevents React #185 (max update depth) from selector returning new object every render. */
const SUBFOCUS_NONE = { kind: 'none' as const }

// ── Types ──

type SearchMode = 'chat' | 'search' | 'actions'
type SearchScope = 'context-graph' | 'capsules' | 'attachments' | 'inbox-messages' | 'all'
type DashboardView = string

interface SearchResult {
  id: string
  title: string
  snippet: string
  scope: 'context-graph' | 'capsules' | 'attachments' | 'inbox-message'
  timestamp?: string
  /** Handshake attribution */
  handshake_id?: string
  source?: 'received' | 'sent'
  score?: number
  data_classification?: string
  /** Governance policy summary (e.g. "Local AI only", "Cloud AI allowed") */
  governance_summary?: string
  /** Human-readable label for structured/context-graph matches */
  matched_field_label?: string
  /** True when result comes from structured lookup */
  structured_result?: boolean
  /** Text to copy when user clicks Copy result (Label: Value for structured, snippet for others) */
  copyableText?: string
}

interface HybridSearchProps {
  activeView: DashboardView
  selectedHandshakeId?: string | null
  selectedHandshakeEmail?: string | null
  selectedDocumentId?: string | null
  selectedMessageId?: string | null
  selectedAttachmentId?: string | null
  onClearMessageSelection?: () => void
}

// ── LLM Models (loaded from backend) ──

interface AvailableModel {
  id: string
  name: string
  provider: string
  type: 'local' | 'cloud'
}

function getModelLabel(id: string, models: AvailableModel[]): string {
  return models.find(m => m.id === id)?.name ?? id
}

function defaultScope(view: DashboardView): SearchScope {
  if (view === 'handshakes') return 'context-graph'
  if (view === 'beap') return 'capsules'
  if (view === 'beap-inbox') return 'inbox-messages'
  return 'all'
}

// ── Helpers ──

function friendlyTypeName(type: string | undefined): string {
  if (!type) return 'Data'
  const map: Record<string, string> = {
    text: 'Text', document: 'Document', url: 'Link', email: 'Email',
    json: 'Structured Data', image: 'Image', file: 'File', note: 'Note',
    profile: 'Profile', contact: 'Contact', vault_profile: 'Profile',
  }
  return map[type.toLowerCase()] ?? type.charAt(0).toUpperCase() + type.slice(1)
}

function truncate(s: string, max = 220): string {
  if (!s) return ''
  return s.length > max ? s.slice(0, max) + '…' : s
}

/** Strip leading internal IDs (hsp_xxx, hs-xxx, long hex) from snippet so user-facing content shows first. */
function sanitizeSnippet(s: string): string {
  if (!s || typeof s !== 'string') return ''
  const trimmed = s.trim()
  const withoutLeadingId = trimmed.replace(/^(?:hsp_[a-zA-Z0-9]+|hs-[a-zA-Z0-9-]+|[a-f0-9]{24,})\s+/i, '')
  return withoutLeadingId || trimmed
}

/** Recursively collect string values from JSON for full-text extraction (no truncation). */
function collectStringsFromJson(val: unknown): string[] {
  if (val == null) return []
  if (typeof val === 'string') return [val]
  if (typeof val === 'number' || typeof val === 'boolean') return [String(val)]
  if (Array.isArray(val)) return val.flatMap((v) => collectStringsFromJson(v))
  if (typeof val === 'object') return Object.values(val).flatMap((v) => collectStringsFromJson(v))
  return []
}

/** Extract full readable text from payload (JSON or plain). No truncation. */
function extractFullTextFromPayload(payload: string): string {
  if (!payload || typeof payload !== 'string') return ''
  const trimmed = payload.trim()
  if (!trimmed) return ''
  try {
    const parsed = JSON.parse(trimmed)
    if (typeof parsed === 'string') return trimmed
    if (parsed && typeof parsed === 'object') {
      const parts = collectStringsFromJson(parsed).filter(Boolean)
      return parts.join(' ').replace(/\s+/g, ' ').trim()
    }
  } catch { /* not JSON */ }
  return trimmed
}

function shortId(id: string): string {
  if (!id) return ''
  return id.length > 16 ? `${id.slice(0, 3)}…${id.slice(-6)}` : id
}

const SPECIAL_RESULT_IDS = ['vault-locked', 'no-embeddings', 'embedding-unavailable', 'degraded-no-match'] as const
function isSpecialResult(r: SearchResult): boolean {
  return SPECIAL_RESULT_IDS.includes(r.id as typeof SPECIAL_RESULT_IDS[number])
}

// ── Search backend (semantic search + inbox) ──

async function runInboxSearch(
  query: string,
  selectedHandshakeId: string | null
): Promise<SearchResult[]> {
  if (!window.emailInbox?.listMessages) return []
  try {
    const res = await window.emailInbox.listMessages({
      search: query || undefined,
      handshakeId: selectedHandshakeId ?? undefined,
      filter: 'all',
      limit: 20,
    })
    if (!res.ok || !res.data?.messages) return []
    const messages = res.data.messages as Array<{
      id: string
      subject?: string | null
      from_name?: string | null
      from_address?: string | null
      body_text?: string | null
      received_at?: string
    }>
    return messages.map((m) => ({
      id: m.id,
      title: m.subject || m.from_address || '(No subject)',
      snippet: truncate((m.body_text || '').replace(/\s+/g, ' ').trim(), 200),
      scope: 'inbox-message' as const,
      handshake_id: undefined,
    }))
  } catch {
    return []
  }
}

async function runSearch(
  query: string,
  scope: SearchScope | string,
  selectedHandshakeId?: string | null
): Promise<SearchResult[]> {
  const includeInbox = scope === 'inbox-messages' || scope === 'all'
  const includeSemantic = scope !== 'inbox-messages'

  if (includeInbox && !includeSemantic) {
    return runInboxSearch(query, selectedHandshakeId ?? null)
  }

  const [semanticResults, inboxResults] = await Promise.all([
    includeSemantic ? runSearchSemantic(query, scope) : Promise.resolve([]),
    includeInbox ? runInboxSearch(query, selectedHandshakeId ?? null) : Promise.resolve([]),
  ])

  if (scope === 'all') {
    return [...semanticResults, ...inboxResults]
  }
  if (includeSemantic) {
    return semanticResults
  }
  return inboxResults
}

async function runSearchSemantic(query: string, scope: SearchScope | string): Promise<SearchResult[]> {
  try {
    const result = await window.handshakeView?.semanticSearch?.(query, scope, 20)
    if (!result?.success) {
      if (result?.error === 'vault_locked') {
        return [{
          id: 'vault-locked',
          title: '🔒 Vault Locked',
          snippet: 'Unlock your vault to search handshake context data.',
          scope: 'context-graph',
        }]
      }
      if (result?.error === 'no_embeddings') {
        return [{
          id: 'no-embeddings',
          title: 'Search index not ready',
          snippet: 'Context blocks are still being indexed. Try again in a moment.',
          scope: 'context-graph',
        }]
      }
      if (result?.error === 'embedding_unavailable') {
        return [{
          id: 'embedding-unavailable',
          title: 'Search requires Ollama',
          snippet: 'Search requires Ollama with an embedding model. Check Backend Configuration.',
          scope: 'context-graph',
        }]
      }
      return []
    }
    // Degraded mode: embedding unavailable, keyword fallback ran but no matches
    if (result.degraded === 'keyword_fallback' && (!result.results || result.results.length === 0)) {
      return [{
        id: 'degraded-no-match',
        title: 'Semantic search unavailable',
        snippet: 'No keyword matches found. Ollama with an embedding model enables full semantic search.',
        scope: 'context-graph',
      }]
    }
    // Legacy: embedding_unavailable with empty results (pre-keyword-fallback)
    if (result.degraded === 'embedding_unavailable' && (!result.results || result.results.length === 0)) {
      return [{
        id: 'degraded-no-match',
        title: 'Structured search only',
        snippet: 'Ollama with an embedding model enables full semantic search. No structured data matched your query.',
        scope: 'context-graph',
      }]
    }
    const raw = result.results ?? []
    return raw.map((r: Record<string, unknown>, i: number) => {
      const matchedLabel = r.matched_field_label as string | undefined
      const title = matchedLabel ?? friendlyTypeName(r.type as string | undefined)
      const payloadRef = typeof r.payload_ref === 'string' ? r.payload_ref : ''
      const snippet = (r.snippet as string) ?? ''
      const isStructured = r.structured_result === true && matchedLabel
      const bestFullText = (() => {
        if (isStructured) return snippet || payloadRef
        const fromPayload = payloadRef ? extractFullTextFromPayload(payloadRef) : ''
        const fromSnippet = sanitizeSnippet(snippet)
        return fromPayload || fromSnippet
      })()
      const sanitizedFull = sanitizeSnippet(bestFullText)
      const displayText = isStructured
        ? truncate(`${matchedLabel}: ${sanitizedFull}`, 200)
        : truncate(sanitizedFull, 200)
      const copyableText = isStructured
        ? `${matchedLabel}: ${sanitizedFull}`.trim()
        : sanitizedFull
      return {
        id: (r.block_id as string) ?? `result-${i}`,
        title,
        snippet: displayText,
        scope: 'context-graph' as const,
        timestamp: r.source === 'received' ? '↓ Received' : r.source === 'sent' ? '↑ Sent' : undefined,
        handshake_id: r.handshake_id as string | undefined,
        source: r.source as 'received' | 'sent' | undefined,
        score: typeof r.score === 'number' ? r.score : undefined,
        data_classification: r.data_classification as string | undefined,
        governance_summary: r.governance_summary as string | undefined,
        matched_field_label: matchedLabel,
        structured_result: r.structured_result === true,
        copyableText,
      }
    })
  } catch (err) {
    console.error('Search failed:', err)
    return []
  }
}

interface ChatSource {
  handshake_id: string
  capsule_id?: string
  block_id: string
  source: string
  score: number
}

// ── Scope label helper ──

const SCOPE_LABELS: Record<SearchScope, string> = {
  'context-graph': 'Context Graph',
  'capsules': 'Capsules',
  'attachments': 'Attachments',
  'inbox-messages': 'Inbox',
  'all': 'All (Global)',
}

// ── Block parser for AI response picker ──────────────────────────────────────

interface ResponseBlock {
  id: string
  type: 'text' | 'code' | 'list' | 'heading'
  content: string
  displayPreview: string
}

function parseResponseIntoBlocks(responseText: string): ResponseBlock[] {
  const blocks: ResponseBlock[] = []
  let blockId = 0
  const segments = responseText.split(/\n{2,}/)
  for (const segment of segments) {
    const trimmed = segment.trim()
    if (!trimmed) continue
    let type: ResponseBlock['type'] = 'text'
    if (trimmed.startsWith('```')) {
      type = 'code'
    } else if (/^#{1,3}\s/.test(trimmed)) {
      type = 'heading'
    } else if (/^[-*•]\s/.test(trimmed) || /^\d+[.)]\s/.test(trimmed)) {
      type = 'list'
    }
    blocks.push({
      id: `block-${blockId++}`,
      type,
      content: trimmed,
      displayPreview: trimmed.slice(0, 80) + (trimmed.length > 80 ? '…' : ''),
    })
  }
  return blocks
}

// ── Chat attachment support ───────────────────────────────────────────────────

interface ChatAttachment {
  id: string
  type: 'image' | 'pdf'
  filename: string
  /** For images: base64 data URL. For PDFs: extracted text content. */
  data: string
  /** Thumbnail preview (same as data for images). */
  thumbnail?: string
}

const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const MAX_IMAGE_SIZE  = 10 * 1024 * 1024  // 10 MB
const MAX_PDF_SIZE    = 20 * 1024 * 1024  // 20 MB
const MAX_CHAT_ATTACHMENTS = 5

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

// ── Component ──

export default function HybridSearch({
  activeView,
  selectedHandshakeId = null,
  selectedHandshakeEmail = null,
  selectedDocumentId = null,
  selectedMessageId = null,
  selectedAttachmentId = null,
  onClearMessageSelection,
}: HybridSearchProps) {
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<SearchMode>('chat')
  const [scope, setScope] = useState<SearchScope>(() => defaultScope(activeView))
  const [selectedModel, setSelectedModel] = useState('')
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([])
  const [modelsLoading, setModelsLoading] = useState(true)
  const [isLoading, setIsLoading] = useState(false)
  const [results, setResults] = useState<SearchResult[]>([])
  const [response, setResponse] = useState<string | null>(null)
  const [contextBlocks, setContextBlocks] = useState<string[]>([])
  const [chatSources, setChatSources] = useState<ChatSource[]>([])
  const [chatGovernanceNote, setChatGovernanceNote] = useState<string | null>(null)
  const [structuredResult, setStructuredResult] = useState<{ title: string; items: Array<{ id: string; title: string; snippet: string; handshake_id: string; block_id: string; source: string; score: number; type?: string }> } | null>(null)
  const [resultType, setResultType] = useState<'document_card' | 'result_card' | 'context_answer' | null>(null)
  const [lastMode, setLastMode] = useState<SearchMode | null>(null)
  const [showPanel, setShowPanel] = useState(false)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [infoPopupOpen, setInfoPopupOpen] = useState(false)
  const [draftRefineHistory, setDraftRefineHistory] = useState<Array<{ role: 'user' | 'assistant'; content: string; showUseButton?: boolean; onUse?: () => void }>>([])
  const contextDocuments = useAiDraftContextStore((s) => s.documents)
  const removeContextDocument = useAiDraftContextStore((s) => s.removeDocument)
  const clearContextDocuments = useAiDraftContextStore((s) => s.clear)

  const projectSetupIncludeInChat = useProjectSetupChatContextStore((s) => s.includeInChat)
  const projectSetupHasContent = useProjectSetupChatContextStore(projectSetupChatHasBridgeableContent)
  const projectSetupSetupTextDraft = useProjectSetupChatContextStore((s) => s.setupTextDraft)
  const projectSetupSetIncludeInChat = useProjectSetupChatContextStore((s) => s.setIncludeInChat)
  const projectSetupSetSetupTextDraft = useProjectSetupChatContextStore((s) => s.setSetupTextDraft)

  /** Derive which project field is currently selected for AI drafting */
  const projectDraftFieldName = projectSetupSetupTextDraft.includes('write a project description')
    ? 'Description'
    : projectSetupSetupTextDraft.includes('define project goals')
      ? 'Goals'
      : projectSetupSetupTextDraft.includes('define project milestones')
        ? 'Milestones'
        : 'Project field'

  /** Parsed response blocks for the AI draft block picker */
  const aiResponseBlocks = useMemo(
    () =>
      activeView === 'analysis' && projectSetupIncludeInChat && response
        ? parseResponseIntoBlocks(response)
        : [],
    [activeView, projectSetupIncludeInChat, response],
  )

  /** Track which individual blocks have already been inserted */
  const [usedBlockIds, setUsedBlockIds] = useState<Set<string>>(new Set())

  /** Reset inserted-state when a new response arrives */
  useEffect(() => {
    setUsedBlockIds(new Set())
  }, [response])

  const containerRef = useRef<HTMLDivElement>(null)
  const infoPopupRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const modelMenuRef = useRef<HTMLDivElement>(null)
  const uploadRef = useRef<HTMLInputElement>(null)
  const chatFileInputRef = useRef<HTMLInputElement>(null)

  // ── Chat attachment state ──────────────────────────────────────────────────
  const [chatAttachments, setChatAttachments] = useState<ChatAttachment[]>([])
  const [isDragging, setIsDragging] = useState(false)

  useEffect(() => {
    const focusChat = () => {
      setMode('chat')
      queueMicrotask(() => inputRef.current?.focus())
    }
    window.addEventListener(WRDESK_FOCUS_AI_CHAT_EVENT, focusChat)
    return () => window.removeEventListener(WRDESK_FOCUS_AI_CHAT_EVENT, focusChat)
  }, [])

  const draftRefineConnected = useDraftRefineStore((s) => s.connected)
  const draftRefineMessageId = useDraftRefineStore((s) => s.messageId)
  const draftRefineMessageSubject = useDraftRefineStore((s) => s.messageSubject)
  const draftRefineTarget = useDraftRefineStore((s) => s.refineTarget)
  const inboxSubFocus = useEmailInboxStore((s) => (activeView === 'beap-inbox' ? s.subFocus : SUBFOCUS_NONE))

  /** True when the chat bar should run draft-refine (inbox message or standalone compose with null ids). */
  const isDraftRefineSession =
    draftRefineConnected &&
    (draftRefineMessageId === selectedMessageId ||
      (draftRefineMessageId === null && selectedMessageId == null))

  /** Derived focus context — distinguishes outer message vs draft sub-focus vs attachment above chat. */
  const uiFocusContext: UiFocusContext = useMemo(() => {
    if (
      activeView === 'beap-inbox' &&
      draftRefineConnected &&
      draftRefineMessageId === null &&
      selectedMessageId == null
    ) {
      return { kind: 'draft', messageId: '__compose__' }
    }
    if (!selectedMessageId) return { kind: 'none' }
    const msgId = selectedMessageId
    if (activeView === 'beap-inbox') {
      if (draftRefineConnected && draftRefineMessageId === msgId) {
        return { kind: 'draft', messageId: msgId }
      }
      if (inboxSubFocus.kind === 'draft' && inboxSubFocus.messageId === msgId) return { kind: 'draft', messageId: msgId }
      if (inboxSubFocus.kind === 'attachment' && inboxSubFocus.messageId === msgId && selectedAttachmentId)
        return { kind: 'attachment', messageId: msgId, attachmentId: selectedAttachmentId }
    }
    return { kind: 'message', messageId: msgId }
  }, [activeView, selectedMessageId, selectedAttachmentId, inboxSubFocus, draftRefineConnected, draftRefineMessageId])
  const draftRefineDraftText = useDraftRefineStore((s) => s.draftText)
  const draftRefineDeliverResponse = useDraftRefineStore((s) => s.deliverResponse)
  const draftRefineAcceptRefinement = useDraftRefineStore((s) => s.acceptRefinement)
  const draftRefineDisconnect = useDraftRefineStore((s) => s.disconnect)

  /** Shown after "✏️ Draft" when refine store targets a capsule field (not subFocus-only). */
  const draftRefineScopeSuffix =
    isDraftRefineSession
      ? draftRefineTarget === 'capsule-public'
        ? ' · Public (pBEAP)'
        : draftRefineTarget === 'capsule-encrypted'
          ? ' · Encrypted (qBEAP)'
          : draftRefineTarget === 'email'
            ? ' · Email'
            : ''
      : ''

  const draftRefineChipTitle =
    uiFocusContext.kind === 'draft' && isDraftRefineSession
      ? draftRefineTarget === 'capsule-public'
        ? 'Chat scoped to public capsule draft — refine with AI'
        : draftRefineTarget === 'capsule-encrypted'
          ? 'Chat scoped to encrypted capsule draft — refine with AI'
          : draftRefineTarget === 'email'
            ? 'Chat scoped to email draft — refine with AI'
            : 'Chat scoped to draft — refine with AI'
      : 'Chat scoped to draft — refine with AI'

  useEffect(() => {
    if (draftRefineConnected) setMode('chat')
  }, [draftRefineConnected])

  useEffect(() => {
    if (!draftRefineConnected) setDraftRefineHistory([])
  }, [draftRefineConnected])

  const handleClearMessageSelection = useCallback(() => {
    draftRefineDisconnect()
    onClearMessageSelection?.()
  }, [draftRefineDisconnect, onClearMessageSelection])

  // Load available models from backend
  useEffect(() => {
    async function loadModels() {
      try {
        const result = await window.handshakeView?.getAvailableModels?.()
        if (result?.success && Array.isArray(result.models)) {
          setAvailableModels(result.models)
          const preferred = result.models.find((m: { type: string }) => m.type === 'local') ?? result.models[0]
          setSelectedModel(prev => (result.models.some((m: { id: string }) => m.id === prev) ? prev : (preferred?.id ?? '')))
        }
      } catch (err) {
        console.error('Failed to load models:', err)
      } finally {
        setModelsLoading(false)
      }
    }
    loadModels()
  }, [])

  // Sync scope when activeView changes
  useEffect(() => {
    setScope(defaultScope(activeView))
  }, [activeView])

  // Close model menu on outside click
  useEffect(() => {
    if (!modelMenuOpen) return
    function handleClick(e: MouseEvent) {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) {
        setModelMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [modelMenuOpen])

  // Close panel on outside click
  useEffect(() => {
    if (!showPanel) return
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowPanel(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showPanel])

  // Close info popup on outside click or Escape
  useEffect(() => {
    if (!infoPopupOpen) return
    function handleClick(e: MouseEvent) {
      if (infoPopupRef.current && !infoPopupRef.current.contains(e.target as Node)) {
        setInfoPopupOpen(false)
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setInfoPopupOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [infoPopupOpen])

  const handleSubmit = useCallback(async () => {
    const trimmed = query.trim()
    if (!trimmed || isLoading) return

    const previousAnswer = response
    setLastMode(mode)
    setIsLoading(true)
    setShowPanel(true)
    setResults([])
    setResponse(null)
    setContextBlocks([])
    setChatSources([])
    setStructuredResult(null)
    setResultType(null)

    try {
      const effectiveScope = selectedHandshakeId ?? selectedMessageId ?? scope
      if (mode === 'search') {
        const r = await runSearch(trimmed, effectiveScope, selectedHandshakeId)
        setResults(r)
      } else if (mode === 'actions') {
        setResponse('Actions mode: Draft, analyze, extract, or automate based on the selected handshake or message. Coming soon.')
      } else {
        const modelInfo = availableModels.find(m => m.id === selectedModel)
        const streamedRef = { current: '' }
        const unsubStart = window.handshakeView?.onChatStreamStart?.((data: { contextBlocks: string[]; sources: ChatSource[] }) => {
          setContextBlocks(data.contextBlocks ?? [])
          setChatSources(data.sources ?? [])
          setIsLoading(false)
        })
        const unsubToken = window.handshakeView?.onChatStreamToken?.((data: { token: string }) => {
          const tok = data.token ?? ''
          streamedRef.current += tok
          setResponse(prev => (prev ?? '') + tok)
        })

        const isDraftRefine = isDraftRefineSession
        const currentDraft = isDraftRefine ? (useDraftRefineStore.getState().draftText || draftRefineDraftText || '') : ''
        const contextDocs = useAiDraftContextStore.getState().documents

        if (isDraftRefine) {
          setDraftRefineHistory(prev => [...prev, { role: 'user', content: trimmed }])
        }

        let chatQuery: string
        if (isDraftRefine) {
          const target = useDraftRefineStore.getState().refineTarget
          let fieldLabel = 'reply draft'
          if (target === 'capsule-public') {
            fieldLabel = 'preview summary of a reply'
          } else if (target === 'capsule-encrypted') {
            fieldLabel = 'full reply draft'
          }
          if (currentDraft.trim()) {
            chatQuery = [
              `Here is the current ${fieldLabel}:`,
              '',
              '---',
              currentDraft,
              '---',
              '',
              `The user wants to modify it: "${trimmed}"`,
              '',
              `Output ONLY the revised text. No explanation, no markdown.`,
            ].join('\n')
          } else {
            chatQuery = [
              `The user has no draft text yet for the ${fieldLabel}.`,
              '',
              `Write initial draft text based on this instruction:`,
              `"${trimmed}"`,
              '',
              `Output ONLY the draft text. No explanation, no preamble, no markdown formatting.`,
            ].join('\n')
          }
        } else {
          let inboxContext = ''
          if (selectedMessageId && window.emailInbox?.getMessage) {
            try {
              const msgRes = await window.emailInbox.getMessage(selectedMessageId)
              if (msgRes.ok && msgRes.data) {
                const msg = msgRes.data as { subject?: string; body_text?: string; body_html?: string }
                inboxContext = `[Email] Subject: ${msg.subject ?? '(none)'}\nBody: ${(msg.body_text || msg.body_html || '').slice(0, 4000)}\n`
                if (selectedAttachmentId && window.emailInbox?.getAttachmentText) {
                  const attRes = await window.emailInbox.getAttachmentText(selectedAttachmentId)
                  if (attRes.ok && attRes.data) {
                    const t = (attRes.data.text || '').trim()
                    if (t) {
                      inboxContext += `[Selected Attachment]\n${t.slice(0, 4000)}\n`
                    } else if (attRes.data.error) {
                      inboxContext += `[Selected Attachment: text not available] ${String(attRes.data.error).slice(0, 800)}\n`
                    }
                  }
                }
                inboxContext += '\n'
              }
            } catch {
              /* ignore */
            }
          }
          chatQuery = inboxContext ? `${inboxContext}User question: ${trimmed}` : trimmed
        }

        if (contextDocs.length > 0 && isDraftRefine) {
          const ctxBlock = contextDocs
            .map(d => `[${d.name}]\n${d.text.slice(0, 8000)}`)
            .join('\n\n')
          chatQuery =
            chatQuery +
            '\n\n--- CONTEXT DOCUMENTS ---\n' +
            ctxBlock +
            '\n--- END CONTEXT ---\n\nUse specific details from context documents ' +
            '(names, numbers, dates, amounts) to personalize the draft.'
        }

        if (contextDocs.length > 0 && !isDraftRefine) {
          const ctxBlock = contextDocs.map(d => `[${d.name}]\n${d.text.slice(0, 8000)}`).join('\n\n')
          chatQuery = `Context:\n${ctxBlock}\n\n${chatQuery}`
        }

        /** Analysis-only: prepend project setup drafts (never mixed into handshake draft-refine prompts). */
        if (!isDraftRefine && activeView === 'analysis') {
          const setupPrefix = buildProjectSetupChatPrefix(useProjectSetupChatContextStore.getState())
          if (setupPrefix) {
            chatQuery = `${setupPrefix}\n\n${chatQuery}`
          }
        }

        // ── Prepend chat attachments (PDF extracted text + image placeholders) ──
        if (chatAttachments.length > 0) {
          const parts: string[] = []
          for (const att of chatAttachments) {
            if (att.type === 'pdf') {
              parts.push(`[Attached PDF: ${att.filename}]\n${att.data}\n[End of PDF]`)
            } else {
              // TODO: Pass images to LLM API for multi-modal models (e.g., Ollama images array)
              parts.push(`[User attached image: ${att.filename}. Image analysis requires a multi-modal model.]`)
            }
          }
          if (parts.length > 0) chatQuery = parts.join('\n\n') + '\n\n' + chatQuery
        }

        let result: Awaited<ReturnType<NonNullable<typeof window.handshakeView>['chatWithContextRag']>> | undefined
        try {
          result = await window.handshakeView?.chatWithContextRag?.({
            query: chatQuery,
            scope: effectiveScope,
            model: selectedModel || 'llama3',
            provider: modelInfo?.provider || 'ollama',
            stream: true,
            conversationContext: previousAnswer?.trim() ? { lastAnswer: previousAnswer } : undefined,
            selectedDocumentId: selectedDocumentId ?? undefined,
            selectedAttachmentId: selectedAttachmentId ?? undefined,
            selectedMessageId: selectedMessageId ?? undefined,
          })
        } finally {
          unsubStart?.()
          unsubToken?.()
        }

        if (!result?.success) {
          if (result?.error === 'vault_locked') {
            setResponse('🔒 Unlock your vault to search handshake data.')
          } else if (result?.error === 'embedding_unavailable') {
            setResponse('Search requires Ollama with an embedding model. Check Backend Configuration.')
          } else if (result?.error === 'no_api_key') {
            setResponse(`No API key configured for ${result.provider ?? 'cloud provider'}. Add it in Extension Settings.`)
          } else if (result?.error === 'ollama_unavailable') {
            setResponse('Ollama is not running. Start Ollama to use local models.')
          } else if (result?.error === 'model_not_available') {
            setResponse(result?.message ?? 'Configured Ollama model not found.')
          } else if (result?.error === 'model_execution_failed') {
            setResponse(result?.message ?? 'Model execution failed.')
          } else if (result?.error === 'api_call_failed') {
            setResponse(result?.message ?? 'API call failed. Check your API key and network.')
          } else {
            setResponse(result?.message ?? 'Chat is not available right now.')
          }
          setChatSources([])
          setChatGovernanceNote(null)
        } else {
          const answerText = (result.answer ?? streamedRef.current) || ''
          if (!result.streamed) {
            setResponse(answerText)
            setChatSources(result.sources ?? [])
          } else if (result.answer) {
            setResponse(prev => prev || answerText)
          }
          if (isDraftRefine && answerText.trim()) {
            const refined = answerText.trim()
            draftRefineDeliverResponse(refined)
            setDraftRefineHistory(prev => [...prev, {
              role: 'assistant',
              content: refined,
              showUseButton: true,
              onUse: () => draftRefineAcceptRefinement(),
            }])
            setResponse(null)
            setQuery('')
          }
          setChatGovernanceNote(result.governanceNote ?? null)
          if (result.sources?.length && chatSources.length === 0) setChatSources(result.sources)
          if (result.structuredResult) {
            setStructuredResult(result.structuredResult)
            setResultType((result.resultType as 'document_card' | 'result_card' | 'context_answer') ?? null)
          }
        }
      }
    } catch (err: any) {
      console.error('Chat failed:', err)
      const msg = err?.message ?? 'Unknown error'
      setResponse(msg)
      setChatSources([])
      setChatGovernanceNote(null)
      setStructuredResult(null)
      setResultType(null)
    } finally {
      setIsLoading(false)
      setChatAttachments([])
    }
  }, [query, mode, scope, activeView, selectedHandshakeId, selectedMessageId, selectedAttachmentId, selectedModel, availableModels, isLoading, response, selectedDocumentId, isDraftRefineSession, draftRefineDraftText, draftRefineTarget, draftRefineDeliverResponse, draftRefineAcceptRefinement, chatAttachments])

  const handleContextUpload = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    await ingestAiContextFiles(files)
    if (uploadRef.current) uploadRef.current.value = ''
  }, [])

  // ── Chat attachment handlers ───────────────────────────────────────────────

  const processDroppedFile = useCallback(async (file: File) => {
    const isImage = SUPPORTED_IMAGE_TYPES.includes(file.type)
    const isPdf   = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')

    if (!isImage && !isPdf) {
      console.warn(`[Chat] Unsupported file type: ${file.type}`)
      return
    }
    if (isImage && file.size > MAX_IMAGE_SIZE) {
      console.warn(`[Chat] Image too large: ${(file.size / 1024 / 1024).toFixed(1)}MB (max 10MB)`)
      return
    }
    if (isPdf && file.size > MAX_PDF_SIZE) {
      console.warn(`[Chat] PDF too large: ${(file.size / 1024 / 1024).toFixed(1)}MB (max 20MB)`)
      return
    }

    const id = crypto.randomUUID()

    if (isImage) {
      const dataUrl = await fileToDataUrl(file)
      setChatAttachments((prev) =>
        prev.length >= MAX_CHAT_ATTACHMENTS ? prev : [...prev, { id, type: 'image', filename: file.name, data: dataUrl, thumbnail: dataUrl }],
      )
    } else {
      // Convert to base64 and reuse the BEAP PDF parser (IPC extract)
      const buffer = await file.arrayBuffer()
      const bytes  = new Uint8Array(buffer)
      let binary = ''
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
      const b64 = btoa(binary)

      const extracted = await extractTextForPackagePreview({
        name: file.name,
        mimeType: file.type || 'application/pdf',
        base64: b64,
      })

      setChatAttachments((prev) =>
        prev.length >= MAX_CHAT_ATTACHMENTS
          ? prev
          : [...prev, {
              id,
              type: 'pdf',
              filename: file.name,
              data: extracted.text || `[PDF: ${file.name} — could not extract text]`,
            }],
      )
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false)
    }
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    const files = Array.from(e.dataTransfer.files).slice(0, MAX_CHAT_ATTACHMENTS)
    for (const file of files) {
      await processDroppedFile(file)
    }
  }, [processDroppedFile])

  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items)
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (file) await processDroppedFile(file)
      } else if (item.type === 'application/pdf') {
        const file = item.getAsFile()
        if (file) await processDroppedFile(file)
      }
    }
  }, [processDroppedFile])

  const showModelSelector = mode === 'chat' || mode === 'actions'

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
    if (e.key === 'Escape') {
      setShowPanel(false)
      setModelMenuOpen(false)
      setInfoPopupOpen(false)
      inputRef.current?.blur()
    }
  }, [handleSubmit])

  const handleViewHandshake = useCallback((handshakeId: string) => {
    navigator.clipboard.writeText(handshakeId).then(() => {}).catch(() => {})
  }, [])

  const handleCopyResult = useCallback((text: string) => {
    navigator.clipboard.writeText(text).then(() => {}).catch(() => {})
  }, [])

  return (
    <div
      className="hs-root"
      ref={containerRef}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={(e) => void handleDrop(e)}
    >
      {isDragging && (
        <div className="chat-drop-zone__overlay">
          <div className="chat-drop-zone__overlay-text">Drop images or PDFs here</div>
        </div>
      )}
      {selectedHandshakeId && selectedHandshakeEmail && (
        <div
          style={{
            fontSize: '10px',
            fontWeight: 600,
            marginBottom: '6px',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            padding: '4px 8px',
            borderRadius: '6px',
            width: 'fit-content',
            maxWidth: '100%',
            ...UI_BADGE.purple,
          }}
        >
          Scope: Handshake → {selectedHandshakeEmail}
        </div>
      )}
      {(selectedMessageId || (draftRefineConnected && draftRefineMessageId === null && selectedMessageId == null)) && (
        <div
          style={{
            fontSize: '10px',
            fontWeight: 600,
            marginBottom: '6px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            flexWrap: 'wrap',
          }}
        >
          {uiFocusContext.kind === 'draft' ? (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '2px 8px',
                borderRadius: '6px',
                ...UI_BADGE.green,
              }}
              title={draftRefineChipTitle}
            >
              ✏️ Draft{draftRefineScopeSuffix}
              {draftRefineMessageSubject
                ? ` · ${draftRefineMessageSubject.length > 40 ? draftRefineMessageSubject.slice(0, 40) + '…' : draftRefineMessageSubject}`
                : ''}
              <button
                type="button"
                onClick={handleClearMessageSelection}
                aria-label="Disconnect draft"
                style={{
                  marginLeft: '4px', padding: 0, background: 'none', border: 'none',
                  cursor: 'pointer', color: 'inherit', fontSize: '12px', lineHeight: 1,
                }}
              >
                ×
              </button>
            </span>
          ) : uiFocusContext.kind === 'attachment' ? (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '2px 8px',
                borderRadius: '6px',
                ...UI_BADGE.amber,
              }}
              title="Chat scoped to attachment"
            >
              📎 Attachment
              {onClearMessageSelection && (
                <button
                  type="button"
                  onClick={handleClearMessageSelection}
                  aria-label="Clear selection"
                  style={{
                    marginLeft: '4px', padding: 0, background: 'none', border: 'none',
                    cursor: 'pointer', color: 'inherit', fontSize: '12px', lineHeight: 1,
                  }}
                >
                  ✕
                </button>
              )}
            </span>
          ) : (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '2px 8px',
                borderRadius: '6px',
                ...UI_BADGE.blue,
              }}
              title="Chat scoped to message"
            >
              📨 Message
              {selectedAttachmentId && <span>→ Attachment</span>}
              {onClearMessageSelection && (
                <button
                  type="button"
                  onClick={handleClearMessageSelection}
                  aria-label="Clear message selection"
                  style={{
                    marginLeft: '4px', padding: 0, background: 'none', border: 'none',
                    cursor: 'pointer', color: 'inherit', fontSize: '12px', lineHeight: 1,
                  }}
                >
                  ✕
                </button>
              )}
            </span>
          )}
        </div>
      )}
      {/* Project AI drafting context banner — Analysis only, takes zero horizontal space */}
      {activeView === 'analysis' && projectSetupIncludeInChat && projectSetupHasContent && !isDraftRefineSession && (
        <div
          style={{
            background: 'rgba(37, 99, 235, 0.05)',
            border: '1px solid rgba(37, 99, 235, 0.15)',
            borderRadius: '4px',
            padding: '4px 8px',
            marginBottom: '4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '4px',
          }}
        >
          <span style={{ fontSize: '10px', color: '#2563EB', fontWeight: 500 }}>
            Drafting for: {projectDraftFieldName}
          </span>
          <button
            type="button"
            onClick={() => {
              projectSetupSetIncludeInChat(false)
              projectSetupSetSetupTextDraft('')
            }}
            aria-label="Disconnect project drafting"
            title="Disconnect — stop sending project context to AI"
            style={{
              padding: 0, background: 'none', border: 'none',
              cursor: 'pointer', color: '#2563EB', fontSize: '14px', lineHeight: 1, flexShrink: 0,
            }}
          >
            ×
          </button>
        </div>
      )}
      {/* ── Chat attachment preview strip ── */}
      {chatAttachments.length > 0 && (
        <div className="chat-attachments-strip">
          {chatAttachments.map((att) => (
            <div
              key={att.id}
              className={`chat-attachment-preview chat-attachment-preview--${att.type}`}
            >
              {att.type === 'image' && (
                <img src={att.thumbnail ?? att.data} alt={att.filename} />
              )}
              {att.type === 'pdf' && (
                <>
                  <div className="chat-attachment-preview__filename">📄 {att.filename}</div>
                  <div className="chat-attachment-preview__meta">PDF</div>
                </>
              )}
              <button
                type="button"
                className="chat-attachment-preview__remove"
                onClick={() => setChatAttachments((prev) => prev.filter((a) => a.id !== att.id))}
                aria-label={`Remove ${att.filename}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div
        className="hs-bar"
        data-draft-refine={isDraftRefineSession ? 'true' : undefined}
      >

        {/* ── Left: mode toggle + scope ── */}
        <div className="hs-bar-left">
          <div className="hs-mode" role="group" aria-label="Input mode">
            <button
              className={`hs-mode-btn${mode === 'chat' ? ' hs-mode-btn--active' : ''}`}
              onClick={() => setMode('chat')}
              title="Chat — ask a question, get an AI answer"
              aria-pressed={mode === 'chat'}
            >
              Chat
            </button>
            <button
              className={`hs-mode-btn${mode === 'actions' ? ' hs-mode-btn--active hs-mode-btn--actions-active' : ''}`}
              onClick={() => setMode('actions')}
              title="Actions — draft, analyze, extract, or automate based on the selected handshake or message"
              aria-pressed={mode === 'actions'}
            >
              Actions
            </button>
            <button
              className={`hs-mode-btn${mode === 'search' ? ' hs-mode-btn--active hs-mode-btn--search-active' : ''}`}
              onClick={() => setMode('search')}
              title="Search — fulltext search across BEAP messages and context graph"
              aria-pressed={mode === 'search'}
            >
              Search
            </button>
          </div>

          {mode === 'search' && <div className="hs-bar-divider" />}

          {mode === 'search' && (
            <select
              className="hs-scope"
              value={scope}
              onChange={e => setScope(e.target.value as SearchScope)}
              aria-label="Search scope"
              title="Scope: where to search"
            >
              <option value="context-graph">Context Graph</option>
              <option value="capsules">Capsules</option>
              <option value="attachments">Attachments</option>
              <option value="inbox-messages">Inbox</option>
              <option value="all">All (Global)</option>
            </select>
          )}
          <div className="hs-info-wrap" ref={infoPopupRef}>
            <button
              type="button"
              className="hs-info-btn"
              onClick={() => setInfoPopupOpen(prev => !prev)}
              aria-label="Mode help"
              title="What do Chat, Search, and Actions do?"
            >
              i
            </button>
            {infoPopupOpen && (
              <div className="hs-info-popup" role="dialog" aria-label="Mode help">
                <div className="hs-info-popup-item"><strong>Chat:</strong> Chat with AI across the global BEAP Ecosystem when nothing is selected. When a handshake or BEAP Message is selected, the AI focuses on it while still using the related Context Graph and relationship context.</div>
                <div className="hs-info-popup-item"><strong>Search:</strong> Search across the global BEAP Ecosystem, or narrow the search to the selected handshake or BEAP Message and its related context.</div>
                <div className="hs-info-popup-item"><strong>Actions:</strong> Draft replies, analyze content, extract structured data into the Context Graph, or prepare automations based on the current selection.</div>
                <div className="hs-info-popup-item"><strong>Analysis project drafts:</strong> On Analysis, optional setup drafts from the Projects card can be prepended to chat (no auto-save).</div>
              </div>
            )}
          </div>
        </div>

        {/* ── Centre: main input ── */}
        {selectedHandshakeId && (
          <span
            style={{ marginRight: '6px', fontSize: '16px', color: '#4c1d95', lineHeight: 1, flexShrink: 0, cursor: 'default' }}
            title="Chat scoped to selected handshake"
          >
            👉
          </span>
        )}
        {((selectedMessageId || (draftRefineConnected && draftRefineMessageId === null && selectedMessageId == null)) && !selectedHandshakeId) && (
          <span
            style={{
              marginRight: '6px', fontSize: '16px', lineHeight: 1, flexShrink: 0, cursor: 'default',
              color: uiFocusContext.kind === 'draft' ? '#166534' : '#1e40af',
            }}
            title={
              uiFocusContext.kind === 'draft'
                ? isDraftRefineSession
                  ? draftRefineTarget === 'capsule-public'
                    ? 'Chat scoped to public capsule draft'
                    : draftRefineTarget === 'capsule-encrypted'
                      ? 'Chat scoped to encrypted capsule draft'
                      : draftRefineTarget === 'email'
                        ? 'Chat scoped to email draft'
                        : 'Chat scoped to draft'
                  : 'Chat scoped to draft'
                : uiFocusContext.kind === 'attachment'
                  ? 'Chat scoped to attachment'
                  : 'Chat scoped to message'
            }
          >
            {uiFocusContext.kind === 'draft' ? '✏️' : '👉'}
          </span>
        )}
        <button
          type="button"
          onClick={() => uploadRef.current?.click()}
          title="Upload context document (AI drafting only — not sent as attachment)"
          aria-label="Upload context document for AI drafting"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: 16,
            padding: '4px 8px',
            opacity: contextDocuments.length > 0 ? 1 : 0.5,
            flexShrink: 0,
            lineHeight: 1,
          }}
        >
          📎{contextDocuments.length > 0 ? ` ${contextDocuments.length}` : ''}
        </button>
        <input
          ref={uploadRef}
          type="file"
          accept=".pdf,.txt,.md,.csv,.json"
          multiple
          style={{ display: 'none' }}
          onChange={handleContextUpload}
        />
        {/* ── Chat attachment file picker (images + PDFs) ── */}
        <input
          ref={chatFileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []).slice(0, MAX_CHAT_ATTACHMENTS)
            files.forEach((f) => void processDroppedFile(f))
            e.currentTarget.value = ''
          }}
        />
        <button
          type="button"
          onClick={() => chatFileInputRef.current?.click()}
          title="Attach images or PDFs to this message (drag & drop also works)"
          aria-label="Attach images or PDFs"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: 14,
            padding: '4px 4px',
            opacity: chatAttachments.length > 0 ? 1 : 0.4,
            flexShrink: 0,
            lineHeight: 1,
            color: chatAttachments.length > 0 ? 'var(--purple-accent, #9333ea)' : undefined,
          }}
        >
          🖼️{chatAttachments.length > 0 ? ` ${chatAttachments.length}` : ''}
        </button>
        <input
          ref={inputRef}
          className="hs-input"
          type="text"
          placeholder={
            isDraftRefineSession
              ? draftRefineMessageId === null && selectedMessageId == null
                ? 'Draft your message — type an instruction for AI'
                : "Modify draft — e.g. 'make it shorter', 'add cancellation request'…"
              : mode === 'actions'
                ? 'Describe an action to draft, analyze, or automate…'
                : (selectedHandshakeId ? 'Ask a question about the context…' : selectedMessageId ? 'Ask a question about this BEAP message…' : 'AI Assistant across the BEAP Ecosystem')
          }
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={(e) => void handlePaste(e)}
          onFocus={() => { if (results.length > 0 || response) setShowPanel(true) }}
          aria-label={mode === 'chat' ? 'Ask a question' : mode === 'search' ? 'Search' : 'Actions input'}
          autoComplete="off"
          spellCheck={false}
        />

        {/* ── Right: action button ── */}
        <div className="hs-send-group" ref={modelMenuRef}>
          <button
            className={`hs-send-btn hs-send-btn--${mode === 'actions' ? 'actions' : mode}`}
            onClick={handleSubmit}
            disabled={!query.trim() || isLoading}
            title={
              mode === 'chat'
                ? `Send to ${getModelLabel(selectedModel, availableModels)} (Enter)`
                : mode === 'search'
                ? 'Run search (Enter)'
                : `Run action with ${getModelLabel(selectedModel, availableModels)} (Enter)`
            }
          >
            {isLoading ? (
              <span className="hs-send-spinner" aria-label="Loading" />
            ) : (
              <span className="hs-send-label">
                {mode === 'chat' ? 'Chat' : mode === 'search' ? 'Search' : 'Actions'}
              </span>
            )}
          </button>

          {/* Model picker — for Chat and Actions */}
          {showModelSelector && (
            <button
              className={`hs-model-selector${modelMenuOpen ? ' hs-model-caret--open' : ''}${mode === 'actions' ? ' hs-model-selector--actions' : ''}`}
              onClick={async () => {
                const next = !modelMenuOpen
                setModelMenuOpen(next)
                if (next) {
                  try {
                    const result = await window.handshakeView?.getAvailableModels?.()
                    if (result?.success && Array.isArray(result.models)) {
                      setAvailableModels(result.models)
                      const preferred = result.models.find((m: { type: string }) => m.type === 'local') ?? result.models[0]
                      setSelectedModel(prev => (result.models.some((m: { id: string }) => m.id === prev) ? prev : (preferred?.id ?? '')))
                    }
                  } catch { /* ignore */ }
                }
              }}
              aria-label="Select LLM model"
              title="Choose model (click to open)"
              tabIndex={0}
            >
              <span className="hs-send-model">{getModelLabel(selectedModel, availableModels)}</span>
              <span className="hs-model-caret">▾</span>
            </button>
          )}

          {modelMenuOpen && showModelSelector && (
            <div className="hs-model-menu" role="menu">
              {modelsLoading ? (
                <div className="hs-model-group-label">Loading models…</div>
              ) : availableModels.length === 0 ? (
                <div className="hs-model-group-label">No models configured — check Settings</div>
              ) : (
                <>
                  {availableModels.some(m => m.type === 'local') && (
                    <>
                      <div className="hs-model-group-label">Local Models</div>
                      {availableModels.filter(m => m.type === 'local').map(m => (
                        <button
                          key={m.id}
                          role="menuitem"
                          className={`hs-model-item${selectedModel === m.id ? ' hs-model-item--active' : ''}`}
                          onClick={() => { setSelectedModel(m.id); setModelMenuOpen(false) }}
                        >
                          {m.name}
                          {selectedModel === m.id && <span className="hs-model-check">✓</span>}
                        </button>
                      ))}
                    </>
                  )}
                  {availableModels.some(m => m.type === 'cloud') && (
                    <>
                      <div className="hs-model-group-label">Cloud Models</div>
                      {availableModels.filter(m => m.type === 'cloud').map(m => (
                        <button
                          key={m.id}
                          role="menuitem"
                          className={`hs-model-item${selectedModel === m.id ? ' hs-model-item--active' : ''}`}
                          onClick={() => { setSelectedModel(m.id); setModelMenuOpen(false) }}
                        >
                          {m.name}
                          {selectedModel === m.id && <span className="hs-model-check">✓</span>}
                        </button>
                      ))}
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {contextDocuments.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 4,
            padding: '4px 8px',
            borderTop: '1px solid var(--border-light, rgba(255,255,255,0.12))',
            alignItems: 'center',
          }}
        >
          {contextDocuments.map((d) => (
            <span
              key={d.id}
              style={{
                fontSize: 11,
                background: 'var(--purple-accent-muted, rgba(147,51,234,0.12))',
                color: 'var(--text-secondary, #cbd5e1)',
                padding: '2px 8px',
                borderRadius: 12,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                border: '1px solid rgba(147,51,234,0.25)',
              }}
            >
              📄 {d.name}
              <button
                type="button"
                onClick={() => removeContextDocument(d.id)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: 'inherit' }}
                aria-label={`Remove ${d.name}`}
              >
                ✕
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={() => clearContextDocuments()}
            style={{ fontSize: 10, color: 'var(--text-muted, #94a3b8)', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            Clear all
          </button>
        </div>
      )}

      {/* ── Results / Response panel ── */}
      {showPanel && (
        <div className="hs-panel" role="region" aria-label="Results">
          <div className="hs-panel-header">
            <span className="hs-panel-meta">
              {lastMode === 'search'
                ? `Search · ${SCOPE_LABELS[scope]}`
                : lastMode === 'actions'
                ? `Actions · ${getModelLabel(selectedModel, availableModels)}`
                : `Chat · ${getModelLabel(selectedModel, availableModels)} · ${SCOPE_LABELS[scope]}`}
            </span>
            <button
              className="hs-panel-close"
              onClick={() => setShowPanel(false)}
              aria-label="Close results"
              title="Close (Esc)"
            >
              ✕
            </button>
          </div>

          {isLoading && !(lastMode === 'chat' && contextBlocks.length > 0) && (
            <div className="hs-panel-loading">
              <span className="hs-spinner" />
              <span>{lastMode === 'chat' ? 'Asking…' : lastMode === 'actions' ? 'Running…' : 'Searching…'}</span>
            </div>
          )}

          {/* Search results */}
          {!isLoading && lastMode === 'search' && (
            <>
              {results.length === 0 ? (
                <div className="hs-panel-empty">
                  No matching context found. Try a different query or check that context blocks have been indexed.
                </div>
              ) : results.length === 1 && isSpecialResult(results[0]) ? (
                <div className="hs-panel-empty">
                  <strong>{results[0].title}</strong>
                  <br />
                  {results[0].snippet}
                </div>
              ) : (
                <div className="hs-result-group">
                  {results.filter(r => !isSpecialResult(r)).map(r => (
                    <ResultRow
                      key={r.id}
                      result={r}
                      selectedHandshakeId={selectedHandshakeId}
                      onCopyResult={handleCopyResult}
                    />
                  ))}
                </div>
              )}
            </>
          )}

          {/* Draft refine history (when connected to draft) */}
          {isDraftRefineSession && (draftRefineHistory.length > 0 || response) && (
            <div className="hs-draft-refine-history" style={{ marginBottom: '16px' }}>
              {draftRefineHistory.map((msg, idx) => (
                <div
                  key={idx}
                  className={`hs-draft-refine-msg hs-draft-refine-msg--${msg.role}`}
                  style={{
                    marginBottom: '10px',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    background: msg.role === 'user' ? 'rgba(147,51,234,0.08)' : 'rgba(147,51,234,0.04)',
                    border: '1px solid rgba(147,51,234,0.2)',
                    fontSize: '12px',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: '10px', marginBottom: '4px', color: 'var(--text-muted)' }}>
                    {msg.role === 'user' ? 'You' : 'Revised draft'}
                  </div>
                  <div className="hs-draft-refine-content">{msg.content}</div>
                  {msg.showUseButton && msg.onUse && (
                    <button
                      type="button"
                      className="chat-use-btn"
                      onClick={msg.onUse}
                      title="Apply this version to draft"
                    >
                      USE ↓
                    </button>
                  )}
                </div>
              ))}
              {isLoading && response && (
                <div
                  className="hs-draft-refine-msg hs-draft-refine-msg--assistant"
                  style={{
                    marginBottom: '10px',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    background: 'rgba(147,51,234,0.04)',
                    border: '1px solid rgba(147,51,234,0.2)',
                    fontSize: '12px',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: '10px', marginBottom: '4px', color: 'var(--text-muted)' }}>Revising…</div>
                  <div>{response}</div>
                </div>
              )}
            </div>
          )}

          {/* Actions response */}
          {lastMode === 'actions' && response && (
            <div className="hs-response">
              <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: '6px' }}>Response:</div>
              <div className="hs-response-text">{response}</div>
            </div>
          )}

          {/* Chat response (skip when draft refine mode — we show draft history instead) */}
          {lastMode === 'chat' && !isDraftRefineSession && (response || contextBlocks.length > 0 || structuredResult) && (
            <div className="hs-response">
              {structuredResult && structuredResult.items.length > 0 && (
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: '8px' }}>
                    {structuredResult.title}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {structuredResult.items.map((item) => (
                      <div
                        key={item.id}
                        style={{
                          padding: '12px',
                          background: 'var(--purple-accent-muted, rgba(147,51,234,0.08))',
                          border: '1px solid rgba(147,51,234,0.2)',
                          borderRadius: '8px',
                          fontSize: '12px',
                        }}
                      >
                        <div style={{ fontWeight: 600, marginBottom: '4px', color: 'var(--text-primary)' }}>{item.title}</div>
                        <div style={{ color: 'var(--text-secondary)', lineHeight: 1.4 }}>{item.snippet}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {structuredResult && structuredResult.items.length === 0 && (
                <div style={{ marginBottom: '12px', fontSize: '12px', color: 'var(--text-muted)' }}>
                  No relevant context found in indexed BEAP data.
                </div>
              )}
              {(response != null || contextBlocks.length > 0) && !(structuredResult && structuredResult.items.length > 0) && (
                <>
                  <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: '6px' }}>Answer:</div>
                  {aiResponseBlocks.length > 0 ? (
                    <div className="hs-response-text">
                      {aiResponseBlocks.map((block) => (
                        <div key={block.id} className="chat-response-block">
                          <div className="chat-response-block__content">{block.content}</div>
                          <button
                            type="button"
                            className={`chat-response-block__use-btn${usedBlockIds.has(block.id) ? ' chat-response-block__use-btn--inserted' : ''}`}
                            onClick={() => {
                              if (usedBlockIds.has(block.id)) return
                              window.dispatchEvent(new CustomEvent('wrdesk:use-ai-draft', { detail: { text: block.content, mode: 'append' } }))
                              setUsedBlockIds((prev) => new Set([...prev, block.id]))
                            }}
                          >
                            {usedBlockIds.has(block.id) ? '✓' : 'Use'}
                          </button>
                        </div>
                      ))}
                      <div className="chat-response-block__use-all">
                        <button
                          type="button"
                          className="chat-response-block__use-all-btn"
                          onClick={() => {
                            const allContent = aiResponseBlocks.map((b) => b.content).join('\n\n')
                            window.dispatchEvent(new CustomEvent('wrdesk:use-ai-draft', { detail: { text: allContent, mode: 'replace' } }))
                            setUsedBlockIds(new Set(aiResponseBlocks.map((b) => b.id)))
                          }}
                        >
                          Use All
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="hs-response-text">
                      {response ?? ''}
                      {contextBlocks.length > 0 && response === '' && <span className="hs-stream-cursor" style={{ display: 'inline-block', width: '2px', height: '1em', background: 'var(--purple-accent)', marginLeft: '2px', animation: 'hs-blink 1s step-end infinite' }} />}
                    </div>
                  )}
                </>
              )}
              {structuredResult && structuredResult.items.length === 0 && response && (
                <>
                  <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: '6px' }}>Answer:</div>
                  {aiResponseBlocks.length > 0 ? (
                    <div className="hs-response-text">
                      {aiResponseBlocks.map((block) => (
                        <div key={block.id} className="chat-response-block">
                          <div className="chat-response-block__content">{block.content}</div>
                          <button
                            type="button"
                            className={`chat-response-block__use-btn${usedBlockIds.has(block.id) ? ' chat-response-block__use-btn--inserted' : ''}`}
                            onClick={() => {
                              if (usedBlockIds.has(block.id)) return
                              window.dispatchEvent(new CustomEvent('wrdesk:use-ai-draft', { detail: { text: block.content, mode: 'append' } }))
                              setUsedBlockIds((prev) => new Set([...prev, block.id]))
                            }}
                          >
                            {usedBlockIds.has(block.id) ? '✓' : 'Use'}
                          </button>
                        </div>
                      ))}
                      <div className="chat-response-block__use-all">
                        <button
                          type="button"
                          className="chat-response-block__use-all-btn"
                          onClick={() => {
                            const allContent = aiResponseBlocks.map((b) => b.content).join('\n\n')
                            window.dispatchEvent(new CustomEvent('wrdesk:use-ai-draft', { detail: { text: allContent, mode: 'replace' } }))
                            setUsedBlockIds(new Set(aiResponseBlocks.map((b) => b.id)))
                          }}
                        >
                          Use All
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="hs-response-text">{response}</div>
                  )}
                </>
              )}
              <div className="hs-response-chips">
                <span className="hs-chip">{SCOPE_LABELS[scope]}</span>
                <span className="hs-chip">{getModelLabel(selectedModel, availableModels)}</span>
              </div>
              {chatGovernanceNote && (
                <div style={{ marginTop: '12px', padding: '10px 12px', background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.3)', borderRadius: '6px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                  {chatGovernanceNote}
                </div>
              )}
              {/* Collapsible Sources & Details dropdown */}
              {(chatSources.length > 0 || contextBlocks.length > 0 || (structuredResult?.items?.length ?? 0) > 0) && (
                <details className="hs-response-details" style={{
                  marginTop: '12px',
                  borderTop: '1px solid var(--border-light, var(--border, #e0e0e0))',
                  paddingTop: '8px',
                }}>
                  <summary style={{
                    fontSize: '11px',
                    color: 'var(--text-muted, #888)',
                    cursor: 'pointer',
                    userSelect: 'none',
                    fontWeight: 500,
                    letterSpacing: '0.03em',
                    listStyle: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}>
                    <span className="hs-details-arrow" style={{
                      display: 'inline-block',
                      transition: 'transform 0.2s',
                      fontSize: '9px',
                    }}>&#9654;</span>
                    Sources &amp; Details
                  </summary>
                  <div style={{
                    paddingTop: '8px',
                    fontSize: '11px',
                    color: 'var(--text-secondary, #666)',
                  }}>
                    {contextBlocks.length > 0 && (
                      <div style={{ marginBottom: '8px' }}>
                        <div style={{
                          fontSize: '9px',
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: '0.06em',
                          color: 'var(--text-muted, #888)',
                          marginBottom: '4px',
                        }}>
                          Context Retrieved
                        </div>
                        <div style={{
                          fontFamily: 'monospace',
                          fontSize: '11px',
                          whiteSpace: 'pre-wrap',
                          color: 'var(--text-secondary, #666)',
                        }}>
                          {contextBlocks.join('\n')}
                        </div>
                      </div>
                    )}
                    {(chatSources.length > 0 || (structuredResult?.items?.length ?? 0) > 0) && (
                      <div>
                        <div style={{
                          fontSize: '9px',
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: '0.06em',
                          color: 'var(--text-muted, #888)',
                          marginBottom: '4px',
                        }}>
                          Sources
                        </div>
                        {(chatSources.length > 0 ? chatSources : structuredResult?.items ?? []).map((s, i, arr) => {
                          const handshakeId = (s as { handshake_id: string }).handshake_id
                          const blockId = (s as { block_id: string }).block_id
                          const displayLabel = selectedHandshakeId && handshakeId === selectedHandshakeId && selectedHandshakeEmail
                            ? selectedHandshakeEmail
                            : (handshakeId?.includes('@') ? handshakeId : shortId(handshakeId))
                          return (
                            <div key={`src-${handshakeId}-${blockId}-${i}`} style={{
                              fontSize: '11px',
                              padding: '4px 0',
                              borderBottom: i < arr.length - 1 ? '1px solid var(--border-light, #eee)' : 'none',
                            }}>
                              <div style={{
                                fontWeight: 600,
                                fontSize: '12px',
                                color: 'var(--text-primary, #333)',
                                marginBottom: '2px',
                              }}>
                                {displayLabel}
                              </div>
                              <div style={{
                                fontFamily: 'monospace',
                                fontSize: '10px',
                                color: 'var(--text-muted, #888)',
                              }}>
                                Block: {blockId}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </details>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Result row ──

function ResultRow({
  result,
  selectedHandshakeId,
  onCopyResult,
}: {
  result: SearchResult
  selectedHandshakeId?: string | null
  onCopyResult: (text: string) => void
}) {
  const [copied, setCopied] = useState(false)
  const scorePct = result.score != null ? Math.round(Math.min(1, Math.max(0, result.score)) * 100) : null
  const attribution =
    result.handshake_id && result.source
      ? result.source === 'received'
        ? `Received from handshake ${shortId(result.handshake_id)}`
        : `Sent by you · handshake ${shortId(result.handshake_id)}`
      : result.timestamp ?? ''

  const textToCopy = result.copyableText ?? result.snippet
  const handleCopyResult = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (textToCopy) {
      onCopyResult(textToCopy)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const ctaLabel = copied ? 'Copied!' : 'Copy result'

  return (
    <div
      className="hs-result-row"
      title={result.title}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <div className="hs-result-row__title">{result.title}</div>
        {result.structured_result && (
          <span
            className="hs-result-badge"
            style={{
              fontSize: '9px',
              padding: '1px 5px',
              borderRadius: '3px',
              fontWeight: 600,
              flexShrink: 0,
              ...UI_BADGE.green,
            }}
          >
            Context
          </span>
        )}
        {result.data_classification && (
          <span
            className="hs-result-badge"
            style={{
              fontSize: '9px',
              padding: '1px 5px',
              borderRadius: '3px',
              fontWeight: 600,
              flexShrink: 0,
              ...UI_BADGE.gray,
            }}
          >
            {result.data_classification}
          </span>
        )}
        {result.governance_summary && (
          <span
            className="hs-result-badge"
            style={{
              fontSize: '9px',
              padding: '1px 5px',
              borderRadius: '3px',
              fontWeight: 600,
              flexShrink: 0,
              ...UI_BADGE.purple,
            }}
          >
            {result.governance_summary}
          </span>
        )}
        {result.timestamp && (
          <span
            style={{
              fontSize: '9px',
              padding: '1px 5px',
              borderRadius: '3px',
              fontWeight: 600,
              flexShrink: 0,
              ...(result.timestamp.startsWith('↓') ? UI_BADGE.purple : UI_BADGE.green),
            }}
          >
            {result.timestamp}
          </span>
        )}
      </div>
      <div className="hs-result-row__snippet">{result.snippet}</div>
      {(attribution || scorePct != null) && (
        <div className="hs-result-row__meta" style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' }}>
          {scorePct != null && (
            <span className="hs-result-score" title={`Relevance: ${scorePct}%`} style={{
              display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: 'var(--text-muted)',
            }}>
              <span style={{
                width: '24px', height: '4px', background: 'rgba(107,114,128,0.2)', borderRadius: 2, overflow: 'hidden',
              }}>
                <span style={{
                  width: `${scorePct}%`, height: '100%', background: 'var(--purple-accent)', borderRadius: 2,
                }} />
              </span>
              {scorePct}%
            </span>
          )}
          {attribution && <span>{attribution}</span>}
          {textToCopy && (
            <button
              type="button"
              className="hs-result-view-handshake"
              onClick={handleCopyResult}
              title={copied ? 'Copied to clipboard' : 'Copy result to clipboard'}
              style={{
                marginLeft: 'auto',
                fontSize: '10px',
                padding: '2px 6px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: 600,
                ...UI_BADGE.purple,
              }}
            >
              {ctaLabel}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
