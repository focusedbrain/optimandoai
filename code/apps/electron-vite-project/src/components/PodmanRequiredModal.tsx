/**
 * Blocking gate — secure isolation requires Podman (runtime recovery path).
 * One-click setup: install → machine init → start → verify.
 */

import { useCallback, useEffect, useState, type CSSProperties } from 'react'

export interface PodmanSetupStatus {
  required: boolean
  probePending: boolean
  code: string | null
  userMessage: string | null
  platform: string
  setupPhase: string
  headline: string
  summary: string
  canOneClickSetup: boolean
  oneClickLabel: string
  setupRunning: boolean
  setupStep: string
  setupStepLabel: string
  setupFailure: { message: string; detail?: string } | null
  install: {
    canAutoInstall: boolean
    installLabel: string
    manualHint: string
    linuxDistroHints?: Array<{ id: string; label: string; commands: readonly string[] }>
  }
}

const DEFAULT_STATUS: PodmanSetupStatus = {
  required: false,
  probePending: true,
  code: null,
  userMessage: null,
  platform: 'win32',
  setupPhase: 'checking',
  headline: 'Checking secure container setup…',
  summary: '',
  canOneClickSetup: false,
  oneClickLabel: 'Install & set up Podman',
  setupRunning: false,
  setupStep: 'idle',
  setupStepLabel: '',
  setupFailure: null,
  install: {
    canAutoInstall: false,
    installLabel: 'Install & set up Podman',
    manualHint: '',
    linuxDistroHints: [],
  },
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 10000,
  background: 'color-mix(in srgb, var(--text-primary, #0f1419) 45%, transparent)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
}

const cardStyle: CSSProperties = {
  width: '100%',
  maxWidth: 520,
  maxHeight: '90vh',
  overflow: 'auto',
  background: 'var(--bg-surface, var(--bg-surface-prof, #ffffff))',
  color: 'var(--text-primary, var(--text-primary-prof, #0f1419))',
  border: '1px solid var(--border, var(--border-prof, #e1e8ed))',
  borderRadius: 12,
  boxShadow: '0 16px 48px color-mix(in srgb, var(--text-primary, #0f1419) 25%, transparent)',
  padding: 24,
}

const progressTrackStyle: CSSProperties = {
  height: 6,
  borderRadius: 999,
  background: 'var(--border-subtle, var(--border-subtle-prof, #eef3f6))',
  overflow: 'hidden',
  margin: '0 0 8px',
}

const btnPrimary: CSSProperties = {
  padding: '12px 16px',
  borderRadius: 8,
  border: '1px solid var(--accent, var(--accent-prof, #1d9bf0))',
  background: 'var(--accent, var(--accent-prof, #1d9bf0))',
  color: '#ffffff',
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: 600,
  width: '100%',
}

const btnLink: CSSProperties = {
  padding: '8px 0',
  border: 'none',
  background: 'transparent',
  color: 'var(--accent, var(--accent-prof, #1d9bf0))',
  cursor: 'pointer',
  fontSize: 14,
  textDecoration: 'underline',
}

const mutedStyle: CSSProperties = {
  color: 'var(--text-secondary, var(--text-secondary-prof, #536471))',
  fontSize: 13,
  lineHeight: 1.5,
}

const errorBoxStyle: CSSProperties = {
  margin: '0 0 16px',
  padding: 12,
  background: 'var(--bg-elevated, var(--bg-elevated-prof, #ffffff))',
  color: 'var(--text-primary, var(--text-primary-prof, #0f1419))',
  border: '1px solid var(--danger, var(--danger-prof, #f4212e))',
  borderRadius: 8,
  fontSize: 13,
  lineHeight: 1.5,
}

function applyStatusFromPayload(res: Record<string, unknown>): PodmanSetupStatus {
  const installRaw = (res.install as PodmanSetupStatus['install']) ?? DEFAULT_STATUS.install
  return {
    required: Boolean(res.required),
    probePending: Boolean(res.probePending),
    code: typeof res.code === 'string' ? res.code : null,
    userMessage: typeof res.userMessage === 'string' ? res.userMessage : null,
    platform: typeof res.platform === 'string' ? res.platform : 'win32',
    setupPhase: typeof res.setupPhase === 'string' ? res.setupPhase : 'checking',
    headline: typeof res.headline === 'string' ? res.headline : DEFAULT_STATUS.headline,
    summary: typeof res.summary === 'string' ? res.summary : '',
    canOneClickSetup: Boolean(res.canOneClickSetup),
    oneClickLabel:
      typeof res.oneClickLabel === 'string' ? res.oneClickLabel : DEFAULT_STATUS.oneClickLabel,
    setupRunning: Boolean(res.setupRunning),
    setupStep: typeof res.setupStep === 'string' ? res.setupStep : 'idle',
    setupStepLabel: typeof res.setupStepLabel === 'string' ? res.setupStepLabel : '',
    setupFailure:
      res.setupFailure && typeof res.setupFailure === 'object'
        ? (res.setupFailure as PodmanSetupStatus['setupFailure'])
        : null,
    install: installRaw,
  }
}

function progressPercent(step: string): number {
  switch (step) {
    case 'installing':
      return 25
    case 'creating_environment':
      return 55
    case 'starting':
      return 80
    case 'verifying':
      return 95
    case 'complete':
      return 100
    default:
      return 0
  }
}

export function PodmanRequiredModal(): JSX.Element | null {
  const api = typeof window !== 'undefined' ? window.podmanSetup : undefined
  const [status, setStatus] = useState<PodmanSetupStatus>(DEFAULT_STATUS)
  const [localBusy, setLocalBusy] = useState(false)

  const applyStatus = useCallback((res: Record<string, unknown>) => {
    setStatus(applyStatusFromPayload(res))
  }, [])

  useEffect(() => {
    if (!api?.getStatus) return
    void api.getStatus().then((s) => applyStatus(s as Record<string, unknown>))
    const off = api.onState?.((payload) => {
      applyStatus(payload as Record<string, unknown>)
    })
    return () => off?.()
  }, [api, applyStatus])

  const runFullSetup = async () => {
    if (!api?.runFullSetup) return
    setLocalBusy(true)
    try {
      const out = await api.runFullSetup()
      applyStatus(out.status as Record<string, unknown>)
    } finally {
      setLocalBusy(false)
    }
  }

  if (!status.required) return null

  const busy = status.setupRunning || localBusy || status.probePending
  const showProgress = status.setupRunning && status.setupStep !== 'idle' && status.setupStep !== 'failed'
  const failure = status.setupFailure
  const linuxHints = status.install.linuxDistroHints ?? []
  const buttonLabel = failure ? status.oneClickLabel : status.oneClickLabel

  return (
    <div
      style={overlayStyle}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="podman-required-title"
      data-testid="podman-required-modal"
    >
      <div style={cardStyle}>
        <h2
          id="podman-required-title"
          style={{
            margin: '0 0 12px',
            fontSize: 20,
            fontWeight: 600,
            color: 'var(--text-primary, var(--text-primary-prof, #0f1419))',
          }}
        >
          {status.headline}
        </h2>
        <p style={{ ...mutedStyle, margin: '0 0 12px' }}>{status.summary}</p>
        <p style={{ ...mutedStyle, margin: '0 0 16px', fontSize: 12 }}>
          WR Desk uses container isolation as a core security measure. Podman is installed separately
          on your computer — this screen appears if it is missing or stopped later.
        </p>

        {showProgress ? (
          <div style={{ marginBottom: 16 }} data-testid="podman-setup-progress">
            <div style={progressTrackStyle} aria-hidden="true">
              <div
                style={{
                  height: '100%',
                  width: `${progressPercent(status.setupStep)}%`,
                  background: 'var(--accent, var(--accent-prof, #1d9bf0))',
                  transition: 'width 0.35s ease',
                }}
              />
            </div>
            <p
              style={{
                margin: 0,
                fontSize: 14,
                color: 'var(--text-primary, var(--text-primary-prof, #0f1419))',
              }}
            >
              {status.setupStepLabel || 'Working…'}
            </p>
            <p style={{ ...mutedStyle, margin: '6px 0 0', fontSize: 12 }}>
              Windows may ask once to approve the install. Everything else runs automatically.
            </p>
          </div>
        ) : null}

        {failure && !status.setupRunning ? (
          <div style={errorBoxStyle} data-testid="podman-setup-failure">
            <strong style={{ display: 'block', marginBottom: 6 }}>{failure.message}</strong>
            {failure.detail ? (
              <span style={{ color: 'var(--text-secondary, var(--text-secondary-prof, #536471))' }}>
                {failure.detail}
              </span>
            ) : null}
          </div>
        ) : null}

        {!status.probePending && status.canOneClickSetup ? (
          <div style={{ marginBottom: 12 }}>
            <button
              type="button"
              style={{ ...btnPrimary, opacity: busy ? 0.65 : 1 }}
              disabled={busy}
              data-testid="podman-one-click-setup"
              onClick={() => void runFullSetup()}
            >
              {busy ? status.setupStepLabel || 'Setting up…' : buttonLabel}
            </button>
          </div>
        ) : null}

        {!status.probePending && !status.install.canAutoInstall && status.platform === 'linux' && linuxHints.length > 0 ? (
          <div style={{ marginBottom: 16 }}>
            <p style={{ ...mutedStyle, margin: '0 0 8px', fontSize: 12 }}>
              Install Podman with your package manager, then use the button above:
            </p>
            <ul
              style={{
                margin: 0,
                paddingLeft: 18,
                fontSize: 12,
                color: 'var(--text-primary, var(--text-primary-prof, #0f1419))',
              }}
            >
              {linuxHints.map((hint) => (
                <li key={hint.id} style={{ marginBottom: 8 }}>
                  <strong>{hint.label}</strong>
                  <pre
                    style={{
                      ...mutedStyle,
                      margin: '4px 0 0',
                      fontSize: 11,
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {hint.commands.join('\n')}
                  </pre>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {!busy ? (
          <button
            type="button"
            style={btnLink}
            onClick={() => void api?.openManualInstall?.()}
          >
            Manual install guide (podman.io)
          </button>
        ) : null}
      </div>
    </div>
  )
}
