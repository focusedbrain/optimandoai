/**
 * BeapMessageDetailPanel
 *
 * Split-viewport right-side panel for the BEAP™ Inbox.
 *
 * Layout
 * ──────
 *   ┌─────────────────────────────────────────────┐
 *   │  Message Content (left)  │  AI Output (right) │
 *   │  (scrollable)            ║  (scrollable)       │
 *   └─────────────────────────────────────────────┘
 *                              ↑ drag handle
 *
 * Sub-components
 * ──────────────
 *   MessageContentPanel  — sender header, canonical content, tags,
 *                          attachments, reply composer
 *   AiOutputPanel        — AI entries list + empty state + clear button
 *   ResizeDivider        — thin drag handle between the two halves
 *
 * Search bar integration
 * ──────────────────────
 * When `onSetSearchContext` is provided, the panel calls it with a context
 * label whenever the selected message changes. The parent (sidepanel.tsx)
 * should push this label into the search bar placeholder. When the user
 * submits a search query, the parent calls `onAiQuery(query)` which appends
 * to the AI output panel.
 *
 * @version 1.0.0
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import type { BeapMessage, BeapAttachment, TrustLevel } from '../beapInboxTypes'
import type { AiOutputEntry } from '../hooks/useBeapMessageAi'
import { useBeapInboxStore } from '../useBeapInboxStore'
import { useBeapMessageAi } from '../hooks/useBeapMessageAi'
import { useReplyComposer } from '../hooks/useReplyComposer'
import { BeapReplyComposer } from './BeapReplyComposer'
import { AiEntryContent } from './AiEntryContent'
import { BeapAttachmentReader } from './BeapAttachmentReader'
import ProtectedAccessWarningDialog from './ProtectedAccessWarningDialog'
import { useViewOriginalArtefact } from '../hooks/useViewOriginalArtefact'

// =============================================================================
// Public props
// =============================================================================

export interface BeapMessageDetailPanelProps {
  /** Active theme — mirrors HandshakeManagementPanel convention. */
  theme?: 'default' | 'dark' | 'professional'
  /**
   * Called whenever the selected message changes.
   * Pass the returned label string to the search bar as a placeholder prefix.
   */
  onSetSearchContext?: (label: string) => void
  /**
   * Called when an AI query is submitted from the search bar.
   * The parent receives the query, calls its AI backend, then should call
   * the returned `appendAiEntry` callback (exposed via ref or prop) with the
   * response.  For now the parent can also call `appendAiEntry` directly by
   * holding a ref to this component — see `BeapMessageDetailPanelHandle`.
   */
  onAiQuery?: (query: string, messageId: string, attachmentId?: string) => void
  /**
   * Called when the user clicks "View Handshake" on a message that has a
   * handshakeId.  Parent navigates to the Handshakes tab and highlights the
   * matching handshake.
   */
  onViewHandshake?: (handshakeId: string) => void
  /**
   * Called when the user selects or deselects an attachment.
   * Parent can update search bar scope (e.g. for HybridSearch pointing finger).
   */
  onAttachmentSelect?: (messageId: string, attachmentId: string | null) => void

  /**
   * Config for the shared BeapReplyComposer (sender fingerprint, AI provider, etc.).
   */
  replyComposerConfig?: import('../hooks/useReplyComposer').UseReplyComposerConfig
}

/** Ref handle so parent can push AI responses into the panel. */
export interface BeapMessageDetailPanelHandle {
  appendAiEntry: (entry: Omit<AiOutputEntry, 'id' | 'generatedAt'>) => void
  startGenerating: () => void
  stopGenerating: () => void
  clearAi: () => void
  getSearchContextLabel: () => string
}

// =============================================================================
// Constants
// =============================================================================

const MIN_SPLIT_PX = 240
const DEFAULT_SPLIT_RATIO = 0.5

const TRUST_BADGE: Record<TrustLevel, { label: string; color: string; bg: string }> = {
  enterprise: { label: 'Enterprise', color: '#b45309', bg: 'rgba(245,158,11,0.15)' },
  pro:        { label: 'Pro',        color: '#2563eb', bg: 'rgba(59,130,246,0.15)'  },
  standard:   { label: 'Standard',   color: '#16a34a', bg: 'rgba(34,197,94,0.15)'   },
  depackaged: { label: 'Email',      color: '#6b7280', bg: 'rgba(107,114,128,0.12)' },
}

// =============================================================================
// Helpers
// =============================================================================

function formatFullTime(ts: number): string {
  return new Date(ts).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1048576).toFixed(1)} MB`
}

// =============================================================================
// ResizeDivider
// =============================================================================

interface ResizeDividerProps {
  isProfessional: boolean
  onMouseDown: (e: React.MouseEvent) => void
}

const ResizeDivider: React.FC<ResizeDividerProps> = ({ isProfessional, onMouseDown }) => {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onMouseDown={onMouseDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title="Drag to resize"
      style={{
        width: '5px',
        cursor: 'col-resize',
        flexShrink: 0,
        background: hovered
          ? (isProfessional ? 'rgba(139,92,246,0.4)' : 'rgba(139,92,246,0.5)')
          : (isProfessional ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'),
        transition: 'background 0.15s ease',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        userSelect: 'none',
      }}
    >
      {/* 3-dot grip indicator */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              width: '3px',
              height: '3px',
              borderRadius: '50%',
              background: hovered
                ? '#a855f7'
                : (isProfessional ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.2)'),
            }}
          />
        ))}
      </div>
    </div>
  )
}

// =============================================================================
// MessageContentPanel
// =============================================================================

interface MessageContentPanelProps {
  message: BeapMessage
  theme: 'default' | 'dark' | 'professional'
  selectedAttachmentId: string | null
  onSelectAttachment: (id: string | null) => void
  /** Composer state and actions from useReplyComposer. */
  composerState: import('../hooks/useReplyComposer').ReplyComposerState
  composerActions: import('../hooks/useReplyComposer').ReplyComposerActions
  /** Navigate to the Handshakes tab for this message's handshake relationship. */
  onViewHandshake?: (handshakeId: string) => void
  /** Called when user confirms viewing the original artefact (after warning). */
  onViewOriginal?: (attachment: BeapAttachment) => void
  /** Error message from view original (e.g. artefact not available). */
  viewOriginalError?: string | null
  onDismissViewOriginalError?: () => void
  /** Optional — user-initiated summarize (selection no longer auto-triggers AI). */
  onSummarizeAttachment?: (attachment: BeapAttachment) => void
}

const MessageContentPanel: React.FC<MessageContentPanelProps> = ({
  message,
  theme,
  selectedAttachmentId,
  onSelectAttachment,
  composerState,
  composerActions,
  onViewHandshake,
  onViewOriginal,
  viewOriginalError,
  onDismissViewOriginalError,
  onSummarizeAttachment,
}) => {
  const isProfessional = theme === 'professional'
  const textColor = isProfessional ? '#1f2937' : 'white'
  const mutedColor = isProfessional ? '#6b7280' : 'rgba(255,255,255,0.6)'
  const dimColor = isProfessional ? '#9ca3af' : 'rgba(255,255,255,0.4)'
  const cardBg = isProfessional ? '#ffffff' : 'rgba(255,255,255,0.04)'
  const borderColor = isProfessional ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'

  const hasHandshake = message.handshakeId !== null
  const trustConfig = TRUST_BADGE[message.trustLevel]
  const senderLabel = message.senderDisplayName || message.senderEmail

  // Automation tag colors — cycle through a small palette
  const TAG_COLORS = [
    { color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)' },
    { color: '#3b82f6', bg: 'rgba(59,130,246,0.12)'  },
    { color: '#22c55e', bg: 'rgba(34,197,94,0.12)'   },
    { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)'  },
    { color: '#ec4899', bg: 'rgba(236,72,153,0.12)'  },
  ]

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* ── Header ─────────────────────────────────────── */}
      <div
        style={{
          padding: '14px 16px',
          borderBottom: `1px solid ${borderColor}`,
          background: cardBg,
          flexShrink: 0,
        }}
      >
        {/* Sender row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {/* Handshake / mail icon */}
            <span style={{ fontSize: '18px', lineHeight: 1 }}>
              {hasHandshake ? '🤝' : '✉️'}
            </span>
            <div>
              <div
                style={{
                  fontSize: '13px',
                  fontWeight: 600,
                  color: textColor,
                  lineHeight: 1.2,
                }}
              >
                {senderLabel}
              </div>
              {message.senderDisplayName && (
                <div style={{ fontSize: '11px', color: dimColor, marginTop: '2px' }}>
                  {message.senderEmail}
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
            {/* Trust badge */}
            <span
              style={{
                fontSize: '9px',
                fontWeight: 600,
                textTransform: 'uppercase' as const,
                letterSpacing: '0.3px',
                padding: '2px 6px',
                borderRadius: '4px',
                color: trustConfig.color,
                background: trustConfig.bg,
              }}
            >
              {trustConfig.label}
            </span>
            {/* Timestamp */}
            <span style={{ fontSize: '11px', color: dimColor, whiteSpace: 'nowrap' as const }}>
              {formatFullTime(message.timestamp)}
            </span>
          </div>
        </div>

        {/* Reply mode indicator + View Handshake link */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: '10px',
              fontWeight: 600,
              padding: '2px 8px',
              borderRadius: '4px',
              color: hasHandshake ? '#16a34a' : '#2563eb',
              background: hasHandshake
                ? 'rgba(34,197,94,0.12)'
                : 'rgba(59,130,246,0.12)',
            }}
          >
            {hasHandshake ? '🤝 Reply via BEAP' : '✉️ Reply via Email'}
          </span>
          {!hasHandshake && (
            <span style={{ fontSize: '10px', color: dimColor }}>
              with wrdesk.com signature
            </span>
          )}
          {/* View Handshake link — only for messages with a handshake */}
          {hasHandshake && message.handshakeId && onViewHandshake && (
            <button
              onClick={() => onViewHandshake(message.handshakeId!)}
              style={{
                padding: '2px 8px',
                fontSize: '10px',
                fontWeight: 500,
                borderRadius: '4px',
                border: `1px solid ${isProfessional ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.12)'}`,
                background: 'transparent',
                color: mutedColor,
                cursor: 'pointer',
              }}
            >
              View Handshake →
            </button>
          )}
        </div>
      </div>

      {/* ── Scrollable body ────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>

        {/* Canonical content */}
        <div
          style={{
            fontSize: '13px',
            lineHeight: 1.65,
            color: textColor,
            whiteSpace: 'pre-wrap' as const,
            wordBreak: 'break-word' as const,
            marginBottom: '14px',
          }}
        >
          {message.canonicalContent || message.messageBody || (
            <span style={{ color: dimColor, fontStyle: 'italic' }}>
              No content — message not yet verified.
            </span>
          )}
        </div>

        {/* Automation tags */}
        {message.automationTags.length > 0 && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap' as const,
              gap: '5px',
              marginBottom: '14px',
            }}
          >
            {message.automationTags.map((tag, i) => {
              const tc = TAG_COLORS[i % TAG_COLORS.length]
              return (
                <span
                  key={tag}
                  style={{
                    fontSize: '11px',
                    fontWeight: 500,
                    padding: '3px 8px',
                    borderRadius: '4px',
                    color: tc.color,
                    background: tc.bg,
                  }}
                >
                  #{tag}
                </span>
              )
            })}
          </div>
        )}

        {/* Attachments */}
        {message.attachments.length > 0 && (
          <div
            style={{
              padding: '12px 14px',
              background: isProfessional ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${borderColor}`,
              borderRadius: '8px',
              marginBottom: '14px',
            }}
          >
            <div
              style={{
                fontSize: '11px',
                fontWeight: 600,
                color: mutedColor,
                textTransform: 'uppercase' as const,
                letterSpacing: '0.4px',
                marginBottom: '8px',
              }}
            >
              Attachments ({message.attachments.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              {message.attachments.map((att) => (
                <AttachmentRow
                  key={att.attachmentId}
                  attachment={att}
                  isSelected={att.attachmentId === selectedAttachmentId}
                  isProfessional={isProfessional}
                  textColor={textColor}
                  mutedColor={mutedColor}
                  borderColor={borderColor}
                  onClick={() =>
                    onSelectAttachment(
                      att.attachmentId === selectedAttachmentId
                        ? null
                        : att.attachmentId,
                    )
                  }
                  onViewOriginal={onViewOriginal}
                  onSummarize={
                    onSummarizeAttachment ? () => onSummarizeAttachment(att) : undefined
                  }
                />
              ))}
            </div>
            {/* Reader panel below list when selected attachment has semanticContent */}
            {selectedAttachmentId && (() => {
              const sel = message.attachments.find((a) => a.attachmentId === selectedAttachmentId)
              if (!sel?.semanticContent?.trim()) return null
              return (
                <div style={{ marginTop: '12px' }}>
                  <div
                    style={{
                      fontSize: '11px',
                      fontWeight: 600,
                      color: mutedColor,
                      textTransform: 'uppercase' as const,
                      letterSpacing: '0.4px',
                      marginBottom: '6px',
                    }}
                  >
                    📄 Extracted Text
                  </div>
                  <BeapAttachmentReader
                    attachment={sel}
                    isProfessional={isProfessional}
                    maxHeight={280}
                    showCopy={true}
                  />
                </div>
              )
            })()}
          </div>
        )}
      </div>

      {/* ── Reply composer (shared BeapReplyComposer) ───── */}
      <div
        style={{
          padding: '12px 14px',
          borderTop: `1px solid ${borderColor}`,
          background: cardBg,
          flexShrink: 0,
        }}
      >
        <BeapReplyComposer
          state={composerState}
          actions={composerActions}
          theme={theme}
          showAiDraft={true}
          showAttachments={true}
          minRows={3}
        />
      </div>
    </div>
  )
}

// =============================================================================
// AttachmentRow — reader view for semanticContent + warning before original access
// =============================================================================

interface AttachmentRowProps {
  attachment: BeapAttachment
  isSelected: boolean
  isProfessional: boolean
  textColor: string
  mutedColor: string
  borderColor: string
  onClick: () => void
  /** Called when user confirms viewing the original artefact (after warning). */
  onViewOriginal?: (attachment: BeapAttachment) => void
  /** User-initiated summarize (optional). */
  onSummarize?: () => void
}

const AttachmentRow: React.FC<AttachmentRowProps> = ({
  attachment,
  isSelected,
  isProfessional,
  textColor,
  mutedColor,
  borderColor,
  onClick,
  onViewOriginal,
  onSummarize,
}) => {
  const [hovered, setHovered] = useState(false)
  const [showWarning, setShowWarning] = useState(false)

  const hasSemanticContent = !!attachment.semanticContent?.trim()

  const handleViewOriginalClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowWarning(true)
  }

  const handleSummarizeClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onSummarize?.()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <div
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('[data-no-select]')) return
          onClick()
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        title={isSelected ? 'Click to deselect attachment' : 'Click to select attachment (text reader below)'}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '7px 10px',
          borderRadius: '6px',
          cursor: 'pointer',
          border: isSelected
            ? `1px solid ${isProfessional ? 'rgba(139,92,246,0.35)' : 'rgba(139,92,246,0.45)'}`
            : `1px solid ${hovered ? borderColor : 'transparent'}`,
          background: isSelected
            ? (isProfessional ? 'rgba(139,92,246,0.08)' : 'rgba(139,92,246,0.15)')
            : hovered
              ? (isProfessional ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.06)')
              : 'transparent',
          transition: 'all 0.12s ease',
        }}
      >
        <span style={{ fontSize: '14px', flexShrink: 0 }}>📄</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: '12px',
              fontWeight: isSelected ? 600 : 500,
              color: isSelected ? (isProfessional ? '#7c3aed' : '#c084fc') : textColor,
              whiteSpace: 'nowrap' as const,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {attachment.filename}
          </div>
          <div style={{ fontSize: '10px', color: mutedColor, marginTop: '1px' }}>
            {attachment.mimeType} · {formatBytes(attachment.sizeBytes)}
            {hasSemanticContent && ' · text extracted'}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }} data-no-select>
          {onSummarize && hasSemanticContent && (
            <button
              type="button"
              onClick={handleSummarizeClick}
              style={{
                background: 'transparent',
                border: `1px solid ${isProfessional ? 'rgba(139,92,246,0.45)' : 'rgba(139,92,246,0.55)'}`,
                borderRadius: '4px',
                padding: '2px 6px',
                fontSize: '10px',
                color: isProfessional ? '#7c3aed' : '#c084fc',
                cursor: 'pointer',
              }}
            >
              Summarize
            </button>
          )}
          {onViewOriginal && (
            <button
              type="button"
              onClick={handleViewOriginalClick}
              style={{
                background: 'transparent',
                border: `1px solid ${isProfessional ? 'rgba(245,158,11,0.5)' : 'rgba(245,158,11,0.6)'}`,
                borderRadius: '4px',
                padding: '2px 6px',
                fontSize: '10px',
                color: isProfessional ? '#b45309' : '#fbbf24',
                cursor: 'pointer',
              }}
            >
              View Original
            </button>
          )}
        </div>
        {isSelected && (
          <span
            style={{
              fontSize: '10px',
              fontWeight: 600,
              padding: '1px 5px',
              borderRadius: '3px',
              color: '#a855f7',
              background: 'rgba(168,85,247,0.12)',
              flexShrink: 0,
            }}
          >
            active
          </span>
        )}
      </div>

      <ProtectedAccessWarningDialog
        kind="original"
        targetLabel={attachment.filename || 'Attachment'}
        open={showWarning}
        onClose={() => setShowWarning(false)}
        onAcknowledge={() => {
          setShowWarning(false)
          onViewOriginal?.(attachment)
        }}
      />
    </div>
  )
}

// =============================================================================
// AiOutputPanel
// =============================================================================

interface AiOutputPanelProps {
  entries: AiOutputEntry[]
  isGenerating: boolean
  theme: 'default' | 'dark' | 'professional'
  onClear: () => void
}

const AiOutputPanel: React.FC<AiOutputPanelProps> = ({
  entries,
  isGenerating,
  theme,
  onClear,
}) => {
  const isProfessional = theme === 'professional'
  const textColor = isProfessional ? '#1f2937' : 'white'
  const mutedColor = isProfessional ? '#6b7280' : 'rgba(255,255,255,0.5)'
  const borderColor = isProfessional ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'
  const cardBg = isProfessional ? '#ffffff' : 'rgba(255,255,255,0.04)'

  const bottomRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to latest entry
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [entries.length])

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* Panel header */}
      <div
        style={{
          padding: '10px 14px',
          borderBottom: `1px solid ${borderColor}`,
          background: cardBg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
          <span style={{ fontSize: '14px' }}>✨</span>
          <span
            style={{ fontSize: '12px', fontWeight: 600, color: textColor }}
          >
            AI Analysis
          </span>
          {entries.length > 0 && (
            <span
              style={{
                fontSize: '10px',
                padding: '1px 6px',
                borderRadius: '8px',
                background: 'rgba(139,92,246,0.15)',
                color: '#a855f7',
                fontWeight: 500,
              }}
            >
              {entries.length}
            </span>
          )}
        </div>
        {entries.length > 0 && (
          <button
            onClick={onClear}
            style={{
              padding: '3px 9px',
              fontSize: '10px',
              fontWeight: 500,
              borderRadius: '5px',
              border: `1px solid ${borderColor}`,
              background: 'transparent',
              color: mutedColor,
              cursor: 'pointer',
            }}
          >
            Clear
          </button>
        )}
      </div>

      {/* Entry list / empty state */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }}>
        {entries.length === 0 && !isGenerating ? (
          /* Empty state */
          <div
            style={{
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              padding: '20px',
            }}
          >
            <span
              style={{
                fontSize: '36px',
                opacity: 0.25,
                marginBottom: '10px',
                display: 'block',
              }}
            >
              ✨
            </span>
            <div
              style={{
                fontSize: '13px',
                fontWeight: 500,
                color: mutedColor,
                marginBottom: '4px',
              }}
            >
              AI analysis will appear here
            </div>
            <div
              style={{
                fontSize: '11px',
                color: mutedColor,
                opacity: 0.7,
                maxWidth: '190px',
                lineHeight: 1.5,
              }}
            >
              Ask a question in the search bar above to analyze this message
            </div>
          </div>
        ) : (
          <>
            {entries.map((entry) => (
              <AiEntryCard
                key={entry.id}
                entry={entry}
                isProfessional={isProfessional}
                textColor={textColor}
                mutedColor={mutedColor}
                borderColor={borderColor}
              />
            ))}
            {/* Generating spinner */}
            {isGenerating && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  background: isProfessional
                    ? 'rgba(139,92,246,0.06)'
                    : 'rgba(139,92,246,0.12)',
                  border: `1px solid ${isProfessional ? 'rgba(139,92,246,0.2)' : 'rgba(139,92,246,0.25)'}`,
                  marginBottom: '8px',
                }}
              >
                <span
                  style={{
                    fontSize: '14px',
                    display: 'inline-block',
                    animation: 'spin 1s linear infinite',
                  }}
                >
                  ⏳
                </span>
                <span style={{ fontSize: '12px', color: mutedColor }}>
                  Generating…
                </span>
              </div>
            )}
            <div ref={bottomRef} />
          </>
        )}
      </div>
    </div>
  )
}

// =============================================================================
// AiEntryCard
// =============================================================================

interface AiEntryCardProps {
  entry: AiOutputEntry
  isProfessional: boolean
  textColor: string
  mutedColor: string
  borderColor: string
}

const AiEntryCard: React.FC<AiEntryCardProps> = ({
  entry,
  isProfessional,
  textColor,
  mutedColor,
  borderColor,
}) => {
  const [expanded, setExpanded] = useState(true)
  const ts = new Date(entry.generatedAt).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <div
      style={{
        marginBottom: '10px',
        borderRadius: '8px',
        border: `1px solid ${borderColor}`,
        background: isProfessional ? 'rgba(0,0,0,0.02)' : 'rgba(255,255,255,0.03)',
        overflow: 'hidden',
      }}
    >
      {/* Card header: query + timestamp */}
      <div
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          cursor: 'pointer',
          borderBottom: expanded
            ? `1px solid ${borderColor}`
            : 'none',
          background: isProfessional
            ? 'rgba(139,92,246,0.04)'
            : 'rgba(139,92,246,0.08)',
        }}
      >
        <div
          style={{
            fontSize: '11px',
            fontWeight: 600,
            color: '#a855f7',
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap' as const,
          }}
        >
          {entry.query}
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            flexShrink: 0,
            marginLeft: '8px',
          }}
        >
          {entry.source && (
            <span
              style={{
                fontSize: '9px',
                fontWeight: 500,
                padding: '1px 5px',
                borderRadius: '3px',
                color: mutedColor,
                background: isProfessional
                  ? 'rgba(0,0,0,0.06)'
                  : 'rgba(255,255,255,0.08)',
              }}
            >
              {entry.source}
            </span>
          )}
          <span style={{ fontSize: '10px', color: mutedColor }}>{ts}</span>
          <span
            style={{
              fontSize: '10px',
              color: mutedColor,
              transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
              transition: 'transform 0.15s ease',
              display: 'inline-block',
            }}
          >
            ▾
          </span>
        </div>
      </div>

      {/* Content */}
      {expanded && (
        <div
          style={{
            padding: '10px 12px',
            fontSize: '12px',
            lineHeight: 1.6,
            wordBreak: 'break-word' as const,
          }}
        >
          <AiEntryContent
            entry={entry}
            textColor={textColor}
            mutedColor={mutedColor}
            borderColor={borderColor}
            isProfessional={isProfessional}
          />
        </div>
      )}
    </div>
  )
}

// =============================================================================
// Empty message selection state
// =============================================================================

const NoMessageSelected: React.FC<{ theme: 'default' | 'dark' | 'professional' }> = ({
  theme,
}) => {
  const isProfessional = theme === 'professional'
  const mutedColor = isProfessional ? '#6b7280' : 'rgba(255,255,255,0.5)'
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 20px',
        textAlign: 'center',
        color: mutedColor,
      }}
    >
      <span style={{ fontSize: '48px', marginBottom: '14px', opacity: 0.3 }}>
        📨
      </span>
      <div
        style={{ fontSize: '14px', fontWeight: 500, marginBottom: '4px' }}
      >
        No message selected
      </div>
      <div style={{ fontSize: '12px', opacity: 0.7 }}>
        Select a message from the list to view its content
      </div>
    </div>
  )
}

// =============================================================================
// BeapMessageDetailPanel — main export
// =============================================================================

export const BeapMessageDetailPanel = React.forwardRef<
  BeapMessageDetailPanelHandle,
  BeapMessageDetailPanelProps
>(({ theme = 'default', onSetSearchContext, onAiQuery, onViewHandshake, onAttachmentSelect, replyComposerConfig }, ref) => {
  const isProfessional = theme === 'professional'

  // Store
  const selectedMessage = useBeapInboxStore((s) => s.getSelectedMessage())
  const markAsRead = useBeapInboxStore((s) => s.markAsRead)

  // View original artefact (download)
  const { viewOriginal } = useViewOriginalArtefact()

  // Reply composer (shared with BeapBulkInbox)
  const [composerState, composerActions] = useReplyComposer(
    selectedMessage,
    replyComposerConfig ?? {},
  )

  // Local UI state
  const [selectedAttachmentId, setSelectedAttachmentId] = useState<string | null>(null)
  const [viewOriginalError, setViewOriginalError] = useState<string | null>(null)

  // Split ratio (0–1, fraction for left panel)
  const [splitRatio, setSplitRatio] = useState(DEFAULT_SPLIT_RATIO)
  const containerRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)

  // AI output hook
  const {
    entries: aiEntries,
    isGenerating,
    appendEntry,
    startGenerating,
    stopGenerating,
    clear: clearAi,
    getSearchContextLabel,
  } = useBeapMessageAi()

  const handleViewOriginal = useCallback(
    async (attachment: BeapAttachment) => {
      if (!selectedMessage) return
      setViewOriginalError(null)
      const err = await viewOriginal(selectedMessage.messageId, attachment)
      if (err) setViewOriginalError(err)
    },
    [selectedMessage, viewOriginal],
  )

  // ── Expose handle to parent ───────────────────────────
  React.useImperativeHandle(ref, () => ({
    appendAiEntry: appendEntry,
    startGenerating,
    stopGenerating,
    clearAi,
    getSearchContextLabel: () => getSearchContextLabel(selectedMessage),
  }))

  // ── Mark as read + update search context on selection ─
  useEffect(() => {
    if (!selectedMessage) {
      onSetSearchContext?.('')
      onAttachmentSelect?.('', null)
      return
    }
    markAsRead(selectedMessage.messageId)
    onSetSearchContext?.(getSearchContextLabel(selectedMessage))
    // Reset attachment selection when message changes
    setSelectedAttachmentId(null)
    onAttachmentSelect?.(selectedMessage.messageId, null)
  }, [
    selectedMessage?.messageId,
    markAsRead,
    onSetSearchContext,
    getSearchContextLabel,
    onAttachmentSelect,
  ])

  // ── Resizable divider (horizontal) ───────────────────
  const handleDividerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      isDragging.current = true
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      const onMove = (ev: MouseEvent) => {
        if (!isDragging.current || !containerRef.current) return
        const rect = containerRef.current.getBoundingClientRect()
        const raw = (ev.clientX - rect.left) / rect.width
        const minRatio = MIN_SPLIT_PX / rect.width
        const maxRatio = 1 - MIN_SPLIT_PX / rect.width
        setSplitRatio(Math.min(maxRatio, Math.max(minRatio, raw)))
      }

      const onUp = () => {
        isDragging.current = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
      }

      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    },
    [],
  )

  // ── Attachment selection (no auto AI; Summarize is explicit) ─────────────
  const handleSelectAttachment = useCallback(
    (id: string | null) => {
      setSelectedAttachmentId(id)
      if (selectedMessage) {
        onAttachmentSelect?.(selectedMessage.messageId, id)
      }
    },
    [selectedMessage, onAttachmentSelect],
  )

  const handleSummarizeAttachment = useCallback(
    (att: BeapAttachment) => {
      if (!selectedMessage) return
      onAiQuery?.(
        `Summarize attachment: ${att.filename}`,
        selectedMessage.messageId,
        att.attachmentId,
      )
    },
    [selectedMessage, onAiQuery],
  )

  // ── Colors ────────────────────────────────────────────
  const borderColor = isProfessional
    ? 'rgba(0,0,0,0.1)'
    : 'rgba(255,255,255,0.1)'

  const leftWidth = useMemo(
    () => `${(splitRatio * 100).toFixed(2)}%`,
    [splitRatio],
  )
  const rightWidth = useMemo(
    () => `${((1 - splitRatio) * 100).toFixed(2)}%`,
    [splitRatio],
  )

  // ── Render ────────────────────────────────────────────
  if (!selectedMessage) {
    return <NoMessageSelected theme={theme} />
  }

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'row',
        overflow: 'hidden',
        height: '100%',
      }}
    >
      {/* Left half — message content */}
      <div
        style={{
          width: leftWidth,
          minWidth: `${MIN_SPLIT_PX}px`,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          borderRight: `1px solid ${borderColor}`,
        }}
      >
        <MessageContentPanel
          message={selectedMessage}
          theme={theme}
          selectedAttachmentId={selectedAttachmentId}
          onSelectAttachment={handleSelectAttachment}
          composerState={composerState}
          composerActions={composerActions}
          onViewHandshake={onViewHandshake}
          onViewOriginal={handleViewOriginal}
          viewOriginalError={viewOriginalError}
          onDismissViewOriginalError={() => setViewOriginalError(null)}
          onSummarizeAttachment={handleSummarizeAttachment}
        />
      </div>

      {/* Drag handle */}
      <ResizeDivider
        isProfessional={isProfessional}
        onMouseDown={handleDividerMouseDown}
      />

      {/* Right half — AI output */}
      <div
        style={{
          width: rightWidth,
          minWidth: `${MIN_SPLIT_PX}px`,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <AiOutputPanel
          entries={aiEntries}
          isGenerating={isGenerating}
          theme={theme}
          onClear={clearAi}
        />
      </div>
    </div>
  )
})

BeapMessageDetailPanel.displayName = 'BeapMessageDetailPanel'

export default BeapMessageDetailPanel
