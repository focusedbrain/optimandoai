/**
 * UX-1 D5 — SandboxReadConsentWizard
 *
 * Modal wizard shown on the sandbox node when ACTION_NEEDED_READ_CONSENT:
 * the sandbox owns ingestion but has no read token for at least one account.
 *
 * Flow:
 *   intro → provider-pick → connecting (OAuth opens in system browser) → done/error
 *
 * Calls window.emailAccounts.connectReadAccount() which runs connectReadClient
 * on the main process (read-only scopes only, stored in roleScopedTokenStore).
 *
 * Spec copy: "Connect a read-only email account on this device so WR Desk can
 * fetch mail safely. This connection cannot send mail, and credentials stay only
 * on this sandbox."
 *
 * ui-readability: every surface sets explicit bg + color.
 */

import { useState } from 'react'

// ── Spec copy ─────────────────────────────────────────────────────────────────
const COPY = {
  intro: {
    title: 'Connect a read-only mail account',
    body: 'Connect a read-only email account on this device so WR Desk can fetch mail safely. This connection cannot send mail, and credentials stay only on this sandbox.',
    cta: 'Choose provider',
  },
  providerPick: {
    title: 'Choose your mail provider',
    gmail: { label: 'Gmail', description: 'Sign in with Google — read-only access' },
    outlook: { label: 'Outlook / Microsoft 365', description: 'Sign in with Microsoft — read-only access' },
  },
  connecting: {
    title: 'Opening sign-in…',
    body: 'Complete the sign-in in your browser. Only read access is requested — no mail will be sent.',
  },
  success: {
    title: 'Read account connected',
    body: 'WR Desk will begin fetching mail on this device on the next sync tick.',
    cta: 'Done',
  },
  errorRetry: 'Try again',
  cancel: 'Cancel',
} as const

// ── Styles ────────────────────────────────────────────────────────────────────

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0,
  background: 'rgba(0,0,0,0.45)',
  zIndex: 1200,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-elevated, var(--bg-elevated-prof, #ffffff))',
  color: 'var(--text-primary, var(--text-primary-prof, #0f172a))',
  borderRadius: 12,
  padding: '24px 28px 20px',
  maxWidth: 460,
  width: '90vw',
  boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
  border: '1px solid var(--border, var(--border-prof, #e2e8f0))',
}

const titleStyle: React.CSSProperties = {
  fontWeight: 700, fontSize: 16, marginBottom: 12,
  color: 'var(--text-primary, var(--text-primary-prof, #0f172a))',
}

const bodyStyle: React.CSSProperties = {
  fontSize: 13, lineHeight: 1.55, marginBottom: 16,
  color: 'var(--text-primary, var(--text-primary-prof, #1e293b))',
}

const rowStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4,
}

const primaryBtnStyle: React.CSSProperties = {
  padding: '8px 20px', fontSize: 13, fontWeight: 600,
  background: 'rgba(251,191,36,0.18)',
  color: 'var(--text-primary, var(--text-primary-prof, #0f172a))',
  border: '1px solid rgba(251,191,36,0.5)',
  borderRadius: 8, cursor: 'pointer',
}

const secondaryBtnStyle: React.CSSProperties = {
  padding: '8px 14px', fontSize: 13,
  background: 'transparent',
  color: 'var(--text-secondary, var(--text-secondary-prof, #6b7280))',
  border: '1px solid var(--border, var(--border-prof, #d1d5db))',
  borderRadius: 8, cursor: 'pointer',
}

const providerCardStyle: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left',
  padding: '14px 16px', marginBottom: 10,
  background: 'var(--bg-surface, var(--bg-surface-prof, #f8fafc))',
  color: 'var(--text-primary, var(--text-primary-prof, #0f172a))',
  border: '1px solid var(--border, var(--border-prof, #e2e8f0))',
  borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600,
}

const providerDescStyle: React.CSSProperties = {
  fontWeight: 400, marginTop: 2,
  color: 'var(--text-secondary, var(--text-secondary-prof, #6b7280))',
  fontSize: 12,
}

const errorStyle: React.CSSProperties = {
  fontSize: 12, color: '#ef4444',
  background: 'rgba(239,68,68,0.07)',
  border: '1px solid rgba(239,68,68,0.25)',
  borderRadius: 6, padding: '8px 10px', marginBottom: 12,
}

// ── Component ─────────────────────────────────────────────────────────────────

type Step = 'intro' | 'providerPick' | 'connecting' | 'success' | 'error'
type Provider = 'gmail' | 'outlook'

type Props = {
  onClose: () => void
}

export function SandboxReadConsentWizard({ onClose }: Props) {
  const [step, setStep] = useState<Step>('intro')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  async function handleProviderPick(provider: Provider) {
    setStep('connecting')
    setErrorMsg(null)
    try {
      const result = await (window as any).emailAccounts?.connectReadAccount({ provider })
      if (!result?.ok) {
        setErrorMsg(result?.error ?? 'Connection failed — please try again.')
        setStep('error')
      } else {
        setStep('success')
      }
    } catch (e: any) {
      setErrorMsg(e?.message ?? String(e))
      setStep('error')
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="sandbox-consent-title"
      data-testid="sandbox-read-consent-wizard"
      style={overlayStyle}
    >
      <div style={cardStyle}>
        {step === 'intro' && (
          <>
            <div id="sandbox-consent-title" style={titleStyle}>{COPY.intro.title}</div>
            <p style={bodyStyle}>{COPY.intro.body}</p>
            <div style={rowStyle}>
              <button type="button" style={secondaryBtnStyle} onClick={onClose}
                data-testid="sandbox-consent-cancel">{COPY.cancel}</button>
              <button type="button" style={primaryBtnStyle} onClick={() => setStep('providerPick')}
                data-testid="sandbox-consent-choose-provider">{COPY.intro.cta}</button>
            </div>
          </>
        )}

        {step === 'providerPick' && (
          <>
            <div id="sandbox-consent-title" style={titleStyle}>{COPY.providerPick.title}</div>
            <button type="button" style={providerCardStyle}
              data-testid="sandbox-consent-pick-gmail"
              onClick={() => handleProviderPick('gmail')}>
              {COPY.providerPick.gmail.label}
              <div style={providerDescStyle}>{COPY.providerPick.gmail.description}</div>
            </button>
            <button type="button" style={providerCardStyle}
              data-testid="sandbox-consent-pick-outlook"
              onClick={() => handleProviderPick('outlook')}>
              {COPY.providerPick.outlook.label}
              <div style={providerDescStyle}>{COPY.providerPick.outlook.description}</div>
            </button>
            <div style={rowStyle}>
              <button type="button" style={secondaryBtnStyle} onClick={onClose}>{COPY.cancel}</button>
            </div>
          </>
        )}

        {step === 'connecting' && (
          <>
            <div id="sandbox-consent-title" style={titleStyle}>{COPY.connecting.title}</div>
            <p style={bodyStyle}>{COPY.connecting.body}</p>
          </>
        )}

        {step === 'success' && (
          <>
            <div id="sandbox-consent-title" style={titleStyle}>{COPY.success.title}</div>
            <p style={bodyStyle}>{COPY.success.body}</p>
            <div style={rowStyle}>
              <button type="button" style={primaryBtnStyle} onClick={onClose}
                data-testid="sandbox-consent-done">{COPY.success.cta}</button>
            </div>
          </>
        )}

        {step === 'error' && (
          <>
            <div id="sandbox-consent-title" style={titleStyle}>Connection failed</div>
            {errorMsg && <div style={errorStyle} data-testid="sandbox-consent-error">{errorMsg}</div>}
            <div style={rowStyle}>
              <button type="button" style={secondaryBtnStyle} onClick={onClose}>{COPY.cancel}</button>
              <button type="button" style={primaryBtnStyle} onClick={() => setStep('providerPick')}
                data-testid="sandbox-consent-retry">{COPY.errorRetry}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
