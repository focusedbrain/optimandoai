/**
 * SendHandshakeDelivery
 *
 * Inline panel for choosing how to deliver a BEAP™ Handshake to a recipient.
 *
 * Delivery modes:
 *  - "Email via API"        → Send directly using a connected mailbox (API send).
 *  - "Email as attachment"  → Download .beap capsule; recipient copies the email template.
 *
 * No backend wiring — handlers are stubbed, state is local.
 */

import React, { useState } from 'react'

// =============================================================================
// Types
// =============================================================================

type DeliveryMode = 'api' | 'attachment'

type Theme = 'standard' | 'pro' | 'dark'

export interface SendHandshakeDeliveryProps {
  /** Prefilled subject line */
  defaultSubject?: string
  /** Theme to match the host panel */
  theme?: Theme
  /** Called when the user clicks Cancel / Back */
  onBack?: () => void
}

// =============================================================================
// Helpers
// =============================================================================

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function useThemeTokens(theme: Theme) {
  const isStandard = theme === 'standard'
  const isDark = theme === 'dark'

  return {
    isStandard,
    text: isStandard ? '#0f172a' : '#f1f5f9',
    muted: isStandard ? '#6b7280' : 'rgba(255,255,255,0.55)',
    border: isStandard ? 'rgba(147,51,234,0.14)' : 'rgba(255,255,255,0.12)',
    inputBg: isStandard ? '#ffffff' : isDark ? '#1e293b' : 'rgba(255,255,255,0.08)',
    inputBorder: isStandard ? 'rgba(147,51,234,0.18)' : 'rgba(255,255,255,0.18)',
    sectionBg: isStandard ? '#f8f9fb' : 'rgba(255,255,255,0.04)',
    accentPrimary: '#8b5cf6',
    accentPrimaryLight: isStandard ? 'rgba(139,92,246,0.08)' : 'rgba(139,92,246,0.18)',
    accentPrimaryBorder: isStandard ? 'rgba(139,92,246,0.28)' : 'rgba(139,92,246,0.38)',
    dangerBg: isStandard ? 'rgba(245,158,11,0.08)' : 'rgba(245,158,11,0.15)',
    dangerBorder: isStandard ? 'rgba(245,158,11,0.30)' : 'rgba(245,158,11,0.35)',
    dangerText: isStandard ? '#92400e' : '#fbbf24',
    errorBg: 'rgba(239,68,68,0.10)',
    errorBorder: 'rgba(239,68,68,0.30)',
    errorText: '#ef4444',
    successBg: 'rgba(34,197,94,0.10)',
    successBorder: 'rgba(34,197,94,0.30)',
    successText: '#22c55e',
    noteBg: isStandard ? 'rgba(59,130,246,0.06)' : 'rgba(59,130,246,0.14)',
    noteBorder: isStandard ? 'rgba(59,130,246,0.20)' : 'rgba(59,130,246,0.25)',
    noteText: isStandard ? '#1e40af' : '#93c5fd',
  }
}

// =============================================================================
// Sub-component: Delivery Mode Selector
// =============================================================================

interface DeliveryOptionProps {
  mode: DeliveryMode
  selected: boolean
  label: string
  description: string
  onClick: () => void
  t: ReturnType<typeof useThemeTokens>
}

const DeliveryOption: React.FC<DeliveryOptionProps> = ({
  mode: _mode,
  selected,
  label,
  description,
  onClick,
  t,
}) => {
  const [hovered, setHovered] = useState(false)

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: '4px',
        padding: '11px 13px',
        background: selected
          ? t.accentPrimaryLight
          : hovered
            ? t.isStandard
              ? 'rgba(0,0,0,0.02)'
              : 'rgba(255,255,255,0.05)'
            : 'transparent',
        border: `1.5px solid ${selected ? t.accentPrimary : t.border}`,
        borderRadius: '9px',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'all 0.15s ease',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '7px',
        }}
      >
        {/* Radio indicator */}
        <span
          style={{
            width: '14px',
            height: '14px',
            borderRadius: '50%',
            border: `2px solid ${selected ? t.accentPrimary : t.muted}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            transition: 'border-color 0.12s',
          }}
        >
          {selected && (
            <span
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: t.accentPrimary,
              }}
            />
          )}
        </span>
        <span
          style={{
            fontSize: '12px',
            fontWeight: 600,
            color: selected ? (t.isStandard ? '#7c3aed' : '#c4b5fd') : t.text,
            transition: 'color 0.12s',
          }}
        >
          {label}
        </span>
      </div>
      <span
        style={{
          fontSize: '11px',
          color: t.muted,
          lineHeight: 1.45,
          paddingLeft: '21px',
        }}
      >
        {description}
      </span>
    </button>
  )
}

// =============================================================================
// Main Component
// =============================================================================

const DEFAULT_SUBJECT = 'BEAP Handshake – Secure communication invitation'

export const SendHandshakeDelivery: React.FC<SendHandshakeDeliveryProps> = ({
  defaultSubject = DEFAULT_SUBJECT,
  theme = 'dark',
  onBack,
}) => {
  const t = useThemeTokens(theme)

  // Delivery mode
  const [mode, setMode] = useState<DeliveryMode>('attachment')

  // Shared fields
  const [recipientEmail, setRecipientEmail] = useState('')
  const [subject, setSubject] = useState(defaultSubject)

  // API-only fields
  const [message, setMessage] = useState('')

  // UI state
  const [touched, setTouched] = useState(false)
  const [sending, setSending] = useState(false)
  const [copySuccess, setCopySuccess] = useState(false)
  const [actionDone, setActionDone] = useState<'sent' | 'downloaded' | null>(null)

  // Validation
  const emailError =
    touched && (!recipientEmail.trim() || !EMAIL_PATTERN.test(recipientEmail.trim()))
      ? !recipientEmail.trim()
        ? 'Recipient email is required.'
        : 'Please enter a valid email address.'
      : null

  const isValid = !!recipientEmail.trim() && EMAIL_PATTERN.test(recipientEmail.trim())

  // -------------------------------------------------------------------------
  // Stub handlers
  // -------------------------------------------------------------------------

  const handleSendViaApi = async () => {
    setTouched(true)
    if (!isValid) return
    setSending(true)
    // Stub: simulate API call
    await new Promise((r) => setTimeout(r, 900))
    setSending(false)
    setActionDone('sent')
  }

  const handleDownloadCapsule = async () => {
    setTouched(true)
    if (!isValid) return
    setSending(true)
    // Stub: simulate capsule build + download trigger
    await new Promise((r) => setTimeout(r, 700))
    setSending(false)
    setActionDone('downloaded')
  }

  const handleCopyEmailTemplate = async () => {
    const template = [
      `To: ${recipientEmail || '<recipient>'}`,
      `Subject: ${subject}`,
      '',
      'Hi,',
      '',
      "I'd like to establish a secure BEAP™ communication channel with you.",
      'Please find the handshake capsule attached (.beap file).',
      '',
      'To accept, open it in your BEAP-compatible client.',
      '',
      '— Sent via BEAP Secure Handshake',
    ].join('\n')

    try {
      await navigator.clipboard.writeText(template)
      setCopySuccess(true)
      setTimeout(() => setCopySuccess(false), 2000)
    } catch {
      // clipboard not available in this context — silently ignore
    }
  }

  // -------------------------------------------------------------------------
  // Shared style helpers
  // -------------------------------------------------------------------------

  const labelStyle: React.CSSProperties = {
    fontSize: '11px',
    fontWeight: 600,
    marginBottom: '5px',
    display: 'block',
    color: t.muted,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  }

  const inputStyle = (hasError?: boolean): React.CSSProperties => ({
    width: '100%',
    padding: '9px 12px',
    background: t.inputBg,
    border: `1px solid ${hasError ? t.errorText : t.inputBorder}`,
    borderRadius: '8px',
    color: t.text,
    fontSize: '13px',
    outline: 'none',
    boxSizing: 'border-box',
    fontFamily: 'inherit',
    transition: 'border-color 0.12s',
  })

  // -------------------------------------------------------------------------
  // Success state
  // -------------------------------------------------------------------------

  if (actionDone) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '44px 24px',
          textAlign: 'center',
          gap: '14px',
        }}
      >
        <span style={{ fontSize: '48px' }}>{actionDone === 'sent' ? '✅' : '📥'}</span>
        <div style={{ fontSize: '16px', fontWeight: 700, color: t.text }}>
          {actionDone === 'sent' ? 'Handshake sent!' : 'Capsule downloaded!'}
        </div>
        <div style={{ fontSize: '12px', color: t.muted, lineHeight: 1.5, maxWidth: '280px' }}>
          {actionDone === 'sent'
            ? `Handshake email delivered to ${recipientEmail}. It will be active once they accept.`
            : `Attach the .beap file to an email addressed to ${recipientEmail} and send it manually.`}
        </div>
        <button
          onClick={() => {
            setActionDone(null)
            setTouched(false)
            setRecipientEmail('')
            setSubject(defaultSubject)
            setMessage('')
          }}
          style={{
            marginTop: '8px',
            padding: '9px 20px',
            background: t.accentPrimaryLight,
            border: `1px solid ${t.accentPrimaryBorder}`,
            borderRadius: '8px',
            color: t.isStandard ? '#7c3aed' : '#c4b5fd',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Send another
        </button>
        {onBack && (
          <button
            onClick={onBack}
            style={{
              padding: '7px 16px',
              background: 'transparent',
              border: `1px solid ${t.border}`,
              borderRadius: '8px',
              color: t.muted,
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            ← Back
          </button>
        )}
      </div>
    )
  }

  // -------------------------------------------------------------------------
  // Main render
  // -------------------------------------------------------------------------

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* ---- Section title ---- */}
      <div
        style={{
          padding: '12px 14px',
          borderBottom: `1px solid ${t.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
          <span style={{ fontSize: '17px' }}>📬</span>
          <span style={{ fontSize: '13px', fontWeight: 700, color: t.text }}>
            Handshake delivery
          </span>
        </div>
        {onBack && (
          <button
            onClick={onBack}
            style={{
              padding: '4px 10px',
              background: 'transparent',
              border: `1px solid ${t.border}`,
              borderRadius: '6px',
              color: t.muted,
              fontSize: '11px',
              cursor: 'pointer',
            }}
          >
            ← Back
          </button>
        )}
      </div>

      {/* ---- Body ---- */}
      <div
        style={{
          padding: '14px',
          display: 'flex',
          flexDirection: 'column',
          gap: '13px',
        }}
      >
        {/* ---- Delivery mode selector ---- */}
        <div>
          <label style={labelStyle}>Delivery method</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <DeliveryOption
              mode="api"
              selected={mode === 'api'}
              label="Email via API"
              description="Send directly using your connected mailbox."
              onClick={() => setMode('api')}
              t={t}
            />
            <DeliveryOption
              mode="attachment"
              selected={mode === 'attachment'}
              label="Email as attachment"
              description="Download the BEAP capsule and attach it to an email yourself."
              onClick={() => setMode('attachment')}
              t={t}
            />
          </div>
        </div>

        {/* ---- Attachment-mode warning ---- */}
        {mode === 'attachment' && (
          <div
            style={{
              padding: '10px 13px',
              background: t.dangerBg,
              border: `1px solid ${t.dangerBorder}`,
              borderRadius: '8px',
              fontSize: '11px',
              color: t.dangerText,
              lineHeight: 1.5,
              display: 'flex',
              gap: '8px',
              alignItems: 'flex-start',
            }}
          >
            <span style={{ flexShrink: 0, fontSize: '13px' }}>⚠️</span>
            <span>
              <strong>Recommendation:</strong> send from the same email address that owns the BEAP
              account to avoid confusion for recipients.
            </span>
          </div>
        )}

        {/* ---- Recipient email ---- */}
        <div>
          <label style={labelStyle}>Recipient email *</label>
          <input
            type="email"
            value={recipientEmail}
            onChange={(e) => {
              setRecipientEmail(e.target.value)
              if (touched) setTouched(true)
            }}
            onBlur={() => setTouched(true)}
            placeholder="recipient@example.com"
            disabled={sending}
            style={inputStyle(!!emailError)}
          />
          {emailError && (
            <div style={{ marginTop: '5px', fontSize: '11px', color: t.errorText }}>
              {emailError}
            </div>
          )}
        </div>

        {/* ---- Subject ---- */}
        <div>
          <label style={labelStyle}>Subject</label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            disabled={sending}
            style={inputStyle()}
          />
        </div>

        {/* ---- Message (API mode only) ---- */}
        {mode === 'api' && (
          <div>
            <label style={labelStyle}>Message (optional)</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Add a personal note to accompany the handshake…"
              disabled={sending}
              rows={3}
              style={{
                ...inputStyle(),
                resize: 'vertical',
                lineHeight: 1.5,
                minHeight: '76px',
              }}
            />
          </div>
        )}

        {/* ---- API sender note ---- */}
        {mode === 'api' && (
          <div
            style={{
              padding: '9px 12px',
              background: t.noteBg,
              border: `1px solid ${t.noteBorder}`,
              borderRadius: '8px',
              fontSize: '11px',
              color: t.noteText,
              lineHeight: 1.45,
            }}
          >
            ℹ️ Sender must match your verified account email (or an approved alias).
          </div>
        )}

        {/* ---- Actions ---- */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            paddingTop: '2px',
          }}
        >
          {mode === 'api' ? (
            <button
              onClick={handleSendViaApi}
              disabled={sending}
              style={{
                width: '100%',
                padding: '10px 16px',
                background: sending
                  ? 'rgba(139,92,246,0.5)'
                  : 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
                border: 'none',
                borderRadius: '9px',
                color: 'white',
                fontSize: '13px',
                fontWeight: 600,
                cursor: sending ? 'wait' : 'pointer',
                opacity: sending ? 0.75 : 1,
                transition: 'opacity 0.15s',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '7px',
              }}
            >
              {sending ? '⏳ Sending…' : '📧 Send via API'}
            </button>
          ) : (
            <>
              <button
                onClick={handleDownloadCapsule}
                disabled={sending}
                style={{
                  width: '100%',
                  padding: '10px 16px',
                  background: sending
                    ? 'rgba(139,92,246,0.5)'
                    : 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
                  border: 'none',
                  borderRadius: '9px',
                  color: 'white',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: sending ? 'wait' : 'pointer',
                  opacity: sending ? 0.75 : 1,
                  transition: 'opacity 0.15s',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '7px',
                }}
              >
                {sending ? '⏳ Building…' : '💾 Download capsule (.beap)'}
              </button>

              <button
                onClick={handleCopyEmailTemplate}
                disabled={sending}
                style={{
                  width: '100%',
                  padding: '9px 16px',
                  background: 'transparent',
                  border: `1.5px solid ${t.inputBorder}`,
                  borderRadius: '9px',
                  color: t.isStandard ? '#7c3aed' : '#c4b5fd',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: sending ? 'not-allowed' : 'pointer',
                  opacity: sending ? 0.6 : 1,
                  transition: 'opacity 0.15s',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '7px',
                }}
              >
                {copySuccess ? '✓ Copied!' : '📋 Copy email template'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default SendHandshakeDelivery
