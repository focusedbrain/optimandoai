/**
 * CommandChatView Component
 * 
 * Chat interface for Commands mode with message list,
 * composer, and "Run" button with model indicator.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { useUIStore } from '../../stores/useUIStore'
import { useActiveCustomModeRuntime } from '../../stores/activeCustomModeRuntime'
import { getPrimaryButtonLabel, shouldShowModelInButton } from '../../shared/ui/capabilities'
import ComposerToolbelt from './ComposerToolbelt'
import AIAssistPopover from './AIAssistPopover'
import { importFromFile } from '../../ingress'
import { logImportEvent } from '../../audit'

const COMMAND_MODEL_SELECTOR_STALE_MS = 20_000

interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  timestamp?: number
}

interface CommandChatViewProps {
  /** Theme variant */
  theme?: 'pro' | 'dark' | 'standard' | 'default' | 'professional'
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
  /** When provided, shows model selector dropdown (popup/docked Command Chat) */
  availableModels?: Array<{ name: string; size?: string }>
  /** Currently selected model name */
  activeLlmModel?: string
  /** Callback when user selects a model */
  onModelSelect?: (name: string) => void
  /** Callback to refresh models (e.g. when opening dropdown); optional `reason` for host/shell logging. */
  onRefreshModels?: (reason?: string) => void | Promise<void>
}

export const CommandChatView: React.FC<CommandChatViewProps> = ({
  theme = 'pro',
  messages: initialMessages = [],
  onSend,
  modelName = 'Local',
  isLoading = false,
  className = '',
  availableModels = [],
  activeLlmModel,
  onModelSelect,
  onRefreshModels
}) => {
  const { mode, composerMode, setComposerMode } = useUIStore()
  const customModeRuntime = useActiveCustomModeRuntime()
  const resolvedModelLabel = customModeRuntime?.modelName?.trim() || modelName
  const resolvedActiveLlm =
    customModeRuntime?.modelName?.trim() || activeLlmModel || availableModels[0]?.name || 'No model'
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages)
  const [inputText, setInputText] = useState('')
  const [showAIAssist, setShowAIAssist] = useState(false)
  const [showModelDropdown, setShowModelDropdown] = useState(false)
  const lastModelListFetchAtRef = useRef(0)
  const modelDropdownRef = useRef<HTMLDivElement>(null)

  // Close model dropdown when clicking outside
  useEffect(() => {
    if (!showModelDropdown) return
    const handleClick = (e: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setShowModelDropdown(false)
      }
    }
    const t = setTimeout(() => document.addEventListener('click', handleClick), 0)
    return () => {
      clearTimeout(t)
      document.removeEventListener('click', handleClick)
    }
  }, [showModelDropdown])
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const beapFileInputRef = useRef<HTMLInputElement>(null)

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

  // BEAP Upload Handlers
  const handleBeapUploadClick = useCallback(() => {
    beapFileInputRef.current?.click()
  }, [])

  const handleBeapFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setIsUploading(true)
    try {
      // Import using the ingress pipeline (source=download is set internally)
      const result = await importFromFile(file)
      
      if (result.success && result.messageId) {
        // Log audit event
        await logImportEvent(result.messageId, 'download', {})
        
        // Show success toast (auto-verified, message is in inbox)
        setToastMessage('BEAP™ Message imported and verified. Check your inbox.')
        setTimeout(() => setToastMessage(null), 4000)
      } else {
        // Show error toast
        setToastMessage(`Import failed: ${result.error || 'Unknown error'}`)
        setTimeout(() => setToastMessage(null), 4000)
      }
    } catch (error) {
      console.error('[WR Chat] BEAP import failed:', error)
      setToastMessage('Import failed. Please try again.')
      setTimeout(() => setToastMessage(null), 4000)
    } finally {
      setIsUploading(false)
      // Reset file input
      if (beapFileInputRef.current) {
        beapFileInputRef.current.value = ''
      }
    }
  }, [])

  const buttonLabel = getPrimaryButtonLabel(mode)
  const showModelInButton = shouldShowModelInButton(mode)

  // Map theme names for backward compatibility ('professional' and 'standard' both map to light theme)
  const effectiveTheme = (theme === 'standard' || theme === 'professional') ? 'standard' : theme === 'dark' ? 'dark' : 'pro'

  // Theme styles
  const getStyles = () => {
    
    const base = {
      container: {
        display: 'flex',
        flexDirection: 'column' as const,
        height: '100%',
        overflow: 'hidden',
        position: 'relative' as const
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

    switch (effectiveTheme) {
      case 'standard':
        return {
          ...base,
          header: { ...base.header, background: '#ffffff', borderBottom: '1px solid #e1e8ed', color: '#0f172a' },
          headerBadge: { ...base.headerBadge, background: 'rgba(59,130,246,0.1)', color: '#2563eb' },
          messages: { ...base.messages, background: '#f8f9fb' },
          bubble: (isUser: boolean) => ({
            ...base.bubble(isUser),
            background: isUser ? 'rgba(34,197,94,0.1)' : '#ffffff',
            border: isUser ? '1px solid rgba(34,197,94,0.3)' : '1px solid #e1e8ed',
            color: '#0f172a'
          }),
          composer: { ...base.composer, background: '#ffffff', borderTop: '1px solid #e1e8ed' },
          textarea: { ...base.textarea, background: '#ffffff', border: '1px solid #e1e8ed', color: '#0f172a' },
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
      default: // 'pro' (purple)
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
          theme={effectiveTheme === 'standard' ? 'professional' : effectiveTheme === 'pro' ? 'default' : effectiveTheme} 
          onAIAssistClick={handleAIAssistClick}
        />
        
        <div style={styles.composerRow}>
          {/* Hidden file input for BEAP upload */}
          <input
            ref={beapFileInputRef}
            type="file"
            accept=".beap,.json,.zip"
            style={{ display: 'none' }}
            onChange={handleBeapFileChange}
          />
          
          {/* Upload BEAP Button */}
          <button
            onClick={handleBeapUploadClick}
            disabled={isUploading}
            title="Upload BEAP™ Message"
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '8px',
              border: effectiveTheme === 'standard' ? '1px solid #e1e8ed' : '1px solid rgba(255,255,255,0.2)',
              background: effectiveTheme === 'standard' ? '#ffffff' : 'rgba(255,255,255,0.08)',
              color: effectiveTheme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.7)',
              cursor: isUploading ? 'wait' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '18px',
              transition: 'all 0.2s ease',
              flexShrink: 0
            }}
          >
            {isUploading ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            )}
          </button>
          
          <textarea
            ref={textareaRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Start a conversation… or Command the Orchestrator… or Upload a BEAP™ Message"
            style={styles.textarea}
            disabled={isLoading}
          />
          
          <div ref={modelDropdownRef} style={{ ...styles.sendWrapper, position: 'relative' as const }}>
            {(onModelSelect != null && onRefreshModels != null) ? (
              <>
                <button
                  onClick={handleSend}
                  disabled={isLoading || !inputText.trim()}
                  style={{
                    ...styles.sendButton,
                    opacity: (isLoading || !inputText.trim()) ? 0.7 : 1,
                    borderTopRightRadius: 0,
                    borderBottomRightRadius: 0,
                    borderRight: 'none'
                  }}
                >
                  <span style={styles.sendText}>{isLoading ? '...' : buttonLabel}</span>
                  <span style={styles.sendModel}>{resolvedActiveLlm}</span>
                </button>
                <button
                  type="button"
                  onClick={async (e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    try {
                      await onRefreshModels('manual_refresh')
                      lastModelListFetchAtRef.current = Date.now()
                    } catch {
                      /* ignore */
                    }
                  }}
                  disabled={isLoading}
                  title="Refresh model list"
                  aria-label="Refresh model list"
                  style={{
                    ...styles.sendButton,
                    opacity: isLoading ? 0.7 : 1,
                    borderRadius: 0,
                    borderLeft: '1px solid rgba(0,0,0,0.1)',
                    padding: '2px 6px',
                    minWidth: '28px',
                    fontSize: 15,
                    lineHeight: 1,
                  }}
                >
                  ↻
                </button>
                <button
                  onClick={async () => {
                    const next = !showModelDropdown
                    if (next && onRefreshModels) {
                      const t0 = lastModelListFetchAtRef.current
                      const listStale =
                        t0 === 0 ||
                        Date.now() - t0 > COMMAND_MODEL_SELECTOR_STALE_MS ||
                        availableModels.length === 0
                      if (listStale) {
                        try {
                          await onRefreshModels('selector_open')
                          lastModelListFetchAtRef.current = Date.now()
                        } catch {
                          /* ignore */
                        }
                      }
                    }
                    setShowModelDropdown(next)
                  }}
                  disabled={isLoading}
                  title="Select model"
                  style={{
                    ...styles.sendButton,
                    opacity: isLoading ? 0.7 : 1,
                    borderTopLeftRadius: 0,
                    borderBottomLeftRadius: 0,
                    borderLeft: '1px solid rgba(0,0,0,0.1)',
                    padding: '4px 10px',
                    minWidth: '36px'
                  }}
                >
                  ▾
                </button>
                {showModelDropdown && (
                  <div
                    style={{
                      position: 'absolute',
                      bottom: '100%',
                      right: 0,
                      marginBottom: '6px',
                      background: effectiveTheme === 'standard' ? '#ffffff' : '#1e293b',
                      border: effectiveTheme === 'standard' ? '1px solid #e2e8f0' : '1px solid rgba(255,255,255,0.2)',
                      borderRadius: '10px',
                      boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
                      zIndex: 1000,
                      minWidth: '180px',
                      maxHeight: '220px',
                      overflowY: 'auto' as const
                    }}
                  >
                    <div style={{
                      padding: '8px 12px',
                      fontSize: '10px',
                      fontWeight: 700,
                      color: effectiveTheme === 'standard' ? '#475569' : 'rgba(255,255,255,0.7)',
                      borderBottom: effectiveTheme === 'standard' ? '1px solid #e2e8f0' : '1px solid rgba(255,255,255,0.1)'
                    }}>
                      SELECT MODEL
                    </div>
                    {availableModels.length === 0 && (
                      <div style={{
                        padding: '10px 12px',
                        fontSize: '11px',
                        color: effectiveTheme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.7)'
                      }}>
                        No models available. Install models in LLM Settings.
                      </div>
                    )}
                    {availableModels.map((m) => (
                      <div
                        key={m.name}
                        onClick={() => { onModelSelect(m.name); setShowModelDropdown(false) }}
                        style={{
                          padding: '10px 12px',
                          fontSize: '12px',
                          cursor: 'pointer',
                          color: effectiveTheme === 'standard' ? '#0f172a' : 'inherit',
                          background:
                            m.name === (customModeRuntime?.modelName?.trim() || activeLlmModel)
                              ? 'rgba(34,197,94,0.12)'
                              : 'transparent',
                          borderLeft:
                            m.name === (customModeRuntime?.modelName?.trim() || activeLlmModel)
                              ? '3px solid #22c55e'
                              : '3px solid transparent'
                        }}
                      >
                        {m.name}
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
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
                  <span style={styles.sendModel}>{resolvedModelLabel}</span>
                )}
              </button>
            )}

            {/* AI Assist Popover */}
            <AIAssistPopover
              isOpen={showAIAssist && composerMode === 'ai_assist'}
              onClose={() => setShowAIAssist(false)}
              inputText={inputText}
              onApply={handleAIApply}
              theme={effectiveTheme === 'standard' ? 'professional' : effectiveTheme === 'pro' ? 'default' : effectiveTheme}
            />
          </div>
        </div>
      </div>
      
      {/* Toast Notification */}
      {toastMessage && (
        <div style={{
          position: 'absolute',
          bottom: '80px',
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '10px 16px',
          borderRadius: '8px',
          background: effectiveTheme === 'standard' 
            ? 'rgba(15,23,42,0.95)' 
            : 'rgba(0,0,0,0.85)',
          color: 'white',
          fontSize: '12px',
          fontWeight: 500,
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          zIndex: 100,
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          maxWidth: '90%'
        }}>
          <span>📥</span>
          <span>{toastMessage}</span>
          <button
            onClick={() => setToastMessage(null)}
            style={{
              background: 'none',
              border: 'none',
              color: 'rgba(255,255,255,0.6)',
              cursor: 'pointer',
              fontSize: '14px',
              padding: '0 4px'
            }}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}

export default CommandChatView








