/**
 * BeapInboxSidebar
 *
 * Left-sidebar message list for the BEAP™ Inbox.
 * Styled identically to HandshakeManagementPanel's list (same card,
 * typography, color tokens, and group-header pattern).
 *
 * Features:
 *  - Handshake vs mail icon differentiated by handshakeId presence
 *  - Urgency indicator dot (red / orange / none / grey strikethrough)
 *  - Unread indicator (bold + blue dot)
 *  - Trust-level badge (gold / blue / green / grey)
 *  - Filter tabs: All | Handshake | Email | Urgent
 *  - Sorted newest-first; urgent messages pinned to top within their group
 *  - Empty state with import prompt
 *  - Selection highlights entry with violet selection state
 *
 * @version 1.0.0
 */

import React, { useState, useMemo, useCallback } from 'react'
import type { BeapMessage, UrgencyLevel, TrustLevel } from '../beapInboxTypes'
import { useBeapInboxStore } from '../useBeapInboxStore'

// =============================================================================
// Props
// =============================================================================

interface BeapInboxSidebarProps {
  theme?: 'default' | 'dark' | 'professional'
  onImport?: () => void
  onNavigateToDraft?: () => void
  /** Called when user wants to open the Handshakes tab for a specific handshake. */
  onNavigateToHandshake?: (handshakeId: string) => void
}

// =============================================================================
// Filter Types
// =============================================================================

type InboxFilter = 'all' | 'handshake' | 'email' | 'urgent'

const FILTER_LABELS: Record<InboxFilter, string> = {
  all: 'All',
  handshake: 'Handshake',
  email: 'Email',
  urgent: 'Urgent',
}

// =============================================================================
// Helpers
// =============================================================================

function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const mins = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days = Math.floor(diff / 86_400_000)

  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: timestamp < Date.now() - 365 * 86_400_000 ? 'numeric' : undefined,
  })
}

function getContentPreview(msg: BeapMessage): string {
  const text = msg.canonicalContent || msg.messageBody || ''
  return text.length > 80 ? text.slice(0, 80).trimEnd() + '…' : text
}

// =============================================================================
// Urgency config
// =============================================================================

const URGENCY_DOT: Record<UrgencyLevel, { color: string; label: string } | null> = {
  urgent: { color: '#ef4444', label: 'Urgent' },
  'action-required': { color: '#f59e0b', label: 'Action required' },
  normal: null,
  irrelevant: { color: '#6b7280', label: 'Irrelevant' },
}

// =============================================================================
// Trust badge config
// =============================================================================

const TRUST_BADGE: Record<TrustLevel, { label: string; color: string; bg: string }> = {
  enterprise: { label: 'Enterprise', color: '#b45309', bg: 'rgba(245,158,11,0.15)' },
  pro:        { label: 'Pro',        color: '#2563eb', bg: 'rgba(59,130,246,0.15)'  },
  standard:   { label: 'Standard',   color: '#16a34a', bg: 'rgba(34,197,94,0.15)'   },
  depackaged: { label: 'Email',      color: '#6b7280', bg: 'rgba(107,114,128,0.12)' },
}

// =============================================================================
// BeapInboxListItem
// =============================================================================

interface BeapInboxListItemProps {
  message: BeapMessage
  isSelected: boolean
  isProfessional: boolean
  isDark: boolean
  onClick: (id: string) => void
  onNavigateToHandshake?: (handshakeId: string) => void
  /** R.14: Prepend animation for newest message */
  animateAppear?: boolean
}

const BeapInboxListItem: React.FC<BeapInboxListItemProps> = ({
  message,
  isSelected,
  isProfessional,
  isDark,
  onClick,
  onNavigateToHandshake,
  animateAppear = false,
}) => {
  const [hovered, setHovered] = useState(false)

  const hasHandshake = message.handshakeId !== null

  // Colors — match HandshakeListItem exactly
  const textColor = isProfessional ? '#1f2937' : 'white'
  const mutedColor = isProfessional ? '#9ca3af' : 'rgba(255,255,255,0.4)'
  const previewColor = isProfessional ? '#6b7280' : 'rgba(255,255,255,0.5)'

  const baseBg = isProfessional ? 'rgba(0,0,0,0.02)' : 'rgba(255,255,255,0.04)'
  const baseBorder = isProfessional ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)'

  const selectedBg = isProfessional ? 'rgba(139,92,246,0.1)' : 'rgba(139,92,246,0.2)'
  const selectedBorder = isProfessional ? 'rgba(139,92,246,0.3)' : 'rgba(139,92,246,0.4)'

  const hoverBg = isProfessional ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.07)'

  const cardBg = isSelected ? selectedBg : hovered ? hoverBg : baseBg
  const cardBorder = isSelected
    ? `1px solid ${selectedBorder}`
    : `1px solid ${baseBorder}`

  const urgencyConfig = URGENCY_DOT[message.urgency]
  const trustConfig = TRUST_BADGE[message.trustLevel]
  const preview = getContentPreview(message)
  const senderLabel = message.senderDisplayName || message.senderEmail

  // Unread styling
  const nameWeight = message.isRead ? 500 : 700
  const nameColor = message.isRead
    ? textColor
    : isDark
      ? 'white'
      : '#1f2937'

  return (
    <div
      onClick={() => onClick(message.messageId)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '10px 12px',
        background: cardBg,
        borderRadius: '8px',
        marginBottom: '4px',
        cursor: 'pointer',
        border: cardBorder,
        transition: 'all 0.15s ease',
        position: 'relative',
        ...(animateAppear && {
          animation: 'beapMessageAppear 0.3s ease-out',
        }),
      }}
    >
      {/* Top row: icon + sender name + timestamp */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>

          {/* Sender icon — handshake vs mail */}
          <span
            style={{ fontSize: '15px', flexShrink: 0, lineHeight: 1 }}
            title={hasHandshake ? 'BEAP handshake sender' : 'Depackaged email sender'}
          >
            {hasHandshake ? '🤝' : '✉️'}
          </span>

          {/* Sender name (+ unread dot) */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              {/* Unread dot */}
              {!message.isRead && (
                <span
                  style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    background: '#3b82f6',
                    flexShrink: 0,
                    display: 'inline-block',
                  }}
                />
              )}
              <div
                style={{
                  fontSize: '12px',
                  fontWeight: nameWeight,
                  color: nameColor,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  textDecoration: message.urgency === 'irrelevant' ? 'line-through' : 'none',
                  opacity: message.urgency === 'irrelevant' ? 0.6 : 1,
                }}
              >
                {senderLabel}
              </div>
            </div>
          </div>
        </div>

        {/* Right side: timestamp + urgency dot */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0 }}>
          {urgencyConfig && (
            <span
              style={{
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                background: urgencyConfig.color,
                display: 'inline-block',
                flexShrink: 0,
              }}
              title={urgencyConfig.label}
            />
          )}
          <span
            style={{
              fontSize: '10px',
              color: mutedColor,
              whiteSpace: 'nowrap',
            }}
          >
            {formatRelativeTime(message.timestamp)}
          </span>
        </div>
      </div>

      {/* Content preview */}
      {preview && (
        <div
          style={{
            fontSize: '11px',
            color: previewColor,
            marginTop: '5px',
            paddingLeft: '23px', // align under sender name (icon 15px + gap 8px = 23px)
            lineHeight: 1.4,
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical' as const,
          }}
        >
          {preview}
        </div>
      )}

      {/* Badge row: trust level + automation tags */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '5px',
          marginTop: '6px',
          paddingLeft: '23px',
          flexWrap: 'wrap',
        }}
      >
        {/* Trust badge */}
        <span
          style={{
            fontSize: '9px',
            fontWeight: 600,
            textTransform: 'uppercase' as const,
            letterSpacing: '0.3px',
            padding: '2px 5px',
            borderRadius: '4px',
            color: trustConfig.color,
            background: trustConfig.bg,
          }}
        >
          {trustConfig.label}
        </span>

        {/* Automation tags (first 2) */}
        {message.automationTags.slice(0, 2).map((tag) => (
          <span
            key={tag}
            style={{
              fontSize: '9px',
              fontWeight: 500,
              padding: '2px 5px',
              borderRadius: '4px',
              color: isProfessional ? '#6b7280' : 'rgba(255,255,255,0.5)',
              background: isProfessional ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.08)',
            }}
          >
            {tag}
          </span>
        ))}

        {/* Attachment count */}
        {message.attachments.length > 0 && (
          <span
            style={{
              fontSize: '9px',
              fontWeight: 500,
              padding: '2px 5px',
              borderRadius: '4px',
              color: isProfessional ? '#6b7280' : 'rgba(255,255,255,0.5)',
              background: isProfessional ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.08)',
            }}
          >
            📎 {message.attachments.length}
          </span>
        )}

        {/* View Handshake chip — only for handshake-bound messages */}
        {message.handshakeId && onNavigateToHandshake && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onNavigateToHandshake(message.handshakeId!)
            }}
            style={{
              fontSize: '9px',
              fontWeight: 500,
              padding: '2px 5px',
              borderRadius: '4px',
              color: '#a855f7',
              background: 'rgba(168,85,247,0.1)',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            🤝 Handshake →
          </button>
        )}
      </div>
    </div>
  )
}

// =============================================================================
// Main component
// =============================================================================

export const BeapInboxSidebar: React.FC<BeapInboxSidebarProps> = ({
  theme = 'default',
  onImport,
  onNavigateToDraft,
  onNavigateToHandshake,
}) => {
  const isProfessional = theme === 'professional'
  const isDark = theme === 'dark' || theme === 'default'

  // Color tokens — matching HandshakeManagementPanel exactly
  const textColor = isProfessional ? '#1f2937' : 'white'
  const mutedColor = isProfessional ? '#6b7280' : 'rgba(255,255,255,0.6)'
  const sectionLabelColor = isProfessional ? '#9ca3af' : 'rgba(255,255,255,0.4)'
  const dividerColor = isProfessional ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'
  const subDividerColor = isProfessional ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)'

  const [activeFilter, setActiveFilter] = useState<InboxFilter>('all')

  // Store
  const allMessages = useBeapInboxStore((s) => s.getInboxMessages())
  const selectedMessageId = useBeapInboxStore((s) => s.selectedMessageId)
  const selectMessage = useBeapInboxStore((s) => s.selectMessage)
  const isNewMessage = useBeapInboxStore((s) => s.isNewMessage)

  const handleSelect = useCallback(
    (id: string) => {
      selectMessage(selectedMessageId === id ? null : id)
    },
    [selectMessage, selectedMessageId],
  )  // Filter messages
  const filteredMessages = useMemo(() => {
    let msgs = allMessages
    switch (activeFilter) {
      case 'handshake':
        msgs = msgs.filter((m) => m.handshakeId !== null)
        break
      case 'email':
        msgs = msgs.filter((m) => m.handshakeId === null)
        break
      case 'urgent':
        msgs = msgs.filter((m) => m.urgency === 'urgent')
        break
    }
    // Pin urgent to top, then sort by timestamp desc within each group
    const urgent = msgs.filter((m) => m.urgency === 'urgent')
    const rest = msgs.filter((m) => m.urgency !== 'urgent')
    return [...urgent, ...rest]
  }, [allMessages, activeFilter])

  // Counts for filter tabs
  const counts: Record<InboxFilter, number> = useMemo(
    () => ({
      all: allMessages.length,
      handshake: allMessages.filter((m) => m.handshakeId !== null).length,
      email: allMessages.filter((m) => m.handshakeId === null).length,
      urgent: allMessages.filter((m) => m.urgency === 'urgent').length,
    }),
    [allMessages],
  )

  const unreadCount = useMemo(
    () => allMessages.filter((m) => !m.isRead).length,
    [allMessages],
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <style>{`
        @keyframes beapMessageAppear {
          from { opacity: 0; transform: translateY(-6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* ===== Header ===== */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          borderBottom: `1px solid ${dividerColor}`,
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
          <div style={{ fontSize: '14px', fontWeight: 600, color: textColor }}>
            BEAP™ Inbox
          </div>
          {/* Message count badge */}
          <span
            style={{
              fontSize: '11px',
              padding: '1px 7px',
              borderRadius: '10px',
              background: isProfessional ? 'rgba(139,92,246,0.1)' : 'rgba(139,92,246,0.2)',
              color: '#a855f7',
              fontWeight: 500,
            }}
          >
            {allMessages.length}
          </span>
          {/* Unread badge */}
          {unreadCount > 0 && (
            <span
              style={{
                fontSize: '11px',
                padding: '1px 7px',
                borderRadius: '10px',
                background: 'rgba(59,130,246,0.15)',
                color: '#3b82f6',
                fontWeight: 600,
              }}
            >
              {unreadCount} new
            </span>
          )}
        </div>

        {/* Import button */}
        <button
          onClick={onImport}
          style={{
            padding: '5px 10px',
            borderRadius: '6px',
            fontSize: '11px',
            fontWeight: 600,
            cursor: 'pointer',
            border: 'none',
            background: 'linear-gradient(135deg, #a855f7 0%, #9333ea 100%)',
            color: 'white',
          }}
        >
          + Import
        </button>
      </div>

      {/* ===== Filter tabs ===== */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          padding: '8px 16px',
          borderBottom: `1px solid ${subDividerColor}`,
          flexShrink: 0,
          overflowX: 'auto',
        }}
      >
        {(Object.keys(FILTER_LABELS) as InboxFilter[]).map((f) => {
          const isActive = activeFilter === f
          return (
            <button
              key={f}
              onClick={() => setActiveFilter(f)}
              style={{
                padding: '4px 10px',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: isActive ? 600 : 500,
                cursor: 'pointer',
                border: isActive
                  ? `1px solid ${isProfessional ? 'rgba(139,92,246,0.35)' : 'rgba(139,92,246,0.4)'}`
                  : '1px solid transparent',
                background: isActive
                  ? (isProfessional ? 'rgba(139,92,246,0.1)' : 'rgba(139,92,246,0.18)')
                  : 'transparent',
                color: isActive
                  ? '#a855f7'
                  : mutedColor,
                transition: 'all 0.15s ease',
                whiteSpace: 'nowrap' as const,
                flexShrink: 0,
              }}
            >
              {FILTER_LABELS[f]}
              {counts[f] > 0 && (
                <span
                  style={{
                    marginLeft: '4px',
                    fontSize: '10px',
                    opacity: isActive ? 1 : 0.7,
                  }}
                >
                  {counts[f]}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* ===== Message list ===== */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
        {filteredMessages.length === 0 ? (
          /* Empty state */
          <EmptyState
            filter={activeFilter}
            isProfessional={isProfessional}
            mutedColor={mutedColor}
            textColor={textColor}
            onImport={onImport}
            onNavigateToDraft={onNavigateToDraft}
          />
        ) : (
          /* Grouped: Urgent pinned first, then rest */
          <MessageGroupedList
            messages={filteredMessages}
            selectedMessageId={selectedMessageId}
            isProfessional={isProfessional}
            isDark={isDark}
            sectionLabelColor={sectionLabelColor}
            onSelect={handleSelect}
            onNavigateToHandshake={onNavigateToHandshake}
            isNewMessage={isNewMessage}
          />
        )}
      </div>
    </div>
  )
}

// =============================================================================
// MessageGroupedList — renders urgent group first, then remaining messages
// =============================================================================

interface GroupedListProps {
  messages: BeapMessage[]
  selectedMessageId: string | null
  isProfessional: boolean
  isDark: boolean
  sectionLabelColor: string
  onSelect: (id: string) => void
  onNavigateToHandshake?: (handshakeId: string) => void
  isNewMessage?: (messageId: string) => boolean
}

const MessageGroupedList: React.FC<GroupedListProps> = ({
  messages,
  selectedMessageId,
  isProfessional,
  isDark,
  sectionLabelColor,
  onSelect,
  onNavigateToHandshake,
  isNewMessage = () => false,
}) => {
  const urgent = messages.filter((m) => m.urgency === 'urgent')
  const rest = messages.filter((m) => m.urgency !== 'urgent')

  const renderGroup = (label: string, items: BeapMessage[], isFirstGroup: boolean) => {
    if (items.length === 0) return null
    return (
      <div key={label} style={{ marginBottom: '12px' }}>
        <div
          style={{
            fontSize: '10px',
            fontWeight: 600,
            color: sectionLabelColor,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            padding: '4px 8px',
            marginBottom: '6px',
          }}
        >
          {label} ({items.length})
        </div>
        {items.map((msg, i) => (
          <BeapInboxListItem
            key={msg.messageId}
            message={msg}
            isSelected={msg.messageId === selectedMessageId}
            isProfessional={isProfessional}
            isDark={isDark}
            onClick={onSelect}
            onNavigateToHandshake={onNavigateToHandshake}
            animateAppear={(isFirstGroup && i === 0) || isNewMessage(msg.messageId)}
          />
        ))}
      </div>
    )
  }

  // If no urgent messages, skip the group header for cleaner display
  if (urgent.length === 0) {
    return (
      <>
        {rest.map((msg, i) => (
          <BeapInboxListItem
            key={msg.messageId}
            message={msg}
            isSelected={msg.messageId === selectedMessageId}
            isProfessional={isProfessional}
            isDark={isDark}
            onClick={onSelect}
            onNavigateToHandshake={onNavigateToHandshake}
            animateAppear={i === 0 || isNewMessage(msg.messageId)}
          />
        ))}
      </>
    )
  }

  return (
    <>
      {renderGroup('Urgent', urgent, true)}
      {renderGroup('Messages', rest, false)}
    </>
  )
}

// =============================================================================
// EmptyState
// =============================================================================

interface EmptyStateProps {
  filter: InboxFilter
  isProfessional: boolean
  mutedColor: string
  textColor: string
  onImport?: () => void
  onNavigateToDraft?: () => void
}

const EmptyState: React.FC<EmptyStateProps> = ({
  filter,
  isProfessional,
  mutedColor,
  textColor,
  onImport,
}) => {
  const filterEmptyMessages: Record<InboxFilter, { icon: string; title: string; body: string; cta?: string }> = {
    all: {
      icon: '📥',
      title: 'No BEAP messages yet',
      body: 'Import a BEAP™ capsule from email, messenger, or file to get started.',
      cta: '+ Import Capsule',
    },
    handshake: {
      icon: '🤝',
      title: 'No handshake messages',
      body: 'Messages from senders with an established handshake will appear here.',
    },
    email: {
      icon: '✉️',
      title: 'No email messages',
      body: 'Depackaged emails received without a handshake will appear here.',
    },
    urgent: {
      icon: '🔴',
      title: 'No urgent messages',
      body: 'Messages classified as urgent by AI or marked manually appear here.',
    },
  }

  const config = filterEmptyMessages[filter]

  return (
    <div style={{ padding: '32px 16px', textAlign: 'center' }}>
      <div style={{ fontSize: '36px', marginBottom: '12px' }}>{config.icon}</div>
      <div
        style={{
          fontSize: '13px',
          fontWeight: 600,
          color: textColor,
          marginBottom: '6px',
        }}
      >
        {config.title}
      </div>
      <div
        style={{
          fontSize: '11px',
          color: mutedColor,
          lineHeight: 1.5,
          marginBottom: config.cta ? '16px' : '0',
          maxWidth: '220px',
          margin: '0 auto',
        }}
      >
        {config.body}
      </div>
      {config.cta && onImport && (
        <button
          onClick={onImport}
          style={{
            marginTop: '16px',
            padding: '8px 16px',
            borderRadius: '8px',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer',
            border: 'none',
            background: 'linear-gradient(135deg, #a855f7 0%, #9333ea 100%)',
            color: 'white',
          }}
        >
          {config.cta}
        </button>
      )}
    </div>
  )
}

export default BeapInboxSidebar
