/**
 * BeapBulkInbox
 *
 * Power-user grid view for rapid batch processing of BEAP messages.
 *
 * Layout
 * ──────
 *   ┌─────────────────────────────────────────────────────────────────┐
 *   │  BatchToolbar (batch size · AI master toggle · nav · actions)   │
 *   ├───────────────────────────────┬─────────────────────────────────┤
 *   │  MessagePair A                │  MessagePair B                   │
 *   │  [msg left] [AI right]        │  [msg left] [AI right]           │
 *   ├───────────────────────────────┼─────────────────────────────────┤
 *   │  MessagePair C                │  MessagePair D                   │
 *   │  ...                          │  ...                             │
 *   └───────────────────────────────┴─────────────────────────────────┘
 *
 * Architecture
 * ────────────
 * Each message-pair cell manages its own AI output state locally (Map keyed
 * by messageId fed from the top-level `pairAiState` ref Map).  The master AI
 * toggle drives `batchAiEnabled`; individual per-pair toggles read/write
 * their entry in `pairAiEnabled`.
 *
 * Pending deletion
 * ────────────────
 * When a message is classified 'irrelevant' and auto-deletion is triggered,
 * the store's `scheduleDeletion` is called with `IRRELEVANT_GRACE_MS`.
 * A per-pair countdown timer shows remaining time.  "Keep" calls
 * `cancelDeletion`; "Delete Now" calls `purgeExpiredDeletions` immediately.
 *
 * Search bar integration
 * ──────────────────────
 * `onSetSearchContext(label)` is called whenever a pair is focused.
 * When the search bar submits, the parent calls `onAiQuery(query, messageId)`.
 * The component exposes `handleExternalAiQuery(query, messageId, content)`
 * through an imperative ref so the parent can push AI responses into the
 * correct pair.
 *
 * @version 1.0.0
 */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  useReducer,
} from 'react'
import type { BeapMessage, UrgencyLevel, TrustLevel } from '../beapInboxTypes'
import type { AiOutputEntry } from '../hooks/useBeapMessageAi'
import { useBulkSend } from '../hooks/useBulkSend'
import { useBulkClassification } from '../hooks/useBulkClassification'
import { useReplyComposer } from '../hooks/useReplyComposer'
import { BeapReplyComposer } from './BeapReplyComposer'
import { AiEntryContent } from './AiEntryContent'
import { useMediaQuery, BULK_GRID_1COL, BULK_GRID_3COL } from '../hooks/useMediaQuery'
import { useBeapInboxStore } from '../useBeapInboxStore'

// =============================================================================
// Constants
// =============================================================================

const IRRELEVANT_GRACE_MS = 30_000 // 30 s default for irrelevant auto-delete

const URGENCY_BORDER: Record<UrgencyLevel, string | null> = {
  urgent:           '#ef4444',
  'action-required':'#f59e0b',
  normal:           null,
  irrelevant:       '#6b7280',
}

const URGENCY_GLOW: Record<UrgencyLevel, string | null> = {
  urgent:           '0 0 0 2px rgba(239,68,68,0.35)',
  'action-required':'0 0 0 2px rgba(245,158,11,0.3)',
  normal:           null,
  irrelevant:       null,
}

const URGENCY_LABEL: Record<UrgencyLevel, { text: string; color: string; bg: string }> = {
  urgent:           { text: 'URGENT',          color: '#ef4444', bg: 'rgba(239,68,68,0.15)'   },
  'action-required':{ text: 'ACTION REQUIRED', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)'  },
  normal:           { text: 'Normal',           color: '#22c55e', bg: 'rgba(34,197,94,0.12)'   },
  irrelevant:       { text: 'Irrelevant',       color: '#6b7280', bg: 'rgba(107,114,128,0.12)' },
}

const TRUST_BADGE: Record<TrustLevel, { label: string; color: string; bg: string }> = {
  enterprise: { label: 'Enterprise', color: '#b45309', bg: 'rgba(245,158,11,0.15)' },
  pro:        { label: 'Pro',        color: '#2563eb', bg: 'rgba(59,130,246,0.15)' },
  standard:   { label: 'Standard',   color: '#16a34a', bg: 'rgba(34,197,94,0.15)'  },
  depackaged: { label: 'Email',      color: '#6b7280', bg: 'rgba(107,114,128,0.12)'},
}

// =============================================================================
// Public API types
// =============================================================================

export interface BeapBulkInboxProps {
  theme?: 'default' | 'dark' | 'professional'
  /** Called when a pair is focused — push to search bar placeholder. */
  onSetSearchContext?: (label: string) => void
  /** Called when a pair requests an AI query from the search bar. */
  onAiQuery?: (query: string, messageId: string, attachmentId?: string) => void
  /** Called when user wants to navigate to the Handshakes tab. */
  onViewHandshake?: (handshakeId: string) => void
  /** Called when user wants to open a message in the full inbox view. */
  onViewInInbox?: (messageId: string) => void
  /** Config for the shared BeapReplyComposer (sender fingerprint, AI provider, etc.). */
  replyComposerConfig?: import('../hooks/useReplyComposer').UseReplyComposerConfig
}

/** Ref handle for parent to push AI responses into a specific pair. */
export interface BeapBulkInboxHandle {
  handleExternalAiQuery: (
    query: string,
    messageId: string,
    content: string,
    type?: AiOutputEntry['type'],
    source?: string,
  ) => void
  startGenerating: (messageId: string) => void
  stopGenerating: (messageId: string) => void
}

// =============================================================================
// Per-pair AI state (held in a Map, managed with useReducer for performance)
// =============================================================================

interface PairAiState {
  entries: AiOutputEntry[]
  isGenerating: boolean
  aiEnabled: boolean
}

type AiAction =
  | { type: 'TOGGLE_AI'; messageId: string }
  | { type: 'SET_ALL_AI'; enabled: boolean; messageIds: string[] }
  | { type: 'APPEND_ENTRY'; messageId: string; entry: AiOutputEntry }
  | { type: 'START_GENERATING'; messageId: string }
  | { type: 'STOP_GENERATING'; messageId: string }
  | { type: 'CLEAR'; messageId: string }
  | { type: 'CLEAR_ALL'; messageIds: string[] }
  | { type: 'ENSURE_IDS'; messageIds: string[] }

function aiReducer(
  state: Map<string, PairAiState>,
  action: AiAction,
): Map<string, PairAiState> {
  const next = new Map(state)

  function ensure(id: string): PairAiState {
    return next.get(id) ?? { entries: [], isGenerating: false, aiEnabled: false }
  }

  switch (action.type) {
    case 'ENSURE_IDS':
      for (const id of action.messageIds) {
        if (!next.has(id)) next.set(id, { entries: [], isGenerating: false, aiEnabled: false })
      }
      return next

    case 'TOGGLE_AI': {
      const cur = ensure(action.messageId)
      next.set(action.messageId, { ...cur, aiEnabled: !cur.aiEnabled })
      return next
    }

    case 'SET_ALL_AI':
      for (const id of action.messageIds) {
        next.set(id, { ...ensure(id), aiEnabled: action.enabled })
      }
      return next

    case 'APPEND_ENTRY': {
      const cur = ensure(action.messageId)
      next.set(action.messageId, { ...cur, entries: [...cur.entries, action.entry] })
      return next
    }

    case 'START_GENERATING':
      next.set(action.messageId, { ...ensure(action.messageId), isGenerating: true })
      return next

    case 'STOP_GENERATING':
      next.set(action.messageId, { ...ensure(action.messageId), isGenerating: false })
      return next

    case 'CLEAR':
      next.set(action.messageId, { ...ensure(action.messageId), entries: [], isGenerating: false })
      return next

    case 'CLEAR_ALL':
      for (const id of action.messageIds) {
        next.set(id, { ...ensure(id), entries: [], isGenerating: false })
      }
      return next

    default:
      return state
  }
}

// =============================================================================
// Helpers
// =============================================================================

let _idCounter = 0
function nextEntryId(): string {
  return `bulk-ai-${Date.now()}-${++_idCounter}`
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60_000)
  const h = Math.floor(diff / 3_600_000)
  const d = Math.floor(diff / 86_400_000)
  if (m < 1) return 'Just now'
  if (m < 60) return `${m}m ago`
  if (h < 24) return `${h}h ago`
  if (d < 7) return `${d}d ago`
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function getPreview(msg: BeapMessage, maxLen = 120): string {
  const t = msg.canonicalContent || msg.messageBody || ''
  return t.length > maxLen ? t.slice(0, maxLen).trimEnd() + '…' : t
}

function formatMs(ms: number): string {
  const s = Math.ceil(ms / 1000)
  if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${s}s`
}

// =============================================================================
// Toggle switch (shared between BatchToolbar and PairCell header)
// =============================================================================

const ToggleSwitch: React.FC<{
  on: boolean
  onChange: (v: boolean) => void
  label?: string
  size?: 'sm' | 'md'
  color?: string
}> = ({ on, onChange, label, size = 'md', color = '#a855f7' }) => {
  const w = size === 'sm' ? 32 : 40
  const h = size === 'sm' ? 18 : 22
  const r = h - 2
  const knob = size === 'sm' ? 12 : 16

  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}
      onClick={() => onChange(!on)}
    >
      <button
        type="button"
        aria-pressed={on}
        style={{
          width: w, height: h, borderRadius: r,
          border: 'none', padding: 0,
          background: on ? color : 'rgba(255,255,255,0.2)',
          cursor: 'pointer',
          position: 'relative',
          transition: 'background 0.2s',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: (h - knob) / 2,
            left: on ? w - knob - 2 : 2,
            width: knob, height: knob,
            borderRadius: '50%',
            background: 'white',
            boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
            transition: 'left 0.18s',
          }}
        />
      </button>
      {label && (
        <span style={{ fontSize: '11px', color: on ? 'white' : 'rgba(255,255,255,0.5)' }}>
          {label}
        </span>
      )}
    </div>
  )
}

// =============================================================================
// BatchToolbar
// =============================================================================

interface BatchToolbarProps {
  batchSize: 12 | 24
  onBatchSizeChange: (s: 12 | 24) => void
  pageIndex: number
  totalPages: number
  totalCount: number
  onPrev: () => void
  onNext: () => void
  batchAiEnabled: boolean
  onBatchAiToggle: (v: boolean) => void
  onArchiveAllIrrelevant: () => void
  onSendAllDrafts: () => void
  onRetryFailed?: () => void
  onClearAllAi: () => void
  isSending?: boolean
  sendProgress?: { total: number; sent: number; failed: number }
  isProfessional: boolean
  textColor: string
  mutedColor: string
  borderColor: string
  bgColor: string
}

const BatchToolbar: React.FC<BatchToolbarProps> = ({
  batchSize,
  onBatchSizeChange,
  pageIndex,
  totalPages,
  totalCount,
  onPrev,
  onNext,
  batchAiEnabled,
  onBatchAiToggle,
  onArchiveAllIrrelevant,
  onSendAllDrafts,
  onRetryFailed,
  onClearAllAi,
  isSending = false,
  sendProgress,
  isProfessional,
  textColor,
  mutedColor,
  borderColor,
  bgColor,
}) => {
  const btnBase: React.CSSProperties = {
    padding: '5px 11px',
    fontSize: '11px',
    fontWeight: 500,
    borderRadius: '6px',
    border: `1px solid ${borderColor}`,
    background: 'transparent',
    color: mutedColor,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    whiteSpace: 'nowrap',
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '10px 14px',
        borderBottom: `1px solid ${borderColor}`,
        background: bgColor,
        flexShrink: 0,
        flexWrap: 'wrap',
      }}
    >
      {/* Title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{ fontSize: '13px', fontWeight: 700, color: textColor }}>
          Bulk Inbox
        </span>
        <span
          style={{
            fontSize: '10px', padding: '1px 6px', borderRadius: '8px',
            background: 'rgba(139,92,246,0.15)', color: '#a855f7', fontWeight: 500,
          }}
        >
          {totalCount}
        </span>
      </div>

      {/* Divider */}
      <div style={{ width: '1px', height: '18px', background: borderColor, flexShrink: 0 }} />

      {/* Batch size selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
        <span style={{ fontSize: '11px', color: mutedColor }}>Batch:</span>
        {([12, 24] as const).map((s) => (
          <button
            key={s}
            onClick={() => onBatchSizeChange(s)}
            style={{
              ...btnBase,
              padding: '4px 9px',
              fontWeight: batchSize === s ? 700 : 500,
              background: batchSize === s
                ? (isProfessional ? 'rgba(139,92,246,0.12)' : 'rgba(139,92,246,0.2)')
                : 'transparent',
              color: batchSize === s ? '#a855f7' : mutedColor,
              borderColor: batchSize === s
                ? (isProfessional ? 'rgba(139,92,246,0.3)' : 'rgba(139,92,246,0.4)')
                : borderColor,
            }}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Divider */}
      <div style={{ width: '1px', height: '18px', background: borderColor, flexShrink: 0 }} />

      {/* Batch AI toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
        <ToggleSwitch
          on={batchAiEnabled}
          onChange={onBatchAiToggle}
          size="sm"
          color="#a855f7"
        />
        <span style={{ fontSize: '11px', color: batchAiEnabled ? '#a855f7' : mutedColor, fontWeight: batchAiEnabled ? 600 : 400 }}>
          Batch AI {batchAiEnabled ? 'ON' : 'OFF'}
        </span>
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Batch navigation */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <button
          onClick={onPrev}
          disabled={pageIndex === 0}
          style={{ ...btnBase, opacity: pageIndex === 0 ? 0.4 : 1, cursor: pageIndex === 0 ? 'default' : 'pointer' }}
        >
          ← Prev
        </button>
        <span style={{ fontSize: '11px', color: mutedColor, whiteSpace: 'nowrap' }}>
          Batch {pageIndex + 1} of {Math.max(totalPages, 1)}
        </span>
        <button
          onClick={onNext}
          disabled={pageIndex >= totalPages - 1}
          style={{ ...btnBase, opacity: pageIndex >= totalPages - 1 ? 0.4 : 1, cursor: pageIndex >= totalPages - 1 ? 'default' : 'pointer' }}
        >
          Next →
        </button>
      </div>

      {/* Divider */}
      <div style={{ width: '1px', height: '18px', background: borderColor, flexShrink: 0 }} />

      {/* Batch actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
        {sendProgress && sendProgress.total > 0 && (
          <span style={{ fontSize: '10px', color: mutedColor }}>
            {isSending ? `Sending ${sendProgress.sent + 1}/${sendProgress.total}…` : `${sendProgress.sent}/${sendProgress.total} sent`}
            {sendProgress.failed > 0 && ` · ${sendProgress.failed} failed`}
          </span>
        )}
        {sendProgress && sendProgress.failed > 0 && onRetryFailed && (
          <button onClick={onRetryFailed} style={{ ...btnBase, color: '#ef4444', borderColor: 'rgba(239,68,68,0.4)' }}>
            Retry Failed
          </button>
        )}
        <button onClick={onArchiveAllIrrelevant} style={{ ...btnBase }} disabled={isSending}>Archive Irrelevant</button>
        <button onClick={onSendAllDrafts} style={{ ...btnBase }} disabled={isSending}>Send Drafts</button>
        <button
          onClick={onClearAllAi}
          style={{ ...btnBase, color: isProfessional ? '#ef4444' : 'rgba(239,68,68,0.8)', borderColor: 'rgba(239,68,68,0.25)' }}
        >
          Clear AI
        </button>
      </div>
    </div>
  )
}

// =============================================================================
// PendingDeleteOverlay — shows countdown + Keep/Delete Now buttons
// =============================================================================

interface PendingDeleteOverlayProps {
  messageId: string
  scheduledAt: number
  gracePeriodMs: number
  isProfessional: boolean
  onKeep: (id: string) => void
  onDeleteNow: (id: string) => void
}

const PendingDeleteOverlay: React.FC<PendingDeleteOverlayProps> = ({
  messageId,
  scheduledAt,
  gracePeriodMs,
  isProfessional,
  onKeep,
  onDeleteNow,
}) => {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, scheduledAt + gracePeriodMs - Date.now())
  )

  useEffect(() => {
    const interval = setInterval(() => {
      setRemaining(Math.max(0, scheduledAt + gracePeriodMs - Date.now()))
    }, 500)
    return () => clearInterval(interval)
  }, [scheduledAt, gracePeriodMs])

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(17,17,17,0.75)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '10px',
        zIndex: 10,
        borderRadius: '9px',
      }}
    >
      <span style={{ fontSize: '22px' }}>🗑️</span>
      <div style={{ fontSize: '12px', fontWeight: 600, color: '#ef4444' }}>Pending Delete</div>
      <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.6)' }}>
        Deleting in {formatMs(remaining)}
      </div>
      <div style={{ display: 'flex', gap: '7px' }}>
        <button
          onClick={() => onKeep(messageId)}
          style={{
            padding: '5px 12px', fontSize: '11px', fontWeight: 600,
            borderRadius: '6px', border: '1px solid rgba(34,197,94,0.4)',
            background: 'rgba(34,197,94,0.15)', color: '#22c55e', cursor: 'pointer',
          }}
        >
          Keep
        </button>
        <button
          onClick={() => onDeleteNow(messageId)}
          style={{
            padding: '5px 12px', fontSize: '11px', fontWeight: 600,
            borderRadius: '6px', border: '1px solid rgba(239,68,68,0.4)',
            background: 'rgba(239,68,68,0.15)', color: '#ef4444', cursor: 'pointer',
          }}
        >
          Delete Now
        </button>
      </div>
    </div>
  )
}

// =============================================================================
// MessagePairCell — the core grid unit: [msg left] [AI right]
// =============================================================================

interface MessagePairCellProps {
  message: BeapMessage
  pairState: PairAiState
  isFocused: boolean
  isProfessional: boolean
  isDark: boolean
  isSendFailed?: boolean
  onFocus: (id: string) => void
  onToggleAi: (id: string) => void
  onClearAi: (id: string) => void
  onKeep: (id: string) => void
  onDeleteNow: (id: string) => void
  onRetrySend?: (messageId: string) => void
  onViewHandshake?: (handshakeId: string) => void
  onViewInInbox?: (messageId: string) => void
  replyComposerConfig?: import('../hooks/useReplyComposer').UseReplyComposerConfig
}

const MessagePairCell: React.FC<MessagePairCellProps> = ({
  message,
  pairState,
  isFocused,
  isProfessional,
  isDark,
  isSendFailed = false,
  onFocus,
  onToggleAi,
  onClearAi,
  onKeep,
  onDeleteNow,
  onRetrySend,
  onViewHandshake,
  onViewInInbox,
  replyComposerConfig,
}) => {
  const [composerState, composerActions] = useReplyComposer(
    message,
    replyComposerConfig ?? {},
  )
  const textColor  = isProfessional ? '#1f2937' : 'white'
  const mutedColor = isProfessional ? '#6b7280' : 'rgba(255,255,255,0.55)'
  const dimColor   = isProfessional ? '#9ca3af' : 'rgba(255,255,255,0.35)'
  const borderColor = isProfessional ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'

  const urgencyBorder = URGENCY_BORDER[message.urgency]
  const urgencyGlow   = URGENCY_GLOW[message.urgency]
  const urgencyLabel  = URGENCY_LABEL[message.urgency]
  const trustBadge    = TRUST_BADGE[message.trustLevel]
  const hasPendingDelete = !!message.deletionScheduled

  const senderLabel = message.senderDisplayName || message.senderEmail
  const preview = getPreview(message, 160)

  // Cell border/glow: focused = violet, urgency = color, default = base
  const cellBorderColor = isFocused
    ? 'rgba(139,92,246,0.5)'
    : urgencyBorder ?? (isProfessional ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)')
  const cellBoxShadow = isFocused
    ? '0 0 0 2px rgba(139,92,246,0.35)'
    : pairState.aiEnabled ? urgencyGlow ?? undefined : undefined
  const cellBg = isFocused
    ? (isProfessional ? 'rgba(139,92,246,0.04)' : 'rgba(139,92,246,0.07)')
    : (isProfessional ? '#ffffff' : 'rgba(255,255,255,0.04)')

  return (
    <div
      onClick={() => onFocus(message.messageId)}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        border: `1px solid ${cellBorderColor}`,
        borderRadius: '10px',
        background: cellBg,
        boxShadow: cellBoxShadow,
        overflow: 'hidden',
        transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
        cursor: 'pointer',
        minHeight: '280px',
      }}
    >
      {/* ─── Cell header ────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 10px',
          borderBottom: `1px solid ${borderColor}`,
          flexShrink: 0,
          background: isProfessional ? 'rgba(0,0,0,0.015)' : 'rgba(255,255,255,0.03)',
        }}
      >
        {/* Sender + badges */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: '12px', lineHeight: 1 }}>
            {message.handshakeId ? '🤝' : '✉️'}
          </span>
          <span
            style={{
              fontSize: '12px', fontWeight: message.isRead ? 500 : 700,
              color: textColor,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
          >
            {senderLabel}
          </span>
          {/* Urgency label (when AI enabled) */}
          {pairState.aiEnabled && (
            <span
              style={{
                fontSize: '9px', fontWeight: 700,
                padding: '2px 5px', borderRadius: '3px',
                color: urgencyLabel.color, background: urgencyLabel.bg,
                textTransform: 'uppercase', letterSpacing: '0.3px',
                flexShrink: 0,
              }}
            >
              {urgencyLabel.text}
            </span>
          )}
        </div>

        {/* Right controls */}
        <div
          style={{ display: 'flex', alignItems: 'center', gap: '7px', flexShrink: 0 }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Send failed badge + Retry */}
          {isSendFailed && onRetrySend && (
            <>
              <span
                style={{
                  fontSize: '9px', fontWeight: 700, padding: '2px 5px', borderRadius: '3px',
                  color: '#ef4444', background: 'rgba(239,68,68,0.15)',
                  textTransform: 'uppercase', letterSpacing: '0.3px',
                }}
              >
                Send failed
              </span>
              <button
                onClick={() => onRetrySend(message.messageId)}
                style={{
                  padding: '2px 6px', fontSize: '10px', fontWeight: 600,
                  borderRadius: '4px', border: '1px solid rgba(239,68,68,0.4)',
                  background: 'rgba(239,68,68,0.12)', color: '#ef4444',
                  cursor: 'pointer',
                }}
              >
                Retry
              </button>
            </>
          )}
          {/* Timestamp */}
          <span style={{ fontSize: '10px', color: dimColor }}>{formatRelative(message.timestamp)}</span>
          {/* Trust badge */}
          <span
            style={{
              fontSize: '9px', fontWeight: 600,
              padding: '1px 5px', borderRadius: '3px',
              color: trustBadge.color, background: trustBadge.bg,
              textTransform: 'uppercase', letterSpacing: '0.3px',
            }}
          >
            {trustBadge.label}
          </span>
          {/* AI toggle */}
          <ToggleSwitch
            on={pairState.aiEnabled}
            onChange={() => onToggleAi(message.messageId)}
            size="sm"
            color="#a855f7"
          />
        </div>
      </div>

      {/* ─── Split: message + AI ────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

        {/* Left: message content */}
        <div
          style={{
            flex: 1,
            borderRight: `1px solid ${borderColor}`,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '10px 10px 6px' }}>
            <div
              style={{
                fontSize: '12px', lineHeight: 1.55, color: textColor,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}
            >
              {preview || (
                <span style={{ color: dimColor, fontStyle: 'italic' }}>
                  Unverified — verify to display content.
                </span>
              )}
            </div>

            {/* Automation tags */}
            {message.automationTags.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '7px' }}>
                {message.automationTags.slice(0, 4).map((tag) => (
                  <span
                    key={tag}
                    style={{
                      fontSize: '9px', padding: '2px 5px', borderRadius: '3px',
                      color: '#a855f7', background: 'rgba(168,85,247,0.12)', fontWeight: 500,
                    }}
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            )}

            {/* Attachments */}
            {message.attachments.length > 0 && (
              <div style={{ marginTop: '8px' }}>
                {message.attachments.slice(0, 3).map((att) => (
                  <div
                    key={att.attachmentId}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '5px',
                      padding: '4px 6px', borderRadius: '5px', marginBottom: '3px',
                      background: isProfessional ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.05)',
                      fontSize: '10px', color: mutedColor,
                    }}
                  >
                    <span>📎</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                      {att.filename}
                    </span>
                  </div>
                ))}
                {message.attachments.length > 3 && (
                  <div style={{ fontSize: '9px', color: dimColor, marginLeft: '6px' }}>
                    +{message.attachments.length - 3} more
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer links */}
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '5px 10px',
              borderTop: `1px solid ${borderColor}`,
              flexShrink: 0,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {onViewInInbox && (
              <button
                onClick={() => onViewInInbox(message.messageId)}
                style={{
                  padding: '2px 7px', fontSize: '9px', fontWeight: 500,
                  borderRadius: '4px', border: `1px solid ${borderColor}`,
                  background: 'transparent', color: dimColor, cursor: 'pointer',
                }}
              >
                Open →
              </button>
            )}
            {message.handshakeId && onViewHandshake && (
              <button
                onClick={() => onViewHandshake(message.handshakeId!)}
                style={{
                  padding: '2px 7px', fontSize: '9px', fontWeight: 500,
                  borderRadius: '4px', border: '1px solid rgba(168,85,247,0.25)',
                  background: 'transparent', color: '#a855f7', cursor: 'pointer',
                }}
              >
                🤝 Handshake →
              </button>
            )}
          </div>
        </div>

        {/* Right: AI output */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            background: isProfessional ? 'rgba(0,0,0,0.01)' : 'rgba(255,255,255,0.015)',
          }}
        >
          {!pairState.aiEnabled ? (
            /* AI disabled placeholder */
            <div
              style={{
                flex: 1, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                textAlign: 'center', padding: '16px',
              }}
            >
              <span style={{ fontSize: '20px', opacity: 0.2, marginBottom: '6px' }}>✨</span>
              <span style={{ fontSize: '10px', color: dimColor }}>
                Enable AI to analyse
              </span>
            </div>
          ) : (
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
              {/* Shared BeapReplyComposer */}
              <div style={{ padding: '8px', flexShrink: 0 }}>
                <BeapReplyComposer
                  state={composerState}
                  actions={composerActions}
                  theme={isProfessional ? 'professional' : 'dark'}
                  showAiDraft={true}
                  showAttachments={false}
                  minRows={2}
                />
              </div>

              {/* AI entries */}
              {pairState.entries.length === 0 && !pairState.isGenerating ? (
                <div
                  style={{
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    padding: '16px', textAlign: 'center', minHeight: '80px',
                  }}
                >
                  <span style={{ fontSize: '18px', opacity: 0.2, marginBottom: '5px' }}>✨</span>
                  <span style={{ fontSize: '10px', color: dimColor }}>
                    AI analysis will appear here
                  </span>
                </div>
              ) : (
                <div style={{ padding: '6px 8px' }}>
                  {pairState.isGenerating && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 8px', marginBottom: '5px', borderRadius: '6px', background: 'rgba(139,92,246,0.1)' }}>
                      <span style={{ fontSize: '12px' }}>⏳</span>
                      <span style={{ fontSize: '10px', color: mutedColor }}>Generating…</span>
                    </div>
                  )}
                  {pairState.entries.map((entry) => (
                    <AiEntryMini
                      key={entry.id}
                      entry={entry}
                      isProfessional={isProfessional}
                      textColor={textColor}
                      mutedColor={mutedColor}
                      borderColor={borderColor}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Clear AI button (when there are entries) */}
          {pairState.entries.length > 0 && (
            <div
              style={{ padding: '4px 8px', borderTop: `1px solid ${borderColor}`, flexShrink: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => onClearAi(message.messageId)}
                style={{
                  padding: '2px 8px', fontSize: '9px', fontWeight: 500,
                  borderRadius: '4px', border: `1px solid ${borderColor}`,
                  background: 'transparent', color: dimColor, cursor: 'pointer',
                }}
              >
                Clear AI
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Pending delete overlay */}
      {hasPendingDelete && (
        <PendingDeleteOverlay
          messageId={message.messageId}
          scheduledAt={message.deletionScheduled!.scheduledAt}
          gracePeriodMs={message.deletionScheduled!.gracePeriodMs}
          isProfessional={isProfessional}
          onKeep={onKeep}
          onDeleteNow={onDeleteNow}
        />
      )}
    </div>
  )
}

// =============================================================================
// AiEntryMini — compact AI output card for grid cells
// =============================================================================

const AiEntryMini: React.FC<{
  entry: AiOutputEntry
  isProfessional: boolean
  textColor: string
  mutedColor: string
  borderColor: string
}> = ({ entry, isProfessional, textColor, mutedColor, borderColor }) => {
  const [expanded, setExpanded] = useState(true)
  return (
    <div
      style={{
        marginBottom: '5px',
        borderRadius: '6px',
        border: `1px solid ${borderColor}`,
        overflow: 'hidden',
        background: isProfessional ? 'rgba(0,0,0,0.02)' : 'rgba(255,255,255,0.03)',
      }}
    >
      <div
        onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v) }}
        style={{
          padding: '5px 8px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'rgba(139,92,246,0.07)',
        }}
      >
        <span style={{ fontSize: '10px', color: '#a855f7', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {entry.query}
        </span>
        <span style={{ fontSize: '9px', color: mutedColor, marginLeft: '6px', flexShrink: 0 }}>
          {new Date(entry.generatedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
          {' '}{expanded ? '▾' : '▸'}
        </span>
      </div>
      {expanded && (
        <div style={{ padding: '6px 8px', fontSize: '11px', lineHeight: 1.5, wordBreak: 'break-word' }}>
          <AiEntryContent
            entry={entry}
            textColor={textColor}
            mutedColor={mutedColor}
            borderColor={borderColor}
            isProfessional={isProfessional}
            compact
          />
        </div>
      )}
    </div>
  )
}

// =============================================================================
// BeapBulkInbox — main export
// =============================================================================

export const BeapBulkInbox = React.forwardRef<BeapBulkInboxHandle, BeapBulkInboxProps>(
  ({ theme = 'default', onSetSearchContext, onAiQuery, onViewHandshake, onViewInInbox, replyComposerConfig }, ref) => {
    const isProfessional = theme === 'professional'
    const isDark = theme !== 'professional'

    // Colors
    const textColor   = isProfessional ? '#1f2937' : 'white'
    const mutedColor  = isProfessional ? '#6b7280' : 'rgba(255,255,255,0.55)'
    const borderColor = isProfessional ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'
    const bgColor     = isProfessional ? 'white' : 'rgba(255,255,255,0.03)'

    // Store
    const getBulkViewPage    = useBeapInboxStore((s) => s.getBulkViewPage)
    const getInboxMessages   = useBeapInboxStore((s) => s.getInboxMessages)
    const archiveMessage     = useBeapInboxStore((s) => s.archiveMessage)
    const scheduleDeletion   = useBeapInboxStore((s) => s.scheduleDeletion)
    const cancelDeletion     = useBeapInboxStore((s) => s.cancelDeletion)
    const purgeExpiredDeletions = useBeapInboxStore((s) => s.purgeExpiredDeletions)
    const batchClassify      = useBeapInboxStore((s) => s.batchClassify)
    const setDraftReply      = useBeapInboxStore((s) => s.setDraftReply)
    const selectMessage      = useBeapInboxStore((s) => s.selectMessage)
    const selectedMessageId  = useBeapInboxStore((s) => s.selectedMessageId)

    // Responsive grid columns: <900px → 1, 900–1600px → 2, >1600px → 3
    const is1Col = useMediaQuery(BULK_GRID_1COL)
    const is3Col = useMediaQuery(BULK_GRID_3COL)
    const gridColumns =
      is1Col ? 'repeat(1, 1fr)' : is3Col ? 'repeat(3, 1fr)' : 'repeat(2, 1fr)'

    // Local state
    const [batchSize, setBatchSize]             = useState<12 | 24>(12)
    const [pageIndex, setPageIndex]             = useState(0)
    const [batchAiEnabled, setBatchAiEnabled]   = useState(false)
    const [focusedMessageId, setFocusedMessageId] = useState<string | null>(null)

    // Per-pair AI state
    const [aiState, dispatchAi] = useReducer(aiReducer, new Map<string, PairAiState>())

    // Current page
    const page = useMemo(
      () => getBulkViewPage(batchSize, pageIndex),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [getBulkViewPage, batchSize, pageIndex, selectedMessageId]
    )
    const { messages, totalPages, totalCount } = page

    // Ensure all visible message IDs have entries in aiState
    useEffect(() => {
      const ids = messages.map((m) => m.messageId)
      dispatchAi({ type: 'ENSURE_IDS', messageIds: ids })
    }, [messages])

    // When batch AI toggled ON, auto-schedule deletion for irrelevant messages
    useEffect(() => {
      if (!batchAiEnabled) return
      for (const msg of messages) {
        if (msg.urgency === 'irrelevant' && !msg.deletionScheduled) {
          scheduleDeletion(msg.messageId, IRRELEVANT_GRACE_MS)
        }
      }
    }, [batchAiEnabled, messages, scheduleDeletion])

    // Purge on interval
    useEffect(() => {
      const id = setInterval(() => purgeExpiredDeletions(), 2000)
      return () => clearInterval(id)
    }, [purgeExpiredDeletions])

    // Bulk classification (must be before handlers that use it)
    const { startClassification, cancelClassification } = useBulkClassification({
      policy: { allowSemanticProcessing: true, allowActuatingProcessing: false },
      irrelevanceGracePeriodMs: IRRELEVANT_GRACE_MS,
    })

    // ── Expose handle to parent ──────────────────────────
    React.useImperativeHandle(ref, () => ({
      handleExternalAiQuery: (query, messageId, content, type = 'text', source) => {
        dispatchAi({
          type: 'APPEND_ENTRY',
          messageId,
          entry: { id: nextEntryId(), type, content, query, generatedAt: Date.now(), source },
        })
        dispatchAi({ type: 'STOP_GENERATING', messageId })
      },
      startGenerating: (messageId) => dispatchAi({ type: 'START_GENERATING', messageId }),
      stopGenerating:  (messageId) => dispatchAi({ type: 'STOP_GENERATING',  messageId }),
    }))

    // ── Handlers ────────────────────────────────────────
    const handleFocus = useCallback(
      (messageId: string) => {
        setFocusedMessageId(messageId)
        selectMessage(messageId)
        const msg = messages.find((m) => m.messageId === messageId)
        if (msg && onSetSearchContext) {
          const sender = msg.senderDisplayName || msg.senderEmail
          const preview = (msg.canonicalContent || msg.messageBody || '').slice(0, 50)
          onSetSearchContext(`Ask about: ${sender} — ${preview}${preview.length >= 50 ? '…' : ''}`)
        }
      },
      [messages, onSetSearchContext, selectMessage],
    )

    const handleToggleAi = useCallback(
      (messageId: string) => {
        const pairState = aiState.get(messageId)
        const wasEnabled = pairState?.aiEnabled ?? false
        dispatchAi({ type: 'TOGGLE_AI', messageId })
        if (!wasEnabled) {
          const msg = messages.find((m) => m.messageId === messageId)
          if (msg) startClassification([msg])
        }
      },
      [messages, aiState, startClassification],
    )

    const handleBatchAiToggle = useCallback(
      (enabled: boolean) => {
        setBatchAiEnabled(enabled)
        dispatchAi({
          type: 'SET_ALL_AI',
          enabled,
          messageIds: messages.map((m) => m.messageId),
        })
        if (enabled) {
          startClassification(messages)
        } else {
          cancelClassification()
        }
      },
      [messages, startClassification, cancelClassification],
    )

    const handleClearAi = useCallback(
      (messageId: string) => {
        dispatchAi({ type: 'CLEAR', messageId })
      },
      [],
    )

    const handleClearAllAi = useCallback(() => {
      dispatchAi({ type: 'CLEAR_ALL', messageIds: messages.map((m) => m.messageId) })
    }, [messages])

    const handleKeep = useCallback(
      (messageId: string) => cancelDeletion(messageId),
      [cancelDeletion],
    )

    const handleDeleteNow = useCallback(
      (messageId: string) => {
        scheduleDeletion(messageId, 0) // zero grace period
        setTimeout(() => purgeExpiredDeletions(), 50)
      },
      [scheduleDeletion, purgeExpiredDeletions],
    )

    const handleArchiveAllIrrelevant = useCallback(() => {
      for (const msg of messages) {
        if (msg.urgency === 'irrelevant') archiveMessage(msg.messageId)
      }
    }, [messages, archiveMessage])

    const getMessageById = useBeapInboxStore((s) => s.getMessageById)
    const { sendAllDrafts, retryFailed, isSending, progress, items } = useBulkSend({
      senderFingerprint: replyComposerConfig?.senderFingerprint,
      senderFingerprintShort: replyComposerConfig?.senderFingerprintShort,
    })
    const failedSendIds = useMemo(
      () => new Set(items.filter((i) => i.status === 'failed').map((i) => i.messageId)),
      [items],
    )

    const handleSendAllDrafts = useCallback(() => {
      const toSend = messages.filter(
        (m) => m.draftReply && (m.draftReply.status === 'draft' || m.draftReply.status === 'ready'),
      )
      if (toSend.length > 0) sendAllDrafts(toSend)
    }, [messages, sendAllDrafts])

    const handleRetryFailed = useCallback(() => {
      retryFailed(getInboxMessages())
    }, [getInboxMessages, retryFailed])

    const handleRetrySingle = useCallback(
      (messageId: string) => {
        const msg = getMessageById(messageId)
        if (msg && msg.draftReply) retryFailed([msg])
      },
      [getMessageById, retryFailed],
    )

    // Sort: urgent → action-required → normal → irrelevant (same order as store, but respect AI classification)
    const sortedMessages = useMemo(() => {
      const ORDER: Record<UrgencyLevel, number> = {
        urgent: 0, 'action-required': 1, normal: 2, irrelevant: 3,
      }
      return [...messages].sort((a, b) => ORDER[a.urgency] - ORDER[b.urgency] || b.timestamp - a.timestamp)
    }, [messages])

    // ── Empty state ──────────────────────────────────────
    if (totalCount === 0) {
      return (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <BatchToolbar
            batchSize={batchSize}
            onBatchSizeChange={setBatchSize}
            pageIndex={pageIndex}
            totalPages={0}
            totalCount={0}
            onPrev={() => {}}
            onNext={() => {}}
            batchAiEnabled={batchAiEnabled}
            onBatchAiToggle={handleBatchAiToggle}
            onArchiveAllIrrelevant={handleArchiveAllIrrelevant}
            onSendAllDrafts={handleSendAllDrafts}
            onRetryFailed={handleRetryFailed}
            onClearAllAi={handleClearAllAi}
            isSending={isSending}
            sendProgress={progress.total > 0 ? progress : undefined}
            isProfessional={isProfessional}
            textColor={textColor}
            mutedColor={mutedColor}
            borderColor={borderColor}
            bgColor={bgColor}
          />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '10px', color: mutedColor }}>
            <span style={{ fontSize: '40px', opacity: 0.3 }}>📬</span>
            <div style={{ fontSize: '14px', fontWeight: 500 }}>No messages to process</div>
            <div style={{ fontSize: '12px', opacity: 0.7 }}>Import BEAP™ packages to start batch processing</div>
          </div>
        </div>
      )
    }

    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Toolbar */}
        <BatchToolbar
          batchSize={batchSize}
          onBatchSizeChange={(s) => { setBatchSize(s); setPageIndex(0) }}
          pageIndex={pageIndex}
          totalPages={totalPages}
          totalCount={totalCount}
          onPrev={() => setPageIndex((i) => Math.max(0, i - 1))}
          onNext={() => setPageIndex((i) => Math.min(totalPages - 1, i + 1))}
          batchAiEnabled={batchAiEnabled}
          onBatchAiToggle={handleBatchAiToggle}
          onArchiveAllIrrelevant={handleArchiveAllIrrelevant}
          onSendAllDrafts={handleSendAllDrafts}
          onRetryFailed={handleRetryFailed}
          onClearAllAi={handleClearAllAi}
          isSending={isSending}
          sendProgress={progress.total > 0 ? progress : undefined}
          isProfessional={isProfessional}
          textColor={textColor}
          mutedColor={mutedColor}
          borderColor={borderColor}
          bgColor={bgColor}
        />

        {/* Grid */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '12px',
            display: 'grid',
            gridTemplateColumns: gridColumns,
            gap: '10px',
            alignContent: 'start',
          }}
        >
          {sortedMessages.map((msg) => (
            <MessagePairCell
              key={msg.messageId}
              message={msg}
              pairState={aiState.get(msg.messageId) ?? { entries: [], isGenerating: false, aiEnabled: false }}
              isFocused={msg.messageId === focusedMessageId}
              isProfessional={isProfessional}
              isDark={isDark}
              isSendFailed={failedSendIds.has(msg.messageId)}
              onFocus={handleFocus}
              onToggleAi={handleToggleAi}
              onClearAi={handleClearAi}
              onKeep={handleKeep}
              onDeleteNow={handleDeleteNow}
              onRetrySend={handleRetrySingle}
              onViewHandshake={onViewHandshake}
              onViewInInbox={onViewInInbox}
              replyComposerConfig={replyComposerConfig}
            />
          ))}
        </div>
      </div>
    )
  }
)

BeapBulkInbox.displayName = 'BeapBulkInbox'

export default BeapBulkInbox
