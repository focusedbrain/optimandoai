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
  /** Handshake attribution */
  handshake_id?: string
  source?: 'received' | 'sent'
  score?: number
  data_classification?: string
  /** Governance policy summary (e.g. "Local AI only", "Cloud AI allowed") */
  governance_summary?: string
}

interface HybridSearchProps {
  activeView: DashboardView
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

function shortId(id: string): string {
  if (!id) return ''
  return id.length > 16 ? `${id.slice(0, 3)}…${id.slice(-6)}` : id
}

const SPECIAL_RESULT_IDS = ['vault-locked', 'no-embeddings', 'embedding-unavailable'] as const
function isSpecialResult(r: SearchResult): boolean {
  return SPECIAL_RESULT_IDS.includes(r.id as typeof SPECIAL_RESULT_IDS[number])
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
    const raw = result.results ?? []
    return raw.map((r: Record<string, unknown>, i: number) => ({
      id: (r.block_id as string) ?? `result-${i}`,
      title: friendlyTypeName(r.type as string | undefined),
      snippet: truncate((r.snippet as string) ?? (typeof r.payload_ref === 'string' ? r.payload_ref : ''), 200),
      scope: 'context-graph' as const,
      timestamp: r.source === 'received' ? '↓ Received' : r.source === 'sent' ? '↑ Sent' : undefined,
      handshake_id: r.handshake_id as string | undefined,
      source: r.source as 'received' | 'sent' | undefined,
      score: typeof r.score === 'number' ? r.score : undefined,
      data_classification: r.data_classification as string | undefined,
      governance_summary: r.governance_summary as string | undefined,
    }))
  } catch (err) {
    console.error('Search failed:', err)
    return []
  }
}

interface ChatSource {
  handshake_id: string
  block_id: string
  source: string
  score: number
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
  const [selectedModel, setSelectedModel] = useState('')
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([])
  const [modelsLoading, setModelsLoading] = useState(true)
  const [isLoading, setIsLoading] = useState(false)
  const [results, setResults] = useState<SearchResult[]>([])
  const [response, setResponse] = useState<string | null>(null)
  const [chatSources, setChatSources] = useState<ChatSource[]>([])
  const [chatGovernanceNote, setChatGovernanceNote] = useState<string | null>(null)
  const [lastMode, setLastMode] = useState<SearchMode | null>(null)
  const [showPanel, setShowPanel] = useState(false)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const modelMenuRef = useRef<HTMLDivElement>(null)

  // Load available models from backend
  useEffect(() => {
    async function loadModels() {
      try {
        const result = await window.handshakeView?.getAvailableModels?.()
        if (result?.success && Array.isArray(result.models)) {
          setAvailableModels(result.models)
          setSelectedModel(prev => (prev || result.models[0]?.id) ?? '')
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

  const handleSubmit = useCallback(async () => {
    const trimmed = query.trim()
    if (!trimmed || isLoading) return

    setLastMode(mode)
    setIsLoading(true)
    setShowPanel(true)
    setResults([])
    setResponse(null)
    setChatSources([])

    try {
      if (mode === 'search') {
        const r = await runSearch(trimmed, scope)
        setResults(r)
      } else {
        const modelInfo = availableModels.find(m => m.id === selectedModel)
        const result = await window.handshakeView?.chatWithContextRag?.({
          query: trimmed,
          scope,
          model: selectedModel || 'llama3',
          provider: modelInfo?.provider || 'ollama',
        })

        if (!result?.success) {
          if (result?.error === 'vault_locked') {
            setResponse('🔒 Unlock your vault to search handshake data.')
          } else if (result?.error === 'embedding_unavailable') {
            setResponse('Search requires Ollama with an embedding model. Check Backend Configuration.')
          } else if (result?.error === 'no_api_key') {
            setResponse(`No API key configured for ${result.provider ?? 'cloud provider'}. Add it in Extension Settings.`)
          } else if (result?.error === 'ollama_unavailable') {
            setResponse('Ollama is not running. Start Ollama to use local models.')
          } else if (result?.error === 'api_call_failed') {
            setResponse(result?.message ?? 'API call failed. Check your API key and network.')
          } else {
            setResponse(result?.message ?? 'Chat is not available right now.')
          }
          setChatSources([])
          setChatGovernanceNote(null)
        } else {
          setResponse(result.answer ?? '')
          setChatSources(result.sources ?? [])
          setChatGovernanceNote(result.governanceNote ?? null)
        }
      }
    } catch (err: any) {
      console.error('Chat failed:', err)
      setResponse('An error occurred.')
      setChatSources([])
      setChatGovernanceNote(null)
    } finally {
      setIsLoading(false)
    }
  }, [query, mode, scope, selectedModel, availableModels, isLoading])

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

  const handleViewHandshake = useCallback((handshakeId: string) => {
    navigator.clipboard.writeText(handshakeId).then(() => {}).catch(() => {})
  }, [])

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
                ? `Send to ${getModelLabel(selectedModel, availableModels)} (Enter)`
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
              <span className="hs-send-model">{getModelLabel(selectedModel, availableModels)}</span>
            )}
          </button>

          {/* Model picker — only shown in chat mode */}
          {mode === 'chat' && (
            <button
              className={`hs-model-caret${modelMenuOpen ? ' hs-model-caret--open' : ''}`}
              onClick={async () => {
                const next = !modelMenuOpen
                setModelMenuOpen(next)
                if (next) {
                  try {
                    const result = await window.handshakeView?.getAvailableModels?.()
                    if (result?.success && Array.isArray(result.models)) {
                      setAvailableModels(result.models)
                      setSelectedModel(prev => prev || result.models[0]?.id ?? '')
                    }
                  } catch { /* ignore */ }
                }
              }}
              aria-label="Select LLM model"
              title="Choose model"
              tabIndex={0}
            >
              ▾
            </button>
          )}

          {modelMenuOpen && mode === 'chat' && (
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

      {/* ── Results / Response panel ── */}
      {showPanel && (
        <div className="hs-panel" role="region" aria-label="Results">
          <div className="hs-panel-header">
            <span className="hs-panel-meta">
              {lastMode === 'search'
                ? `Search · ${SCOPE_LABELS[scope]}`
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
                    <ResultRow key={r.id} result={r} onViewHandshake={handleViewHandshake} />
                  ))}
                </div>
              )}
            </>
          )}

          {/* Chat response */}
          {!isLoading && lastMode === 'chat' && response && (
            <div className="hs-response">
              <div className="hs-response-text">{response}</div>
              <div className="hs-response-chips">
                <span className="hs-chip">{SCOPE_LABELS[scope]}</span>
                <span className="hs-chip">{getModelLabel(selectedModel, availableModels)}</span>
              </div>
              {chatGovernanceNote && (
                <div style={{ marginTop: '12px', padding: '10px 12px', background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.3)', borderRadius: '6px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                  {chatGovernanceNote}
                </div>
              )}
              {chatSources.length > 0 && (
                <div className="hs-response-sources" style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border)' }}>
                  <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: '8px' }}>Sources</div>
                  {chatSources.map((s, i) => (
                    <div key={`${s.handshake_id}-${s.block_id}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '6px', fontSize: '11px' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>
                        Source {i + 1}: Handshake {shortId(s.handshake_id)} · {s.source === 'received' ? 'Received' : 'Sent'} · Score: {(s.score * 100).toFixed(0)}%
                      </span>
                      <button
                        type="button"
                        onClick={() => handleViewHandshake(s.handshake_id)}
                        title="Copy handshake ID"
                        style={{
                          fontSize: '10px', padding: '2px 6px',
                          background: 'var(--purple-accent-muted)', color: 'var(--purple-accent)',
                          border: '1px solid rgba(147,51,234,0.2)', borderRadius: '4px',
                          cursor: 'pointer', fontWeight: 600,
                        }}
                      >
                        View in handshake
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Result row ──

function ResultRow({ result, onViewHandshake }: { result: SearchResult; onViewHandshake: (id: string) => void }) {
  const [copied, setCopied] = useState(false)
  const scorePct = result.score != null ? Math.round(Math.min(1, Math.max(0, result.score)) * 100) : null
  const attribution =
    result.handshake_id && result.source
      ? result.source === 'received'
        ? `Received from handshake ${shortId(result.handshake_id)}`
        : `Sent by you · handshake ${shortId(result.handshake_id)}`
      : result.timestamp ?? ''

  const handleCopyHandshake = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (result.handshake_id) {
      onViewHandshake(result.handshake_id)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div
      className="hs-result-row"
      title={result.title}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <div className="hs-result-row__title">{result.title}</div>
        {result.data_classification && (
          <span className="hs-result-badge" style={{
            fontSize: '9px', padding: '1px 5px', borderRadius: '3px',
            background: 'rgba(107,114,128,0.15)', color: 'var(--text-muted)',
            fontWeight: 600, flexShrink: 0,
          }}>
            {result.data_classification}
          </span>
        )}
        {result.governance_summary && (
          <span className="hs-result-badge" style={{
            fontSize: '9px', padding: '1px 5px', borderRadius: '3px',
            background: 'rgba(139,92,246,0.12)', color: '#a78bfa',
            fontWeight: 600, flexShrink: 0,
          }}>
            {result.governance_summary}
          </span>
        )}
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
          {result.handshake_id && (
            <button
              type="button"
              className="hs-result-view-handshake"
              onClick={handleCopyHandshake}
              title={copied ? 'Handshake ID copied' : 'Copy handshake ID'}
              style={{
                marginLeft: 'auto', fontSize: '10px', padding: '2px 6px',
                background: 'var(--purple-accent-muted)', color: 'var(--purple-accent)',
                border: '1px solid rgba(147,51,234,0.2)', borderRadius: '4px',
                cursor: 'pointer', fontWeight: 600,
              }}
            >
              {copied ? 'Copied!' : 'View in handshake'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
