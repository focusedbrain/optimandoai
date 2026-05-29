/**
 * Blocking gate — secure isolation requires Podman (runtime recovery path).
 * Platform-aware: Windows WSL2 + one-click, macOS one-click, Linux operator instructions.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'

export interface PodmanSetupStatus {
  required: boolean
  probePending: boolean
  code: string | null
  platform: string
  setupPhase: string
  headline: string
  summary: string
  statusMessage: string | null
  terminalAction: string
  operatorInstruction: string | null
  wslManualCommand: string | null
  canOneClickSetup: boolean
  oneClickLabel: string
  setupRunning: boolean
  setupStep: string
  setupStepLabel: string
  setupFailure: { kind?: string; message: string; detail?: string } | null
  install: {
    canAutoInstall: boolean
    installLabel: string
    manualHint: string
  }
}

const DEFAULT_STATUS: PodmanSetupStatus = {
  required: false,
  probePending: true,
  code: null,
  platform: 'win32',
  setupPhase: 'checking',
  headline: 'Checking secure container setup…',
  summary: '',
  statusMessage: null,
  terminalAction: 'none',
  operatorInstruction: null,
  wslManualCommand: null,
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

const prominentBoxStyle: CSSProperties = {
  margin: '0 0 16px',
  padding: 14,
  background: 'var(--bg-elevated, var(--bg-elevated-prof, #ffffff))',
  color: 'var(--text-primary, var(--text-primary-prof, #0f1419))',
  border: '1px solid var(--border, var(--border-prof, #e1e8ed))',
  borderRadius: 8,
  fontSize: 14,
  lineHeight: 1.55,
}

const errorBoxStyle: CSSProperties = {
  ...prominentBoxStyle,
  border: '1px solid var(--danger, var(--danger-prof, #f4212e))',
  fontSize: 13,
}

const restartBoxStyle: CSSProperties = {
  ...prominentBoxStyle,
  border: '2px solid var(--accent, var(--accent-prof, #1d9bf0))',
  background: 'color-mix(in srgb, var(--accent, #1d9bf0) 8%, var(--bg-elevated, #ffffff))',
}

function applyStatusFromPayload(res: Record<string, unknown>): PodmanSetupStatus {
  const installRaw = (res.install as PodmanSetupStatus['install']) ?? DEFAULT_STATUS.install
  return {
    required: Boolean(res.required),
    probePending: Boolean(res.probePending),
    code: typeof res.code === 'string' ? res.code : null,
    platform: typeof res.platform === 'string' ? res.platform : 'win32',
    setupPhase: typeof res.setupPhase === 'string' ? res.setupPhase : 'checking',
    headline: typeof res.headline === 'string' ? res.headline : DEFAULT_STATUS.headline,
    summary: typeof res.summary === 'string' ? res.summary : '',
    statusMessage: typeof res.statusMessage === 'string' ? res.statusMessage : null,
    terminalAction: typeof res.terminalAction === 'string' ? res.terminalAction : 'none',
    operatorInstruction:
      typeof res.operatorInstruction === 'string' ? res.operatorInstruction : null,
    wslManualCommand: typeof res.wslManualCommand === 'string' ? res.wslManualCommand : null,
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
      return 35
    case 'creating_environment':
      return 55
    case 'starting':
      return 75
    case 'verifying':
      return 92
    case 'complete':
      return 100
    default:
      return 0
  }
}

function progressHint(platform: string): string {
  if (platform === 'win32') {
    return 'Windows may ask once to approve WSL or Podman install. Everything else runs automatically.'
  }
  if (platform === 'darwin') {
    return 'macOS may ask once to approve Homebrew or Podman. Everything else runs automatically.'
  }
  return 'Please wait while setup completes.'
}

function statusPayloadKey(res: Record<string, unknown>): string {
  return [
    res.required,
    res.probePending,
    res.setupPhase,
    res.headline,
    res.summary,
    res.statusMessage,
    res.terminalAction,
    res.canOneClickSetup,
    res.setupRunning,
    res.setupStep,
    res.setupStepLabel,
    JSON.stringify(res.setupFailure ?? null),
    res.platform,
  ].join('|')
}

export function PodmanRequiredModal(): JSX.Element | null {
  const apiRef = useRef(typeof window !== 'undefined' ? window.podmanSetup : undefined)
  const [status, setStatus] = useState<PodmanSetupStatus>(DEFAULT_STATUS)
  const [localBusy, setLocalBusy] = useState(false)
  const [clickError, setClickError] = useState<string | null>(null)
  const [copyOk, setCopyOk] = useState(false)
  const lastPayloadKeyRef = useRef<string>('')

  const applyStatus = useCallback((res: Record<string, unknown>) => {
    const key = statusPayloadKey(res)
    if (key === lastPayloadKeyRef.current) return
    lastPayloadKeyRef.current = key
    setStatus(applyStatusFromPayload(res))
  }, [])

  useEffect(() => {
    const api = apiRef.current
    if (!api?.getStatus) return
    void api.getStatus().then((s) => applyStatus(s as Record<string, unknown>))
    const off = api.onState?.((payload) => {
      applyStatus(payload as Record<string, unknown>)
    })
    return () => off?.()
  }, [applyStatus])

  const runFullSetup = async () => {
    setClickError(null)
    const api = apiRef.current
    if (!api?.runFullSetup) {
      setClickError('Setup could not start (app bridge unavailable). Restart WR Desk and try again.')
      return
    }
    setLocalBusy(true)
    try {
      const out = await api.runFullSetup()
      applyStatus(out.status as Record<string, unknown>)
      if (!out.ok && out.failure?.message && !(out.status as PodmanSetupStatus)?.setupFailure) {
        setClickError(out.failure.detail ? `${out.failure.message} ${out.failure.detail}` : out.failure.message)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setClickError(
        msg.includes('No handler registered')
          ? 'Setup could not start. Restart WR Desk and try again.'
          : `Setup failed: ${msg}`,
      )
    } finally {
      setLocalBusy(false)
    }
  }

  if (!status.required) return null

  const setupActive = status.setupRunning || localBusy
  const monitoredProgressSteps = new Set(['installing', 'creating_environment', 'starting', 'verifying', 'complete'])
  const showProgress =
    setupActive &&
    monitoredProgressSteps.has(status.setupStep)
  const failure = status.setupFailure
  const isRestart =
    status.terminalAction === 'restart' || status.setupPhase === 'need_restart'
  const isVirtualization = status.terminalAction === 'enable_virtualization'
  const isWslManual =
    status.platform === 'win32' &&
    (status.terminalAction === 'wsl_manual' || status.setupPhase === 'need_wsl_manual')
  const wslManualText = isWslManual ? status.operatorInstruction : null
  const isOperatorLinux =
    status.platform === 'linux' &&
    (status.terminalAction === 'operator_install' || status.setupPhase === 'need_operator_install')
  const operatorText = isOperatorLinux ? status.operatorInstruction ?? failure?.detail : null
  const showOneClick = status.canOneClickSetup && !isWslManual
  const summaryIsPrimaryInstruction =
    Boolean(
      (failure && !setupActive && failure.detail && status.summary === failure.detail) ||
        (isWslManual && wslManualText),
    )

  const copyWslCommand = async () => {
    const cmd = status.wslManualCommand ?? 'wsl --install'
    try {
      await navigator.clipboard.writeText(cmd)
      setCopyOk(true)
      window.setTimeout(() => setCopyOk(false), 2000)
    } catch {
      setClickError(`Could not copy. Type manually: ${cmd}`)
    }
  }

  const recheckSetup = async () => {
    setClickError(null)
    const api = apiRef.current
    if (!api?.probe) return
    setLocalBusy(true)
    try {
      const snap = await api.probe()
      applyStatus(snap as Record<string, unknown>)
    } catch (err: unknown) {
      setClickError(err instanceof Error ? err.message : String(err))
    } finally {
      setLocalBusy(false)
    }
  }

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
        <p
          style={{
            ...(summaryIsPrimaryInstruction
              ? {
                  color: 'var(--text-primary, var(--text-primary-prof, #0f1419))',
                  fontSize: 14,
                  lineHeight: 1.55,
                  whiteSpace: 'pre-wrap',
                }
              : { ...mutedStyle }),
            margin: '0 0 16px',
          }}
        >
          {status.summary}
        </p>

        {status.statusMessage &&
        !setupActive &&
        !isOperatorLinux &&
        status.statusMessage !== status.summary ? (
          <div style={prominentBoxStyle} data-testid="podman-status-message">
            {status.statusMessage}
          </div>
        ) : null}

        {isRestart && !setupActive && failure?.message !== status.headline ? (
          <div style={restartBoxStyle} data-testid="podman-restart-required">
            <strong style={{ display: 'block', marginBottom: 8 }}>
              {failure?.message ?? 'Restart your computer to finish Windows setup'}
            </strong>
            <span style={{ color: 'var(--text-primary, var(--text-primary-prof, #0f1419))' }}>
              {failure?.detail ??
                'After restarting, open WR Desk again. Setup will continue automatically.'}
            </span>
          </div>
        ) : null}

        {isVirtualization && !setupActive ? (
          <div style={errorBoxStyle} data-testid="podman-virtualization-required">
            <strong style={{ display: 'block', marginBottom: 8 }}>
              {failure?.message ?? 'Enable virtualization in your computer firmware'}
            </strong>
            <span style={{ color: 'var(--text-primary, var(--text-primary-prof, #0f1419))' }}>
              {failure?.detail ??
                'Podman on Windows requires WSL2, which needs Intel VT-x / AMD-V enabled in BIOS or UEFI.'}
            </span>
          </div>
        ) : null}

        {isWslManual && wslManualText && !setupActive ? (
          <div style={prominentBoxStyle} data-testid="podman-wsl-manual-instruction">
            <pre
              style={{
                margin: '0 0 12px',
                whiteSpace: 'pre-wrap',
                fontFamily: 'inherit',
                fontSize: 13,
                color: 'var(--text-primary, var(--text-primary-prof, #0f1419))',
              }}
            >
              {wslManualText}
            </pre>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                style={{
                  ...btnPrimary,
                  width: 'auto',
                  flex: '1 1 auto',
                  minWidth: 140,
                }}
                data-testid="podman-wsl-copy-command"
                onClick={() => void copyWslCommand()}
              >
                {copyOk ? 'Copied' : `Copy: ${status.wslManualCommand ?? 'wsl --install'}`}
              </button>
              <button
                type="button"
                style={{
                  ...btnPrimary,
                  width: 'auto',
                  flex: '1 1 auto',
                  minWidth: 140,
                  background: 'var(--bg-elevated, var(--bg-elevated-prof, #ffffff))',
                  color: 'var(--text-primary, var(--text-primary-prof, #0f1419))',
                  border: '1px solid var(--border, var(--border-prof, #e1e8ed))',
                }}
                data-testid="podman-wsl-recheck"
                onClick={() => void recheckSetup()}
              >
                After restart — check again
              </button>
            </div>
          </div>
        ) : null}

        {isOperatorLinux && operatorText && !setupActive ? (
          <div style={prominentBoxStyle} data-testid="podman-operator-instruction">
            <pre
              style={{
                margin: 0,
                whiteSpace: 'pre-wrap',
                fontFamily: 'inherit',
                fontSize: 13,
                color: 'var(--text-primary, var(--text-primary-prof, #0f1419))',
              }}
            >
              {operatorText}
            </pre>
          </div>
        ) : null}

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
              {progressHint(status.platform)}
            </p>
          </div>
        ) : null}

        {failure &&
        !setupActive &&
        !isRestart &&
        !isVirtualization &&
        !isOperatorLinux &&
        !isWslManual &&
        (failure.detail !== status.summary || failure.message !== status.headline) ? (
          <div style={errorBoxStyle} data-testid="podman-setup-failure">
            <strong style={{ display: 'block', marginBottom: 6 }}>{failure.message}</strong>
            {failure.detail && failure.detail !== status.summary ? (
              <span
                style={{
                  color: 'var(--text-primary, var(--text-primary-prof, #0f1419))',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {failure.detail}
              </span>
            ) : null}
          </div>
        ) : null}

        {clickError && !setupActive ? (
          <div style={errorBoxStyle} data-testid="podman-click-error">
            {clickError}
          </div>
        ) : null}

        {!status.probePending && showOneClick ? (
          <div style={{ marginBottom: 12 }}>
            <button
              type="button"
              style={{ ...btnPrimary, opacity: setupActive ? 0.65 : 1 }}
              disabled={setupActive}
              data-testid="podman-one-click-setup"
              onClick={() => void runFullSetup()}
            >
              {setupActive ? status.setupStepLabel || 'Setting up…' : status.oneClickLabel}
            </button>
          </div>
        ) : null}

        {!setupActive && status.platform !== 'linux' ? (
          <button
            type="button"
            style={btnLink}
            onClick={() => void apiRef.current?.openManualInstall?.()}
          >
            Manual install guide (podman.io)
          </button>
        ) : null}
      </div>
    </div>
  )
}
