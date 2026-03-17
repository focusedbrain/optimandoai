/**
 * HandshakeBeapMessages — BEAP messages for a handshake, below Context Graph.
 * Fetches from window.emailInbox.listMessages({ handshakeId }).
 * Collapsible section, message cards with attachments when selected.
 * Selecting message/attachment narrows scope for HybridSearch.
 */

import { useState, useEffect, useCallback } from 'react'
import type { InboxMessage, InboxSourceType } from '../stores/useEmailInboxStore'
import InboxAttachmentRow from './InboxAttachmentRow'
import '../components/handshakeViewTypes'

const BODY_PREVIEW_LEN = 150

function formatDate(isoString: string | null): string {
  if (!isoString) return '—'
  try {
    return new Date(isoString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return '—'
  }
}

function formatSourceBadge(sourceType: InboxSourceType): string {
  switch (sourceType) {
    case 'direct_beap':
      return 'Direct'
    case 'email_beap':
      return 'Email'
    case 'email_plain':
      return 'Plain'
    default:
      return 'Email'
  }
}


export interface HandshakeBeapMessagesProps {
  handshakeId: string
  selectedMessageId: string | null
  onSelectMessage: (messageId: string | null) => void
  selectedAttachmentId: string | null
  onSelectAttachment: (attachmentId: string | null) => void
}

export default function HandshakeBeapMessages({
  handshakeId,
  selectedMessageId,
  onSelectMessage,
  selectedAttachmentId,
  onSelectAttachment,
}: HandshakeBeapMessagesProps) {
  const [expanded, setExpanded] = useState(true)
  const [messages, setMessages] = useState<InboxMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [messageDetails, setMessageDetails] = useState<Record<string, InboxMessage>>({})
  const [loadingMessageId, setLoadingMessageId] = useState<string | null>(null)

  const fetchMessages = useCallback(async () => {
    if (!handshakeId || !window.emailInbox?.listMessages) return
    setLoading(true)
    try {
      const res = await window.emailInbox.listMessages({
        handshakeId,
        filter: 'all',
      })
      if (res.ok && res.data?.messages) {
        setMessages((res.data.messages as InboxMessage[]) ?? [])
      } else {
        setMessages([])
      }
    } catch {
      setMessages([])
    } finally {
      setLoading(false)
    }
  }, [handshakeId])

  useEffect(() => {
    fetchMessages()
  }, [fetchMessages])

  const handleSelectMessage = useCallback(
    (id: string | null) => {
      onSelectMessage(id)
      if (id) {
        if (messageDetails[id]) return
        setLoadingMessageId(id)
        window.emailInbox?.getMessage(id).then((res) => {
          if (res.ok && res.data) {
            setMessageDetails((prev) => ({ ...prev, [id]: res.data as InboxMessage }))
          }
          setLoadingMessageId((prev) => (prev === id ? null : prev))
        }).catch(() => setLoadingMessageId((prev) => (prev === id ? null : prev)))
      } else {
        setLoadingMessageId(null)
      }
    },
    [onSelectMessage, messageDetails]
  )

  useEffect(() => {
    if (selectedMessageId && !messageDetails[selectedMessageId]) {
      setLoadingMessageId(selectedMessageId)
      window.emailInbox?.getMessage(selectedMessageId).then((res) => {
        if (res.ok && res.data) {
          setMessageDetails((prev) => ({
            ...prev,
            [selectedMessageId]: res.data as InboxMessage,
          }))
        }
        setLoadingMessageId((prev) => (prev === selectedMessageId ? null : prev))
      }).catch(() => setLoadingMessageId((prev) => (prev === selectedMessageId ? null : prev)))
    }
  }, [selectedMessageId, messageDetails])

  const selectedMessage = selectedMessageId ? messageDetails[selectedMessageId] : null
  const attachments = selectedMessage?.attachments ?? []

  return (
    <div
      style={{
        marginBottom: '16px',
        background: 'var(--color-surface, rgba(255,255,255,0.03))',
        border: '1px solid var(--color-border, rgba(255,255,255,0.08))',
        borderRadius: '8px',
        overflow: 'hidden',
      }}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => e.key === 'Enter' && setExpanded(!expanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          background: 'rgba(255,255,255,0.02)',
          borderBottom: expanded ? '1px solid var(--color-border, rgba(255,255,255,0.06))' : 'none',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
          <span style={{ fontSize: '18px', flexShrink: 0 }}>📨</span>
          <span style={{ fontWeight: 600, fontSize: '14px', color: 'var(--color-text, #e2e8f0)' }}>
            BEAP Messages
          </span>
          <span style={{ fontSize: '12px', color: 'var(--color-text-muted, #94a3b8)' }}>
            ({messages.length})
          </span>
        </div>
        <span
          style={{
            flexShrink: 0,
            fontSize: '12px',
            color: 'var(--color-text-muted, #94a3b8)',
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s',
          }}
        >
          ▼
        </span>
      </div>

      {expanded && (
        <div style={{ padding: '12px 16px' }}>
          {loading ? (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--color-text-muted, #94a3b8)', fontSize: '12px' }}>
              Loading…
            </div>
          ) : messages.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--color-text-muted, #94a3b8)', fontSize: '13px' }}>
              No messages in this relationship yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {messages.map((msg) => {
                const isSelected = selectedMessageId === msg.id
                const bodyPreview = (msg.body_text || '')
                  .slice(0, BODY_PREVIEW_LEN)
                  .replace(/\s+/g, ' ')
                  .trim()

                return (
                  <div
                    key={msg.id}
                    style={{
                      padding: '12px',
                      background: isSelected ? 'rgba(139,92,246,0.12)' : 'rgba(255,255,255,0.02)',
                      border: isSelected ? '1px solid rgba(139,92,246,0.5)' : '1px solid rgba(255,255,255,0.06)',
                      borderRadius: '8px',
                    }}
                  >
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => handleSelectMessage(isSelected ? null : msg.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          handleSelectMessage(isSelected ? null : msg.id)
                        }
                      }}
                      style={{ cursor: 'pointer' }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text, #e2e8f0)' }}>
                          {msg.subject || msg.from_address || '—'}
                        </span>
                        <span style={{ fontSize: '11px', color: 'var(--color-text-muted, #94a3b8)' }}>
                          {formatDate(msg.received_at)}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                        <span
                          style={{
                            fontSize: '9px',
                            padding: '2px 6px',
                            borderRadius: 4,
                            background: 'rgba(139,92,246,0.2)',
                            color: '#a78bfa',
                            fontWeight: 600,
                          }}
                        >
                          {formatSourceBadge(msg.source_type)}
                        </span>
                      </div>
                      {bodyPreview && (
                        <div
                          style={{
                            fontSize: '12px',
                            color: 'var(--color-text-muted, #94a3b8)',
                            lineHeight: 1.4,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {bodyPreview}…
                        </div>
                      )}
                    </div>

                    {/* Attachments when selected */}
                    {isSelected && (
                      <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                        {loadingMessageId === msg.id ? (
                          <div style={{ fontSize: '12px', color: 'var(--color-text-muted, #94a3b8)' }}>
                            Loading…
                          </div>
                        ) : attachments.length > 0 ? (
                          <>
                            <div
                              style={{
                                fontSize: '11px',
                                fontWeight: 700,
                                color: 'var(--color-text-muted, #94a3b8)',
                                marginBottom: '10px',
                                textTransform: 'uppercase',
                                letterSpacing: '0.5px',
                              }}
                            >
                              ATTACHMENTS
                            </div>
                            {attachments.map((att) => (
                              <InboxAttachmentRow
                                key={att.id}
                                attachment={att}
                                selectedAttachmentId={selectedAttachmentId}
                                onSelectAttachment={onSelectAttachment}
                              />
                            ))}
                          </>
                        ) : null}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
