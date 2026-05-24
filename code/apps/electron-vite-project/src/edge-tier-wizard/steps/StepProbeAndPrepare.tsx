/**
 * Step 3 — Probe target and optional Podman install.
 */

import { LiveLogPanel } from '../LiveLogPanel.js'
import type { LogEvent } from '../types.js'
import { btnPrimary, btnSecondary } from '../styles.js'
import { StepErrorActions, StepLoading } from './StepCommon.js'

export interface StepProbeAndPrepareProps {
  loading: boolean
  probing: boolean
  installing: boolean
  error: string | null
  probe: Record<string, unknown> | null
  podmanReady: boolean
  installLogs: LogEvent[]
  onRunProbe: () => void
  onInstallPodman: () => void
  onContinue: () => void
  onCancelWizard: () => void
}

export function StepProbeAndPrepare({
  loading,
  probing,
  installing,
  error,
  probe,
  podmanReady,
  installLogs,
  onRunProbe,
  onInstallPodman,
  onContinue,
  onCancelWizard,
}: StepProbeAndPrepareProps) {
  const verdict = probe?.verdict as { ok?: boolean; message?: string } | undefined
  const needsInstall = probe && verdict?.ok && !probe.podman_installed && !podmanReady

  return (
    <div data-testid="wizard-step-probe">
      <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>Probe &amp; prepare host</h2>
      <p style={{ color: '#94a3b8', marginTop: 0 }}>
        We check the distro, sudo access, and whether Podman is installed on your VM.
      </p>
      <StepErrorActions
        error={error}
        onRetry={onRunProbe}
        onCancelWizard={onCancelWizard}
      />
      {probing && <StepLoading message="Running SSH probe…" />}
      {probe && (
        <div
          data-testid="wizard-probe-results"
          style={{
            padding: 10,
            borderRadius: 6,
            border: '1px solid #334155',
            marginBottom: 12,
            fontSize: 12,
          }}
        >
          <div>
            <strong>{String(probe.distro)}</strong> {String(probe.version)} ({String(probe.family)})
          </div>
          <div>Podman: {probe.podman_installed ? 'installed' : 'not installed'}</div>
          <div>Sudo: {probe.has_passwordless_sudo ? 'passwordless OK' : probe.is_root ? 'root' : 'needs sudo'}</div>
          {!verdict?.ok && (
            <div style={{ color: '#f87171', marginTop: 6 }}>{verdict?.message ?? 'Probe failed'}</div>
          )}
        </div>
      )}
      {needsInstall && !installing && (
        <div style={{ marginBottom: 12 }}>
          <p style={{ color: '#cbd5e1' }}>
            Podman is not installed on this VM. Install it using the native package manager?
          </p>
          <button type="button" style={btnPrimary} onClick={onInstallPodman}>
            Install Podman
          </button>
        </div>
      )}
      {installing && (
        <>
          <StepLoading message="Installing Podman…" />
          <LiveLogPanel events={installLogs} />
        </>
      )}
      {(podmanReady || (probe?.podman_installed && verdict?.ok)) && !installing && (
        <button
          type="button"
          style={btnPrimary}
          disabled={loading}
          data-testid="wizard-probe-continue"
          onClick={onContinue}
        >
          Continue
        </button>
      )}
      {!probe && !probing && (
        <button type="button" style={btnSecondary} onClick={onRunProbe}>
          Run probe
        </button>
      )}
    </div>
  )
}
