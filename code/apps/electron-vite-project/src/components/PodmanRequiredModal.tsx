/**
 * Blocking gate — BEAP receive requires Podman (no dismiss-and-continue).
 */

import { useCallback, useEffect, useState } from 'react'

import { wizardOverlayStyle, wizardCardStyle, btnPrimary, btnSecondary } from '../edge-tier-wizard/styles.js'

export interface PodmanSetupStatus {
  required: boolean
  probePending: boolean
  code: string | null
  userMessage: string | null
  platform: string
  install: {
    canAutoInstall: boolean
    installAction: string | null
    installLabel: string
    installCommand: string | null
    manualHint: string
    linuxDistroHints?: Array<{ id: string; label: string; commands: readonly string[] }>
  }
  showMachineSteps: boolean
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
  install: {
    canAutoInstall: false,
    installAction: null,
    installLabel: '',
    installCommand: null,
    manualHint: '',
    linuxDistroHints: [],
  },
  showMachineSteps: false,
  machineInitCommand: 'podman machine init',
  machineStartCommand: 'podman machine start',
}

export function PodmanRequiredModal(): JSX.Element | null {
  const api = typeof window !== 'undefined' ? window.podmanSetup : undefined
  const [status, setStatus] = useState<PodmanSetupStatus>(DEFAULT_STATUS)
  const [busy, setBusy] = useState(false)
  const [lastLog, setLastLog] = useState<CommandLog | null>(null)
  const [error, setError] = useState<string | null>(null)

  const applyStatus = useCallback((res: Record<string, unknown>) => {
    setStatus({
      required: Boolean(res.required),
      probePending: Boolean(res.probePending),
      code: typeof res.code === 'string' ? res.code : null,
      userMessage: typeof res.userMessage === 'string' ? res.userMessage : null,
      platform: typeof res.platform === 'string' ? res.platform : 'win32',
      install: (res.install as PodmanSetupStatus['install']) ?? DEFAULT_STATUS.install,
      showMachineSteps: Boolean(res.showMachineSteps),
      machineInitCommand:
        typeof res.machineInitCommand === 'string' ? res.machineInitCommand : 'podman machine init',
      machineStartCommand:
        typeof res.machineStartCommand === 'string' ? res.machineStartCommand : 'podman machine start',
    })
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
      setStatus((prev) => ({
        ...prev,
        required: payload.required,
        code: payload.code,
        userMessage: payload.userMessage,
        platform: payload.platform,
      }))
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

  const title = status.probePending
    ? 'Checking Podman — BEAP is blocked until verified'
    : 'Podman required — BEAP cannot run without isolation'
  const code = status.code
  const linuxHints = status.install.linuxDistroHints ?? []

  return (
    <div
      style={wizardOverlayStyle}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="podman-required-title"
      data-testid="podman-required-modal"
    >
      <div style={{ ...wizardCardStyle, maxWidth: 560 }}>
        <h2
          id="podman-required-title"
          style={{ margin: '0 0 12px', fontSize: 18, color: 'var(--text-primary, #f8fafc)' }}
        >
          {title}
        </h2>
        <p style={{ margin: '0 0 12px', color: 'var(--text-secondary, #cbd5e1)' }}>
          BEAP security isolation depends on <strong>Podman</strong>. The orchestrator cannot start relay
          receive, coordination WebSocket, or local capsule handling until Podman is installed and its virtual
          machine is running (Windows/macOS). Untrusted capsules are never processed in the main app process.
        </p>
        <p style={{ margin: '0 0 16px', color: 'var(--text-secondary, #94a3b8)', fontSize: 12 }}>
          There is no continue-without-Podman mode. Podman is not bundled (license). Install once, then use
          Check again after setup.
        </p>
        {status.probePending ? (
          <p
            style={{
              margin: '0 0 16px',
              padding: 10,
              background: 'var(--bg-elevated, #1e293b)',
              borderRadius: 6,
              color: 'var(--text-primary, #e2e8f0)',
              fontSize: 12,
            }}
          >
            {status.userMessage ?? 'Checking Podman installation…'}
          </p>
        ) : status.userMessage ? (
          <p
            style={{
              margin: '0 0 16px',
              padding: 10,
              background: 'var(--bg-elevated, #1e293b)',
              borderRadius: 6,
              color: 'var(--text-primary, #e2e8f0)',
              fontSize: 12,
            }}
          >
            {status.userMessage}
          </p>
        ) : null}

        {!status.probePending && status.install.canAutoInstall && status.install.installAction ? (
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
                  marginTop: 8,
                  fontSize: 11,
                  color: 'var(--text-secondary, #94a3b8)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}
              >
                {status.install.installCommand}
              </pre>
            ) : null}
            <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--text-secondary, #64748b)' }}>
              {status.install.manualHint}
            </p>
          </div>
        ) : !status.probePending ? (
          <div style={{ marginBottom: 16 }}>
            <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--text-secondary, #94a3b8)' }}>
              {status.install.manualHint}
            </p>
            {linuxHints.length > 0 ? (
              <ul
                style={{
                  margin: 0,
                  paddingLeft: 18,
                  fontSize: 12,
                  color: 'var(--text-primary, #e2e8f0)',
                }}
              >
                {linuxHints.map((hint) => (
                  <li key={hint.id} style={{ marginBottom: 8 }}>
                    <strong>{hint.label}</strong>
                    <pre
                      style={{
                        margin: '4px 0 0',
                        fontSize: 11,
                        color: 'var(--text-secondary, #94a3b8)',
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
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary, #cbd5e1)' }}>
              {code === 'machine_not_initialized'
                ? 'After Podman is installed, create and start the virtual machine:'
                : 'Start the Podman virtual machine:'}
            </p>
            {code === 'machine_not_initialized' ? (
              <button
                type="button"
                style={{ ...btnSecondary, opacity: busy ? 0.6 : 1 }}
                disabled={busy}
                onClick={() => void runAction('machine_init')}
              >
                Run: {status.machineInitCommand}
              </button>
            ) : null}
            <button
              type="button"
              style={{ ...btnSecondary, opacity: busy ? 0.6 : 1 }}
              disabled={busy}
              onClick={() => void runAction('machine_start')}
            >
              Run: {status.machineStartCommand}
            </button>
          </div>
        ) : null}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          <button
            type="button"
            style={btnSecondary}
            disabled={busy || status.probePending}
            onClick={() => void api?.openManualInstall?.()}
          >
            Open podman.io install guide
          </button>
          <button type="button" style={btnPrimary} disabled={busy} onClick={() => void refresh()}>
            {status.probePending ? 'Checking…' : 'Check again'}
          </button>
        </div>

        {lastLog ? (
          <pre
            style={{
              margin: 0,
              maxHeight: 120,
              overflow: 'auto',
              fontSize: 10,
              padding: 8,
              background: 'var(--bg-surface, #020617)',
              borderRadius: 4,
              color: lastLog.ok ? '#86efac' : '#fca5a5',
            }}
          >
            {`$ ${lastLog.command}\n${lastLog.ok ? lastLog.stdout : lastLog.stderr || lastLog.stdout}`}
          </pre>
        ) : null}
        {error ? (
          <p style={{ margin: '8px 0 0', color: '#f87171', fontSize: 12 }}>{error}</p>
        ) : null}
      </div>
    </div>
  )
}
