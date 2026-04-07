/**
 * HandshakeDetailsPanel Component
 *
 * Shows detailed handshake info from the backend HandshakeRecord.
 * Groups handshakes by state (Active / Pending / Revoked).
 * Actions per state:
 *   - PENDING_ACCEPT (acceptor): Accept / Decline
 *   - ACTIVE: Send Message / Revoke
 *   - REVOKED: View only + Delete
 *
 * @version 2.0.0 — added Messages tab (BEAP messages for this handshake)
 */

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { handshakeDetailsStatusPrefix, type HandshakeRecord, type HandshakeState } from '../rpcTypes'
import { useBeapInboxStore } from '../../beap-messages/useBeapInboxStore'
import type { BeapMessage } from '../../beap-messages/beapInboxTypes'
import { BeapMessageDetailPanel } from '../../beap-messages/components/BeapMessageDetailPanel'
import type { BeapMessageDetailPanelHandle } from '../../beap-messages/components/BeapMessageDetailPanel'
import { InboxErrorBoundary } from '../../beap-messages/components/InboxErrorBoundary'

// =============================================================================
// Types
// =============================================================================

type PanelTab = 'details' | 'messages'

interface HandshakeDetailsPanelProps {
  handshake: HandshakeRecord
  theme?: 'default' | 'dark' | 'professional'
  onSendMessage?: (handshakeId: string) => void
  onAccept?: (handshakeId: string) => void
  onRevoke?: (handshakeId: string) => void
  onDelete?: (handshakeId: string) => void
  onClose?: () => void
  /** Navigate to the full BEAP inbox and select this message. */
  onViewInInbox?: (messageId: string) => void
  /** Initial tab to open ('details' | 'messages'). */
  initialTab?: PanelTab
  /** Config for BeapMessageDetailPanel reply composer. */
  replyComposerConfig?: import('../../beap-messages/hooks/useReplyComposer').UseReplyComposerConfig
}

// =============================================================================
// Constants
// =============================================================================

const STATE_CONFIG: Record<HandshakeState, { label: string; color: string; bg: string }> = {
  DRAFT:          { label: 'Draft',            color: '#94a3b8', bg: 'rgba(148,163,184,0.15)' },
  PENDING_ACCEPT: { label: 'Pending',          color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
  PENDING_REVIEW: { label: 'Review pending',   color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
  ACCEPTED:       { label: 'Accepted',         color: '#0ea5e9', bg: 'rgba(14,165,233,0.15)' },
  ACTIVE:         { label: 'Active',           color: '#22c55e', bg: 'rgba(34,197,94,0.15)'  },
  EXPIRED:        { label: 'Expired',          color: '#6b7280', bg: 'rgba(107,114,128,0.15)' },
  REVOKED:        { label: 'Revoked',          color: '#ef4444', bg: 'rgba(239,68,68,0.15)'  },
}

// =============================================================================
// Helpers
// =============================================================================

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts
  const mins  = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days  = Math.floor(diff / 86_400_000)
  if (mins  <  1) return 'Just now'
  if (mins  < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days  <  7) return `${days}d ago`
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function getContentPreview(msg: BeapMessage): string {
  const text = msg.canonicalContent || msg.messageBody || ''
  return text.length > 72 ? text.slice(0, 72).trimEnd() + '…' : text
}

// =============================================================================
// HandshakeMessageRow
// =============================================================================

interface HandshakeMessageRowProps {
  message: BeapMessage
  isSelected: boolean
  isProfessional: boolean
  textColor: string
  mutedColor: string
  onClick: (id: string) => void
}

const HandshakeMessageRow: React.FC<HandshakeMessageRowProps> = ({
  message,
  isSelected,
  isProfessional,
  textColor,
  mutedColor,
  onClick,
}) => {
  const [hovered, setHovered] = useState(false)
  const preview = getContentPreview(message)
  const senderLabel = message.senderDisplayName || message.senderEmail

  // Urgency dot colors
  const urgencyDotColor =
    message.urgency === 'urgent'           ? '#ef4444' :
    message.urgency === 'action-required'  ? '#f59e0b' :
    null

  const cardBg = isSelected
    ? (isProfessional ? 'rgba(139,92,246,0.1)'  : 'rgba(139,92,246,0.2)')
    : hovered
      ? (isProfessional ? 'rgba(0,0,0,0.03)'    : 'rgba(255,255,255,0.07)')
      : (isProfessional ? 'rgba(0,0,0,0.02)'    : 'rgba(255,255,255,0.04)')

  const cardBorder = isSelected
    ? `1px solid ${isProfessional ? 'rgba(139,92,246,0.3)' : 'rgba(139,92,246,0.4)'}`
    : `1px solid ${isProfessional ? 'rgba(0,0,0,0.06)'    : 'rgba(255,255,255,0.06)'}`

  return (
    <div
      onClick={() => onClick(message.messageId)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '10px 12px',
        background: cardBg,
        border: cardBorder,
        borderRadius: '8px',
        marginBottom: '4px',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
      }}
    >
      {/* Top row: sender + timestamp + urgency dot */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flex: 1, minWidth: 0 }}>
          {/* Unread dot */}
          {!message.isRead && (
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#3b82f6', flexShrink: 0, display: 'inline-block' }} />
          )}
          <div
            style={{
              fontSize: '12px',
              fontWeight: message.isRead ? 500 : 700,
              color: textColor,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              textDecoration: message.urgency === 'irrelevant' ? 'line-through' : 'none',
              opacity:        message.urgency === 'irrelevant' ? 0.6 : 1,
            }}
          >
            {senderLabel}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0 }}>
          {urgencyDotColor && (
            <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: urgencyDotColor, display: 'inline-block' }} />
          )}
          <span style={{ fontSize: '10px', color: mutedColor, whiteSpace: 'nowrap' }}>
            {formatRelativeTime(message.timestamp)}
          </span>
        </div>
      </div>

      {/* Preview */}
      {preview && (
        <div
          style={{
            fontSize: '11px',
            color: mutedColor,
            marginTop: '4px',
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
    </div>
  )
}

// =============================================================================
// Main component
// =============================================================================

export const HandshakeDetailsPanel: React.FC<HandshakeDetailsPanelProps> = ({
  handshake,
  theme = 'default',
  onSendMessage,
  onAccept,
  onRevoke,
  onDelete,
  onClose,
  onViewInInbox,
  initialTab = 'details',
  replyComposerConfig,
}) => {
  const isProfessional = theme === 'professional'
  const stateInfo = STATE_CONFIG[handshake.state]

  // ── Tab state ────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<PanelTab>(initialTab)
  // Whether we're showing the full split-panel for a selected message
  const [expandedMessageId, setExpandedMessageId] = useState<string | null>(null)

  // ── Store ────────────────────────────────────────────────
  const messages = useBeapInboxStore(
    useCallback((s) => s.getHandshakeMessages(handshake.handshake_id), [handshake.handshake_id])
  )
  const selectMessage  = useBeapInboxStore((s) => s.selectMessage)
  const selectedMsgId  = useBeapInboxStore((s) => s.selectedMessageId)

  // ── AI panel ref ─────────────────────────────────────────
  const aiPanelRef = useRef<BeapMessageDetailPanelHandle>(null)

  // Reset expanded view when handshake changes
  useEffect(() => {
    setExpandedMessageId(null)
    setActiveTab(initialTab)
  }, [handshake.handshake_id, initialTab])

  // ── Handlers ─────────────────────────────────────────────
  const handleSelectMessage = useCallback(
    (msgId: string) => {
      selectMessage(msgId)
      setExpandedMessageId(msgId)
    },
    [selectMessage],
  )

  const handleBackToList = useCallback(() => {
    setExpandedMessageId(null)
    selectMessage(null)
  }, [selectMessage])

  // ── Styles (unchanged from v1) ───────────────────────────
  const isPro = isProfessional
  const textColor   = isPro ? '#1f2937'                : 'white'
  const mutedColor  = isPro ? '#6b7280'                : 'rgba(255,255,255,0.6)'
  const dimColor    = isPro ? '#9ca3af'                : 'rgba(255,255,255,0.4)'
  const divider     = isPro ? 'rgba(0,0,0,0.1)'        : 'rgba(255,255,255,0.1)'
  const subDivider  = isPro ? 'rgba(0,0,0,0.05)'       : 'rgba(255,255,255,0.05)'
  const panelBg     = isPro ? '#ffffff'                : 'rgba(30,30,40,0.95)'
  const panelBorder = isPro ? 'rgba(0,0,0,0.1)'        : 'rgba(255,255,255,0.1)'
  const sectionBg   = isPro ? 'rgba(0,0,0,0.02)'       : 'rgba(255,255,255,0.04)'
  const inputBg     = isPro ? 'white'                  : 'rgba(255,255,255,0.07)'

  const labelStyle: React.CSSProperties = {
    fontSize: '11px', fontWeight: 600,
    color: mutedColor,
    textTransform: 'uppercase', letterSpacing: '0.5px',
    marginBottom: '8px',
  }
  const buttonStyle: React.CSSProperties = {
    padding: '8px 14px', borderRadius: '6px',
    fontSize: '12px', fontWeight: 500,
    cursor: 'pointer', border: 'none',
    transition: 'all 0.15s ease',
  }

  const unreadCount = messages.filter((m) => !m.isRead).length

  // ── Tab button renderer ──────────────────────────────────
  const renderTabBtn = (tab: PanelTab, label: string, count?: number) => {
    const isActive = activeTab === tab
    return (
      <button
        key={tab}
        onClick={() => { setActiveTab(tab); setExpandedMessageId(null); selectMessage(null) }}
        style={{
          flex: 1,
          padding: '9px 12px',
          fontSize: '12px',
          fontWeight: 600,
          background: 'none',
          border: 'none',
          borderBottom: isActive ? '2px solid #a855f7' : '2px solid transparent',
          color: isActive ? textColor : mutedColor,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '5px',
          transition: 'color 0.15s ease',
        }}
      >
        {label}
        {count !== undefined && count > 0 && (
          <span
            style={{
              fontSize: '10px',
              padding: '1px 6px',
              borderRadius: '8px',
              background: isActive ? 'rgba(139,92,246,0.2)' : (isPro ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.1)'),
              color: isActive ? '#a855f7' : dimColor,
              fontWeight: 500,
            }}
          >
            {count}
          </span>
        )}
      </button>
    )
  }

  // ────────────────────────────────────────────────────────
  // Expanded message view (split panel, replaces content area)
  // ────────────────────────────────────────────────────────
  if (expandedMessageId) {
    return (
      <div
        style={{
          background: panelBg,
          borderRadius: '12px',
          border: `1px solid ${panelBorder}`,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          minHeight: '520px',
        }}
      >
        {/* Expanded view header */}
        <div
          style={{
            padding: '10px 14px',
            borderBottom: `1px solid ${divider}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={handleBackToList}
              style={{
                ...buttonStyle,
                padding: '5px 10px',
                fontSize: '11px',
                background: isPro ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.08)',
                color: mutedColor,
              }}
            >
              ← Back
            </button>
            <span style={{ fontSize: '12px', fontWeight: 600, color: textColor }}>
              🤝 {handshake.counterparty_email}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {onViewInInbox && expandedMessageId && (
              <button
                onClick={() => onViewInInbox(expandedMessageId)}
                style={{
                  ...buttonStyle,
                  padding: '5px 10px',
                  fontSize: '11px',
                  background: 'rgba(139,92,246,0.12)',
                  color: '#a855f7',
                  border: '1px solid rgba(139,92,246,0.25)',
                }}
              >
                View in Inbox
              </button>
            )}
            {onClose && (
              <button
                onClick={onClose}
                style={{ ...buttonStyle, background: 'transparent', color: dimColor, padding: '4px 8px' }}
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Split panel fills remaining space */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
          <InboxErrorBoundary componentName="HandshakeDetailsPanel-Messages" theme={theme === 'default' ? 'dark' : theme}>
            <BeapMessageDetailPanel
              ref={aiPanelRef}
              theme={theme === 'default' ? 'dark' : theme}
              replyComposerConfig={replyComposerConfig}
            />
          </InboxErrorBoundary>
        </div>
      </div>
    )
  }

  // ────────────────────────────────────────────────────────
  // Normal panel
  // ────────────────────────────────────────────────────────
  return (
    <div
      style={{
        background: panelBg,
        borderRadius: '12px',
        border: `1px solid ${panelBorder}`,
        overflow: 'hidden',
      }}
    >
      {/* ── Header ───────────────────────────────────────── */}
      <div
        style={{
          padding: '16px',
          borderBottom: `1px solid ${divider}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <div style={{ fontSize: '16px', fontWeight: 600, color: textColor }}>
            {handshake.counterparty_email}
          </div>
          <div style={{ fontSize: '12px', color: mutedColor, marginTop: '2px' }}>
            {handshake.local_role === 'initiator' ? 'You initiated' : 'They initiated'}
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            style={{ ...buttonStyle, background: 'transparent', color: dimColor, padding: '4px 8px' }}
          >
            ✕
          </button>
        )}
      </div>

      {/* ── Tab bar ──────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          borderBottom: `1px solid ${divider}`,
          background: isPro ? 'rgba(0,0,0,0.01)' : 'rgba(255,255,255,0.02)',
        }}
      >
        {renderTabBtn('details', '📋 Details')}
        {renderTabBtn('messages', '📨 Messages', messages.length)}
      </div>

      {/* ── Tab content ──────────────────────────────────── */}

      {activeTab === 'details' && (
        <>
          {/* State section */}
          <div style={{ padding: '16px', borderBottom: `1px solid ${subDivider}` }}>
            <div style={labelStyle}>Status</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '6px',
                  fontSize: '11px', fontWeight: 600,
                  padding: '6px 12px', borderRadius: '6px',
                  background: stateInfo.bg, color: stateInfo.color,
                  border: `1px solid ${stateInfo.color}33`,
                }}
              >
                {handshakeDetailsStatusPrefix(handshake.state)} {stateInfo.label}
              </span>
              {handshake.activated_at && (
                <span style={{ fontSize: '11px', color: dimColor }}>
                  {new Date(handshake.activated_at).toLocaleDateString()}
                </span>
              )}
            </div>
          </div>

          {/* Details section */}
          <div style={{ padding: '16px', borderBottom: `1px solid ${subDivider}` }}>
            <div style={labelStyle}>Details</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <DetailRow label="Handshake ID"  value={handshake.handshake_id.slice(0, 16) + '…'}  isPro={isPro} />
              <DetailRow label="Relationship"  value={handshake.relationship_id.slice(0, 16) + '…'} isPro={isPro} />
              <DetailRow label="Role"          value={handshake.local_role}                          isPro={isPro} />
              {handshake.sharing_mode && (
                <DetailRow
                  label="Sharing Mode"
                  value={handshake.sharing_mode === 'reciprocal' ? 'Reciprocal' : 'Receive-only'}
                  isPro={isPro}
                />
              )}
              <DetailRow label="Created" value={new Date(handshake.created_at).toLocaleString()} isPro={isPro} />
            </div>
          </div>

          {/* Actions section */}
          <div style={{ padding: '16px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {(handshake.state === 'PENDING_ACCEPT' || handshake.state === 'PENDING_REVIEW') &&
              handshake.local_role === 'acceptor' &&
              onAccept && (
              <button
                onClick={() => onAccept(handshake.handshake_id)}
                style={{ ...buttonStyle, background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)', color: 'white' }}
              >
                ✓ Accept
              </button>
            )}
            {handshake.state === 'ACTIVE' && onSendMessage && (
              <button
                onClick={() => { onSendMessage(handshake.handshake_id); setActiveTab('messages') }}
                style={{ ...buttonStyle, background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)', color: 'white' }}
              >
                📤 Send Message
              </button>
            )}
            {handshake.state === 'ACTIVE' && onRevoke && (
              <button
                onClick={() => onRevoke(handshake.handshake_id)}
                style={{ ...buttonStyle, background: 'transparent', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444' }}
              >
                Revoke
              </button>
            )}
            {handshake.state === 'REVOKED' && onDelete && (
              <button
                onClick={() => onDelete(handshake.handshake_id)}
                style={{ ...buttonStyle, background: 'transparent', border: '1px solid rgba(107,114,128,0.3)', color: '#94a3b8' }}
              >
                Delete
              </button>
            )}
          </div>
        </>
      )}

      {activeTab === 'messages' && (
        <InboxErrorBoundary componentName="HandshakeDetailsPanel-MessagesTab" theme={theme === 'default' ? 'dark' : theme}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {/* Messages tab content */}
          {messages.length === 0 ? (
            /* Empty state */
            <div
              style={{
                padding: '32px 20px',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: '32px', marginBottom: '10px', opacity: 0.4 }}>📨</div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: textColor, marginBottom: '5px' }}>
                No messages yet
              </div>
              <div style={{ fontSize: '11px', color: mutedColor, lineHeight: 1.5 }}>
                Messages exchanged via this handshake will appear here.
              </div>
              {handshake.state === 'ACTIVE' && onSendMessage && (
                <button
                  onClick={() => onSendMessage(handshake.handshake_id)}
                  style={{
                    marginTop: '14px',
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
                  📤 Send First Message
                </button>
              )}
            </div>
          ) : (
            <div style={{ padding: '8px' }}>
              {messages.map((msg) => (
                <HandshakeMessageRow
                  key={msg.messageId}
                  message={msg}
                  isSelected={msg.messageId === selectedMsgId}
                  isProfessional={isPro}
                  textColor={textColor}
                  mutedColor={mutedColor}
                  onClick={handleSelectMessage}
                />
              ))}
            </div>
          )}
        </div>
        </InboxErrorBoundary>
      )}

      {/* ── Footer (always visible; message count clickable to switch to Messages) ── */}
      <div
        style={{
          padding: '10px 14px',
          borderTop: `1px solid ${subDivider}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: isPro ? 'rgba(0,0,0,0.01)' : 'rgba(255,255,255,0.02)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={() => setActiveTab('messages')}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              fontSize: '11px',
              color: dimColor,
            }}
          >
            {messages.length} Message{messages.length !== 1 ? 's' : ''}
          </button>
          {activeTab === 'messages' && unreadCount > 0 && (
            <span
              style={{
                fontSize: '10px',
                padding: '1px 6px',
                borderRadius: '8px',
                background: 'rgba(59,130,246,0.15)',
                color: '#3b82f6',
                fontWeight: 600,
              }}
            >
              {unreadCount} unread
            </span>
          )}
        </div>
        {onViewInInbox && messages.length > 0 && (
          <button
            onClick={() => onViewInInbox(messages[0].messageId)}
            style={{
              padding: '3px 8px',
              fontSize: '10px',
              fontWeight: 500,
              borderRadius: '5px',
              border: `1px solid ${isPro ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.12)'}`,
              background: 'transparent',
              color: mutedColor,
              cursor: 'pointer',
            }}
          >
            Open in Inbox →
          </button>
        )}
      </div>
    </div>
  )
}

// =============================================================================
// DetailRow (unchanged)
// =============================================================================

const DetailRow: React.FC<{ label: string; value: string; isPro: boolean }> = ({
  label, value, isPro,
}) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
    <span style={{ fontSize: '11px', color: isPro ? '#9ca3af' : 'rgba(255,255,255,0.4)' }}>
      {label}
    </span>
    <span
      style={{
        fontSize: '12px',
        color: isPro ? '#1f2937' : 'white',
        fontFamily: 'monospace',
        background: isPro ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.05)',
        padding: '2px 6px',
        borderRadius: '4px',
      }}
    >
      {value}
    </span>
  </div>
)

export default HandshakeDetailsPanel
