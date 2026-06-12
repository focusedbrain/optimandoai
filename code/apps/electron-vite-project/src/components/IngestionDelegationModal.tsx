/**
 * UX-1 D4 — IngestionDelegationModal
 *
 * One-time host-side modal shown when a handshake reaches ACTIVE and the
 * topology auto-wire delegates inbound mail to the sandbox. Explains the
 * new split to the user with ≤3 sentences; accurate tier copy
 * (no microVM/hardware claims — purely about the pairing result).
 *
 * Dismissal is persisted per handshakeId (localStorage) via
 * useTopologyDelegationModal so this fires exactly once per pairing event.
 *
 * ui-readability: all surfaces set explicit bg + color.
 */

const MODAL_COPY = {
  title: 'Your sandbox is now connected.',
  body: [
    'Inbound mail is now fetched on your sandbox device — connect a read-only email account there to resume receiving mail.',
    'Sending from this device is unchanged and keeps working.',
  ],
  cta: 'Got it',
} as const

// ── Styles ────────────────────────────────────────────────────────────────────

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.45)',
  zIndex: 1100,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-elevated, var(--bg-elevated-prof, #ffffff))',
  color: 'var(--text-primary, var(--text-primary-prof, #0f172a))',
  borderRadius: 12,
  padding: '24px 28px 20px',
  maxWidth: 440,
  width: '90vw',
  boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
  border: '1px solid var(--border, var(--border-prof, #e2e8f0))',
}

const titleStyle: React.CSSProperties = {
  fontWeight: 700,
  fontSize: 16,
  marginBottom: 12,
  color: 'var(--text-primary, var(--text-primary-prof, #0f172a))',
}

const bodyStyle: React.CSSProperties = {
  fontSize: 13,
  lineHeight: 1.55,
  color: 'var(--text-primary, var(--text-primary-prof, #1e293b))',
  marginBottom: 8,
}

const ctaRowStyle: React.CSSProperties = {
  marginTop: 20,
  display: 'flex',
  justifyContent: 'flex-end',
}

const ctaButtonStyle: React.CSSProperties = {
  padding: '8px 20px',
  fontSize: 13,
  fontWeight: 600,
  background: 'rgba(251,191,36,0.18)',
  color: 'var(--text-primary, var(--text-primary-prof, #0f172a))',
  border: '1px solid rgba(251,191,36,0.5)',
  borderRadius: 8,
  cursor: 'pointer',
}

// ── Component ─────────────────────────────────────────────────────────────────

type Props = {
  /** The handshakeId that triggered this modal (for dismissal key in consumer). */
  handshakeId: string
  onDismiss: () => void
}

export function IngestionDelegationModal({ handshakeId: _handshakeId, onDismiss }: Props) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ingestion-delegation-title"
      data-testid="ingestion-delegation-modal"
      style={overlayStyle}
      onClick={(e) => { if (e.target === e.currentTarget) onDismiss() }}
    >
      <div style={cardStyle}>
        <div id="ingestion-delegation-title" style={titleStyle}>
          {MODAL_COPY.title}
        </div>
        {MODAL_COPY.body.map((line, i) => (
          <p key={i} style={bodyStyle}>
            {line}
          </p>
        ))}
        <div style={ctaRowStyle}>
          <button
            type="button"
            style={ctaButtonStyle}
            onClick={onDismiss}
            data-testid="ingestion-delegation-modal-cta"
          >
            {MODAL_COPY.cta}
          </button>
        </div>
      </div>
    </div>
  )
}
