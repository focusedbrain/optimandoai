/**
 * HandshakeChatSidebar — Unidirectional LLM Chat for Handshake Context
 *
 * Provides a chat interface scoped to the selected handshake relationship.
 * Uses the contextEscaping module for safe prompt construction.
 *
 * Security model:
 *   - System message is fixed (never includes user data)
 *   - Context blocks are XML-escaped and wrapped in <data> readonly tags
 *   - User message is only the local user's question
 *   - Output is rendered as plain text only (no HTML)
 *   - Chat is disabled when no verified context blocks exist
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import {
  buildSystemMessage,
  buildDataWrapper,
  type VerifiedContextBlock,
} from './contextEscaping'

import './handshakeViewTypes'

// ── Types ──

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

interface Props {
  handshakeId: string | null
  contextBlockCount: number
}

// ── Component ──

export default function HandshakeChatSidebar({ handshakeId, contextBlockCount }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [contextBlocks, setContextBlocks] = useState<VerifiedContextBlock[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<VerifiedContextBlock[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const isDisabled = !handshakeId || contextBlockCount === 0

  // Load context blocks when handshake changes
  useEffect(() => {
    if (!handshakeId) {
      setContextBlocks([])
      setMessages([])
      return
    }

    const loadBlocks = async () => {
      try {
        const blocks = await window.handshakeView?.queryContextBlocks?.(handshakeId) ?? []
        setContextBlocks(blocks)
      } catch {
        setContextBlocks([])
      }
    }

    loadBlocks()
  }, [handshakeId, contextBlockCount])

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = useCallback(async () => {
    if (!input.trim() || isDisabled || loading) return

    const userMessage = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: userMessage, timestamp: Date.now() }])
    setLoading(true)

    try {
      const systemMsg = buildSystemMessage()
      const dataWrapper = buildDataWrapper(contextBlocks)

      const response = await window.handshakeView?.chatWithContext?.(
        systemMsg, dataWrapper, userMessage,
      ) ?? 'Chat function not available. Please ensure the LLM backend is connected.'

      setMessages(prev => [...prev, { role: 'assistant', content: response, timestamp: Date.now() }])
    } catch (err: any) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Error: ${err?.message || 'Failed to get response.'}`,
        timestamp: Date.now(),
      }])
    } finally {
      setLoading(false)
    }
  }, [input, isDisabled, loading, contextBlocks])

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim() || !handshakeId) return
    const query = searchQuery.trim().toLowerCase()
    const filtered = contextBlocks.filter(b =>
      b.payload_ref.toLowerCase().includes(query) ||
      b.type.toLowerCase().includes(query) ||
      b.block_id.toLowerCase().includes(query),
    )
    setSearchResults(filtered)
  }, [searchQuery, contextBlocks, handshakeId])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      borderTop: '1px solid var(--color-border, rgba(255,255,255,0.08))',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 12px',
        borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.08))',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-text, #e2e8f0)' }}>
          Relationship Search
        </span>
        <span style={{
          fontSize: '9px', padding: '2px 6px', borderRadius: '3px',
          background: isDisabled ? 'rgba(107,114,128,0.2)' : 'rgba(34,197,94,0.15)',
          color: isDisabled ? '#6b7280' : '#22c55e',
          fontWeight: 600,
        }}>
          {isDisabled ? 'No data' : `${contextBlockCount} blocks`}
        </span>
      </div>

      {/* Security notice */}
      <div style={{
        padding: '6px 12px', fontSize: '9px',
        color: 'var(--color-text-muted, #94a3b8)',
        background: 'var(--color-surface, rgba(255,255,255,0.02))',
        borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.05))',
      }}>
        Chat searches only VERIFIED Context-Blocks from fully validated BEAP Capsules.
      </div>

      {/* Fulltext search */}
      <div style={{
        padding: '8px 12px',
        borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.08))',
      }}>
        <div style={{ display: 'flex', gap: '4px' }}>
          <input
            type="text"
            placeholder="Search context blocks…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            disabled={isDisabled}
            style={{
              flex: 1, padding: '6px 8px', fontSize: '11px',
              background: 'var(--color-input-bg, rgba(255,255,255,0.06))',
              border: '1px solid var(--color-border, rgba(255,255,255,0.12))',
              borderRadius: '5px', color: 'var(--color-text, #e2e8f0)',
              outline: 'none', opacity: isDisabled ? 0.5 : 1,
            }}
          />
          <button
            onClick={handleSearch}
            disabled={isDisabled}
            style={{
              padding: '6px 10px', fontSize: '10px', fontWeight: 600,
              background: 'var(--color-accent-bg, rgba(139,92,246,0.12))',
              border: '1px solid var(--color-accent-border, rgba(139,92,246,0.3))',
              borderRadius: '5px', color: 'var(--color-accent, #a78bfa)',
              cursor: isDisabled ? 'not-allowed' : 'pointer',
              opacity: isDisabled ? 0.5 : 1,
            }}
          >
            Search
          </button>
        </div>
        {searchResults.length > 0 && (
          <div style={{ marginTop: '6px', maxHeight: '80px', overflowY: 'auto' }}>
            {searchResults.map(b => (
              <div key={b.block_id} style={{
                fontSize: '10px', padding: '3px 0',
                color: 'var(--color-text-muted, #94a3b8)',
                borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.05))',
              }}>
                <strong>{b.type}</strong> ({b.block_id.slice(0, 12)}…)
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Messages area */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '10px 12px',
        display: 'flex', flexDirection: 'column', gap: '8px',
        opacity: isDisabled ? 0.4 : 1,
      }}>
        {isDisabled && (
          <div style={{
            textAlign: 'center', padding: '20px',
            fontSize: '11px', color: 'var(--color-text-muted, #94a3b8)',
          }}>
            {!handshakeId
              ? 'Select a relationship to enable chat.'
              : 'No verified context blocks available yet. Content arrives via the BEAP-Capsule pipeline.'}
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} style={{
            alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
            maxWidth: '85%', padding: '8px 10px', borderRadius: '8px',
            fontSize: '12px', lineHeight: 1.5, whiteSpace: 'pre-wrap',
            background: msg.role === 'user'
              ? 'var(--color-accent-bg, rgba(139,92,246,0.15))'
              : 'var(--color-surface, rgba(255,255,255,0.04))',
            color: 'var(--color-text, #e2e8f0)',
            border: `1px solid ${msg.role === 'user'
              ? 'var(--color-accent-border, rgba(139,92,246,0.25))'
              : 'var(--color-border, rgba(255,255,255,0.08))'}`,
          }}>
            {msg.content}
          </div>
        ))}
        {loading && (
          <div style={{
            alignSelf: 'flex-start', padding: '8px 10px',
            fontSize: '12px', color: 'var(--color-text-muted, #94a3b8)',
            fontStyle: 'italic',
          }}>
            Thinking…
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={{
        padding: '8px 12px',
        borderTop: '1px solid var(--color-border, rgba(255,255,255,0.08))',
        display: 'flex', gap: '6px',
      }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isDisabled ? 'Chat disabled — no data available' : 'Ask a question about the context…'}
          disabled={isDisabled || loading}
          rows={1}
          style={{
            flex: 1, padding: '8px 10px', fontSize: '12px',
            background: 'var(--color-input-bg, rgba(255,255,255,0.06))',
            border: '1px solid var(--color-border, rgba(255,255,255,0.12))',
            borderRadius: '6px', color: 'var(--color-text, #e2e8f0)',
            outline: 'none', resize: 'none', fontFamily: 'inherit',
            opacity: isDisabled ? 0.5 : 1,
          }}
        />
        <button
          onClick={handleSend}
          disabled={isDisabled || loading || !input.trim()}
          style={{
            padding: '8px 14px', fontSize: '12px', fontWeight: 600,
            background: isDisabled || !input.trim()
              ? 'rgba(139,92,246,0.1)'
              : 'rgba(139,92,246,0.2)',
            border: '1px solid rgba(139,92,246,0.3)',
            borderRadius: '6px', color: '#a78bfa',
            cursor: isDisabled || loading || !input.trim() ? 'not-allowed' : 'pointer',
            opacity: isDisabled || !input.trim() ? 0.5 : 1,
          }}
        >
          Send
        </button>
      </div>
    </div>
  )
}
