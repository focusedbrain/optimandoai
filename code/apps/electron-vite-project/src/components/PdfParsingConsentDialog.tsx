/**
 * PDF parsing consent dialog — five variants (Workstream 4).
 */

import type { PdfParsingConsentVariant } from '../lib/pdfParsingConsentDecision.js'

export interface PdfParsingConsentDialogProps {
  variant: PdfParsingConsentVariant
  filename: string
  open: boolean
  busy?: boolean
  error?: string | null
  transitionNotice?: string | null
  onProceedOnce: () => void
  onDontAskAgainSession?: () => void
  onSetupServer?: () => void
  onFinishSetup?: () => void
  onWaitForServer?: () => void
  onCancel: () => void
}

type VariantCopy = {
  title: string
  body: string[]
  showDontAskAgain: boolean
  showSetup: boolean
  showFinishSetup: boolean
  showWaitForServer: boolean
  proceedLabel: string
}

function copyForVariant(variant: PdfParsingConsentVariant): VariantCopy {
  switch (variant) {
    case 'VARIANT_FREE_TIER':
      return {
        title: 'Parse this PDF on your computer?',
        body: [
          'To answer your question, the PDF needs to be read and converted to text. Parsing untrusted PDFs always carries some risk, even with the security measures we have in place — the PDF will be processed inside an isolated, sandboxed environment with read-only filesystem and strict resource limits.',
          'For higher-assurance use (journalism, legal work, regulated industries), paid tiers can run PDF parsing on a separate Linux server you control. PDFs are then never processed on this computer.',
        ],
        showDontAskAgain: true,
        showSetup: false,
        showFinishSetup: false,
        showWaitForServer: false,
        proceedLabel: 'Proceed once',
      }
    case 'VARIANT_PAID_NO_EDGE':
      return {
        title: 'Parse this PDF on your computer?',
        body: [
          'Your plan includes server-side verification, but you have not set up a verification server yet. Until you do, parsing this PDF will happen on this computer in an isolated, sandboxed environment.',
          'For routine high-assurance use, setting up your verification server is recommended.',
        ],
        showDontAskAgain: true,
        showSetup: true,
        showFinishSetup: false,
        showWaitForServer: false,
        proceedLabel: 'Proceed once',
      }
    case 'VARIANT_EDGE_UNREACHABLE':
      return {
        title: 'Parse this PDF on your computer?',
        body: [
          'Your verification server is currently unreachable, so this PDF would be parsed on this computer instead. Your normal setup is to verify on your server.',
        ],
        showDontAskAgain: false,
        showSetup: false,
        showFinishSetup: false,
        showWaitForServer: true,
        proceedLabel: 'Proceed once on this computer',
      }
    case 'VARIANT_EDGE_INCOMPLETE':
      return {
        title: 'Parse this PDF on your computer?',
        body: [
          'Your verification server setup is incomplete. Parsing this PDF on this computer will happen in an isolated, sandboxed environment.',
        ],
        showDontAskAgain: false,
        showSetup: false,
        showFinishSetup: true,
        showWaitForServer: false,
        proceedLabel: 'Proceed once',
      }
    case 'VARIANT_PAID_EDGE_ACTIVE_UNEXPECTED':
      return {
        title: 'Unexpected state',
        body: [
          'Your verification server is active, but this PDF was not pre-extracted on the server. This is unusual. Parsing on this computer is available as a fallback, but if this happens repeatedly, please contact support.',
        ],
        showDontAskAgain: false,
        showSetup: false,
        showFinishSetup: false,
        showWaitForServer: false,
        proceedLabel: 'Proceed once',
      }
    default:
      return copyForVariant('VARIANT_FREE_TIER')
  }
}

export function PdfParsingConsentDialog({
  variant,
  filename,
  open,
  busy = false,
  error = null,
  transitionNotice = null,
  onProceedOnce,
  onDontAskAgainSession,
  onSetupServer,
  onFinishSetup,
  onWaitForServer,
  onCancel,
}: PdfParsingConsentDialogProps) {
  if (!open) return null

  const copy = copyForVariant(variant)
  const btnStyle = {
    padding: '8px 14px',
    fontSize: 13,
    borderRadius: 6,
    cursor: busy ? 'wait' as const : 'pointer' as const,
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pdf-parsing-consent-title"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10001,
      }}
      onClick={(e) => e.target === e.currentTarget && !busy && onCancel()}
      onKeyDown={(e) => e.key === 'Escape' && !busy && onCancel()}
    >
      <div
        style={{
          background: 'var(--bg-surface, var(--color-surface, #1e293b))',
          border: '1px solid var(--border, rgba(255,255,255,0.12))',
          borderRadius: 12,
          maxWidth: 480,
          width: '92%',
          padding: 20,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}
      >
        <h3
          id="pdf-parsing-consent-title"
          style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 600, color: 'var(--color-text, #e2e8f0)' }}
        >
          {copy.title}
        </h3>
        {filename ? (
          <div
            style={{
              fontSize: 12,
              color: 'var(--color-text-muted, #94a3b8)',
              marginBottom: 12,
              wordBreak: 'break-all',
            }}
          >
            {filename}
          </div>
        ) : null}
        {copy.body.map((para) => (
          <p
            key={para.slice(0, 24)}
            style={{ margin: '0 0 10px', fontSize: 13, lineHeight: 1.55, color: 'var(--color-text, #e2e8f0)' }}
          >
            {para}
          </p>
        ))}
        {transitionNotice ? (
          <p
            role="status"
            style={{ margin: '0 0 12px', fontSize: 12, lineHeight: 1.45, color: '#86efac' }}
          >
            {transitionNotice}
          </p>
        ) : null}
        {error ? (
          <p style={{ margin: '0 0 12px', fontSize: 12, color: '#f87171' }} role="alert">
            {error}
          </p>
        ) : null}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
          {copy.showWaitForServer ? (
            <button
              type="button"
              disabled={busy}
              onClick={onWaitForServer}
              style={{ ...btnStyle, background: 'rgba(99,102,241,0.2)', border: '1px solid rgba(99,102,241,0.4)', color: '#c4b5fd' }}
            >
              Wait for server
            </button>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={onProceedOnce}
            style={{ ...btnStyle, border: 'none', background: '#6366f1', color: '#fff' }}
          >
            {busy ? 'Working…' : copy.proceedLabel}
          </button>
          {copy.showDontAskAgain && onDontAskAgainSession ? (
            <button
              type="button"
              disabled={busy}
              onClick={onDontAskAgainSession}
              style={{ ...btnStyle, background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', color: '#e2e8f0' }}
            >
              Do not ask again this session
            </button>
          ) : null}
          {copy.showSetup && onSetupServer ? (
            <button
              type="button"
              disabled={busy}
              onClick={onSetupServer}
              style={{ ...btnStyle, background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', color: '#a78bfa' }}
            >
              Set up verification server
            </button>
          ) : null}
          {copy.showFinishSetup && onFinishSetup ? (
            <button
              type="button"
              disabled={busy}
              onClick={onFinishSetup}
              style={{ ...btnStyle, background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', color: '#a78bfa' }}
            >
              Finish server setup
            </button>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            style={{ ...btnStyle, background: 'transparent', color: '#94a3b8' }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

export default PdfParsingConsentDialog
