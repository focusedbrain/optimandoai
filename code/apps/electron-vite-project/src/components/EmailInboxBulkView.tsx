/**
 * EmailInboxBulkView — Bulk grid view: [Message Card | AI Output Field] per row (50/50).
 * Toolbar: Select all, bulk actions, pagination. Uses bulkPage + bulkBatchSize from store.
 */

import { useEffect, useState, useCallback } from 'react'
import {
  useEmailInboxStore,
  type InboxMessage,
  type InboxSourceType,
} from '../stores/useEmailInboxStore'
import '../components/handshakeViewTypes'

const BODY_PREVIEW_LEN = 200
const ACCENT = '#8b5cf6'
const MUTED = 'var(--color-text-muted, #94a3b8)'

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
      return 'BEAP'
    case 'email_plain':
      return 'Plain'
    default:
      return 'Email'
  }
}

export interface EmailInboxBulkViewProps {
  accounts: Array<{ id: string; email: string }>
  onSelectMessage?: (messageId: string | null) => void
}

export default function EmailInboxBulkView({
  accounts,
  onSelectMessage,
}: EmailInboxBulkViewProps) {
  const {
    messages,
    total,
    loading,
    error,
    bulkPage,
    bulkBatchSize,
    multiSelectIds,
    fetchMessages,
    setBulkMode,
    setBulkPage,
    toggleMultiSelect,
    clearMultiSelect,
    markRead,
    archiveMessages,
    deleteMessages,
    setCategory,
  } = useEmailInboxStore()

  const [aiOutputs, setAiOutputs] = useState<
    Record<string, { summary?: string; draft?: string; loading?: string }>
  >({})

  const selectedCount = multiSelectIds.size
  const totalPages = Math.max(1, Math.ceil(total / bulkBatchSize))
  const canPrev = bulkPage > 0
  const canNext = bulkPage < totalPages - 1
  const allSelected = messages.length > 0 && selectedCount === messages.length

  useEffect(() => {
    setBulkMode(true)
    return () => setBulkMode(false)
  }, [setBulkMode])

  useEffect(() => {
    fetchMessages()
  }, [fetchMessages, bulkPage])

  const handleSelectAll = useCallback(() => {
    if (allSelected) {
      clearMultiSelect()
    } else {
      messages.forEach((m) => {
        if (!multiSelectIds.has(m.id)) toggleMultiSelect(m.id)
      })
    }
  }, [allSelected, messages, multiSelectIds, clearMultiSelect, toggleMultiSelect])

  const handleBulkDelete = useCallback(() => {
    const ids = Array.from(multiSelectIds)
    if (ids.length) deleteMessages(ids)
    clearMultiSelect()
  }, [multiSelectIds, deleteMessages, clearMultiSelect])

  const handleBulkArchive = useCallback(() => {
    const ids = Array.from(multiSelectIds)
    if (ids.length) archiveMessages(ids)
    clearMultiSelect()
  }, [multiSelectIds, archiveMessages, clearMultiSelect])

  const handleBulkMarkRead = useCallback(() => {
    const ids = Array.from(multiSelectIds)
    if (ids.length) markRead(ids, true)
    clearMultiSelect()
  }, [multiSelectIds, markRead, clearMultiSelect])

  const handleBulkCategorize = useCallback(() => {
    const ids = Array.from(multiSelectIds)
    if (ids.length) {
      const cat = window.prompt('Category name (or leave empty to clear):')
      if (cat !== null) {
        setCategory(ids, cat)
        clearMultiSelect()
      }
    }
  }, [multiSelectIds, setCategory, clearMultiSelect])

  const handleAiAutoSort = useCallback(async () => {
    const ids = Array.from(multiSelectIds)
    if (ids.length && window.emailInbox?.aiCategorize) {
      const res = await window.emailInbox.aiCategorize(ids)
      if (res.ok) {
        clearMultiSelect()
        fetchMessages()
      }
    }
  }, [multiSelectIds, clearMultiSelect, fetchMessages])

  const handleSummarize = useCallback(
    async (messageId: string) => {
      if (!window.emailInbox?.aiSummarize) return
      setAiOutputs((prev) => ({ ...prev, [messageId]: { ...prev[messageId], loading: 'summary' } }))
      try {
        const res = await window.emailInbox.aiSummarize(messageId)
        if (res.ok && res.data?.summary) {
          setAiOutputs((prev) => ({
            ...prev,
            [messageId]: { ...prev[messageId], summary: res.data!.summary, loading: undefined },
          }))
        } else {
          setAiOutputs((prev) => ({ ...prev, [messageId]: { ...prev[messageId], loading: undefined } }))
        }
      } catch {
        setAiOutputs((prev) => ({ ...prev, [messageId]: { ...prev[messageId], loading: undefined } }))
      }
    },
    []
  )

  const handleDraftReply = useCallback(
    async (messageId: string) => {
      if (!window.emailInbox?.aiDraftReply) return
      setAiOutputs((prev) => ({ ...prev, [messageId]: { ...prev[messageId], loading: 'draft' } }))
      try {
        const res = await window.emailInbox.aiDraftReply(messageId)
        if (res.ok && res.data?.draft) {
          setAiOutputs((prev) => ({
            ...prev,
            [messageId]: { ...prev[messageId], draft: res.data!.draft, loading: undefined },
          }))
        } else {
          setAiOutputs((prev) => ({ ...prev, [messageId]: { ...prev[messageId], loading: undefined } }))
        }
      } catch {
        setAiOutputs((prev) => ({ ...prev, [messageId]: { ...prev[messageId], loading: undefined } }))
      }
    },
    []
  )

  const handleMessageClick = useCallback(
    (msg: InboxMessage) => {
      onSelectMessage?.(msg.id)
    },
    [onSelectMessage]
  )

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
        background: 'var(--color-bg, #0f172a)',
        color: 'var(--color-text, #e2e8f0)',
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          padding: '10px 14px',
          borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.08))',
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          flexShrink: 0,
        }}
      >
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={allSelected}
            onChange={handleSelectAll}
            disabled={messages.length === 0}
          />
          <span style={{ fontSize: 12, fontWeight: 600 }}>Select all</span>
        </label>
        <span style={{ fontSize: 12, color: MUTED }}>
          {selectedCount} selected
        </span>
        <span style={{ color: 'var(--color-border, rgba(255,255,255,0.2))', margin: '0 4px' }}>|</span>
        <button
          type="button"
          onClick={handleBulkDelete}
          disabled={selectedCount === 0}
          style={{
            padding: '6px 10px',
            fontSize: 11,
            fontWeight: 600,
            background: 'rgba(239,68,68,0.15)',
            border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: 6,
            color: '#fca5a5',
            cursor: selectedCount ? 'pointer' : 'not-allowed',
            opacity: selectedCount ? 1 : 0.5,
          }}
        >
          Delete
        </button>
        <button
          type="button"
          onClick={handleBulkArchive}
          disabled={selectedCount === 0}
          style={{
            padding: '6px 10px',
            fontSize: 11,
            fontWeight: 600,
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 6,
            color: 'var(--color-text, #e2e8f0)',
            cursor: selectedCount ? 'pointer' : 'not-allowed',
            opacity: selectedCount ? 1 : 0.5,
          }}
        >
          Archive
        </button>
        <button
          type="button"
          onClick={handleBulkMarkRead}
          disabled={selectedCount === 0}
          style={{
            padding: '6px 10px',
            fontSize: 11,
            fontWeight: 600,
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 6,
            color: 'var(--color-text, #e2e8f0)',
            cursor: selectedCount ? 'pointer' : 'not-allowed',
            opacity: selectedCount ? 1 : 0.5,
          }}
        >
          Mark Read
        </button>
        <button
          type="button"
          onClick={handleBulkCategorize}
          disabled={selectedCount === 0}
          style={{
            padding: '6px 10px',
            fontSize: 11,
            fontWeight: 600,
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 6,
            color: 'var(--color-text, #e2e8f0)',
            cursor: selectedCount ? 'pointer' : 'not-allowed',
            opacity: selectedCount ? 1 : 0.5,
          }}
        >
          Categorize
        </button>
        <button
          type="button"
          onClick={handleAiAutoSort}
          disabled={selectedCount === 0}
          style={{
            padding: '6px 10px',
            fontSize: 11,
            fontWeight: 600,
            background: 'rgba(139,92,246,0.2)',
            border: '1px solid rgba(139,92,246,0.4)',
            borderRadius: 6,
            color: '#a78bfa',
            cursor: selectedCount ? 'pointer' : 'not-allowed',
            opacity: selectedCount ? 1 : 0.5,
          }}
        >
          ✨ AI Auto-Sort
        </button>
        <div style={{ flex: 1, minWidth: 0 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            onClick={() => setBulkPage(Math.max(0, bulkPage - 1))}
            disabled={!canPrev}
            style={{
              padding: '6px 10px',
              fontSize: 11,
              fontWeight: 600,
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 6,
              color: canPrev ? 'var(--color-text, #e2e8f0)' : MUTED,
              cursor: canPrev ? 'pointer' : 'not-allowed',
            }}
          >
            Prev
          </button>
          <span style={{ fontSize: 12, color: MUTED }}>
            Page {bulkPage + 1} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setBulkPage(Math.min(totalPages - 1, bulkPage + 1))}
            disabled={!canNext}
            style={{
              padding: '6px 10px',
              fontSize: 11,
              fontWeight: 600,
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 6,
              color: canNext ? 'var(--color-text, #e2e8f0)' : MUTED,
              cursor: canNext ? 'pointer' : 'not-allowed',
            }}
          >
            Next
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', color: MUTED, fontSize: 12 }}>
            Loading…
          </div>
        ) : error ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#ef4444', fontSize: 12 }}>
            {error}
          </div>
        ) : messages.length === 0 ? (
          <div style={{ padding: 28, textAlign: 'center', color: MUTED, fontSize: 13 }}>
            No messages in this batch.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {messages.map((msg) => {
              const isSelected = multiSelectIds.has(msg.id)
              const output = aiOutputs[msg.id]
              const bodyPreview = (msg.body_text || '')
                .slice(0, BODY_PREVIEW_LEN)
                .replace(/\s+/g, ' ')
                .trim()
              const hasAttachments = msg.has_attachments === 1
              const isDeleted = msg.deleted === 1

              return (
                <div
                  key={msg.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 16,
                    minHeight: 180,
                  }}
                >
                  {/* Left: Message card */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest('input[type="checkbox"]')) return
                      handleMessageClick(msg)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        handleMessageClick(msg)
                      }
                    }}
                    style={{
                      padding: 14,
                      background: 'rgba(255,255,255,0.03)',
                      border: `1px solid ${isSelected ? 'rgba(139,92,246,0.5)' : 'rgba(255,255,255,0.08)'}`,
                      borderRadius: 8,
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                          e.stopPropagation()
                          toggleMultiSelect(msg.id)
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                          {msg.from_name || msg.from_address || '—'}
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
                          {msg.subject || '(No subject)'}
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: MUTED,
                            lineHeight: 1.4,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            display: '-webkit-box',
                            WebkitLineClamp: 3,
                            WebkitBoxOrient: 'vertical',
                          }}
                        >
                          {bodyPreview || '(No body)'}
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8, alignItems: 'center' }}>
                          {hasAttachments && (
                            <span style={{ fontSize: 10, color: MUTED }}>📎 {msg.attachment_count}</span>
                          )}
                          {msg.sort_category && (
                            <span
                              style={{
                                fontSize: 9,
                                padding: '2px 6px',
                                borderRadius: 4,
                                background: 'rgba(255,255,255,0.06)',
                                color: MUTED,
                              }}
                            >
                              {msg.sort_category}
                            </span>
                          )}
                          {isDeleted && (
                            <span
                              style={{
                                fontSize: 9,
                                padding: '2px 6px',
                                borderRadius: 4,
                                background: 'rgba(239,68,68,0.2)',
                                color: '#fca5a5',
                              }}
                            >
                              Deleted
                            </span>
                          )}
                          <span
                            style={{
                              fontSize: 9,
                              padding: '2px 6px',
                              borderRadius: 4,
                              background: 'rgba(139,92,246,0.15)',
                              color: '#a78bfa',
                            }}
                          >
                            {formatSourceBadge(msg.source_type)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right: AI output */}
                  <div
                    style={{
                      padding: 14,
                      background: 'rgba(0,0,0,0.2)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 8,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                    }}
                  >
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => handleSummarize(msg.id)}
                        disabled={!!output?.loading}
                        style={{
                          padding: '4px 8px',
                          fontSize: 10,
                          fontWeight: 600,
                          background: 'rgba(139,92,246,0.2)',
                          border: '1px solid rgba(139,92,246,0.3)',
                          borderRadius: 4,
                          color: '#a78bfa',
                          cursor: output?.loading ? 'not-allowed' : 'pointer',
                        }}
                      >
                        ✨ Summarize
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDraftReply(msg.id)}
                        disabled={!!output?.loading}
                        style={{
                          padding: '4px 8px',
                          fontSize: 10,
                          fontWeight: 600,
                          background: 'rgba(139,92,246,0.2)',
                          border: '1px solid rgba(139,92,246,0.3)',
                          borderRadius: 4,
                          color: '#a78bfa',
                          cursor: output?.loading ? 'not-allowed' : 'pointer',
                        }}
                      >
                        ✍ Draft Reply
                      </button>
                      <button
                        type="button"
                        disabled
                        title="Augment (coming soon)"
                        style={{
                          padding: '4px 8px',
                          fontSize: 10,
                          fontWeight: 600,
                          background: 'rgba(255,255,255,0.04)',
                          border: '1px solid rgba(255,255,255,0.08)',
                          borderRadius: 4,
                          color: MUTED,
                          cursor: 'not-allowed',
                          opacity: 0.7,
                        }}
                      >
                        🔍 Augment
                      </button>
                    </div>
                    <div
                      style={{
                        flex: 1,
                        minHeight: 80,
                        padding: 10,
                        background: 'rgba(0,0,0,0.2)',
                        borderRadius: 6,
                        fontSize: 12,
                        lineHeight: 1.5,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        overflowY: 'auto',
                        color: 'var(--color-text, #e2e8f0)',
                      }}
                    >
                      {output?.loading ? (
                        <span style={{ color: MUTED }}>Loading…</span>
                      ) : output?.summary ? (
                        output.summary
                      ) : output?.draft ? (
                        output.draft
                      ) : (
                        <span style={{ color: MUTED }}>AI output will appear here</span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
