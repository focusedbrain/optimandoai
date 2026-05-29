/**
 * Blocking gate — secure isolation requires Podman (runtime recovery path).
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
  showPackageInstall: boolean
  showMachineSteps: boolean
  install: {
    canAutoInstall: boolean
    installAction: string | null
    installLabel: string
    installCommand: string | null
    manualHint: string
    linuxDistroHints?: Array<{ id: string; label: string; commands: readonly string[] }>
  }
  machineInitCommand: string
  machineStartCommand: string
}

type CommandLog = {
  command: string
  ok: boolean
  stdout: string
  stderr: string
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
  showPackageInstall: false,
  showMachineSteps: false,
  install: {
    canAutoInstall: false,
    installAction: null,
    installLabel: '',
    installCommand: null,
    manualHint: '',
    linuxDistroHints: [],
  },
  machineInitCommand: 'podman machine init',
  machineStartCommand: 'podman machine start',
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

const statusBoxStyle: CSSProperties = {
  margin: '0 0 16px',
  padding: 12,
  background: 'var(--bg-elevated, var(--bg-elevated-prof, #ffffff))',
  color: 'var(--text-primary, var(--text-primary-prof, #0f1419))',
  border: '1px solid var(--border-subtle, var(--border-subtle-prof, #eef3f6))',
  borderRadius: 8,
  fontSize: 13,
  lineHeight: 1.5,
}

const btnPrimary: CSSProperties = {
  padding: '10px 16px',
  borderRadius: 8,
  border: '1px solid var(--accent, var(--accent-prof, #1d9bf0))',
  background: 'var(--accent, var(--accent-prof, #1d9bf0))',
  color: '#ffffff',
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: 600,
}

const btnSecondary: CSSProperties = {
  padding: '10px 16px',
  borderRadius: 8,
  border: '1px solid var(--border, var(--border-prof, #e1e8ed))',
  background: 'var(--bg-elevated, var(--bg-elevated-prof, #ffffff))',
  color: 'var(--text-primary, var(--text-primary-prof, #0f1419))',
  cursor: 'pointer',
  fontSize: 14,
}

const mutedStyle: CSSProperties = {
  color: 'var(--text-secondary, var(--text-secondary-prof, #536471))',
  fontSize: 13,
  lineHeight: 1.5,
}

function applyStatusFromPayload(res: Record<string, unknown>): PodmanSetupStatus {
  return {
    required: Boolean(res.required),
    probePending: Boolean(res.probePending),
    code: typeof res.code === 'string' ? res.code : null,
    userMessage: typeof res.userMessage === 'string' ? res.userMessage : null,
    platform: typeof res.platform === 'string' ? res.platform : 'win32',
    setupPhase: typeof res.setupPhase === 'string' ? res.setupPhase : 'checking',
    headline: typeof res.headline === 'string' ? res.headline : DEFAULT_STATUS.headline,
    summary: typeof res.summary === 'string' ? res.summary : '',
    showPackageInstall: Boolean(res.showPackageInstall),
    showMachineSteps: Boolean(res.showMachineSteps),
    install: (res.install as PodmanSetupStatus['install']) ?? DEFAULT_STATUS.install,
    machineInitCommand:
      typeof res.machineInitCommand === 'string' ? res.machineInitCommand : 'podman machine init',
    machineStartCommand:
      typeof res.machineStartCommand === 'string' ? res.machineStartCommand : 'podman machine start',
  }
}

export function PodmanRequiredModal(): JSX.Element | null {
  const api = typeof window !== 'undefined' ? window.podmanSetup : undefined
  const [status, setStatus] = useState<PodmanSetupStatus>(DEFAULT_STATUS)
  const [busy, setBusy] = useState(false)
  const [lastLog, setLastLog] = useState<CommandLog | null>(null)
  const [error, setError] = useState<string | null>(null)

  const applyStatus = useCallback((res: Record<string, unknown>) => {
    setStatus(applyStatusFromPayload(res))
  }, [])

  const refresh = useCallback(async () => {
    if (!api?.probe) return
    setError(null)
    setBusy(true)
    try {
      const res = await api.probe()
      applyStatus(res as Record<string, unknown>)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [api, applyStatus])

  useEffect(() => {
    if (!api?.getStatus) return
    void api.getStatus().then((s) => applyStatus(s as Record<string, unknown>))
    const off = api.onState?.((payload) => {
      applyStatus(payload as Record<string, unknown>)
    })
    return () => off?.()
  }, [api, applyStatus])

  const runAction = async (action: string) => {
    if (!api?.runAction) return
    setBusy(true)
    setError(null)
    try {
      const out = await api.runAction(action)
      if (out.result) {
        setLastLog({
          command: out.result.command,
          ok: out.result.ok,
          stdout: out.result.stdout,
          stderr: out.result.stderr,
        })
      }
      applyStatus(out.status as Record<string, unknown>)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!status.required) return null

  const linuxHints = status.install.linuxDistroHints ?? []
  const showContinueSetup =
    !status.probePending &&
    status.showMachineSteps &&
    status.setupPhase === 'need_machine_init'

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
          Podman is not included with WR Desk. Install it once on this computer. This screen appears
          if Podman is missing or stopped later — the installer should set it up before your first
          session when possible.
        </p>

        {status.userMessage ? (
          <div style={statusBoxStyle} data-testid="podman-status-message">
            {status.probePending ? 'Checking… ' : null}
            {status.userMessage}
          </div>
        ) : null}

        {!status.probePending && status.showPackageInstall && status.install.canAutoInstall && status.install.installAction ? (
          <div style={{ marginBottom: 16 }}>
            <button
              type="button"
              style={{ ...btnPrimary, width: '100%', opacity: busy ? 0.6 : 1 }}
              disabled={busy}
              onClick={() => void runAction(status.install.installAction!)}
            >
              {status.install.installLabel}
            </button>
            {status.install.installCommand ? (
              <pre
                style={{
                  ...mutedStyle,
                  marginTop: 8,
                  fontSize: 11,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}
              >
                {status.install.installCommand}
              </pre>
            ) : null}
            <p style={{ ...mutedStyle, margin: '8px 0 0', fontSize: 12 }}>{status.install.manualHint}</p>
          </div>
        ) : null}

        {!status.probePending && !status.showPackageInstall && status.platform === 'linux' ? (
          <div style={{ marginBottom: 16 }}>
            <p style={{ ...mutedStyle, margin: '0 0 8px', fontSize: 12 }}>{status.install.manualHint}</p>
            {linuxHints.length > 0 ? (
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
            ) : null}
          </div>
        ) : null}

        {!status.probePending && status.showMachineSteps ? (
          <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <p style={{ ...mutedStyle, margin: 0 }}>
              {status.setupPhase === 'need_machine_init'
                ? 'Next: create and start Podman’s background environment (one-time on Windows/Mac).'
                : 'Next: start Podman’s background environment.'}
            </p>
            {showContinueSetup ? (
              <button
                type="button"
                style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }}
                disabled={busy}
                onClick={() => void runAction('machine_init')}
              >
                Continue setup (create environment)
              </button>
            ) : null}
            {status.setupPhase === 'need_machine_init' ? (
              <button
                type="button"
                style={{ ...btnSecondary, opacity: busy ? 0.6 : 1 }}
                disabled={busy}
                onClick={() => void runAction('machine_init')}
              >
                Run: {status.machineInitCommand}
              </button>
            ) : null}
            {(status.setupPhase === 'need_machine_init' || status.setupPhase === 'need_machine_start') && (
              <button
                type="button"
                style={{ ...btnSecondary, opacity: busy ? 0.6 : 1 }}
                disabled={busy}
                onClick={() => void runAction('machine_start')}
              >
                Run: {status.machineStartCommand}
              </button>
            )}
          </div>
        ) : null}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          <button
            type="button"
            style={btnSecondary}
            disabled={busy}
            onClick={() => void api?.openManualInstall?.()}
          >
            Open install guide
          </button>
          <button type="button" style={btnPrimary} disabled={busy} onClick={() => void refresh()}>
            {status.probePending || busy ? 'Checking…' : 'Check again'}
          </button>
        </div>

        {lastLog ? (
          <pre
            style={{
              margin: 0,
              maxHeight: 120,
              overflow: 'auto',
              fontSize: 11,
              padding: 10,
              background: 'var(--bg-elevated, var(--bg-elevated-prof, #ffffff))',
              color: 'var(--text-primary, var(--text-primary-prof, #0f1419))',
              border: `1px solid ${lastLog.ok ? 'var(--success, var(--success-prof, #00ba7c))' : 'var(--danger, var(--danger-prof, #f4212e))'}`,
              borderRadius: 6,
            }}
          >
            {`$ ${lastLog.command}\n${lastLog.ok ? lastLog.stdout || '(completed)' : lastLog.stderr || lastLog.stdout}`}
          </pre>
        ) : null}
        {error ? (
          <p
            style={{
              margin: '8px 0 0',
              color: 'var(--danger, var(--danger-prof, #f4212e))',
              fontSize: 13,
            }}
          >
            {error}
          </p>
        ) : null}
      </div>
    </div>
  )
}
