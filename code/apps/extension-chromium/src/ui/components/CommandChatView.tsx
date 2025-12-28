/**
 * CommandChatView Component
 * 
 * Chat interface for Commands mode with message list,
 * composer, and "Run" button with model indicator.
 */

import React, { useState, useRef, useEffect } from 'react'
import { useUIStore } from '../../stores/useUIStore'
import { getPrimaryButtonLabel, shouldShowModelInButton } from '../../shared/ui/capabilities'
import ComposerToolbelt from './ComposerToolbelt'
import AIAssistPopover from './AIAssistPopover'

interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  timestamp?: number
}

interface CommandChatViewProps {
  /** Theme variant */
  theme?: 'default' | 'dark' | 'professional'
  /** Initial messages */
  messages?: ChatMessage[]
  /** Callback when message is sent */
  onSend?: (text: string) => void
  /** Current model name (for display) */
  modelName?: string
  /** Whether currently processing */
  isLoading?: boolean
  /** Custom class name */
  className?: string
}

export const CommandChatView: React.FC<CommandChatViewProps> = ({
  theme = 'default',
  messages: initialMessages = [],
  onSend,
  modelName = 'Local',
  isLoading = false,
  className = ''
}) => {
  const { mode, composerMode, setComposerMode } = useUIStore()
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages)
  const [inputText, setInputText] = useState('')
  const [showAIAssist, setShowAIAssist] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Focus textarea when AI assist closes
  useEffect(() => {
    if (!showAIAssist && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [showAIAssist])

  const handleSend = () => {
    const text = inputText.trim()
    if (!text || isLoading) return

    // Add user message
    const userMessage: ChatMessage = { role: 'user', text, timestamp: Date.now() }
    setMessages(prev => [...prev, userMessage])
    setInputText('')

    // Call external handler if provided
    if (onSend) {
      onSend(text)
    } else {
      // Mock response
      setTimeout(() => {
        setMessages(prev => [...prev, {
          role: 'assistant',
          text: `[Mock Response] Received: "${text}"`,
          timestamp: Date.now()
        }])
      }, 500)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleAIAssistClick = () => {
    setShowAIAssist(true)
  }

  const handleAIApply = (text: string) => {
    setInputText(text)
    setComposerMode('text')
  }

  const buttonLabel = getPrimaryButtonLabel(mode)
  const showModelInButton = shouldShowModelInButton(mode)

  // Theme styles
  const getStyles = () => {
    const base = {
      container: {
        display: 'flex',
        flexDirection: 'column' as const,
        height: '100%',
        overflow: 'hidden'
      },
      header: {
        padding: '8px 12px',
        fontSize: '11px',
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        gap: '8px'
      },
      headerBadge: {
        padding: '3px 8px',
        borderRadius: '4px',
        fontSize: '10px'
      },
      messages: {
        flex: 1,
        overflowY: 'auto' as const,
        padding: '12px',
        display: 'flex',
        flexDirection: 'column' as const,
        gap: '10px'
      },
      bubble: (isUser: boolean) => ({
        maxWidth: '80%',
        padding: '10px 12px',
        borderRadius: '10px',
        fontSize: '12px',
        lineHeight: 1.45,
        alignSelf: isUser ? 'flex-end' : 'flex-start'
      }),
      composer: {
        padding: '8px 12px 12px',
        display: 'flex',
        flexDirection: 'column' as const,
        gap: '8px'
      },
      composerRow: {
        display: 'flex',
        gap: '8px',
        alignItems: 'flex-end'
      },
      textarea: {
        flex: 1,
        minHeight: '42px',
        maxHeight: '120px',
        resize: 'vertical' as const,
        padding: '10px',
        borderRadius: '8px',
        fontSize: '12px',
        fontFamily: 'inherit',
        outline: 'none'
      },
      sendWrapper: {
        position: 'relative' as const,
        display: 'flex'
      },
      sendButton: {
        height: '44px',
        padding: '4px 14px',
        borderRadius: '10px',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column' as const,
        alignItems: 'center',
        justifyContent: 'center',
        gap: '1px',
        border: 'none',
        fontWeight: 700,
        transition: 'all 0.2s ease'
      },
      sendText: {
        fontSize: '13px',
        lineHeight: 1
      },
      sendModel: {
        fontSize: '9px',
        opacity: 0.85,
        lineHeight: 1,
        maxWidth: '70px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap' as const
      }
    }

    switch (theme) {
      case 'professional':
        return {
          ...base,
          header: { ...base.header, background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#0f172a' },
          headerBadge: { ...base.headerBadge, background: 'rgba(59,130,246,0.1)', color: '#2563eb' },
          messages: { ...base.messages, background: '#ffffff' },
          bubble: (isUser: boolean) => ({
            ...base.bubble(isUser),
            background: isUser ? 'rgba(34,197,94,0.1)' : '#f1f5f9',
            border: isUser ? '1px solid rgba(34,197,94,0.3)' : '1px solid #e2e8f0',
            color: '#0f172a'
          }),
          composer: { ...base.composer, background: '#f8fafc', borderTop: '1px solid #e2e8f0' },
          textarea: { ...base.textarea, background: '#ffffff', border: '1px solid #e2e8f0', color: '#0f172a' },
          sendButton: { ...base.sendButton, background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)', color: '#052e16' }
        }
      case 'dark':
        return {
          ...base,
          header: { ...base.header, background: 'rgba(0,0,0,0.2)', borderBottom: '1px solid rgba(255,255,255,0.1)', color: '#e5e7eb' },
          headerBadge: { ...base.headerBadge, background: 'rgba(139,92,246,0.2)', color: '#a78bfa' },
          messages: { ...base.messages, background: 'transparent' },
          bubble: (isUser: boolean) => ({
            ...base.bubble(isUser),
            background: isUser ? 'rgba(34,197,94,0.12)' : 'rgba(255,255,255,0.1)',
            border: isUser ? '1px solid rgba(34,197,94,0.45)' : '1px solid rgba(255,255,255,0.2)',
            color: '#e5e7eb'
          }),
          composer: { ...base.composer, borderTop: '1px solid rgba(255,255,255,0.1)' },
          textarea: { ...base.textarea, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', color: '#e5e7eb' },
          sendButton: { ...base.sendButton, background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)', color: '#052e16' }
        }
      default: // purple
        return {
          ...base,
          header: { ...base.header, background: 'rgba(0,0,0,0.15)', borderBottom: '1px solid rgba(255,255,255,0.15)', color: 'white' },
          headerBadge: { ...base.headerBadge, background: 'rgba(255,255,255,0.15)', color: 'white' },
          messages: { ...base.messages, background: 'transparent' },
          bubble: (isUser: boolean) => ({
            ...base.bubble(isUser),
            background: isUser ? 'rgba(34,197,94,0.14)' : 'rgba(255,255,255,0.12)',
            border: isUser ? '1px solid rgba(34,197,94,0.55)' : '1px solid rgba(255,255,255,0.22)',
            color: 'white'
          }),
          composer: { ...base.composer, borderTop: '1px solid rgba(255,255,255,0.15)' },
          textarea: { ...base.textarea, background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: 'white' },
          sendButton: { ...base.sendButton, background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)', color: '#052e16' }
        }
    }
  }

  const styles = getStyles()

  return (
    <div style={styles.container} className={className}>
      {/* Header Badge */}
      <div style={styles.header}>
        <span style={styles.headerBadge}>⚡ Command Session</span>
      </div>

      {/* Messages */}
      <div style={styles.messages}>
        {messages.length === 0 ? (
          <div style={{ opacity: 0.5, textAlign: 'center', padding: '20px', fontSize: '12px' }}>
            Type a command to get started...
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={i} style={styles.bubble(msg.role === 'user')}>
              {msg.text}
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Composer */}
      <div style={styles.composer}>
        <ComposerToolbelt 
          theme={theme} 
          onAIAssistClick={handleAIAssistClick}
        />
        
        <div style={styles.composerRow}>
          <textarea
            ref={textareaRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command..."
            style={styles.textarea}
            disabled={isLoading}
          />
          
          <div style={styles.sendWrapper}>
            <button
              onClick={handleSend}
              disabled={isLoading || !inputText.trim()}
              style={{
                ...styles.sendButton,
                opacity: (isLoading || !inputText.trim()) ? 0.7 : 1
              }}
            >
              <span style={styles.sendText}>{isLoading ? '...' : buttonLabel}</span>
              {showModelInButton && (
                <span style={styles.sendModel}>{modelName}</span>
              )}
            </button>

            {/* AI Assist Popover */}
            <AIAssistPopover
              isOpen={showAIAssist && composerMode === 'ai_assist'}
              onClose={() => setShowAIAssist(false)}
              inputText={inputText}
              onApply={handleAIApply}
              theme={theme}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export default CommandChatView






