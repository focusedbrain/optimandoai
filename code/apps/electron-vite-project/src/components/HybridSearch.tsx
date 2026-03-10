import { useState, useCallback, useEffect, useRef } from 'react'
import './HybridSearch.css'
import './handshakeViewTypes'

// ── Types ──

type SearchMode = 'chat' | 'search'
type SearchScope = 'context-graph' | 'capsules' | 'attachments' | 'all'
type DashboardView = string

interface SearchResult {
  id: string
  title: string
  snippet: string
  scope: 'context-graph' | 'capsules' | 'attachments'
  timestamp?: string
}

interface HybridSearchProps {
  activeView: DashboardView
}

// ── LLM Models ──

const LOCAL_MODELS = [
  { id: 'llama3', label: 'Llama 3' },
  { id: 'mistral', label: 'Mistral 7B' },
  { id: 'phi3', label: 'Phi-3' },
]

const API_MODELS = [
  { id: 'gpt-4o', label: 'GPT-4o' },
  { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  { id: 'claude-3-5-sonnet', label: 'Claude 3.5 Sonnet' },
  { id: 'claude-3-haiku', label: 'Claude 3 Haiku' },
  { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
]

function getModelLabel(id: string): string {
  return (
    [...LOCAL_MODELS, ...API_MODELS].find(m => m.id === id)?.label ?? id
  )
}

function defaultScope(view: DashboardView): SearchScope {
  if (view === 'handshakes') return 'context-graph'
  if (view === 'beap') return 'capsules'
  return 'all'
}

// ── Helpers ──

function friendlyTypeName(type: string | undefined): string {
  if (!type) return 'Data'
  const map: Record<string, string> = {
    text: 'Text', document: 'Document', url: 'Link', email: 'Email',
    json: 'Structured Data', image: 'Image', file: 'File', note: 'Note',
    profile: 'Profile', contact: 'Contact',
  }
  return map[type.toLowerCase()] ?? type.charAt(0).toUpperCase() + type.slice(1)
}

function truncate(s: string, max = 220): string {
  if (!s) return ''
  return s.length > max ? s.slice(0, max) + '…' : s
}

// ── Search backend (semantic search via handshake IPC) ──

async function runSearch(query: string, scope: SearchScope): Promise<SearchResult[]> {
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
      return []
    }
    const raw = result.results ?? []
    return raw.map((r: Record<string, unknown>, i: number) => ({
      id: (r.block_id as string) ?? `result-${i}`,
      title: friendlyTypeName(r.type as string | undefined),
      snippet: truncate((r.snippet as string) ?? (typeof r.payload_ref === 'string' ? r.payload_ref : '')),
      scope: 'context-graph' as const,
      timestamp: r.source === 'received' ? '↓ Received' : r.source === 'sent' ? '↑ Sent' : undefined,
    }))
  } catch (err) {
    console.error('Search failed:', err)
    return []
  }
}

async function runChat(query: string, scope: SearchScope, _model: string): Promise<string> {
  try {
    const result = await window.handshakeView?.semanticSearch?.(query, scope, 5)
    if (!result?.success) {
      if (result?.error === 'vault_locked') {
        return '🔒 Your vault is locked. Please unlock it to search handshake data.'
      }
      return 'Search is not available right now. Make sure your vault is unlocked and context blocks have been indexed.'
    }
    const raw = result.results ?? []
    if (raw.length === 0) {
      return 'No matching context blocks found for your query.\n\nTip: Make sure your vault is unlocked and context blocks have been exchanged and indexed.'
    }
    const summary = (raw as Array<Record<string, unknown>>)
      .map((r, i) => {
        const label = friendlyTypeName(r.type as string | undefined)
        const text = truncate((r.snippet as string) ?? (typeof r.payload_ref === 'string' ? r.payload_ref : ''), 300)
        const direction = r.source === 'received' ? '↓ Received' : '↑ Sent'
        return `${i + 1}. [${label} · ${direction}]\n   ${text}`
      })
      .join('\n\n')
    return `Found ${raw.length} relevant context block${raw.length !== 1 ? 's' : ''}:\n\n${summary}`
  } catch (err) {
    console.error('Chat query failed:', err)
    return 'An error occurred while searching.'
  }
}

// ── Scope label helper ──

const SCOPE_LABELS: Record<SearchScope, string> = {
  'context-graph': 'Context Graph',
  'capsules': 'Capsules',
  'attachments': 'Attachments',
  'all': 'All (Global)',
}

// ── Component ──

export default function HybridSearch({ activeView }: HybridSearchProps) {
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<SearchMode>('chat')
  const [scope, setScope] = useState<SearchScope>(() => defaultScope(activeView))
  const [selectedModel, setSelectedModel] = useState('gpt-4o')
  const [isLoading, setIsLoading] = useState(false)
  const [results, setResults] = useState<SearchResult[]>([])
  const [response, setResponse] = useState<string | null>(null)
  const [lastMode, setLastMode] = useState<SearchMode | null>(null)
  const [showPanel, setShowPanel] = useState(false)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const modelMenuRef = useRef<HTMLDivElement>(null)

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

  const handleSubmit = useCallback(async () => {
    const trimmed = query.trim()
    if (!trimmed || isLoading) return

    setLastMode(mode)
    setIsLoading(true)
    setShowPanel(true)
    setResults([])
    setResponse(null)

    try {
      if (mode === 'search') {
        const r = await runSearch(trimmed, scope)
        setResults(r)
      } else {
        const r = await runChat(trimmed, scope, selectedModel)
        setResponse(r)
      }
    } finally {
      setIsLoading(false)
    }
  }, [query, mode, scope, selectedModel, isLoading])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
    if (e.key === 'Escape') {
      setShowPanel(false)
      setModelMenuOpen(false)
      inputRef.current?.blur()
    }
  }, [handleSubmit])

  const groupedResults = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    if (!acc[r.scope]) acc[r.scope] = []
    acc[r.scope].push(r)
    return acc
  }, {})

  const scopeGroups = Object.entries(groupedResults) as [string, SearchResult[]][]

  return (
    <div className="hs-root" ref={containerRef}>
      <div className="hs-bar">

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
              <option value="all">All (Global)</option>
            </select>
          )}
        </div>

        {/* ── Centre: main input ── */}
        <input
          ref={inputRef}
          className="hs-input"
          type="text"
          placeholder="AI Assistant across the BEAP Ecosystem"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (results.length > 0 || response) setShowPanel(true) }}
          aria-label={mode === 'chat' ? 'Ask a question' : 'Search'}
          autoComplete="off"
          spellCheck={false}
        />

        {/* ── Right: action button ── */}
        <div className="hs-send-group" ref={modelMenuRef}>
          <button
            className={`hs-send-btn hs-send-btn--${mode}`}
            onClick={handleSubmit}
            disabled={!query.trim() || isLoading}
            title={
              mode === 'chat'
                ? `Send to ${getModelLabel(selectedModel)} (Enter)`
                : 'Run search (Enter)'
            }
          >
            {isLoading ? (
              <span className="hs-send-spinner" aria-label="Loading" />
            ) : (
              <span className="hs-send-label">
                {mode === 'chat' ? 'Chat' : 'Search'}
              </span>
            )}
            {mode === 'chat' && !isLoading && (
              <span className="hs-send-model">{getModelLabel(selectedModel)}</span>
            )}
          </button>

          {/* Model picker — only shown in chat mode */}
          {mode === 'chat' && (
            <button
              className={`hs-model-caret${modelMenuOpen ? ' hs-model-caret--open' : ''}`}
              onClick={() => setModelMenuOpen(o => !o)}
              aria-label="Select LLM model"
              title="Choose model"
              tabIndex={0}
            >
              ▾
            </button>
          )}

          {modelMenuOpen && mode === 'chat' && (
            <div className="hs-model-menu" role="menu">
              <div className="hs-model-group-label">Local</div>
              {LOCAL_MODELS.map(m => (
                <button
                  key={m.id}
                  role="menuitem"
                  className={`hs-model-item${selectedModel === m.id ? ' hs-model-item--active' : ''}`}
                  onClick={() => { setSelectedModel(m.id); setModelMenuOpen(false) }}
                >
                  {m.label}
                  {selectedModel === m.id && <span className="hs-model-check">✓</span>}
                </button>
              ))}
              <div className="hs-model-group-label">API</div>
              {API_MODELS.map(m => (
                <button
                  key={m.id}
                  role="menuitem"
                  className={`hs-model-item${selectedModel === m.id ? ' hs-model-item--active' : ''}`}
                  onClick={() => { setSelectedModel(m.id); setModelMenuOpen(false) }}
                >
                  {m.label}
                  {selectedModel === m.id && <span className="hs-model-check">✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Results / Response panel ── */}
      {showPanel && (
        <div className="hs-panel" role="region" aria-label="Results">
          <div className="hs-panel-header">
            <span className="hs-panel-meta">
              {lastMode === 'search'
                ? `Search · ${SCOPE_LABELS[scope]}`
                : `Chat · ${getModelLabel(selectedModel)} · ${SCOPE_LABELS[scope]}`}
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

          {isLoading && (
            <div className="hs-panel-loading">
              <span className="hs-spinner" />
              <span>{lastMode === 'chat' ? 'Asking…' : 'Searching…'}</span>
            </div>
          )}

          {/* Search results */}
          {!isLoading && lastMode === 'search' && (
            <>
              {results.length === 0 ? (
                <div className="hs-panel-empty">No results found.</div>
              ) : scope === 'all' && scopeGroups.length > 0 ? (
                scopeGroups.map(([groupScope, groupResults]) => (
                  <div key={groupScope} className="hs-result-group">
                    <div className="hs-result-group-label">
                      {SCOPE_LABELS[groupScope as SearchScope] ?? groupScope}
                    </div>
                    {groupResults.map(r => (
                      <ResultRow key={r.id} result={r} />
                    ))}
                  </div>
                ))
              ) : (
                results.map(r => <ResultRow key={r.id} result={r} />)
              )}
            </>
          )}

          {/* Chat response */}
          {!isLoading && lastMode === 'chat' && response && (
            <div className="hs-response">
              <div className="hs-response-text">{response}</div>
              <div className="hs-response-chips">
                <span className="hs-chip">{SCOPE_LABELS[scope]}</span>
                <span className="hs-chip">{getModelLabel(selectedModel)}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Result row ──

function ResultRow({ result }: { result: SearchResult }) {
  return (
    <button
      className="hs-result-row"
      onClick={() => {
        console.log('[HybridSearch] result clicked:', result.id)
      }}
      title={result.title}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div className="hs-result-row__title">{result.title}</div>
        {result.timestamp && (
          <span style={{
            fontSize: '9px', padding: '1px 5px', borderRadius: '3px',
            background: result.timestamp.startsWith('↓') ? 'rgba(139,92,246,0.15)' : 'rgba(34,197,94,0.1)',
            color: result.timestamp.startsWith('↓') ? '#a78bfa' : '#22c55e',
            fontWeight: 600, flexShrink: 0,
          }}>
            {result.timestamp}
          </span>
        )}
      </div>
      <div className="hs-result-row__snippet">{result.snippet}</div>
    </button>
  )
}
