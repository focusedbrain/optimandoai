/**
 * Art. 50(1)/(5) — Layer B first-interaction disclosure.
 *
 * Renders a full notice + acknowledge button on first visit.
 * After acknowledgement: a compact persistent indicator on every AI surface
 * (not dismissible to null).
 *
 * Acknowledgement is stored in localStorage under AI_DISCLOSURE_ACK_KEY_MAIN
 * ('art50.aiDisclosure.acknowledgedAt'). It is NOT stored in the handshake
 * ledger, email-accounts store, or orchestrator-mode store.
 */

import { useState, useEffect, useCallback } from 'react'
import { AI_DISCLOSURE_ACK_KEY_MAIN } from '@shared/aiProvenance'

function readAck(): string | null {
  try {
    return localStorage.getItem(AI_DISCLOSURE_ACK_KEY_MAIN)
  } catch {
    return null
  }
}

function writeAck(): void {
  try {
    localStorage.setItem(AI_DISCLOSURE_ACK_KEY_MAIN, new Date().toISOString())
  } catch {
    // storage unavailable — degrade gracefully
  }
}

interface AiInteractionDisclosureProps {
  /** Optional extra CSS class on the wrapper. */
  className?: string
  /**
   * 'full': show full disclosure panel + badge after ack (default).
   * 'compact': always render only the compact badge (use when embedding
   *            inside a surface that already has the full panel nearby).
   */
  variant?: 'full' | 'compact'
}

/**
 * First-interaction AI disclosure for electron / renderer surfaces.
 *
 * @example
 * <AiInteractionDisclosure />
 */
export function AiInteractionDisclosure({
  className,
  variant = 'full',
}: AiInteractionDisclosureProps) {
  const [acked, setAcked] = useState<boolean>(() => readAck() !== null)

  useEffect(() => {
    const stored = readAck()
    if (stored !== null && !acked) setAcked(true)
  }, [acked])

  const handleAcknowledge = useCallback(() => {
    writeAck()
    setAcked(true)
  }, [])

  if (variant === 'compact' || acked) {
    return (
      <div
        role="note"
        aria-label="AI system indicator"
        className={className}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '3px 8px',
          borderRadius: 999,
          fontSize: 11,
          fontWeight: 600,
          background: 'var(--bg-elevated, #f8fafc)',
          color: 'var(--text-secondary, #64748b)',
          border: '1px solid var(--border, #e2e8f0)',
          userSelect: 'none',
          lineHeight: 1.4,
        }}
      >
        <span aria-hidden="true" style={{ fontSize: 10 }}>
          ✦
        </span>
        AI system
      </div>
    )
  }

  // Full first-time notice
  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="ai-disclosure-title"
      aria-describedby="ai-disclosure-body"
      className={className}
      style={{
        background: 'var(--bg-elevated, var(--bg-elevated-prof, #f8fafc))',
        color: 'var(--text-primary, var(--text-primary-prof, #0f172a))',
        border: '1px solid var(--border, #e2e8f0)',
        borderRadius: 10,
        padding: '14px 16px',
        marginBottom: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span aria-hidden="true" style={{ fontSize: 16 }}>
          ✦
        </span>
        <strong
          id="ai-disclosure-title"
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: 'var(--text-primary, var(--text-primary-prof, #0f172a))',
          }}
        >
          You are interacting with an AI system
        </strong>
      </div>

      <p
        id="ai-disclosure-body"
        style={{
          margin: 0,
          fontSize: 12,
          lineHeight: 1.55,
          color: 'var(--text-primary, var(--text-primary-prof, #0f172a))',
        }}
      >
        This feature uses artificial intelligence to generate responses and
        suggestions. AI outputs may be inaccurate, incomplete, or biased.
        Always review AI-generated content before relying on it. Outputs are
        labelled with <strong>[AI-generated]</strong> when copied or exported.
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
        <button
          type="button"
          autoFocus
          onClick={handleAcknowledge}
          aria-label="Acknowledge: I understand I am interacting with an AI system"
          style={{
            padding: '6px 14px',
            borderRadius: 6,
            border: 'none',
            background: 'var(--color-accent, #2563eb)',
            color: '#fff',
            fontWeight: 600,
            fontSize: 12,
            cursor: 'pointer',
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              handleAcknowledge()
            }
          }}
        >
          Acknowledge
        </button>
        <span
          style={{
            fontSize: 10,
            color: 'var(--text-secondary, #64748b)',
          }}
        >
          Disclosure required under EU AI Act Art. 50
        </span>
      </div>
    </div>
  )
}
