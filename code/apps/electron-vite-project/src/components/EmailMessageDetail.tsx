/**
 * EmailMessageDetail — Full detail panel for viewing a selected inbox message.
 * Header (From, To, date, subject, actions), source badge, body, attachments, deletion notice.
 */

import { useCallback, useMemo, useState, type ReactNode } from 'react'
import type { InboxMessage, InboxSourceType } from '../stores/useEmailInboxStore'
import { useEmailInboxStore } from '../stores/useEmailInboxStore'
import InboxAttachmentRow from './InboxAttachmentRow'
import LinkWarningDialog from './LinkWarningDialog'
import { extractLinkParts } from '../utils/safeLinks'
import { deriveInboxMessageKind } from '../lib/inboxMessageKind'

export interface EmailMessageDetailProps {
  message: InboxMessage | null
  /** When provided, used instead of store for attachment focus (e.g. bulk inbox → Hybrid Search) */
  selectedAttachmentId?: string | null
  /** When provided, called when user selects/deselects an attachment (for HybridSearch scope) */
  onSelectAttachment?: (attachmentId: string | null) => void
  /** When provided, called when user clicks Reply — routes depackaged → EmailComposeOverlay, BEAP → openBeapDraft */
  onReply?: (message: InboxMessage) => void
}

// ── Helpers ──

function formatDate(isoString: string | null): string {
  if (!isoString) return '—'
  try {
    return new Date(isoString).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return '—'
  }
}

function formatSourceBadge(sourceType: InboxSourceType): string {
  switch (sourceType) {
    case 'direct_beap':
      return 'Direct BEAP'
    case 'email_beap':
      return 'BEAP'
    case 'email_plain':
      return 'Plain Email'
    default:
      return 'Email'
  }
}

/** Basic HTML sanitization: strip script, style, iframe, object, embed; remove on* attributes */
function sanitizeHtml(html: string): string {
  if (!html || typeof html !== 'string') return ''
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const remove = doc.querySelectorAll('script, style, iframe, object, embed')
  remove.forEach((el) => el.remove())
  doc.body.querySelectorAll('*').forEach((el) => {
    Array.from(el.attributes).forEach((attr) => {
      if (/^on/i.test(attr.name) || attr.name === 'href' && attr.value?.startsWith('javascript:')) {
        el.removeAttribute(attr.name)
      }
    })
  })
  return doc.body.innerHTML
}

function getAutomationTags(p: Record<string, unknown>): string[] {
  const a = p.automation
  if (!a || typeof a !== 'object') return []
  const tags = (a as { tags?: unknown }).tags
  if (!Array.isArray(tags)) return []
  return tags.filter((t): t is string => typeof t === 'string')
}

function getSessionRefs(p: Record<string, unknown>): Array<Record<string, unknown>> {
  const r = p.sessionRefs
  if (!Array.isArray(r)) return []
  return r.filter((x): x is Record<string, unknown> => x !== null && typeof x === 'object')
}

function renderDepackagedJson(jsonStr: string | null): ReactNode {
  if (!jsonStr || typeof jsonStr !== 'string') return null
  try {
    const parsed = JSON.parse(jsonStr)
    if (typeof parsed !== 'object' || parsed === null) return null
    return (
      <div className="msg-detail-beap-json">
        {JSON.stringify(parsed, null, 2)}
      </div>
    )
  } catch {
    return null
  }
}

export default function EmailMessageDetail({ message, selectedAttachmentId: selectedAttachmentIdProp, onSelectAttachment, onReply }: EmailMessageDetailProps) {
  const [beapPanelOpen, setBeapPanelOpen] = useState(false)
  const [pendingLinkUrl, setPendingLinkUrl] = useState<string | null>(null)
  const {
    selectedAttachmentId: storeSelectedAttachmentId,
    selectAttachment,
    toggleStar,
    archiveMessages,
    deleteMessages,
    cancelDeletion,
    editingDraftForMessageId,
    setEditingDraftForMessageId,
  } = useEmailInboxStore()

  const messageKind = message ? deriveInboxMessageKind(message) : 'depackaged'
  const isNativeBeap = messageKind === 'handshake'

  const parsedDepackaged = useMemo(() => {
    if (!isNativeBeap || !message?.depackaged_json) return null
    try {
      return JSON.parse(message.depackaged_json) as Record<string, unknown>
    } catch {
      return null
    }
  }, [isNativeBeap, message?.depackaged_json])

  const fromDisplay = useMemo((): ReactNode => {
    if (!message) return '—'
    if (isNativeBeap) {
      const name = message.from_name || message.from_address
      return (
        <span>
          {name || 'Unknown sender'}
          {message.handshake_id ? (
            <span className="beap-identity-badge" title="Verified via BEAP handshake">
              🤝 Handshake
            </span>
          ) : null}
        </span>
      )
    }
    return message.from_name
      ? `${message.from_name} <${message.from_address || ''}>`
      : message.from_address || '—'
  }, [isNativeBeap, message])

  const toDisplay = useMemo((): ReactNode => {
    if (!message) return '—'
    if (isNativeBeap) {
      return message.to_addresses || 'You (local identity)'
    }
    return message.to_addresses || '—'
  }, [isNativeBeap, message])

  if (!message) return null

  const isBeap = message.source_type === 'email_beap' || message.source_type === 'direct_beap'
  const hasAttachments = message.has_attachments === 1
  const attachments = message.attachments ?? []
  const isDeleted = message.deleted === 1

  const automationTags = parsedDepackaged ? getAutomationTags(parsedDepackaged) : []
  const sessionRefsList = parsedDepackaged ? getSessionRefs(parsedDepackaged) : []

  const handleStar = useCallback(() => {
    toggleStar(message.id)
  }, [message.id, toggleStar])

  const handleArchive = useCallback(() => {
    archiveMessages([message.id])
  }, [message.id, archiveMessages])

  const handleDelete = useCallback(() => {
    deleteMessages([message.id])
  }, [message.id, deleteMessages])

  const handleCancelDeletion = useCallback(() => {
    cancelDeletion(message.id)
  }, [message.id, cancelDeletion])

  const handleReply = useCallback(() => {
    onReply?.(message)
  }, [message, onReply])

  const handleLinkClick = useCallback((url: string) => setPendingLinkUrl(url), [])
  const handleLinkConfirm = useCallback(() => {
    if (pendingLinkUrl) {
      window.open(pendingLinkUrl, '_blank', 'noopener,noreferrer')
      setPendingLinkUrl(null)
    }
  }, [pendingLinkUrl])
  const handleLinkCancel = useCallback(() => setPendingLinkUrl(null), [])

  return (
    <>
      <LinkWarningDialog
        isOpen={!!pendingLinkUrl}
        url={pendingLinkUrl || ''}
        onConfirm={handleLinkConfirm}
        onCancel={handleLinkCancel}
      />
    <div
      className={`inbox-detail-message-inner inbox-detail-message-inner--premium${editingDraftForMessageId === message.id ? ' inbox-detail-message-inner--editing-draft' : ''}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 16 }}>
        {/* Deletion notice */}
        {isDeleted && (
          <div
            style={{
              padding: 12,
              marginBottom: 16,
              background: 'rgba(239,68,68,0.15)',
              border: '1px solid rgba(239,68,68,0.4)',
              borderRadius: 8,
              color: '#fca5a5',
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
              Message scheduled for deletion
            </div>
            <div style={{ fontSize: 12, marginBottom: 10 }}>
              {message.purge_after
                ? `Permanent deletion: ${formatDate(message.purge_after)}`
                : 'Permanent deletion pending'}
            </div>
            <button
              type="button"
              onClick={handleCancelDeletion}
              style={{
                padding: '6px 12px',
                fontSize: 11,
                fontWeight: 600,
                background: 'rgba(34,197,94,0.2)',
                border: '1px solid rgba(34,197,94,0.4)',
                borderRadius: 6,
                color: '#86efac',
                cursor: 'pointer',
              }}
            >
              Cancel Deletion
            </button>
          </div>
        )}

        {/* Header — stacked: subject full-width, then actions, then metadata */}
        <div style={{ marginBottom: 16 }}>
          <h2
            style={{
              margin: 0,
              fontSize: 18,
              fontWeight: 700,
              width: '100%',
              wordBreak: 'break-word',
              marginBottom: 10,
            }}
          >
            {message.subject || '(No subject)'}
          </h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 10 }}>
            {editingDraftForMessageId === message.id && (
              <span
                role="button"
                tabIndex={0}
                className="inbox-detail-editing-draft-indicator"
                onClick={() => setEditingDraftForMessageId(null)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setEditingDraftForMessageId(null)
                  }
                }}
                title="Click to exit edit mode"
              >
                Editing draft
              </span>
            )}
            <button
              type="button"
              onClick={handleStar}
              title={message.starred === 1 ? 'Unstar' : 'Star'}
              style={{
                padding: '6px 10px',
                fontSize: 11,
                fontWeight: 600,
                background: message.starred === 1 ? 'rgba(139,92,246,0.2)' : 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(139,92,246,0.3)',
                borderRadius: 6,
                color: message.starred === 1 ? '#a78bfa' : 'var(--color-text-muted, #94a3b8)',
                cursor: 'pointer',
              }}
            >
              {message.starred === 1 ? '★ Starred' : '☆ Star'}
            </button>
            <button
              type="button"
              onClick={handleArchive}
              style={{
                padding: '6px 10px',
                fontSize: 11,
                fontWeight: 600,
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 6,
                color: 'var(--color-text, #e2e8f0)',
                cursor: 'pointer',
              }}
            >
              Archive
            </button>
            <button
              type="button"
              onClick={handleDelete}
              style={{
                padding: '6px 10px',
                fontSize: 11,
                fontWeight: 600,
                background: 'rgba(239,68,68,0.1)',
                border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: 6,
                color: '#fca5a5',
                cursor: 'pointer',
              }}
            >
              Delete
            </button>
            {onReply && (
              <button
                type="button"
                onClick={handleReply}
                title={isBeap ? 'Reply with BEAP' : 'Reply with email'}
                style={{
                  padding: '6px 10px',
                  fontSize: 11,
                  fontWeight: 600,
                  background: 'rgba(139,92,246,0.15)',
                  border: '1px solid rgba(139,92,246,0.3)',
                  borderRadius: 6,
                  color: '#a78bfa',
                  cursor: 'pointer',
                }}
              >
                Reply
              </button>
            )}
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted, #94a3b8)' }}>
            <div>From: {fromDisplay}</div>
            <div>To: {toDisplay}</div>
            <div>{formatDate(message.received_at)}</div>
          </div>
        </div>

        {/* Source badge */}
        <div style={{ marginBottom: 16 }}>
          <span
            style={{
              fontSize: 10,
              padding: '4px 8px',
              borderRadius: 4,
              fontWeight: 600,
              background: isBeap ? 'rgba(139,92,246,0.2)' : 'rgba(107,114,128,0.2)',
              color: isBeap ? '#a78bfa' : 'var(--color-text-muted, #94a3b8)',
            }}
          >
            {formatSourceBadge(message.source_type)}
          </span>
        </div>

        {/* Body — human-readable by default; native BEAP uses structured depackaged sections */}
        <div style={{ marginBottom: 20 }}>
          {isNativeBeap && parsedDepackaged ? (
            <div className="native-beap-body">
              {message.body_text ? (
                <div className="beap-body-section">
                  <div className="beap-body-label">📨 Public Message (pBEAP)</div>
                  <div className="beap-body-content beap-body-content--public">
                    <pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'inherit' }}>
                      {message.body_text}
                    </pre>
                  </div>
                </div>
              ) : null}

              {parsedDepackaged.body != null && String(parsedDepackaged.body).trim() !== '' ? (
                <div className="beap-body-section">
                  <div className="beap-body-label beap-body-label--confidential">
                    🔒 CONFIDENTIAL (qBEAP — Encrypted Content)
                  </div>
                  <div className="beap-body-content beap-body-content--confidential">
                    <pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'inherit' }}>
                      {typeof parsedDepackaged.body === 'string'
                        ? parsedDepackaged.body
                        : String(parsedDepackaged.body)}
                    </pre>
                  </div>
                </div>
              ) : null}

              {automationTags.length > 0 ? (
                <div className="beap-body-section">
                  <div className="beap-body-label">🏷️ Automation Tags</div>
                  <div className="beap-automation-tags">
                    {automationTags.map((tag, i) => (
                      <span key={i} className="beap-automation-tag">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {sessionRefsList.length > 0 ? (
                <div className="beap-body-section beap-session-indicator">
                  <div className="beap-body-label">⚙️ Attached Session</div>
                  {sessionRefsList.map((ref, i) => {
                    const sessionId =
                      typeof ref.sessionId === 'string' ? ref.sessionId : String(ref.sessionId ?? '')
                    const sessionName =
                      typeof ref.sessionName === 'string'
                        ? ref.sessionName
                        : sessionId || 'Session'
                    const cap = ref.requiredCapability
                    const capLabel =
                      cap != null && typeof cap === 'object'
                        ? JSON.stringify(cap)
                        : cap != null
                          ? String(cap)
                          : ''
                    return (
                      <div key={i} className="beap-session-ref">
                        <span className="beap-session-name">{sessionName || sessionId}</span>
                        {capLabel ? (
                          <span className="beap-session-capability">Requires: {capLabel}</span>
                        ) : null}
                        <button
                          type="button"
                          className="beap-session-import-btn"
                          onClick={() => {
                            console.log('Import session:', sessionId)
                          }}
                        >
                          ▶ Import & Run
                        </button>
                      </div>
                    )
                  })}
                </div>
              ) : null}
            </div>
          ) : (
            <>
              {message.body_html ? (
                <div
                  className="msg-detail-body-html"
                  onClick={(e) => {
                    const a = (e.target as HTMLElement).closest('a[href]')
                    if (a) {
                      e.preventDefault()
                      e.stopPropagation()
                      const href = (a as HTMLAnchorElement).href
                      if (href && !href.startsWith('mailto:')) handleLinkClick(href)
                    }
                  }}
                  style={{
                    fontSize: 13,
                    lineHeight: 1.6,
                    color: 'var(--color-text, #e2e8f0)',
                  }}
                >
                  <div
                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(message.body_html) }}
                    style={{ fontSize: 'inherit', lineHeight: 'inherit', color: 'inherit' }}
                  />
                </div>
              ) : (
                <pre
                  style={{
                    margin: 0,
                    fontSize: 13,
                    lineHeight: 1.6,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    fontFamily: 'inherit',
                  }}
                >
                  {extractLinkParts(message.body_text || '(No body)').map((part, i) =>
                    part.type === 'text' ? (
                      <span key={i}>{part.text}</span>
                    ) : (
                      <button
                        key={i}
                        type="button"
                        className="msg-safe-link-btn"
                        onClick={() => handleLinkClick(part.url!)}
                      >
                        {part.text}
                      </button>
                    )
                  )}
                </pre>
              )}

              {message.depackaged_json && !isNativeBeap ? (
                <div style={{ marginTop: 16 }}>
                  <button
                    type="button"
                    className="msg-detail-beap-toggle"
                    onClick={() => setBeapPanelOpen((o) => !o)}
                  >
                    BEAP content
                  </button>
                  {beapPanelOpen && (
                    <div className="msg-detail-beap-panel">
                      {renderDepackagedJson(message.depackaged_json)}
                    </div>
                  )}
                </div>
              ) : null}
            </>
          )}
        </div>

        {/* Attachments */}
        {hasAttachments && attachments.length > 0 && (
          <div className="inbox-detail-attachments-block" data-subfocus="attachment">
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: 'var(--color-text-muted, #94a3b8)',
                marginBottom: 12,
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
                selectedAttachmentId={selectedAttachmentIdProp ?? storeSelectedAttachmentId}
                onSelectAttachment={onSelectAttachment ?? ((id) => selectAttachment(message.id, id))}
              />
            ))}
          </div>
        )}
      </div>
    </div>
    </>
  )
}
