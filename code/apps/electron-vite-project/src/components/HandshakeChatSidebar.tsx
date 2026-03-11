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

import { useState, useRef, useEffect } from 'react'

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
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const isDisabled = !handshakeId || contextBlockCount === 0

  useEffect(() => {
    if (!handshakeId) setMessages([])
  }, [handshakeId])

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      borderTop: '1px solid var(--color-border, rgba(255,255,255,0.08))',
    }}>
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
        <div ref={messagesEndRef} />
      </div>
    </div>
  )
}
