/**
 * EmailInboxView — Main inbox view matching HandshakeView layout.
 * Left: toolbar + message list. Right: EmailMessageDetail when selected.
 */

import { useEffect, useCallback } from 'react'
import EmailInboxToolbar from './EmailInboxToolbar'
import EmailMessageDetail from './EmailMessageDetail'
import { useEmailInboxStore, type InboxMessage } from '../stores/useEmailInboxStore'
import '../components/handshakeViewTypes'

// ── Relative date ──

function formatRelativeDate(isoString: string): string {
  if (!isoString) return '—'
  const d = new Date(isoString)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffM = Math.floor(diffMs / 60000)
  const diffH = Math.floor(diffMs / 3600000)
  const diffD = Math.floor(diffMs / 86400000)

  if (diffM < 1) return 'now'
  if (diffM < 60) return `${diffM}m`
  if (diffH < 24) return `${diffH}h`
  if (diffD < 7) return `${diffD}d`
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' }).replace(/\//g, '.')
}

// ── InboxMessageRow ──

interface InboxMessageRowProps {
  message: InboxMessage
  selected: boolean
  bulkMode: boolean
  multiSelected: boolean
  onSelect: () => void
  onToggleMultiSelect: () => void
}

function InboxMessageRow({
  message,
  selected,
  bulkMode,
  multiSelected,
  onSelect,
  onToggleMultiSelect,
}: InboxMessageRowProps) {
  const isBeap = message.source_type === 'email_beap' || message.source_type === 'direct_beap'
  const bodyPreview = (message.body_text || '').slice(0, 100).replace(/\s+/g, ' ').trim()
  const hasAttachments = message.has_attachments === 1

  const handleClick = () => {
    if (bulkMode) {
      onToggleMultiSelect()
    } else {
      onSelect()
    }
  }

  return (
    <div
      onClick={handleClick}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '12px 14px',
        borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.08))',
        background:
          selected || multiSelected
            ? 'var(--purple-accent-light)'
            : 'transparent',
        cursor: 'pointer',
        minWidth: 0,
      }}
    >
      {bulkMode && (
        <div
          style={{
            flexShrink: 0,
            width: 18,
            height: 18,
            borderRadius: 4,
            border: `2px solid ${multiSelected ? 'var(--purple-accent, #9333ea)' : 'var(--color-border, rgba(255,255,255,0.2))'}`,
            background: multiSelected ? 'var(--purple-accent, #9333ea)' : 'transparent',
          }}
        />
      )}

      {/* Source badge */}
      <div
        style={{
          flexShrink: 0,
          width: 24,
          height: 24,
          borderRadius: 4,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 12,
          fontWeight: 700,
          background: isBeap ? 'var(--purple-accent, #9333ea)' : 'rgba(107,114,128,0.5)',
          color: '#fff',
        }}
      >
        {isBeap ? 'B' : '✉'}
      </div>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span
            style={{
              fontSize: 12,
              fontWeight: message.read_status === 0 ? 700 : 500,
              color: 'var(--color-text, #e2e8f0)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {message.from_name || message.from_address || '—'}
          </span>
          <span
            style={{
              flexShrink: 0,
              fontSize: 10,
              color: 'var(--color-text-muted, #94a3b8)',
            }}
          >
            {formatRelativeDate(message.received_at)}
          </span>
        </div>
        <div
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: 'var(--color-text, #e2e8f0)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {message.subject || '(No subject)'}
        </div>
        {bodyPreview && (
          <div
            style={{
              fontSize: 11,
              color: 'var(--color-text-muted, #94a3b8)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {bodyPreview}
          </div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          {hasAttachments && (
            <span style={{ fontSize: 10, color: 'var(--color-text-muted, #94a3b8)' }}>📎</span>
          )}
          {message.starred === 1 && (
            <span style={{ fontSize: 10, color: 'var(--purple-accent, #9333ea)' }}>⭐</span>
          )}
          {message.sort_category && (
            <span
              style={{
                fontSize: 9,
                padding: '2px 6px',
                borderRadius: 4,
                background: 'var(--color-surface, rgba(255,255,255,0.04))',
                color: 'var(--color-text-muted, #94a3b8)',
              }}
            >
              {message.sort_category}
            </span>
          )}
          {message.handshake_id && (
            <span
              style={{
                fontSize: 9,
                padding: '2px 6px',
                borderRadius: 4,
                background: 'var(--purple-accent-muted, rgba(147,51,234,0.2))',
                color: 'var(--purple-accent, #9333ea)',
              }}
            >
              🤝
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main component ──

export interface EmailInboxViewProps {
  accounts: Array<{ id: string; email: string }>
  selectedMessageId?: string | null
  onSelectMessage?: (messageId: string | null) => void
  selectedAttachmentId?: string | null
  onSelectAttachment?: (attachmentId: string | null) => void
}

export default function EmailInboxView({
  accounts,
  selectedMessageId: selectedMessageIdProp,
  onSelectMessage,
  selectedAttachmentId: selectedAttachmentIdProp,
  onSelectAttachment,
}: EmailInboxViewProps) {
  const {
    messages,
    total,
    loading,
    error,
    selectedMessageId,
    selectedMessage,
    selectedAttachmentId,
    filter,
    bulkMode,
    multiSelectIds,
    autoSyncEnabled,
    syncing,
    fetchMessages,
    selectMessage,
    selectAttachment,
    setFilter,
    setBulkMode,
    toggleMultiSelect,
    clearMultiSelect,
    markRead,
    archiveMessages,
    deleteMessages,
    setCategory,
    syncAccount,
    toggleAutoSync,
  } = useEmailInboxStore()

  const primaryAccountId = accounts[0]?.id

  // Sync App-level selection to store when props change
  useEffect(() => {
    if (selectedMessageIdProp !== undefined && selectedMessageIdProp !== selectedMessageId) {
      selectMessage(selectedMessageIdProp)
    }
  }, [selectedMessageIdProp, selectedMessageId, selectMessage])

  useEffect(() => {
    if (selectedAttachmentIdProp !== undefined && selectedAttachmentIdProp !== selectedAttachmentId) {
      selectAttachment(selectedAttachmentIdProp)
    }
  }, [selectedAttachmentIdProp, selectedAttachmentId, selectAttachment])

  const handleSelectMessage = useCallback(
    (id: string) => {
      selectMessage(id)
      onSelectMessage?.(id)
    },
    [selectMessage, onSelectMessage]
  )

  const handleSelectAttachment = useCallback(
    (id: string | null) => {
      selectAttachment(id)
      onSelectAttachment?.(id)
    },
    [selectAttachment, onSelectAttachment]
  )
  const selectedCount = multiSelectIds.size

  const handleSync = useCallback(() => {
    if (primaryAccountId) syncAccount(primaryAccountId)
  }, [primaryAccountId, syncAccount])

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

  useEffect(() => {
    fetchMessages()
  }, [fetchMessages])

  useEffect(() => {
    const unsub = window.emailInbox?.onNewMessages?.(() => {
      fetchMessages()
    })
    return () => unsub?.()
  }, [fetchMessages])

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: selectedMessageId ? '320px 1fr' : '1fr',
        height: '100%',
        overflow: 'hidden',
        background: 'var(--color-bg, #0f172a)',
        color: 'var(--color-text, #e2e8f0)',
      }}
    >
      {/* Left panel: toolbar + message list */}
      <div
        style={{
          borderRight: selectedMessageId ? '1px solid var(--color-border, rgba(255,255,255,0.08))' : 'none',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          minWidth: 0,
        }}
      >
        <EmailInboxToolbar
          filter={filter}
          onFilterChange={(partial) => setFilter(partial)}
          accounts={accounts}
          autoSyncEnabled={autoSyncEnabled}
          syncing={syncing}
          onSync={handleSync}
          onToggleAutoSync={toggleAutoSync}
          bulkMode={bulkMode}
          onBulkModeChange={setBulkMode}
          selectedCount={selectedCount}
          onBulkDelete={handleBulkDelete}
          onBulkArchive={handleBulkArchive}
          onBulkMarkRead={handleBulkMarkRead}
          onBulkCategorize={
            selectedCount > 0
              ? () => {
                  const ids = Array.from(multiSelectIds)
                  if (ids.length) {
                    const cat = window.prompt('Category name (or leave empty to clear):')
                    if (cat !== null) setCategory(ids, cat)
                  }
                }
              : undefined
          }
        />

        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          {loading ? (
            <div
              style={{
                padding: 24,
                textAlign: 'center',
                fontSize: 12,
                color: 'var(--color-text-muted, #94a3b8)',
              }}
            >
              Loading…
            </div>
          ) : error ? (
            <div
              style={{
                padding: 24,
                textAlign: 'center',
                fontSize: 12,
                color: '#ef4444',
              }}
            >
              {error}
            </div>
          ) : messages.length === 0 ? (
            <div
              style={{
                padding: 28,
                textAlign: 'center',
                color: 'var(--color-text-muted, #94a3b8)',
              }}
            >
              <div style={{ fontSize: 28, marginBottom: 10, opacity: 0.4 }}>✉</div>
              <div style={{ fontSize: 12, lineHeight: 1.6 }}>
                No messages.
                <br />
                Pull to sync or connect an email account.
              </div>
            </div>
          ) : (
            messages.map((msg) => (
              <InboxMessageRow
                key={msg.id}
                message={msg}
                selected={selectedMessageId === msg.id}
                bulkMode={bulkMode}
                multiSelected={multiSelectIds.has(msg.id)}
                onSelect={() => handleSelectMessage(msg.id)}
                onToggleMultiSelect={() => toggleMultiSelect(msg.id)}
              />
            ))
          )}
        </div>

        <div
          style={{
            padding: '8px 14px',
            fontSize: 11,
            color: 'var(--color-text-muted, #94a3b8)',
            borderTop: '1px solid var(--color-border, rgba(255,255,255,0.08))',
          }}
        >
          {total} message{total !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Right panel: detail (only when message selected) */}
      {selectedMessageId && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            minWidth: 320,
          }}
        >
          <EmailMessageDetail
            message={selectedMessage}
            onSelectAttachment={onSelectAttachment ? handleSelectAttachment : undefined}
          />
        </div>
      )}
    </div>
  )
}
