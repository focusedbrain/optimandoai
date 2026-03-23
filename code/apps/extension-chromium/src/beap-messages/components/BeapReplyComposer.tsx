/**
 * BeapReplyComposer
 *
 * Shared reply composition component used in both the single-message inbox
 * detail view and the bulk inbox grid.
 *
 * Layout
 * ──────
 *   ┌────────────────────────────────────────────────────────┐
 *   │  [Mode badge]  Replying via BEAP™ / Replying via Email │
 *   ├────────────────────────────────────────────────────────┤
 *   │  <textarea>  (plain text for BEAP, email-style for Email) │
 *   ├────────────────────────────────────────────────────────┤
 *   │  Attachments row (chips + add button)                  │
 *   ├────────────────────────────────────────────────────────┤
 *   │  [Draft with AI]  [Save Draft]  [Send ▶]              │
 *   └────────────────────────────────────────────────────────┘
 *
 * The component is purely presentational — it delegates all state and logic
 * to `useReplyComposer`, passed in as `state` + `actions` props.
 * This keeps the component reusable without any internal hook coupling.
 *
 * @version 1.0.0
 */

import React, { useRef, useCallback } from 'react'
import type { ReplyComposerState, ReplyComposerActions, ReplyAttachment } from '../hooks/useReplyComposer'
import { EMAIL_SIGNATURE } from '../hooks/useReplyComposer'

// =============================================================================
// Public API
// =============================================================================

export interface BeapReplyComposerProps {
  /** All composer state from useReplyComposer. */
  state: ReplyComposerState
  /** All composer actions from useReplyComposer. */
  actions: ReplyComposerActions

  theme?: 'default' | 'dark' | 'professional'

  /**
   * If false, the "Draft with AI" button is hidden.
   * Default: true.
   */
  showAiDraft?: boolean

  /**
   * If false, the attachment picker is hidden.
   * Default: true.
   */
  showAttachments?: boolean

  /**
   * Min rows for the textarea. Default: 3.
   */
  minRows?: number

  /**
   * Optional class or style overrides for the container.
   */
  style?: React.CSSProperties
}

// =============================================================================
// Sub-components
// =============================================================================

const BEAP_GRADIENT  = 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)'
const EMAIL_GRADIENT = 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)'
const AI_GRADIENT    = 'linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)'

/** Pill badge indicating the current reply mode. */
const ModeBadge: React.FC<{ mode: 'beap' | 'email'; isProfessional: boolean }> = ({
  mode, isProfessional,
}) => {
  const isBeap = mode === 'beap'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          padding: '3px 9px',
          borderRadius: '20px',
          fontSize: '10px',
          fontWeight: 700,
          letterSpacing: '0.3px',
          textTransform: 'uppercase',
          background: isBeap
            ? 'rgba(34,197,94,0.15)'
            : 'rgba(59,130,246,0.15)',
          color: isBeap ? '#16a34a' : '#2563eb',
          border: `1px solid ${isBeap ? 'rgba(34,197,94,0.3)' : 'rgba(59,130,246,0.3)'}`,
        }}
      >
        <span>{isBeap ? '🤝' : '✉️'}</span>
        {isBeap ? 'BEAP™ Reply' : 'Email Reply'}
      </span>
      <span
        style={{
          fontSize: '10px',
          color: isProfessional ? '#9ca3af' : 'rgba(255,255,255,0.35)',
        }}
      >
        {isBeap
          ? 'Reply is packaged as a BEAP™ capsule'
          : 'Reply sent as email with WR Desk signature'}
      </span>
    </div>
  )
}

/** Single attachment chip with remove button. */
const AttachmentChip: React.FC<{
  attachment: ReplyAttachment
  onRemove: (id: string) => void
  borderColor: string
  mutedColor: string
  dimColor: string
}> = ({ attachment, onRemove, borderColor, mutedColor, dimColor }) => {
  const kb = (attachment.sizeBytes / 1024).toFixed(1)
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '3px 8px',
        borderRadius: '5px',
        border: `1px solid ${borderColor}`,
        background: 'rgba(255,255,255,0.04)',
        fontSize: '10px',
        color: mutedColor,
        maxWidth: '160px',
      }}
    >
      <span>📎</span>
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
        }}
      >
        {attachment.name}
      </span>
      <span style={{ color: dimColor, flexShrink: 0 }}>{kb}k</span>
      <button
        onClick={() => onRemove(attachment.id)}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '0 2px',
          fontSize: '11px',
          color: dimColor,
          lineHeight: 1,
          flexShrink: 0,
        }}
        aria-label={`Remove ${attachment.name}`}
      >
        ×
      </button>
    </div>
  )
}

/** Email signature preview shown below the textarea in email mode. */
const SignaturePreview: React.FC<{ mutedColor: string; dimColor: string; borderColor: string }> = ({
  mutedColor, dimColor, borderColor,
}) => (
  <div
    style={{
      padding: '6px 10px',
      borderTop: `1px dashed ${borderColor}`,
      background: 'rgba(255,255,255,0.015)',
    }}
  >
    <div style={{ fontSize: '9px', color: dimColor, marginBottom: '2px', textTransform: 'uppercase', letterSpacing: '0.3px' }}>
      Auto-appended signature
    </div>
    <div style={{ fontSize: '10px', color: mutedColor, whiteSpace: 'pre-line', lineHeight: 1.5 }}>
      {EMAIL_SIGNATURE.trim()}
    </div>
  </div>
)

// =============================================================================
// Main component
// =============================================================================

export const BeapReplyComposer: React.FC<BeapReplyComposerProps> = ({
  state,
  actions,
  theme = 'default',
  showAiDraft = true,
  showAttachments = true,
  minRows = 3,
  style,
}) => {
  const isProfessional = theme === 'professional'

  const textColor   = isProfessional ? '#1f2937' : 'white'
  const mutedColor  = isProfessional ? '#6b7280' : 'rgba(255,255,255,0.55)'
  const dimColor    = isProfessional ? '#9ca3af' : 'rgba(255,255,255,0.35)'
  const borderColor = isProfessional ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'
  const inputBg     = isProfessional ? 'white' : 'rgba(255,255,255,0.07)'
  const inputBorder = isProfessional ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.12)'
  const containerBg = isProfessional ? '#ffffff' : 'rgba(255,255,255,0.02)'
  const isBeap      = state.mode === 'beap'

  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (!files) return
      for (const f of Array.from(files)) {
        actions.addAttachment(f)
      }
      // Reset input so the same file can be picked again
      e.target.value = ''
    },
    [actions],
  )

  const canSend = !!state.draftText.trim() && !state.isSending && !state.isGeneratingDraft

  const sendBtnBg = canSend
    ? (isBeap ? BEAP_GRADIENT : EMAIL_GRADIENT)
    : (isProfessional ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.08)')

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '9px',
        border: `1px solid ${borderColor}`,
        background: containerBg,
        overflow: 'hidden',
        ...style,
      }}
    >
      {/* ── Header: mode badge ─────────────────────────────── */}
      <div
        style={{
          padding: '9px 12px',
          borderBottom: `1px solid ${borderColor}`,
          background: isProfessional ? 'rgba(0,0,0,0.015)' : 'rgba(255,255,255,0.025)',
        }}
      >
        <ModeBadge mode={state.mode} isProfessional={isProfessional} />
      </div>

      {/* ── Textarea ───────────────────────────────────────── */}
      <div style={{ position: 'relative' }}>
        <textarea
          value={state.draftText}
          onChange={(e) => actions.setDraftText(e.target.value)}
          rows={minRows}
          placeholder={
            state.isGeneratingDraft
              ? 'AI is drafting your reply…'
              : isBeap
                ? 'Write a BEAP™ reply… (plain text, capsule-packaged on send)'
                : 'Write your reply… (WR Desk signature appended automatically)'
          }
          disabled={state.isSending || state.isGeneratingDraft}
          style={{
            width: '100%',
            resize: 'vertical',
            padding: '10px 12px',
            fontSize: '12px',
            lineHeight: 1.6,
            border: 'none',
            background: inputBg,
            color: textColor,
            outline: 'none',
            fontFamily: 'inherit',
            boxSizing: 'border-box',
            opacity: state.isSending || state.isGeneratingDraft ? 0.6 : 1,
          }}
        />
        {state.isGeneratingDraft && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: isProfessional ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.4)',
              backdropFilter: 'blur(2px)',
              gap: '8px',
              fontSize: '12px',
              color: '#a855f7',
              fontWeight: 600,
            }}
          >
            <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span>
            Drafting with AI…
          </div>
        )}
      </div>

      {/* ── Email signature preview (email mode only) ─────── */}
      {!isBeap && (
        <SignaturePreview
          mutedColor={mutedColor}
          dimColor={dimColor}
          borderColor={borderColor}
        />
      )}

      {/* ── Attachments row ───────────────────────────────── */}
      {showAttachments && (
        <div
          style={{
            padding: '6px 10px',
            borderTop: `1px solid ${borderColor}`,
            display: 'flex',
            flexWrap: 'wrap',
            gap: '5px',
            alignItems: 'center',
            minHeight: '32px',
          }}
        >
          {state.attachments.map((att) => (
            <AttachmentChip
              key={att.id}
              attachment={att}
              onRemove={actions.removeAttachment}
              borderColor={borderColor}
              mutedColor={mutedColor}
              dimColor={dimColor}
            />
          ))}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={state.isSending}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '3px',
              padding: '3px 8px',
              borderRadius: '5px',
              border: `1px dashed ${borderColor}`,
              background: 'transparent',
              color: dimColor,
              fontSize: '10px',
              cursor: state.isSending ? 'default' : 'pointer',
              opacity: state.isSending ? 0.5 : 1,
            }}
          >
            <span>+</span>
            <span>Attach</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
        </div>
      )}

      {/* ── Error banner (E2E.7: Retry + clear) ───────────────────── */}
      {state.error && (
        <div
          style={{
            padding: '7px 12px',
            background: 'rgba(239,68,68,0.1)',
            borderTop: `1px solid rgba(239,68,68,0.25)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
          }}
        >
          <span style={{ fontSize: '11px', color: '#ef4444', flex: 1 }}>
            ⚠️ {/^(TypeError|ReferenceError|SyntaxError|undefined|null is not)/i.test(state.error)
              ? 'Something went wrong. Please try again.'
              : state.error}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              onClick={() => { actions.clearError(); actions.sendReply() }}
              disabled={state.isSending}
              style={{
                background: 'rgba(239,68,68,0.15)',
                border: '1px solid rgba(239,68,68,0.4)',
                cursor: state.isSending ? 'not-allowed' : 'pointer',
                fontSize: '11px',
                color: '#ef4444',
                padding: '3px 8px',
                borderRadius: '4px',
                fontWeight: 500,
              }}
            >
              {state.isSending ? 'Retrying…' : 'Retry'}
            </button>
            <button
              onClick={actions.clearError}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: '12px',
                color: '#ef4444',
                padding: '0 2px',
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* ── Send result banner ─────────────────────────────── */}
      {state.sendResult && (
        <div
          style={{
            padding: '7px 12px',
            background: 'rgba(34,197,94,0.1)',
            borderTop: `1px solid rgba(34,197,94,0.25)`,
            fontSize: '11px',
            color: '#16a34a',
            fontWeight: 500,
          }}
        >
          ✓ {isBeap ? 'BEAP™ capsule sent' : 'Email sent'} ·{' '}
          {new Date(state.sendResult.sentAt).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </div>
      )}

      {/* ── Action bar ────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '8px 10px',
          borderTop: `1px solid ${borderColor}`,
          background: isProfessional ? 'rgba(0,0,0,0.015)' : 'rgba(255,255,255,0.02)',
          flexWrap: 'wrap',
        }}
      >
        {/* Draft with AI */}
        {showAiDraft && (
          <button
            onClick={actions.generateAiDraft}
            disabled={state.isSending || state.isGeneratingDraft}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '6px 11px',
              borderRadius: '6px',
              border: '1px solid rgba(168,85,247,0.3)',
              background: state.isGeneratingDraft ? AI_GRADIENT : 'rgba(168,85,247,0.1)',
              color: state.isGeneratingDraft ? 'white' : '#a855f7',
              fontSize: '11px',
              fontWeight: 600,
              cursor: state.isSending || state.isGeneratingDraft ? 'default' : 'pointer',
              opacity: state.isSending ? 0.5 : 1,
              transition: 'all 0.15s ease',
            }}
          >
            <span>✨</span>
            {state.isGeneratingDraft ? 'Drafting…' : 'Draft with AI'}
          </button>
        )}

        {/* Save Draft */}
        <button
          onClick={actions.saveDraft}
          disabled={state.isSending || !state.isDirty || !state.draftText.trim()}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            padding: '6px 11px',
            borderRadius: '6px',
            border: `1px solid ${borderColor}`,
            background: 'transparent',
            color: state.isDirty && state.draftText.trim() ? mutedColor : dimColor,
            fontSize: '11px',
            fontWeight: 500,
            cursor:
              state.isSending || !state.isDirty || !state.draftText.trim()
                ? 'default'
                : 'pointer',
            opacity: !state.isDirty || !state.draftText.trim() ? 0.45 : 1,
            transition: 'all 0.15s ease',
          }}
        >
          <span>💾</span>
          Save Draft
        </button>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Character count (email mode only) */}
        {!isBeap && state.draftText.length > 0 && (
          <span style={{ fontSize: '10px', color: dimColor }}>
            {state.draftText.length} chars
          </span>
        )}

        {/* Send button */}
        <button
          onClick={actions.sendReply}
          disabled={!canSend}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            padding: '7px 16px',
            borderRadius: '7px',
            border: 'none',
            background: sendBtnBg,
            color: canSend ? 'white' : (isProfessional ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.3)'),
            fontSize: '12px',
            fontWeight: 700,
            cursor: canSend ? 'pointer' : 'default',
            opacity: canSend ? 1 : 0.55,
            transition: 'all 0.15s ease',
            boxShadow: canSend
              ? (isBeap
                  ? '0 2px 8px rgba(34,197,94,0.25)'
                  : '0 2px 8px rgba(59,130,246,0.25)')
              : 'none',
          }}
        >
          {state.isSending ? (
            <>
              <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span>
              Sending…
            </>
          ) : isBeap ? (
            <>⚡ Send BEAP™</>
          ) : (
            <>📧 Send Email</>
          )}
        </button>
      </div>

      {/* Spinner keyframes (injected once via a style tag) */}
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}

export default BeapReplyComposer
