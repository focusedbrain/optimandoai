import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import {
  GROUP_CLOUD,
  GROUP_HOST_MODELS,
  GROUP_LOCAL_MODELS,
  HOST_AI_STALE_INLINE,
  HOST_AI_SELECTOR_ICON_CLASS,
  HOST_INFERENCE_UNAVAILABLE,
} from '../lib/hostAiSelectorCopy'
import type { ChangeEvent, MutableRefObject } from 'react'
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
import { useProjectStore } from '../stores/useProjectStore'
import { useLetterComposerStore } from '../stores/useLetterComposerStore'
import { useChatFocusStore } from '@ext/stores/chatFocusStore'
import { getChatFocusLlmPrefix } from '@ext/utils/chatFocusLlmPrefix'
import { parseLetterFillJson, wantsLetterTemplateMultiVersion } from '../lib/letterTemplateMultiVersion'
import { UI_BADGE } from '../styles/uiContrastTokens'
import { resolveChatRoute } from '../chat/routing/resolveChatRoute'
import { handleLetterComposerChat } from '../chat/routing/letterComposerChat'
import {
  useSandboxHostInference,
  type HostInferenceTargetRow,
} from '../hooks/useSandboxHostInference'
import { useOrchestratorMode } from '../hooks/useOrchestratorMode'
import { logModelSelectorTargets } from '../lib/modelSelectorTargetsLog'
import {
  type InferenceTargetRefreshReason,
  countMergedModelList,
  logInferenceTargetRefreshFromLoad,
  logInferenceTargetRefreshStart,
} from '../lib/inferenceTargetRefreshLog'
import {
  computeShowHostInferenceRefresh,
  discoveryHasHostInternalRows,
  handshakeLocalRoleForModelSelectorLog,
  logModelSelectorShowRefresh,
} from '../lib/modelSelectorHostRefreshVisibility'
import { fetchSelectorModelListFromHostDiscovery } from '../lib/selectorModelListFromHostDiscovery'
import type { SelectorAvailableModel } from '../lib/selectorModelListFromHostDiscovery'
import { mapHostTargetsToGavModelEntries } from '../lib/modelSelectorMerge'
import {
  type HostRefreshFeedback,
  getHostRefreshFeedbackFromTargets,
} from '../lib/hostRefreshFeedback'
import {
  buildHostAiSelectorTooltip,
  hostModelSelectorRowUi,
  hostModelSelectorShowsDefinitiveHostFailure,
} from '../lib/hostModelSelectorRowUi'
import {
  computeHostInferenceGavRowPresentation,
  hostInferenceTargetMenuSelectable,
  hostAiTargetDevDebugSnippet,
} from '../lib/hostAiTargetConnectionPresentation'
import {
  areNormalizedHostAiTargetListsEqual,
  serializeMergedSelectorModelsForStableUi,
} from '../lib/hostAiTargetUiNormalization'
import { isHostInferenceModelId, parseAnyHostInferenceModelId } from '../lib/hostInferenceModelIds'
import {
  findHostInferenceTargetRowForChatSelection,
  inferHostModelRemoteLane,
  type HostModelRemoteLane,
} from '../lib/hostAiRemoteChatLane'
import { directP2pReachabilityCopyForSandboxToHost } from '../lib/hostInferenceUiGates'
import { hostAiUserFacingMessageFromTarget, type HostAiEndpointDiagnostics } from '../lib/hostAiUiDiagnostics'
import {
  appendHostAiAttributionLine,
  formatInternalInferenceErrorCode,
  getRequestHostCompletion,
  hostModelDisplayNameFromSelection,
} from '@ext/lib/inferenceSubmitRouting'
import {
  accountKeyFromSession,
  readOrchestratorInferenceSelection,
  validateStoredSelectionForOrchestratorWithDiagnostics,
  persistOrchestratorModelId,
  clearOrchestratorInferenceSelection,
  clearPersistedHostAiInferenceSelection,
  isHostInternalSelectionStaleForOrchestratorUi,
  type ValidateSelectionResultWithDiagnostics,
} from '../lib/inferenceSelectionPersistence'
import { buildAiExecutionContextIpcPayload } from '../lib/aiExecutionContextFromSelection'

function formatOrchestratorSelectionLogValue(v: string | null): string {
  if (v == null || v === '') return 'null'
  return v.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240)
}

/** Deduped: emit only when validation outcome changes (restore effect may re-run on list updates). */
function logOrchestratorModelSelectionValidateIfChanged(
  keyRef: MutableRefObject<string>,
  outcome: ValidateSelectionResultWithDiagnostics,
): void {
  const { diagnostics: d, error, modelId } = outcome
  const key = JSON.stringify({
    provider: d.provider,
    saved: d.saved,
    kind: d.kind,
    handshake: d.handshake,
    source: d.source,
    matched_row_id: d.matched_row_id,
    available: d.available,
    availability: d.availability,
    p2p_phase: d.p2p_phase,
    host_selector_state: d.host_selector_state,
    valid: d.valid,
    pending: d.pending,
    reason: d.reason,
    error: error ?? null,
    modelId,
  })
  if (key === keyRef.current) return
  keyRef.current = key
  console.log(
    `[MODEL_SELECTION_VALIDATE] provider=${d.provider} saved=${formatOrchestratorSelectionLogValue(d.saved)} kind=${d.kind} handshake=${formatOrchestratorSelectionLogValue(d.handshake)} source=${d.source} matched_row_id=${formatOrchestratorSelectionLogValue(d.matched_row_id)} available=${d.available === null ? 'null' : String(d.available)} availability=${formatOrchestratorSelectionLogValue(d.availability)} p2p_phase=${formatOrchestratorSelectionLogValue(d.p2p_phase)} host_selector_state=${formatOrchestratorSelectionLogValue(d.host_selector_state)}`,
  )
  console.log(
    `[MODEL_SELECTION_VALIDATE_RESULT] provider=${d.provider} valid=${d.valid} pending=${d.pending} reason=${d.reason}`,
  )
}

/** Resolves which template field the user meant (focused row, name in message, or single field). */
function matchLetterComposerFieldFromMessage(
  fields: Array<{ id: string; name: string }>,
  msg: string,
): string | null {
  const lower = msg.toLowerCase()
  for (const f of fields) {
    const n = f.name.toLowerCase()
    if (n.length >= 3 && lower.includes(n)) return f.id
  }
  for (const f of fields) {
    const parts = f.name
      .toLowerCase()
      .split(/[\s/_,.-]+/)
      .map((w) => w.replace(/[^a-z0-9]/g, ''))
      .filter((w) => w.length > 2)
    for (const w of parts) {
      if (w && lower.includes(w)) return f.id
    }
  }
  if (fields.length === 1) return fields[0].id
  return null
}

/** Parses [MILESTONE_TITLE]: / [MILESTONE_DESC]: blocks from AI responses (Analysis dashboard). */
function parseMilestoneMarkersFromResponse(text: string): { title: string; description: string } | null {
  if (!text) return null
  if (!/\[MILESTONE_TITLE\]:/i.test(text) && !/\[MILESTONE_DESC\]:/i.test(text)) return null
  const titleM = text.match(/\[MILESTONE_TITLE\]:\s*([\s\S]*?)(?=\n\s*\[MILESTONE_DESC\]:|$)/i)
  const descM = text.match(/\[MILESTONE_DESC\]:\s*([\s\S]*)$/i)
  const title = (titleM?.[1] ?? '').trim()
  const description = (descM?.[1] ?? '').trim()
  if (!title && !description) return null
  return { title, description }
}

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

type DraftRefineHistoryEntry = {
  role: 'user' | 'assistant'
  content: string
  showUseButton?: boolean
  onUse?: () => void
  refineParagraphs?: string[]
}

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

// ── LLM Models (loaded from backend) — same shape as `fetchSelectorModelListFromHostDiscovery` (top + WR). ──

type AvailableModel = SelectorAvailableModel

const RAW_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isCompactUiRawId(s: string): boolean {
  const t = s.trim()
  if (!t) return true
  if (RAW_UUID_RE.test(t)) return true
  if (t.length > 60 && t.includes('host-internal:')) return true
  return false
}

function getModelLabel(id: string, models: AvailableModel[], hostLabel?: (modelId: string) => string | null): string {
  const h = hostLabel?.(id)
  if (h && !isCompactUiRawId(h)) return h
  if (h && isCompactUiRawId(h)) {
    return 'Host AI'
  }
  const m = models.find((x) => x.id === id)
  if (m && m.type === 'host_internal') {
    const title = m.displayTitle || m.name
    if (!isCompactUiRawId(title)) return title
    return 'Host AI'
  }
  const n = m?.name ?? id
  if (isCompactUiRawId(n)) {
    return n.length > 20 ? `…${n.slice(-8)}` : n
  }
  return n
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
  type: 'text' | 'code' | 'list' | 'heading' | 'title-suggestion'
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

/**
 * Title-specific parser: extracts quoted strings and numbered/bulleted
 * suggestions as individual `title-suggestion` blocks, then appends the
 * full response as a final `text` block for "Use All".
 */
function parseTitleResponse(responseText: string): ResponseBlock[] {
  const blocks: ResponseBlock[] = []
  let blockId = 0
  const trimmed = responseText.trim()

  // Short single-line response → the whole thing IS the title
  const lines = trimmed.split('\n').filter(l => l.trim().length > 0)
  if (lines.length === 1 && trimmed.length <= 80) {
    const cleanTitle = trimmed
      .replace(/^["'\u201C\u2018]|["'\u201D\u2019]$/g, '')
      .replace(/^[\d.)\-*\s]+/, '')
      .replace(/\*\*/g, '')
      .trim()
    blocks.push({
      id: `block-${blockId++}`,
      type: 'title-suggestion',
      content: cleanTitle,
      displayPreview: cleanTitle,
    })
    return blocks
  }

  const extractedTitles: string[] = []

  // Match quoted strings: "…" or '…' or curly-quote variants
  const quotePattern = /["\u201C\u2018']([^"\u201D\u2019'\n]{3,80})["\u201D\u2019']/g
  let match: RegExpExecArray | null
  while ((match = quotePattern.exec(trimmed)) !== null) {
    const title = match[1].trim()
    if (title.length >= 3 && title.length <= 80 && !title.startsWith('http')) {
      extractedTitles.push(title)
    }
  }

  // Also look for numbered / bulleted suggestions: "1. Title" or "- Title"
  for (const line of lines) {
    const numbered = line.match(/^\s*(?:\d+[.)]\s*|[-*]\s+)(.{3,80})$/)
    if (numbered) {
      const title = numbered[1].replace(/[*_"'\u201C\u201D\u2018\u2019]/g, '').trim()
      if (title.length >= 3 && !extractedTitles.includes(title)) {
        extractedTitles.push(title)
      }
    }
  }

  // Individual pill blocks for each extracted title
  for (const title of extractedTitles) {
    blocks.push({
      id: `block-${blockId++}`,
      type: 'title-suggestion',
      content: title,
      displayPreview: title,
    })
  }

  // Always include the full response as the final block (for "Use All")
  blocks.push({
    id: `block-${blockId++}`,
    type: 'text',
    content: trimmed,
    displayPreview: trimmed.slice(0, 80) + (trimmed.length > 80 ? '…' : ''),
  })

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

/** Matches the RAG path attachment prepend (HybridSearch PDF block ~1835+) so Host-internal IPC gets the same text. */
function prependChatAttachmentsToUserText(trimmed: string, attachments: ChatAttachment[]): string {
  if (!attachments?.length) return trimmed
  const parts: string[] = []
  for (const att of attachments) {
    if (att.type === 'pdf') {
      parts.push(`[Attached PDF: ${att.filename}]\n${att.data}\n[End of PDF]`)
    } else {
      parts.push(`[User attached image: ${att.filename}. Image analysis requires a multi-modal model.]`)
    }
  }
  return parts.length > 0 ? `${parts.join('\n\n')}\n\n${trimmed}` : trimmed
}

interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const MAX_IMAGE_SIZE  = 10 * 1024 * 1024  // 10 MB
const MAX_PDF_SIZE    = 20 * 1024 * 1024  // 20 MB
const MAX_CHAT_ATTACHMENTS = 5
/** Re-fetch `getAvailableModels` when opening the model menu if the last successful load is older than this. */
const SELECTOR_MODEL_LIST_STALE_MS = 20_000

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
  /** Host rows from the same `getAvailableModels` call as `availableModels` (main merges listTargets). */
  const [gavHostTargets, setGavHostTargets] = useState<HostInferenceTargetRow[]>([])
  const [modelsLoading, setModelsLoading] = useState(true)
  const [isLoading, setIsLoading] = useState(false)
  const [results, setResults] = useState<SearchResult[]>([])
  const [response, setResponse] = useState<string | null>(null)
  const [contextBlocks, setContextBlocks] = useState<string[]>([])
  const [chatSources, setChatSources] = useState<ChatSource[]>([])
  const [chatGovernanceNote, setChatGovernanceNote] = useState<string | null>(null)
  const [chatRetrievalDebugNote, setChatRetrievalDebugNote] = useState<string | null>(null)
  const [structuredResult, setStructuredResult] = useState<{ title: string; items: Array<{ id: string; title: string; snippet: string; handshake_id: string; block_id: string; source: string; score: number; type?: string }> } | null>(null)
  const [resultType, setResultType] = useState<'document_card' | 'result_card' | 'context_answer' | null>(null)
  const [lastMode, setLastMode] = useState<SearchMode | null>(null)
  const [showPanel, setShowPanel] = useState(false)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [infoPopupOpen, setInfoPopupOpen] = useState(false)
  const [draftRefineHistory, setDraftRefineHistory] = useState<DraftRefineHistoryEntry[]>([])

  /** General chat conversation — user + assistant turns (non-draft-refine mode only) */
  const [chatMessages, setChatMessages] = useState<ChatTurn[]>([])
  const chatContainerRef = useRef<HTMLDivElement>(null)
  /** Bumped on letter-composer field switch and on each chat submit so stale stream tokens are ignored. */
  const chatGenerationRef = useRef(0)
  const orchestratorChatModelRestoredRef = useRef(false)
  const lastOrchestratorSelectionValidateLogKeyRef = useRef('')
  const lastAccountKeyForOrchRef = useRef(accountKeyFromSession())
  const isFirstOrchListRef = useRef(true)
  const lastInferenceTargetFetchAtRef = useRef(0)
  const hostRefreshFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [hostRefreshFeedback, setHostRefreshFeedback] = useState<HostRefreshFeedback | null>(null)
  const [inferenceSelectionPersistError, setInferenceSelectionPersistError] = useState<string | null>(null)

  const [hostInfSuccess, setHostInfSuccess] = useState(false)
  const [hostInfRunUi, setHostInfRunUi] = useState<{
    line1: string
    line2: string
  } | null>(null)
  const {
    ready: orchModeReady,
    mode: orchMode,
    isSandbox: orchIsSandbox,
    isHost: orchIsHost,
    ledgerProvesInternalSandboxToHost,
    ledgerProvesLocalHostPeerSandbox,
  } = useOrchestratorMode()
  const discoveryHostInternalRows = useMemo(
    () => discoveryHasHostInternalRows(gavHostTargets, availableModels),
    [gavHostTargets, availableModels],
  )
  const hostInferenceRefreshState = useMemo(
    () =>
      computeShowHostInferenceRefresh({
        orchModeReady,
        orchIsSandbox,
        orchIsHost,
        ledgerProvesInternalSandboxToHost,
        ledgerProvesLocalHostPeerSandbox,
        discoveryHasHostInternalRows: discoveryHostInternalRows,
      }),
    [
      orchModeReady,
      orchIsSandbox,
      orchIsHost,
      ledgerProvesInternalSandboxToHost,
      ledgerProvesLocalHostPeerSandbox,
      discoveryHostInternalRows,
    ],
  )
  /** Same gate as ↻: merge `listTargets` + show Host rows even with stale "host" on disk; local list may be empty. */
  const includeHostInternalDiscovery = hostInferenceRefreshState.show
  const showHostAiDiscoveryControls = hostInferenceRefreshState.show
  useEffect(() => {
    if (!orchModeReady) {
      return
    }
    logModelSelectorShowRefresh({
      selector: 'top',
      configuredMode: orchMode,
      handshakeLocalRole: handshakeLocalRoleForModelSelectorLog({
        ledgerProvesInternalSandboxToHost,
        ledgerProvesLocalHostPeerSandbox,
      }),
      show: hostInferenceRefreshState.show,
      reason: hostInferenceRefreshState.reason,
    })
  }, [
    orchModeReady,
    orchMode,
    ledgerProvesInternalSandboxToHost,
    ledgerProvesLocalHostPeerSandbox,
    hostInferenceRefreshState.show,
    hostInferenceRefreshState.reason,
  ])
  const hostInferenceProbeId = parseAnyHostInferenceModelId(selectedModel)?.handshakeId ?? null
  const selectedModelRef = useRef(selectedModel)
  selectedModelRef.current = selectedModel

  /** `loadModels` is intentionally stabilized (deps `[]`): read flags via refs so `includeHostInternalDiscovery` flips don't recreate the callback and retrigger mount effects (`loadModels('startup')` / `mode_change` loops). */
  const includeHostInternalDiscoveryRef = useRef(includeHostInternalDiscovery)
  includeHostInternalDiscoveryRef.current = includeHostInternalDiscovery
  const ledgerSandboxToHostRef = useRef(ledgerProvesInternalSandboxToHost)
  ledgerSandboxToHostRef.current = ledgerProvesInternalSandboxToHost

  const loadModels = useCallback(
    async (reason?: InferenceTargetRefreshReason, options?: { force?: boolean }) => {
    try {
      const discoveryEnabled = includeHostInternalDiscoveryRef.current
      if (discoveryEnabled && reason === 'manual_refresh') {
        logInferenceTargetRefreshStart('manual_refresh')
        setModelsLoading(true)
        setGavHostTargets((prev) =>
          prev.length
            ? prev.map((t) => ({
                ...t,
                host_selector_state: 'checking' as const,
                availability: 'checking_host',
                unavailable_reason: 'CHECKING_CAPABILITIES',
                available: false,
              }))
            : prev,
        )
        setAvailableModels((prev) =>
          prev.map((m) =>
            m.type === 'host_internal'
              ? {
                  ...m,
                  hostTargetAvailable: false,
                  hostSelectorState: 'checking' as const,
                }
              : m,
          ),
        )
      }
      const discovered = await fetchSelectorModelListFromHostDiscovery({
        reason,
        force: options?.force ?? (reason === 'manual_refresh' ? true : undefined),
        includeHostInternalDiscovery: discoveryEnabled,
        orchestratorLedgerProvesInternalSandboxToHost: ledgerSandboxToHostRef.current,
      })
      const { result, withHost, models, gavForHook, path } = discovered
      setGavHostTargets((prev) =>
        areNormalizedHostAiTargetListsEqual(prev, gavForHook) ? prev : gavForHook,
      )
      setAvailableModels((prev) =>
        serializeMergedSelectorModelsForStableUi(prev) === serializeMergedSelectorModelsForStableUi(models)
          ? prev
          : (models as AvailableModel[]),
      )

      if (reason === 'manual_refresh' && discoveryEnabled) {
        setHostRefreshFeedback(getHostRefreshFeedbackFromTargets(gavForHook, { path }))
      }

      if (path === 'empty' && models.length === 0) {
        lastInferenceTargetFetchAtRef.current = Date.now()
        return result
      }
      const localCount = models.filter((m) => m.type === 'local').length
      const hostInternalCount = models.filter((m) => m.type === 'host_internal').length
      const gav = gavForHook
      const hostTargetsPayload =
        gav.length > 0
          ? gav.map((t) => ({
              id: t.id,
              kind: t.kind,
              handshake_id: t.handshake_id,
              available: t.available,
              availability: t.availability,
              label: t.label,
              display_label: t.display_label,
              model: t.model,
              model_id: t.model_id,
              secondary_label: t.secondary_label,
              direct_reachable: t.direct_reachable,
              policy_enabled: t.policy_enabled,
            }))
          : models
              .filter((m): m is Extract<AvailableModel, { type: 'host_internal' }> => m.type === 'host_internal')
              .map((m) => ({
                id: m.id,
                type: m.type,
                hostTargetAvailable: m.hostTargetAvailable,
                displayTitle: m.displayTitle,
                displaySubtitle: m.displaySubtitle,
              }))
      const { local, host, final } = countMergedModelList(models)
      const hadMeta = Boolean(withHost.inferenceRefreshMeta?.hadCapabilitiesProbed)
      const hadCap = path === 'list_fallback' ? true : hadMeta
      logInferenceTargetRefreshFromLoad(reason, hadCap, local, host, final)
      lastInferenceTargetFetchAtRef.current = Date.now()
      const ipc =
        path === 'gav_success'
          ? 'handshake:getAvailableModels'
          : path === 'gav_host_only'
            ? 'handshake:getAvailableModels+hostTargetsOnly'
            : 'internal-inference:listTargets+fallback'
      logModelSelectorTargets({
        selector: 'top',
        localCount,
        hostCount: hostInternalCount,
        finalCount: models.length,
        hostTargets: { ipc, rows: hostTargetsPayload },
        selected: { selectedModel: selectedModelRef.current },
      })
      return result
    } catch (err) {
      console.error('Failed to load models:', err)
      if (includeHostInternalDiscoveryRef.current && (reason as InferenceTargetRefreshReason | undefined) === 'manual_refresh') {
        setHostRefreshFeedback(getHostRefreshFeedbackFromTargets([], { path: 'empty', error: err }))
      }
    } finally {
      setModelsLoading(false)
    }
    return null
    // Stable callback: refs carry `includeHostInternalDiscovery` / ledger flags so downstream effects (`loadModels`-dependent) don't loop on unrelated gate flips.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally empty
  }, [])

  useEffect(() => {
    if (hostRefreshFeedback == null) return
    if (hostRefreshFeedbackTimerRef.current) {
      clearTimeout(hostRefreshFeedbackTimerRef.current)
    }
    hostRefreshFeedbackTimerRef.current = setTimeout(() => {
      hostRefreshFeedbackTimerRef.current = null
      setHostRefreshFeedback(null)
    }, 8_000)
    return () => {
      if (hostRefreshFeedbackTimerRef.current) {
        clearTimeout(hostRefreshFeedbackTimerRef.current)
        hostRefreshFeedbackTimerRef.current = null
      }
    }
  }, [hostRefreshFeedback])

  const gavForHostHook = useMemo(
    () => ({
      targets: gavHostTargets,
      refresh: async (reason?: InferenceTargetRefreshReason): Promise<void> => {
        await loadModels(reason)
      },
    }),
    [gavHostTargets, loadModels],
  )
  const hostInf = useSandboxHostInference(hostInferenceProbeId, gavForHostHook)
  const hostModelLabel = useCallback(
    (modelId: string) => {
      const p = parseAnyHostInferenceModelId(modelId)
      if (!p) return null
      const t = hostInf.inferenceTargets.find((x) => x.handshake_id === p.handshakeId)
      const primary = (t as { display_label?: string; label?: string } | undefined)?.display_label || t?.label
      if (primary) return primary
      return 'Host AI'
    },
    [hostInf.inferenceTargets],
  )

  const hostAiSelectionInvalid = useMemo(
    () => isHostInternalSelectionStaleForOrchestratorUi(selectedModel, availableModels, hostInf.inferenceTargets),
    [selectedModel, hostInf.inferenceTargets, availableModels],
  )

  /** Phase 8: never hide Host AI when GAV has targets but merge lagged — synthesize from `gavHostTargets`. */
  const hostInternalMenuModels = useMemo((): Extract<SelectorAvailableModel, { type: 'host_internal' }>[] => {
    const from = availableModels.filter(
      (m): m is Extract<AvailableModel, { type: 'host_internal' }> => m.type === 'host_internal',
    )
    if (from.length > 0) {
      return from
    }
    if (hostInf.treatAsSandboxForHostInternal && gavHostTargets.length > 0) {
      return mapHostTargetsToGavModelEntries(gavHostTargets) as unknown as Extract<
        SelectorAvailableModel,
        { type: 'host_internal' }
      >[]
    }
    return from
  }, [availableModels, gavHostTargets, hostInf.treatAsSandboxForHostInternal])

  const switchOrchestratorChatToLocalModel = useCallback(() => {
    const local = availableModels.find((m) => m.type === 'local')
    if (local) {
      setSelectedModel(local.id)
      setModelMenuOpen(false)
      return
    }
    const cloud = availableModels.find((m) => m.type === 'cloud')
    if (cloud) {
      setSelectedModel(cloud.id)
    } else {
      setSelectedModel('')
    }
    setModelMenuOpen(false)
  }, [availableModels])

  const hostAiRowForStatusStrip = useMemo((): HostInferenceTargetRow | null => {
    if (!isHostInferenceModelId(selectedModel)) return null
    const p = parseAnyHostInferenceModelId(selectedModel)
    if (!p?.handshakeId) return null
    return hostInf.inferenceTargets.find((x) => x.handshake_id === p.handshakeId) ?? null
  }, [selectedModel, hostInf.inferenceTargets])

  const selectedHostMenuModel = useMemo((): Extract<AvailableModel, { type: 'host_internal' }> | null => {
    if (!isHostInferenceModelId(selectedModel)) return null
    return hostInternalMenuModels.find((m) => m.id === selectedModel) ?? null
  }, [hostInternalMenuModels, selectedModel])

  /**
   * Chat-area strip only (above messages). Gate with the same unavailable detection as
   * `hostModelSelectorRowUi` so we never show "connection failed" while the model menu shows connecting/ready.
   */
  const hostDirectP2pStatusUi = useMemo(() => {
    if (!hostInf.treatAsSandboxForHostInternal || mode !== 'chat' || !isHostInferenceModelId(selectedModel)) {
      return null
    }
    const t = hostAiRowForStatusStrip
    if (!t) {
      return null
    }
    const m = selectedHostMenuModel
    const rowUiIn = m
      ? {
          hostSelectorState: m.hostSelectorState,
          hostTargetAvailable: m.hostTargetAvailable,
          displayTitle: m.displayTitle || m.name,
          displaySubtitle: m.displaySubtitle?.trim() || '',
          name: m.id,
          hostLocalModelName: t.model ?? t.model_id,
          p2pUiPhase: t.p2pUiPhase ?? m.p2pUiPhase,
          host_ai_target_status: m.host_ai_target_status ?? t.host_ai_target_status,
        }
      : (() => {
          const pres = computeHostInferenceGavRowPresentation(t)
          return {
            hostSelectorState: pres.hostSelectorState,
            hostTargetAvailable: pres.hostTargetAvailable,
            displayTitle: (t.displayTitle ?? t.display_label ?? t.label ?? '').trim() || 'Host AI',
            displaySubtitle: (t.displaySubtitle ?? t.secondary_label ?? '').trim(),
            name: selectedModel,
            hostLocalModelName: t.model ?? t.model_id,
            p2pUiPhase: t.p2pUiPhase,
            host_ai_target_status: t.host_ai_target_status,
          }
        })()
    if (!hostModelSelectorShowsDefinitiveHostFailure(rowUiIn, t)) {
      return null
    }
    const fromProbe = hostAiUserFacingMessageFromTarget(t, {
      hostWireOllamaReachableOverride: (t as { hostWireOllamaReachable?: boolean }).hostWireOllamaReachable,
    })
    if (fromProbe) {
      return { primary: fromProbe.primary, hint: fromProbe.hint }
    }
    return (
      directP2pReachabilityCopyForSandboxToHost(hostInf.directReachability) ?? {
        primary: 'Connection to host failed',
        hint: 'Host AI is not available for the selected model. Check the model menu or use Refresh (↻).',
      }
    )
  }, [
    hostInf.treatAsSandboxForHostInternal,
    hostInf.directReachability,
    mode,
    selectedModel,
    hostAiRowForStatusStrip,
    selectedHostMenuModel,
  ])

  useEffect(() => {
    setHostInfSuccess(false)
  }, [selectedModel])

  const letterComposerPortForUse = useChatFocusStore((s) =>
    s.chatFocusMode.mode === 'letter-composer' ? s.focusMeta?.letterComposerPort : undefined,
  )

  /** Letter-compose replies must use one full-response "Use" (not parseResponseIntoBlocks), even if project setup "include in chat" is on. */
  const letterComposerFullAnswerUseOnly = useChatFocusStore(
    (s) =>
      s.chatFocusMode.mode === 'letter-composer' && s.focusMeta?.letterComposerPort === 'template',
  )

  /** Top WR Chat uses letter-compose / chatDirect; show normal chat panel even if draft-refine is connected for per-field buttons. */
  const isLetterComposerFocus = useChatFocusStore((s) => s.chatFocusMode.mode === 'letter-composer')

  const applyLetterComposerUseFromText = useCallback((text: string): boolean => {
    const cf = useChatFocusStore.getState()
    if (cf.chatFocusMode.mode !== 'letter-composer') return false
    const meta = cf.focusMeta
    if (!meta || meta.letterComposerPort !== 'template') return false
    const lc = useLetterComposerStore.getState()
    const templateId = meta.letterComposerTemplateId ?? lc.activeTemplateId
    let fields = meta.letterComposerFields
    if ((!fields || fields.length === 0) && templateId) {
      const t = lc.templates.find((x) => x.id === templateId)
      if (t?.fields?.length) {
        fields = t.fields.map((f) => ({ id: f.id, name: f.name, value: f.value }))
      }
    }
    if (!templateId || !fields?.length) return false
    const value = text.trim()
    if (!value) return false
    const lastUser = [...chatMessages].reverse().find((m) => m.role === 'user')?.content ?? ''
    let fieldId = meta.letterComposerApplyFieldId ?? lc.focusedTemplateFieldId ?? null
    if (!fieldId || !fields.some((f) => f.id === fieldId)) {
      fieldId = matchLetterComposerFieldFromMessage(fields, lastUser)
    }
    if (!fieldId) return false
    useLetterComposerStore.getState().updateTemplateField(templateId, fieldId, value)
    return true
  }, [chatMessages])

  const handleChatUseContent = useCallback(
    (content: string, mode: 'append' | 'replace') => {
      const port = useChatFocusStore.getState().chatFocusMode.mode === 'letter-composer'
        ? useChatFocusStore.getState().focusMeta?.letterComposerPort
        : undefined
      if (port === 'letter') return
      if (applyLetterComposerUseFromText(content)) return
      if (window.__wrdeskInsertDraft) window.__wrdeskInsertDraft(content, mode)
    },
    [applyLetterComposerUseFromText],
  )

  const contextDocuments = useAiDraftContextStore((s) => s.documents)
  const removeContextDocument = useAiDraftContextStore((s) => s.removeDocument)
  const clearContextDocuments = useAiDraftContextStore((s) => s.clear)

  const projectSetupIncludeInChat = useProjectSetupChatContextStore((s) => s.includeInChat)
  const projectSetupHasContent = useProjectSetupChatContextStore(projectSetupChatHasBridgeableContent)
  const projectSetupSetupTextDraft = useProjectSetupChatContextStore((s) => s.setupTextDraft)
  const projectSetupSetIncludeInChat = useProjectSetupChatContextStore((s) => s.setIncludeInChat)
  const projectSetupSetSetupTextDraft = useProjectSetupChatContextStore((s) => s.setSetupTextDraft)
  const activeMilestoneChatCtx = useProjectSetupChatContextStore((s) => s.activeMilestoneContext)
  const activeProjectIdForMilestone = useProjectStore((s) => s.activeProjectId)

  /** Derive which project field is currently selected for AI drafting */
  const projectDraftFieldName = (() => {
    const d = projectSetupSetupTextDraft
    const fieldTagMatch = d.match(/^\[field:([^\]]+)\]/)
    if (fieldTagMatch) {
      const f = fieldTagMatch[1]
      if (f === 'title')       return 'Project Title'
      if (f === 'description') return 'Description'
      if (f === 'goals')       return 'Goals'
      if (f === 'milestone')   return 'Milestone'
      if (f === 'milestones')  return 'New Milestones'
      return f
    }
    // Fallbacks for any legacy format still in the store
    if (d.startsWith('Text to edit:') || d.includes('\nText to edit:')) return 'Milestone'
    if (d.includes('EDIT THIS MILESTONE')) return 'Milestone'
    if (d.includes('OUTPUT ONLY A PROJECT TITLE') || d.includes('drafting a PROJECT TITLE')) return 'Project Title'
    if (d.includes('drafting a PROJECT DESCRIPTION')) return 'Description'
    if (d.includes('drafting PROJECT GOALS')) return 'Goals'
    if (d.includes('drafting PROJECT MILESTONES')) return 'New Milestones'
    return 'Project field'
  })()

  /** Parsed response blocks for the AI draft block picker */
  const aiResponseBlocks = useMemo(
    () =>
      letterComposerFullAnswerUseOnly
        ? []
        : activeView === 'analysis' && projectSetupIncludeInChat && response
          ? projectDraftFieldName === 'Project Title'
            ? parseTitleResponse(response)
            : parseResponseIntoBlocks(response)
          : [],
    [letterComposerFullAnswerUseOnly, activeView, projectSetupIncludeInChat, response, projectDraftFieldName],
  )

  const milestoneMarkerSuggestion = useMemo(() => {
    if (activeView !== 'analysis' || !response?.trim()) return null
    return parseMilestoneMarkersFromResponse(response)
  }, [activeView, response])

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
  const isSortingActive = useEmailInboxStore((s) => s.isSortingActive)

  /** True when the chat bar should run draft-refine (inbox message or standalone compose with null ids). */
  const isDraftRefineSession =
    draftRefineConnected &&
    (draftRefineMessageId === selectedMessageId ||
      (draftRefineMessageId === null && selectedMessageId == null) ||
      draftRefineTarget === 'letter-template')

  /** Derived focus context — distinguishes outer message vs draft sub-focus vs attachment above chat. */
  const uiFocusContext: UiFocusContext = useMemo(() => {
    if (draftRefineConnected && draftRefineTarget === 'letter-template') {
      return { kind: 'draft', messageId: '__letter-template__' }
    }
    if (
      (activeView === 'beap-inbox' || activeView === 'analysis') &&
      draftRefineConnected &&
      draftRefineMessageId === null &&
      selectedMessageId == null
    ) {
      return {
        kind: 'draft',
        messageId: activeView === 'analysis' ? '__dashboard-compose__' : '__compose__',
      }
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
  }, [
    activeView,
    selectedMessageId,
    selectedAttachmentId,
    inboxSubFocus,
    draftRefineConnected,
    draftRefineMessageId,
    draftRefineTarget,
  ])
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
          : draftRefineTarget === 'email-subject'
            ? ' · Subject'
            : draftRefineTarget === 'email'
              ? ' · Body'
              : draftRefineTarget === 'letter-template'
                ? ' · Letter template'
                : ''
      : ''

  const draftRefineChipTitle =
    uiFocusContext.kind === 'draft' && isDraftRefineSession
      ? draftRefineTarget === 'capsule-public'
        ? 'Chat scoped to public capsule draft — refine with AI'
        : draftRefineTarget === 'capsule-encrypted'
          ? 'Chat scoped to encrypted capsule draft — refine with AI'
          : draftRefineTarget === 'email-subject'
            ? 'Chat scoped to email subject — refine with AI'
            : draftRefineTarget === 'email'
              ? 'Chat scoped to email body — refine with AI'
              : draftRefineTarget === 'letter-template'
                ? 'Chat scoped to letter template field — refine with AI'
                : 'Chat scoped to draft — refine with AI'
      : 'Chat scoped to draft — refine with AI'

  useEffect(() => {
    if (draftRefineConnected) setMode('chat')
  }, [draftRefineConnected])

  useEffect(() => {
    if (!draftRefineConnected) setDraftRefineHistory([])
  }, [draftRefineConnected])

  const handleClearMessageSelection = useCallback(() => {
    const wasLetterTemplate = useDraftRefineStore.getState().refineTarget === 'letter-template'
    draftRefineDisconnect()
    if (!wasLetterTemplate) {
      onClearMessageSelection?.()
    }
  }, [draftRefineDisconnect, onClearMessageSelection])

  // Load available models: first paint when mode is known (startup) + when Sandbox/Host or mode binding changes (mode_change).
  useEffect(() => {
    if (!orchModeReady) {
      return
    }
    if (isFirstOrchListRef.current) {
      isFirstOrchListRef.current = false
      void loadModels('startup')
      return
    }
    void loadModels('mode_change')
  }, [loadModels, orchModeReady, orchIsSandbox, ledgerProvesInternalSandboxToHost])

  useEffect(() => {
    const onHandshake = () => {
      void loadModels('handshake_active')
    }
    window.addEventListener('handshake-list-refresh', onHandshake)
    return () => {
      window.removeEventListener('handshake-list-refresh', onHandshake)
    }
  }, [loadModels])

  useEffect(() => {
    const onP2p = (e: Event) => {
      const d = (e as CustomEvent<{ reason?: string }>).detail
      if (d?.reason === 'p2p_change') {
        void loadModels('p2p_change')
      }
    }
    window.addEventListener('inference-target-refresh', onP2p)
    return () => {
      window.removeEventListener('inference-target-refresh', onP2p)
    }
  }, [loadModels])

  useEffect(() => {
    const onOrchestratorMode = () => {
      void loadModels('mode_change')
    }
    window.addEventListener('orchestrator-mode-changed', onOrchestratorMode)
    return () => {
      window.removeEventListener('orchestrator-mode-changed', onOrchestratorMode)
    }
  }, [loadModels])

  useEffect(() => {
    const onBuild = () => {
      clearPersistedHostAiInferenceSelection()
      orchestratorChatModelRestoredRef.current = false
      lastOrchestratorSelectionValidateLogKeyRef.current = ''
      void loadModels('orchestrator_build_changed')
    }
    window.addEventListener('host-ai-orchestrator-build-changed', onBuild)
    return () => {
      window.removeEventListener('host-ai-orchestrator-build-changed', onBuild)
    }
  }, [loadModels])

  useEffect(() => {
    if (selectedModel) {
      persistOrchestratorModelId(selectedModel, availableModels)
      const payload = buildAiExecutionContextIpcPayload(selectedModel, gavHostTargets)
      if (payload && typeof window.llm?.setAiExecutionContext === 'function') {
        void window.llm.setAiExecutionContext(payload)
      }
    }
  }, [selectedModel, availableModels, gavHostTargets])

  // App resume and account switch: refetch (Host hook also reloads on handshake-list-refresh + orchestrator-mode-changed).
  useEffect(() => {
    const onResume = () => {
      if (document.visibilityState !== 'visible') return
      const next = accountKeyFromSession()
      if (next !== lastAccountKeyForOrchRef.current) {
        lastAccountKeyForOrchRef.current = next
        orchestratorChatModelRestoredRef.current = false
        lastOrchestratorSelectionValidateLogKeyRef.current = ''
        setGavHostTargets([])
        setAvailableModels([])
        setModelsLoading(true)
        void loadModels('account_change')
        return
      }
      void loadModels('visibility_resume')
    }
    document.addEventListener('visibilitychange', onResume)
    return () => document.removeEventListener('visibilitychange', onResume)
  }, [loadModels])

  useEffect(() => {
    if (modelsLoading) {
      return
    }
    if (hostInf.treatAsSandboxForHostInternal && hostInf.listLoading) {
      return
    }
    const ak = accountKeyFromSession()
    if (ak !== lastAccountKeyForOrchRef.current) {
      lastAccountKeyForOrchRef.current = ak
      orchestratorChatModelRestoredRef.current = false
      lastOrchestratorSelectionValidateLogKeyRef.current = ''
    }
    if (orchestratorChatModelRestoredRef.current) {
      return
    }
    setInferenceSelectionPersistError(null)
    const stored = readOrchestratorInferenceSelection()
    const hasLocal = availableModels.some((m) => m.type === 'local')
    if (stored) {
      const v = validateStoredSelectionForOrchestratorWithDiagnostics(
        stored,
        availableModels,
        hostInf.inferenceTargets,
        hostInf.treatAsSandboxForHostInternal,
        hasLocal,
      )
      logOrchestratorModelSelectionValidateIfChanged(lastOrchestratorSelectionValidateLogKeyRef, v)
      if (v.error) {
        if (v.error === 'host_unavailable') {
          setInferenceSelectionPersistError(HOST_INFERENCE_UNAVAILABLE)
        } else {
          setInferenceSelectionPersistError(
            'The saved chat model is no longer available. Choose another model.',
          )
        }
        clearOrchestratorInferenceSelection()
        setSelectedModel('')
        orchestratorChatModelRestoredRef.current = true
        return
      }
      if (v.modelId) {
        setSelectedModel(v.modelId)
        orchestratorChatModelRestoredRef.current = true
        return
      }
    }
    const firstCloud = availableModels.find((m) => m.type === 'cloud')?.id
    const firstHost =
      availableModels.find((m) => m.type === 'host_internal' && m.hostTargetAvailable)?.id ??
      hostInf.inferenceTargets.find((t) => hostInferenceTargetMenuSelectable(t))?.id
    const firstLocal = availableModels.find((m) => m.type === 'local')?.id
    const preferred =
      (hostInf.treatAsSandboxForHostInternal ? firstCloud ?? firstHost ?? firstLocal : firstLocal ?? firstCloud) ??
      availableModels[0]?.id ??
      ''
    setSelectedModel((prev) => {
      if (isHostInferenceModelId(prev)) {
        if (availableModels.some((m) => m.id === prev)) {
          return prev
        }
        return preferred
      }
      if (availableModels.some((m) => m.id === prev)) {
        return prev
      }
      return preferred
    })
    orchestratorChatModelRestoredRef.current = true
  }, [
    modelsLoading,
    hostInf.treatAsSandboxForHostInternal,
    hostInf.listLoading,
    hostInf.inferenceTargets,
    availableModels,
  ])

  useEffect(() => {
    if (selectedModel) {
      setInferenceSelectionPersistError(null)
    }
  }, [selectedModel])

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

  // Close chat model menu if autosort starts while it is open
  useEffect(() => {
    if (isSortingActive && modelMenuOpen) setModelMenuOpen(false)
  }, [isSortingActive, modelMenuOpen])

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

  // Clear full chat state when the panel closes
  useEffect(() => {
    if (!showPanel) {
      setChatAttachments([])
      setChatMessages([])
      setResponse(null)
      setContextBlocks([])
      setChatSources([])
      setStructuredResult(null)
      setResultType(null)
      setUsedBlockIds(new Set())
    }
  }, [showPanel])

  // Clear chat attachments when ProjectOptimizationPanel switches fields
  useEffect(() => {
    const handler = () => setChatAttachments([])
    window.addEventListener('wrdesk:clear-chat-attachments', handler)
    return () => window.removeEventListener('wrdesk:clear-chat-attachments', handler)
  }, [])

  // Clear full chat state when fields switch (previous response is for a different field)
  useEffect(() => {
    const handler = () => {
      setChatMessages([])
      setResponse(null)
      setContextBlocks([])
      setChatSources([])
      setStructuredResult(null)
      setResultType(null)
      setUsedBlockIds(new Set())
    }
    window.addEventListener('wrdesk:clear-chat-conversation', handler)
    return () => window.removeEventListener('wrdesk:clear-chat-conversation', handler)
  }, [])

  // Letter Composer only: clear current response (keep chat history) when the focused template field changes
  useEffect(() => {
    let prevFieldId = useLetterComposerStore.getState().focusedTemplateFieldId
    const unsub = useLetterComposerStore.subscribe((state) => {
      const curr = state.focusedTemplateFieldId
      if (curr === prevFieldId) return
      prevFieldId = curr
      if (useChatFocusStore.getState().chatFocusMode.mode !== 'letter-composer') return
      if (curr == null) return
      chatGenerationRef.current += 1
      setResponse(null)
      setContextBlocks([])
      setChatSources([])
      setStructuredResult(null)
      setResultType(null)
      setUsedBlockIds(new Set())
    })
    return unsub
  }, [])

  // Auto-scroll to bottom when chatMessages updates
  useEffect(() => {
    const el = chatContainerRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chatMessages])

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

    if (mode === 'chat' && !isDraftRefineSession && hostAiSelectionInvalid) {
      setResponse(
        'Host AI is not ready for this run. Open the model menu, wait for a ready state, or pick a local or cloud model.',
      )
      setShowPanel(true)
      return
    }

    chatGenerationRef.current += 1

    const previousAnswer = response
    setLastMode(mode)
    setIsLoading(true)
    setShowPanel(true)
    setHostInfSuccess(false)
    setHostInfRunUi(null)
    setResults([])
    setResponse(null)
    setContextBlocks([])
    setChatSources([])
    setStructuredResult(null)
    setResultType(null)

    // ── Chat conversation: push previous AI answer + current user message, clear input ──
    if (mode === 'chat' && !isDraftRefineSession) {
      setChatMessages(prev => {
        const next = [...prev]
        if (previousAnswer?.trim()) next.push({ role: 'assistant', content: previousAnswer.trim() })
        next.push({ role: 'user', content: trimmed })
        return next
      })
      setQuery('')
    }

    try {
      const effectiveScope = selectedHandshakeId ?? selectedMessageId ?? scope
      if (mode === 'search') {
        const r = await runSearch(trimmed, effectiveScope, selectedHandshakeId)
        setResults(r)
      } else if (mode === 'actions') {
        setResponse('Actions mode: Draft, analyze, extract, or automate based on the selected handshake or message. Coming soon.')
      } else {
        if (mode === 'chat' && !isDraftRefineSession) {
          const mEntry = availableModels.find((m) => m.id === selectedModel)
          const isHostInternalChat =
            mEntry?.type === 'host_internal' || isHostInferenceModelId(selectedModel)
          if (!isHostInternalChat) {
            /* fall through to stream / local */
          } else {
            setChatGovernanceNote(null)
            setChatRetrievalDebugNote(null)
            setStructuredResult(null)
            setResultType(null)
            const parsed = parseAnyHostInferenceModelId(selectedModel)
            const hid = parsed?.handshakeId
            if (!hid) {
              setResponse('That Host AI selection is not in the list. Open the model menu and select Host AI again.')
              setIsLoading(false)
              return
            }
            const target = findHostInferenceTargetRowForChatSelection(hostInf.inferenceTargets, selectedModel)
            if (!target) {
              setResponse('That Host AI selection is not in the list. Open the model menu and select Host AI again.')
              setIsLoading(false)
              return
            }

            const modelParam =
              parsed?.model?.trim() ||
              target.model_id?.trim() ||
              target.model?.trim() ||
              undefined

            const hostMenuRow = mEntry?.type === 'host_internal' ? mEntry : null
            const laneFromMerged: HostModelRemoteLane | null =
              hostMenuRow?.remoteLane === 'ollama_direct' || hostMenuRow?.remoteLane === 'beap'
                ? hostMenuRow.remoteLane
                : null
            const remoteLane: HostModelRemoteLane = laneFromMerged ?? inferHostModelRemoteLane(target)

            console.log(
              `[HOST_AI_CHAT_ROUTE] model=${modelParam ?? ''} lane=${remoteLane} beapReady=${Boolean(target.beapReady)} ollamaDirectReady=${Boolean(target.ollamaDirectReady)} failureCode=${target.failureCode ?? 'null'}`,
            )

            if (remoteLane === 'ollama_direct') {
              if (target.ollamaDirectReady !== true) {
                setResponse(formatInternalInferenceErrorCode('HOST_AI_OLLAMA_DIRECT_LANE_NOT_READY'))
                setIsLoading(false)
                return
              }
            } else {
              if (target.beapReady !== true) {
                setResponse(formatInternalInferenceErrorCode('HOST_AI_DIRECT_PEER_BEAP_MISSING'))
                setIsLoading(false)
                return
              }
            }
            const row = hostInf.candidates.find((c) => c.handshakeId === hid)
            if (remoteLane === 'beap' && !row?.directP2pAvailable) {
              setResponse(
                'Host AI · P2P unavailable. Check that the Host is online, then use Refresh (↻) in the model menu, or pick another model.',
              )
              setIsLoading(false)
              return
            }
            if (hostInf.policy === 'deny') {
              setResponse(
                'Host AI · disabled by Host. On the Host, enable Sandbox inference for this device, or pick another model here.',
              )
              setIsLoading(false)
              return
            }
            const run = getRequestHostCompletion(window)
            if (typeof run !== 'function') {
              setResponse('Host AI is not available in this build. Pick a local or cloud model instead.')
              setIsLoading(false)
              return
            }
            setHostInfSuccess(false)
            const hostComputerName = (target?.host_computer_name ?? row?.hostDisplayName ?? 'Host').trim() || 'Host'
            setHostInfRunUi({
              line1: `Running on Host AI · ${hostModelDisplayNameFromSelection({
                parsedModel: modelParam,
                targetLabel: target?.display_label || target?.label,
              })}`,
              line2: hostComputerName,
            })
            const prior = chatMessages.map((m) => ({ role: m.role, content: m.content }))
            const userLine = prependChatAttachmentsToUserText(trimmed, chatAttachments)
            const msgSeq =
              previousAnswer?.trim() && mode === 'chat' && !isDraftRefineSession
                ? [
                    ...prior,
                    { role: 'assistant' as const, content: previousAnswer.trim() },
                    { role: 'user' as const, content: userLine },
                  ]
                : [...prior, { role: 'user' as const, content: userLine }]
            try {
              const r = (await run({
                targetId: selectedModel,
                handshakeId: hid,
                messages: msgSeq,
                model: modelParam,
                timeoutMs: 120_000,
                execution_transport: remoteLane === 'ollama_direct' ? ('ollama_direct' as const) : undefined,
              })) as
                | { ok: true; output: string }
                | { ok: false; code: string; message: string }
              if (r && 'ok' in r && r.ok) {
                const out = (r as { output: string }).output
                setResponse(appendHostAiAttributionLine(out, hostComputerName))
                setHostInfSuccess(true)
              } else {
                const er = r as { ok: false; code: string; message: string }
                setResponse(formatInternalInferenceErrorCode(er.code, er.message))
                setHostInfSuccess(false)
              }
            } catch {
              setResponse(formatInternalInferenceErrorCode(undefined))
              setHostInfSuccess(false)
            } finally {
              setHostInfRunUi(null)
              setIsLoading(false)
              setChatAttachments([])
            }
            return
          }
        }
        const modelInfo = availableModels.find(m => m.id === selectedModel)
        const streamedRef = { current: '' }
        const streamGenAtSubmit = chatGenerationRef.current
        // Register stream listeners before ANY branch that calls IPC with stream:true (multi-version, letter-compose, field-drafting, RAG).
        const unsubStart = window.handshakeView?.onChatStreamStart?.((data: { contextBlocks: string[]; sources: ChatSource[] }) => {
          if (chatGenerationRef.current !== streamGenAtSubmit) return
          setContextBlocks(data.contextBlocks ?? [])
          setChatSources(data.sources ?? [])
          setIsLoading(false)
        })
        const unsubToken = window.handshakeView?.onChatStreamToken?.((data: { token: string }) => {
          if (chatGenerationRef.current !== streamGenAtSubmit) return
          const tok = data.token ?? ''
          streamedRef.current += tok
          setResponse(prev => (prev ?? '') + tok)
        })

        const isDraftRefine = isDraftRefineSession
        const currentDraft = isDraftRefine ? (useDraftRefineStore.getState().draftText || draftRefineDraftText || '') : ''
        const contextDocs = useAiDraftContextStore.getState().documents

        const isLetterTemplateMultiVersion =
          mode === 'chat' &&
          !isDraftRefine &&
          activeView === 'analysis' &&
          wantsLetterTemplateMultiVersion(trimmed) &&
          useChatFocusStore.getState().chatFocusMode.mode === 'letter-composer' &&
          useChatFocusStore.getState().focusMeta?.letterComposerPort === 'template'

        if (isLetterTemplateMultiVersion && window.handshakeView?.chatDirect) {
          const lc = useLetterComposerStore.getState()
          const fm = useChatFocusStore.getState().focusMeta
          const tid = fm?.letterComposerTemplateId ?? lc.activeTemplateId
          const tpl = tid ? lc.templates.find((t) => t.id === tid) : null
          const cleanupSubs = () => {
            unsubStart?.()
            unsubToken?.()
          }
          if (tpl?.fields.length) {
            const fieldLines = tpl.fields
              .map(
                (f) =>
                  `- Field id "${f.id}" (${f.name}, ${f.type}). Placeholder in document: ${f.placeholder?.trim() || `{{${f.id}}}`}.`,
              )
              .join('\n')
            const idsList = tpl.fields.map((f) => `"${f.id}"`).join(', ')
            const systemPrompt = `You fill business letter templates. Output ONLY a single JSON object whose keys are EXACTLY these field ids: ${idsList}. Each value is the filled string for that field. No markdown code fences, no commentary, no text before or after the JSON.\n\nFields:\n${fieldLines}`
            // Raw instruction only — same as letter-compose: avoid getChatFocusLlmPrefix (German template snapshot leaks language).
            const userPrompt = `Instruction:\n${trimmed}`
            const temps = [0.35, 0.72, 1.0] as const
            const snapshots: Array<Record<string, string>> = []
            try {
              for (let i = 0; i < 3; i++) {
                const r = await window.handshakeView.chatDirect({
                  model: selectedModel || 'llama3',
                  provider: modelInfo?.provider || 'ollama',
                  systemPrompt,
                  userPrompt,
                  stream: false,
                  temperature: temps[i],
                })
                if (!r?.success || typeof r.answer !== 'string') {
                  throw new Error(
                    (r as { message?: string })?.message ||
                      (r as { error?: string })?.error ||
                      'LLM call failed',
                  )
                }
                const parsed = parseLetterFillJson(r.answer, tpl.fields.map((f) => f.id))
                if (!parsed) throw new Error('Model did not return valid JSON for the template fields.')
                snapshots.push(parsed)
              }
              useLetterComposerStore.getState().setTemplateVersions(tpl.id, snapshots, 0)
              setResponse(
                'Generated 3 versions of your template. Use the version controls in the Template port to compare them.',
              )
              setContextBlocks([])
              setChatSources([])
              setStructuredResult(null)
              setResultType(null)
              setChatGovernanceNote(null)
              setChatRetrievalDebugNote(null)
            } catch (e) {
              setResponse((e as Error)?.message ?? 'Could not generate template versions.')
              setChatSources([])
              setChatGovernanceNote(null)
              setChatRetrievalDebugNote(null)
            } finally {
              cleanupSubs()
              setIsLoading(false)
              setChatAttachments([])
            }
            return
          }
        }

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
          } else if (target === 'email-subject') {
            fieldLabel = 'email subject line'
          } else if (target === 'email') {
            fieldLabel = 'email body'
          } else if (target === 'letter-template') {
            fieldLabel = 'letter template field'
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

        if (!isDraftRefine && useChatFocusStore.getState().chatFocusMode.mode !== 'letter-composer') {
          const focusPrefix = getChatFocusLlmPrefix(useChatFocusStore.getState())
          if (focusPrefix) chatQuery = focusPrefix + chatQuery
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

        // ── Prepend chat attachments (PDF extracted text + image placeholders) ──
        if (chatAttachments.length > 0) {
          const parts: string[] = []
          for (const att of chatAttachments) {
            if (att.type === 'pdf') {
              parts.push(`[Attached PDF: ${att.filename}]\n${att.data}\n[End of PDF]`)
            } else {
              parts.push(`[User attached image: ${att.filename}. Image analysis requires a multi-modal model.]`)
            }
          }
          if (parts.length > 0) chatQuery = parts.join('\n\n') + '\n\n' + chatQuery
        }

        const amCtx =
          !isDraftRefine && activeView === 'analysis'
            ? useProjectSetupChatContextStore.getState().activeMilestoneContext
            : null
        const milestoneContextBlock =
          amCtx
            ? `\n\nThe user is currently working on this milestone:\nTitle: ${amCtx.title}\nDescription: ${amCtx.description}\n\nIf the user asks to refine, improve, or edit the milestone, produce an improved version. Format your response as:\n[MILESTONE_TITLE]: <improved title>\n[MILESTONE_DESC]: <improved description>\n\nIf the user is not asking about the milestone, respond normally.`
            : ''

        /** Detect field-drafting mode: when a project field is selected for AI editing,
         *  bypass chatWithContextRag entirely and call chatDirect instead. This avoids
         *  the RAG system prompt ("answer ONLY from context blocks") which conflicts
         *  with field-editing tasks and causes the model to ignore or lose the field content. */
        const fieldDraftState = (!isDraftRefine && activeView === 'analysis')
          ? useProjectSetupChatContextStore.getState()
          : null
        const isFieldDrafting = !!(fieldDraftState?.includeInChat && fieldDraftState?.setupTextDraft.trim())

        // --- Letter Composer direct chat (bypasses RAG) ---
        // chatDirect streams via handshake:chatStreamToken; unsubToken/unsubStart above are registered before this branch (same as field-drafting chatDirect).
        const letterRoute = resolveChatRoute({
          mode,
          activeView,
          isDraftRefineSession,
          trimmedQuery: trimmed,
          wantsLetterTemplateMultiVersion: wantsLetterTemplateMultiVersion(trimmed),
          isFieldDrafting,
        })
        if (
          !isFieldDrafting &&
          useChatFocusStore.getState().chatFocusMode.mode === 'letter-composer' &&
          letterRoute.kind === 'letter-compose'
        ) {
          let chatAttachmentTextForLetter: string | null = null
          if (chatAttachments.length > 0) {
            const parts: string[] = []
            for (const att of chatAttachments) {
              if (att.type === 'pdf') {
                parts.push(`[Attached PDF: ${att.filename}]\n${att.data}\n[End of PDF]`)
              } else {
                parts.push(`[User attached image: ${att.filename}. Image analysis requires a multi-modal model.]`)
              }
            }
            if (parts.length > 0) chatAttachmentTextForLetter = parts.join('\n\n')
          }
          try {
            const letterResult = await handleLetterComposerChat({
              userQuery: trimmed,
              chatAttachmentText: chatAttachmentTextForLetter,
              model: selectedModel || 'llama3',
              provider: modelInfo?.provider || 'ollama',
              stream: true,
            })
            if (!letterResult.success) {
              setResponse(letterResult.error || 'Letter composer error')
            } else {
              const ans = letterResult.answer ?? ''
              setResponse((prev) => prev || ans)
            }
          } catch (err: any) {
            setResponse(err?.message || 'Letter composer error')
          } finally {
            unsubStart?.()
            unsubToken?.()
          }
          setIsLoading(false)
          setChatAttachments([])
          return
        }
        // --- end letter composer ---

        let result: Awaited<ReturnType<NonNullable<typeof window.handshakeView>['chatWithContextRag']>> | undefined
        try {
          if (isFieldDrafting && window.handshakeView?.chatDirect) {
            const draft = fieldDraftState!.setupTextDraft.trim()
            const fieldTagMatch = draft.match(/^\[field:([^\]]+)\]\n?/)
            const fieldName = fieldTagMatch ? fieldTagMatch[1] : 'content'
            const content = fieldTagMatch
              ? draft.slice(fieldTagMatch[0].length).trim()
              : draft.trim()

            let systemPrompt =
              'You are a helpful writing assistant. When the user provides text and asks you to modify, rewrite, or improve it, output ONLY the modified text. No explanations, no preamble, no markdown formatting unless the original text uses markdown. Match the language of the user\'s request.'
            if (milestoneContextBlock) systemPrompt += milestoneContextBlock
            let userPrompt: string
            if (content) {
              userPrompt = `Here is the current ${fieldName}:\n\n${content}\n\nInstruction: ${chatQuery}`
            } else {
              userPrompt = `Write a ${fieldName} based on this instruction: ${chatQuery}`
            }

            result = await window.handshakeView.chatDirect({
              model: selectedModel || 'llama3',
              provider: modelInfo?.provider || 'ollama',
              systemPrompt,
              userPrompt,
              stream: true,
            })
          } else {
            const ragQuery = milestoneContextBlock ? chatQuery + milestoneContextBlock : chatQuery
            result = await window.handshakeView?.chatWithContextRag?.({
              query: ragQuery,
              scope: effectiveScope,
              model: selectedModel || 'llama3',
              provider: modelInfo?.provider || 'ollama',
              stream: true,
              conversationContext: previousAnswer?.trim() ? { lastAnswer: previousAnswer } : undefined,
              selectedDocumentId: selectedDocumentId ?? undefined,
              selectedAttachmentId: selectedAttachmentId ?? undefined,
              selectedMessageId: selectedMessageId ?? undefined,
              sandboxInferenceHandshakeId: selectedHandshakeId ?? undefined,
              beapContentTaskKind: isDraftRefine ? 'refine' : 'chat_rag',
              requiresTopChatTools: false,
            })
          }
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
          } else if (result?.error === 'inference_routing_unavailable') {
            const r = result as { message?: string }
            setResponse(
              typeof r.message === 'string' && r.message.trim()
                ? r.message
                : 'No AI available. Either install Ollama on this device, or connect to a host running Ollama.',
            )
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
          setChatRetrievalDebugNote(null)
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
            const refineTargetNow = useDraftRefineStore.getState().refineTarget
            const paras = refined.split(/\n\n+/).map((s) => s.trim()).filter(Boolean)
            if (refineTargetNow === 'letter-template' && paras.length > 1) {
              setDraftRefineHistory((prev) => [
                ...prev,
                {
                  role: 'assistant',
                  content: refined,
                  refineParagraphs: paras,
                },
              ])
            } else {
              setDraftRefineHistory((prev) => [
                ...prev,
                {
                  role: 'assistant',
                  content: refined,
                  showUseButton: true,
                  onUse: () => draftRefineAcceptRefinement(),
                },
              ])
            }
            setResponse(null)
            setQuery('')
          }
          setChatGovernanceNote(result.governanceNote ?? null)
          const cr = result.contextRetrieval
          setChatRetrievalDebugNote(
            cr?.mode === 'none' && cr?.warningCode
              ? 'Semantic context unavailable; generated without retrieval context.'
              : null,
          )
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
      setChatRetrievalDebugNote(null)
      setStructuredResult(null)
      setResultType(null)
    } finally {
      setIsLoading(false)
      setChatAttachments([])
    }
  }, [query, mode, scope, activeView, selectedHandshakeId, selectedMessageId, selectedAttachmentId, selectedModel, availableModels, isLoading, response, selectedDocumentId, isDraftRefineSession, draftRefineDraftText, draftRefineTarget, draftRefineDeliverResponse, draftRefineAcceptRefinement, chatAttachments, chatMessages, hostInf.inferenceTargets, hostInf.policy, hostAiSelectionInvalid])

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
        if (file) {
          await processDroppedFile(file)
          setShowPanel(true)
        }
      } else if (item.type === 'application/pdf') {
        const file = item.getAsFile()
        if (file) {
          await processDroppedFile(file)
          setShowPanel(true)
        }
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
    >
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
              // Clear all store draft fields — prevents stale goalsDraft / milestonesDraft
              // from contaminating the next field selection
              const store = useProjectSetupChatContextStore.getState()
              store.setIncludeInChat(false)
              store.setSetupTextDraft('')
              store.setGoalsDraft('')
              store.setMilestonesDraft('')
              store.clearSnippets()
              // Clear drop-zone attachments, conversation, and last AI response — they are field-specific
              setChatAttachments([])
              setChatMessages([])
              setResponse(null)
              setContextBlocks([])
              setChatSources([])
              setStructuredResult(null)
              setResultType(null)
              setUsedBlockIds(new Set())
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
      {hostInf.treatAsSandboxForHostInternal && mode === 'chat' && hostDirectP2pStatusUi && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            padding: '4px 10px',
            marginBottom: 4,
            borderRadius: 6,
            background: 'rgba(15, 23, 42, 0.35)',
            border: '1px solid var(--color-border, rgba(255,255,255,0.1))',
          }}
          role="status"
          aria-label="Connection status to your Host for Host models"
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--text-secondary, #cbd5e1)',
            }}
          >
            {hostDirectP2pStatusUi.primary}
          </span>
          {hostDirectP2pStatusUi.hint ? (
            <span style={{ fontSize: 10, color: 'var(--text-muted, #94a3b8)', lineHeight: 1.35 }}>{hostDirectP2pStatusUi.hint}</span>
          ) : null}
        </div>
      )}
      {mode === 'chat' && hostInf.treatAsSandboxForHostInternal && (hostAiRowForStatusStrip as { host_ai_endpoint_diagnostics?: HostAiEndpointDiagnostics } | null)?.host_ai_endpoint_diagnostics ? (
        (() => {
          const d = (hostAiRowForStatusStrip as { host_ai_endpoint_diagnostics: HostAiEndpointDiagnostics }).host_ai_endpoint_diagnostics
          return (
            <div
              className="hs-host-diag"
              style={{
                fontSize: 10,
                color: 'var(--text-muted, #94a3b8)',
                padding: '4px 10px 6px',
                marginBottom: 4,
                borderRadius: 6,
                background: 'rgba(15, 23, 42, 0.45)',
                border: '1px solid var(--color-border, rgba(255,255,255,0.08))',
                lineHeight: 1.4,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
              }}
              role="status"
              aria-label="Host AI endpoint diagnostics"
            >
              <div style={{ fontWeight: 600, color: 'var(--text-secondary, #cbd5e1)', marginBottom: 4, fontSize: 11, fontFamily: 'inherit' }}>Host AI diagnostics</div>
              <div>local_device_id: {d.local_device_id || '—'}</div>
              <div>peer_host_device_id: {d.peer_host_device_id || '—'}</div>
              <div>selected_endpoint: {d.selected_endpoint || '—'}</div>
              <div>selected_endpoint_owner: {d.selected_endpoint_owner || '—'}</div>
              <div>local_beap_endpoint: {d.local_beap_endpoint || '—'}</div>
              <div>peer_advertised_endpoint: {d.peer_advertised_beap_endpoint || '—'}</div>
              {d.webrtc_available !== undefined ? <div>webrtc_available: {String(d.webrtc_available)}</div> : null}
              {d.direct_http_available !== undefined ? <div>direct_http_available: {String(d.direct_http_available)}</div> : null}
              {d.relay_available !== undefined ? <div>relay_available: {String(d.relay_available)}</div> : null}
              {d.local_role !== undefined ? <div>local_role: {d.local_role || '—'}</div> : null}
              {d.peer_role !== undefined ? <div>peer_role: {d.peer_role || '—'}</div> : null}
              {d.requester_role !== undefined ? <div>requester_role: {d.requester_role || '—'}</div> : null}
              {d.receiver_role !== undefined ? <div>receiver_role: {d.receiver_role || '—'}</div> : null}
              <div>rejection_reason: {d.rejection_reason || '—'}</div>
            </div>
          )
        })()
      ) : null}
      {mode === 'chat' && (hostInfRunUi || hostInfSuccess) && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: 2,
            padding: '4px 10px',
            marginBottom: 4,
            borderRadius: 6,
            background: hostInfSuccess ? 'linear-gradient(90deg, rgba(234,179,8,0.12), rgba(217,119,6,0.08))' : 'rgba(30, 64, 175, 0.08)',
            border: hostInfSuccess ? '1px solid rgba(217, 119, 6, 0.35)' : '1px solid rgba(30, 64, 175, 0.2)',
          }}
          role="status"
        >
          {hostInfRunUi ? (
            <>
              <span style={{ fontSize: 12, color: 'var(--text-primary, #e2e8f0)', fontWeight: 600 }}>
                {hostInfRunUi.line1}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-muted, #94a3b8)', fontWeight: 500 }}>{hostInfRunUi.line2}</span>
              <span style={{ fontSize: 10, color: 'var(--text-muted, #94a3b8)', fontStyle: 'italic' }}>
                Cancel is not available while using a Host model
              </span>
            </>
          ) : null}
          {hostInfSuccess && !hostInfRunUi ? (
            <span style={{ fontSize: 12, color: '#b45309', fontWeight: 600 }}>Host model finished</span>
          ) : null}
        </div>
      )}
      {inferenceSelectionPersistError && mode === 'chat' && (
        <div className="hs-host-stale" role="alert">
          <span className="hs-host-stale__text">{inferenceSelectionPersistError}</span>
        </div>
      )}
      {hostAiSelectionInvalid && mode === 'chat' && (
        <div
          className="hs-host-stale"
          role="alert"
        >
          <span className="hs-host-stale__text">{HOST_AI_STALE_INLINE}</span>
          <button
            type="button"
            className="hs-host-stale__action"
            onClick={switchOrchestratorChatToLocalModel}
          >
            Use a local or cloud model
          </button>
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
                      : draftRefineTarget === 'email-subject'
                        ? 'Chat scoped to email subject'
                        : draftRefineTarget === 'email'
                          ? 'Chat scoped to email body'
                          : draftRefineTarget === 'letter-template'
                            ? 'Chat scoped to letter template'
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
        {/* ── Chat attachment file picker (images + PDFs) — inside the panel drop zone ── */}
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
        <input
          ref={inputRef}
          className="hs-input"
          type="text"
          placeholder={
            isDraftRefineSession
              ? draftRefineTarget === 'letter-template'
                ? 'Refine this letter field — e.g. formal reply declining the request…'
                : draftRefineMessageId === null && selectedMessageId == null ? 'Draft your message — type an instruction for AI'
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

        {/* ── Right: action button + Host refresh status (absolute below selector on Sandbox) ── */}
        <div className="hs-send-group-wrap">
        <div className="hs-send-group" ref={modelMenuRef}>
          <button
            className={`hs-send-btn hs-send-btn--${mode === 'actions' ? 'actions' : mode}`}
            onClick={handleSubmit}
            disabled={!query.trim() || isLoading}
            title={
              mode === 'chat'
                ? `Send to ${getModelLabel(selectedModel, availableModels, hostModelLabel)} (Enter)`
                : mode === 'search'
                ? 'Run search (Enter)'
                : `Run action with ${getModelLabel(selectedModel, availableModels, hostModelLabel)} (Enter)`
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

          {/* Model picker — Chat / Actions only. Does NOT affect Auto-Sort (autosort has its own selector in the inbox toolbar row). */}
          {showModelSelector && (
            <>
              {showHostAiDiscoveryControls && (
                <button
                  type="button"
                  className="hs-inference-refresh"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    void loadModels('manual_refresh', { force: true })
                  }}
                  disabled={isSortingActive}
                  aria-label="Refresh Host AI model list (Sandbox)"
                  title="Re-fetch the paired Host’s model list and capabilities (Sandbox only)"
                >
                  ↻
                </button>
              )}
              <button
                className={`hs-model-selector${modelMenuOpen ? ' hs-model-caret--open' : ''}${mode === 'actions' ? ' hs-model-selector--actions' : ''}`}
                onClick={async () => {
                  if (isSortingActive) return
                  const next = !modelMenuOpen
                  setModelMenuOpen(next)
                  if (next) {
                    void (async () => {
                      try {
                        const t0 = lastInferenceTargetFetchAtRef.current
                        const listStale =
                          t0 === 0 ||
                          Date.now() - t0 > SELECTOR_MODEL_LIST_STALE_MS ||
                          availableModels.length === 0
                        let models: AvailableModel[] | null = null
                        if (listStale) {
                          const result = (await loadModels('selector_open')) as
                            | { success?: boolean; models?: unknown[] }
                            | null
                            | undefined
                          if (result?.success && Array.isArray(result.models)) {
                            models = result.models as AvailableModel[]
                          }
                        } else {
                          models = availableModels
                        }
                        if (models && models.length > 0) {
                          const preferred =
                            models.find((m) => m.type === 'local') ??
                            models.find((m) => m.type === 'host_internal') ??
                            models[0]
                          setSelectedModel((prev) => {
                            if (isHostInferenceModelId(prev)) {
                              return prev
                            }
                            if (models!.some((m) => m.id === prev)) {
                              return prev
                            }
                            return preferred?.id ?? ''
                          })
                        }
                      } catch {
                        /* ignore */
                      }
                    })()
                  }
                }}
                disabled={isSortingActive}
                aria-label="Chat model"
                title={
                  isSortingActive
                    ? 'Chat model cannot be changed while Auto-Sort is running.'
                    : 'Chat model — click to switch. This selector is for Chat/Actions only and does not affect Auto-Sort.'
                }
                tabIndex={0}
              >
                <span className="hs-send-model">{getModelLabel(selectedModel, availableModels, hostModelLabel)}</span>
                <span className="hs-model-caret">▾</span>
              </button>
            </>
          )}

          {modelMenuOpen && showModelSelector && (
            <div className="hs-model-menu" role="menu">
              {modelsLoading || (hostInf.treatAsSandboxForHostInternal && hostInf.listLoading) ? (
                hostInf.treatAsSandboxForHostInternal ? (
                  <>
                    <div className="hs-model-group-label hs-model-group-label--ledge">{GROUP_HOST_MODELS}</div>
                    <div
                      role="status"
                      aria-live="polite"
                      className="hs-model-item hs-model-item--host hs-model-item--host-compact hs-model-item--disabled"
                    >
                      <div className="hs-model-item__host-row">
                        <span className={HOST_AI_SELECTOR_ICON_CLASS} aria-hidden title="" />
                        <div className="hs-model-item__stack">
                          <div className="hs-model-item__line-primary">Host AI · connecting…</div>
                        </div>
                      </div>
                    </div>
                    <div className="hs-model-group-label" style={{ marginTop: 6 }}>
                      Loading models…
                    </div>
                  </>
                ) : (
                  <div className="hs-model-group-label">Loading models…</div>
                )
              ) : (
                <>
                  {availableModels.some(m => m.type === 'local') && (
                    <>
                      <div className="hs-model-group-label hs-model-group-label--ledge">{GROUP_LOCAL_MODELS}</div>
                      {availableModels.filter(m => m.type === 'local').map(m => (
                        <button
                          key={m.id}
                          role="menuitem"
                          className={`hs-model-item${selectedModel === m.id ? ' hs-model-item--active' : ''}`}
                          title={`Local model: ${m.name}`}
                          onClick={() => { setSelectedModel(m.id); setModelMenuOpen(false) }}
                        >
                          {m.name}
                          {selectedModel === m.id && <span className="hs-model-check">✓</span>}
                        </button>
                      ))}
                    </>
                  )}
                  {hostInf.treatAsSandboxForHostInternal && (
                    <>
                      {hostInternalMenuModels.length > 0 ? (
                        <>
                          <div className="hs-model-group-label hs-model-group-label--ledge">{GROUP_HOST_MODELS}</div>
                          {hostInternalMenuModels.map((m) => {
                            const id = m.id
                            const active = selectedModel === id
                            const t = hostInf.inferenceTargets.find((x) => x.id === m.id)
                            const ui = hostModelSelectorRowUi(
                              {
                                hostSelectorState: m.hostSelectorState,
                                hostTargetAvailable: m.hostTargetAvailable,
                                displayTitle: m.displayTitle || m.name,
                                displaySubtitle: m.displaySubtitle?.trim() || '',
                                name: m.id,
                                hostLocalModelName: t?.model ?? t?.model_id,
                                p2pUiPhase: t?.p2pUiPhase ?? m.p2pUiPhase,
                                host_ai_target_status: m.host_ai_target_status ?? t?.host_ai_target_status,
                              },
                              t,
                            )
                            const titleLine = ui.titleLine
                            const dbg = import.meta.env.DEV && t ? hostAiTargetDevDebugSnippet(t) : ''
                            const sub = [ui.subtitleLine, dbg].filter(Boolean).join('\n')
                            const sel =
                              m.hostSelectorState ??
                              (m.hostTargetAvailable ? 'available' : 'unavailable')
                            const tip = buildHostAiSelectorTooltip(t, {
                              hostTargetAvailable: m.hostTargetAvailable,
                              hostSelectorState: m.hostSelectorState,
                            })
                            const hostItemMod =
                              !m.hostTargetAvailable && sel === 'checking'
                                ? ' hs-model-item--host-checking'
                                : !m.hostTargetAvailable
                                  ? ' hs-model-item--disabled hs-model-item--host-off'
                                  : ''
                            return (
                              <button
                                key={id}
                                type="button"
                                role="menuitem"
                                disabled={!m.hostTargetAvailable}
                                title={tip}
                                className={`hs-model-item hs-model-item--host hs-model-item--host-compact${active ? ' hs-model-item--active' : ''}${hostItemMod}`}
                                onClick={() => {
                                  if (!m.hostTargetAvailable) return
                                  setSelectedModel(id)
                                  setModelMenuOpen(false)
                                }}
                              >
                                <div className="hs-model-item__host-body">
                                  <div className="hs-model-item__host-row">
                                    <span className={HOST_AI_SELECTOR_ICON_CLASS} aria-hidden title="" />
                                    <div className="hs-model-item__stack">
                                      <div className="hs-model-item__line-primary">{titleLine}</div>
                                      {sub ? (
                                        <div
                                          className="hs-model-item__line-secondary"
                                          style={{ whiteSpace: 'pre-line' }}
                                        >
                                          {sub}
                                        </div>
                                      ) : null}
                                    </div>
                                  </div>
                                  {active && <span className="hs-model-check">✓</span>}
                                </div>
                              </button>
                            )
                          })}
                        </>
                      ) : !hostInf.listLoading ? (
                        <div className="hs-model-group-label hs-model-group-label--host-empty" role="note">
                          {GROUP_HOST_MODELS}: none — pair in Settings.
                        </div>
                      ) : null}
                    </>
                  )}
                  {availableModels.some(m => m.type === 'cloud') && (
                    <>
                      <div className="hs-model-group-label hs-model-group-label--ledge">{GROUP_CLOUD}</div>
                      {availableModels.filter(m => m.type === 'cloud').map(m => (
                        <button
                          key={m.id}
                          role="menuitem"
                          className={`hs-model-item${selectedModel === m.id ? ' hs-model-item--active' : ''}`}
                          title={`Cloud: ${m.name} (${m.provider})`}
                          onClick={() => { setSelectedModel(m.id); setModelMenuOpen(false) }}
                        >
                          {m.name}
                          {selectedModel === m.id && <span className="hs-model-check">✓</span>}
                        </button>
                      ))}
                    </>
                  )}
                  {availableModels.length === 0 &&
                    !(
                        hostInf.treatAsSandboxForHostInternal &&
                        hostInternalMenuModels.length > 0
                      ) && (
                    <div className="hs-model-group-label">No models configured — check Settings</div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
        {hostRefreshFeedback && includeHostInternalDiscovery && (
          <div
            role="status"
            aria-live="polite"
            className={`hs-host-refresh-feedback hs-host-refresh-feedback--${hostRefreshFeedback.variant}${
              hostRefreshFeedback.display === 'premium'
                ? ' hs-host-refresh-feedback--premium'
                : hostRefreshFeedback.display === 'compact'
                  ? ' hs-host-refresh-feedback--compact'
                  : ''
            }`}
          >
            {hostRefreshFeedback.message}
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
                ? `Actions · ${getModelLabel(selectedModel, availableModels, hostModelLabel)}`
                : `Chat · ${getModelLabel(selectedModel, availableModels, hostModelLabel)} · ${SCOPE_LABELS[scope]}`}
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

          {/* ── Attachment drop zone — below panel header, above response content ── */}
          <div
            className={[
              'chat-dropzone',
              isDragging ? 'chat-dropzone--dragover' : '',
              chatAttachments.length > 0 ? 'chat-dropzone--has-files' : '',
            ].filter(Boolean).join(' ')}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={(e) => void handleDrop(e)}
            onClick={() => chatFileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            aria-label="Attach images or PDFs — click to browse or drag and drop"
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') chatFileInputRef.current?.click() }}
          >
            <div className="chat-dropzone__prompt">
              <span className="chat-dropzone__prompt-icon">📎</span>
              <span>Drop images or PDFs here, or click to browse</span>
            </div>
            {chatAttachments.length > 0 && (
              <div className="chat-dropzone__files">
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
                      onClick={(e) => {
                        e.stopPropagation()
                        setChatAttachments((prev) => prev.filter((a) => a.id !== att.id))
                      }}
                      aria-label={`Remove ${att.filename}`}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {isLoading &&
            !(lastMode === 'chat' && (contextBlocks.length > 0 || !!(response && response.trim()))) && (
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
          {isDraftRefineSession &&
            (draftRefineHistory.length > 0 || (response && !isLetterComposerFocus)) && (
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
                  <div className="hs-draft-refine-content">
                    {msg.refineParagraphs && msg.refineParagraphs.length > 1 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {msg.refineParagraphs.map((para, pi) => (
                          <div
                            key={pi}
                            style={{
                              padding: '8px 10px',
                              borderRadius: 6,
                              border: '1px solid rgba(147,51,234,0.25)',
                              background: 'rgba(255,255,255,0.5)',
                            }}
                          >
                            <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{para}</div>
                            <button
                              type="button"
                              className="chat-use-btn"
                              onClick={() => {
                                const cb = useDraftRefineStore.getState().onResponse
                                if (cb) cb(para)
                              }}
                              title="Insert this paragraph into the field"
                            >
                              Use
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          className="chat-use-btn"
                          onClick={() => draftRefineAcceptRefinement()}
                          title="Replace field with the full AI response"
                          style={{ alignSelf: 'flex-start', fontWeight: 700 }}
                        >
                          Use All
                        </button>
                      </div>
                    ) : (
                      msg.content
                    )}
                  </div>
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
              {!isLetterComposerFocus && response && (
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
                  <div style={{ fontWeight: 600, fontSize: '10px', marginBottom: '4px', color: 'var(--text-muted)' }}>
                    {isLoading ? 'Revising…' : 'AI'}
                  </div>
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

          {/* Chat response — hidden in draft-refine unless letter-composer (top chat uses chatDirect stream there). */}
          {lastMode === 'chat' && (!isDraftRefineSession || isLetterComposerFocus) && (
            <>
              {/* Conversation history — all completed turns */}
              {chatMessages.length > 0 && (
                <div className="chat-history" ref={chatContainerRef}>
                  {chatMessages.map((msg, i) => (
                    <div key={i} className={`chat-msg chat-msg--${msg.role}`}>
                      {msg.role === 'user' ? (
                        <>
                          <span className="chat-msg__role-label">You</span>
                          <p className="chat-msg__text">{msg.content}</p>
                        </>
                      ) : (
                        <>
                          <span className="chat-msg__role-label">AI</span>
                          <p className="chat-msg__text">{msg.content}</p>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Current / streaming AI response */}
              {(response || contextBlocks.length > 0 || structuredResult) && (
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
              {/* `window.__wrdeskInsertDraft` — set by ProjectOptimizationPanel when a field is selected for AI insert; do not rename global. */}
              {(response != null || contextBlocks.length > 0) && !(structuredResult && structuredResult.items.length > 0) && (
                <>
                  <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: '6px' }}>Answer:</div>
                  {aiResponseBlocks.length > 0 ? (
                    <div className="hs-response-text">
                      {aiResponseBlocks.map((block) => (
                        <div key={block.id} className={`chat-response-block${block.type === 'title-suggestion' ? ' chat-response-block--title-suggestion' : ''}`}>
                          <div className="chat-response-block__content">{block.content}</div>
                          {letterComposerPortForUse !== 'letter' && (
                            <button
                              type="button"
                              className={`chat-response-block__use-btn${usedBlockIds.has(block.id) ? ' chat-response-block__use-btn--inserted' : ''}`}
                              onClick={() => {
                                if (usedBlockIds.has(block.id)) return
                                handleChatUseContent(block.content, 'append')
                                setUsedBlockIds((prev) => new Set([...prev, block.id]))
                              }}
                            >
                              {usedBlockIds.has(block.id) ? '✓' : 'Use'}
                            </button>
                          )}
                        </div>
                      ))}
                      {letterComposerPortForUse !== 'letter' && (
                        <div className="chat-response-block__use-all">
                          <button
                            type="button"
                            className="chat-response-block__use-all-btn"
                            onClick={() => {
                              const allContent = aiResponseBlocks.map((b) => b.content).join('\n\n')
                              handleChatUseContent(allContent, 'replace')
                              setUsedBlockIds(new Set(aiResponseBlocks.map((b) => b.id)))
                            }}
                          >
                            Use All
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="hs-response-text">
                      {response ?? ''}
                      {contextBlocks.length > 0 && response === '' && <span className="hs-stream-cursor" style={{ display: 'inline-block', width: '2px', height: '1em', background: 'var(--purple-accent)', marginLeft: '2px', animation: 'hs-blink 1s step-end infinite' }} />}
                      {letterComposerPortForUse === 'template' && (response ?? '').trim() && !isLoading && (
                        <div style={{ marginTop: '8px' }}>
                          <button
                            type="button"
                            className="chat-use-btn"
                            onClick={() => handleChatUseContent((response ?? '').trim(), 'replace')}
                          >
                            Use
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
              {/* Same `__wrdeskInsertDraft` contract as block above. */}
              {structuredResult && structuredResult.items.length === 0 && response && (
                <>
                  <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: '6px' }}>Answer:</div>
                  {aiResponseBlocks.length > 0 ? (
                    <div className="hs-response-text">
                      {aiResponseBlocks.map((block) => (
                        <div key={block.id} className={`chat-response-block${block.type === 'title-suggestion' ? ' chat-response-block--title-suggestion' : ''}`}>
                          <div className="chat-response-block__content">{block.content}</div>
                          {letterComposerPortForUse !== 'letter' && (
                            <button
                              type="button"
                              className={`chat-response-block__use-btn${usedBlockIds.has(block.id) ? ' chat-response-block__use-btn--inserted' : ''}`}
                              onClick={() => {
                                if (usedBlockIds.has(block.id)) return
                                handleChatUseContent(block.content, 'append')
                                setUsedBlockIds((prev) => new Set([...prev, block.id]))
                              }}
                            >
                              {usedBlockIds.has(block.id) ? '✓' : 'Use'}
                            </button>
                          )}
                        </div>
                      ))}
                      {letterComposerPortForUse !== 'letter' && (
                        <div className="chat-response-block__use-all">
                          <button
                            type="button"
                            className="chat-response-block__use-all-btn"
                            onClick={() => {
                              const allContent = aiResponseBlocks.map((b) => b.content).join('\n\n')
                              handleChatUseContent(allContent, 'replace')
                              setUsedBlockIds(new Set(aiResponseBlocks.map((b) => b.id)))
                            }}
                          >
                            Use All
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="hs-response-text">
                      {response}
                      {letterComposerPortForUse === 'template' && (response ?? '').trim() && !isLoading && (
                        <div style={{ marginTop: '8px' }}>
                          <button
                            type="button"
                            className="chat-use-btn"
                            onClick={() => handleChatUseContent((response ?? '').trim(), 'replace')}
                          >
                            Use
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
              <div className="hs-response-chips">
                <span className="hs-chip">{SCOPE_LABELS[scope]}</span>
                <span className="hs-chip">{getModelLabel(selectedModel, availableModels, hostModelLabel)}</span>
              </div>
              {milestoneMarkerSuggestion &&
                activeMilestoneChatCtx &&
                activeProjectIdForMilestone &&
                lastMode === 'chat' &&
                !isDraftRefineSession && (
                  <div style={{ marginTop: '10px' }}>
                    <button
                      type="button"
                      onClick={() => {
                        const patch: { title?: string; description?: string } = {}
                        if (milestoneMarkerSuggestion.title) patch.title = milestoneMarkerSuggestion.title
                        if (milestoneMarkerSuggestion.description !== undefined)
                          patch.description = milestoneMarkerSuggestion.description
                        useProjectStore
                          .getState()
                          .updateMilestone(
                            activeProjectIdForMilestone,
                            activeMilestoneChatCtx.id,
                            patch,
                          )
                      }}
                      style={{
                        padding: '6px 12px',
                        fontSize: '12px',
                        borderRadius: '6px',
                        border: '1px solid rgba(147,51,234,0.35)',
                        background: 'rgba(147,51,234,0.08)',
                        cursor: 'pointer',
                        color: 'var(--text-primary)',
                      }}
                    >
                      Apply to milestone?
                    </button>
                  </div>
                )}
              {chatRetrievalDebugNote && (
                <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--text-muted, #888)', fontStyle: 'italic' }}>
                  {chatRetrievalDebugNote}
                </div>
              )}
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
            </>
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
