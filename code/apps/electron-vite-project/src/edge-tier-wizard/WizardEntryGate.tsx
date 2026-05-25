/**
 * Wizard entry guard — resume / start-over / add-replica when edge is already partially configured.
 */

import type { CSSProperties, ReactNode } from 'react'
import type { EdgeConfigurationState } from '../edge-tier/configurationState.js'
import { btnDanger, btnPrimary, btnSecondary } from './styles.js'

export interface WizardEntryGateProps {
  configurationState: EdgeConfigurationState
  primaryHost: string | null
  confirmStartOver: boolean
  confirmReconfigure: boolean
  busy: boolean
  onResumeSetup: () => void
  onStartOverRequest: () => void
  onStartOverConfirm: () => void
  onStartOverCancel: () => void
  onAddReplica: () => void
  onReconfigureRequest: () => void
  onReconfigureConfirm: () => void
  onReconfigureCancel: () => void
  onCancel: () => void
}

export function WizardEntryGate({
  configurationState,
  primaryHost,
  confirmStartOver,
  confirmReconfigure,
  busy,
  onResumeSetup,
  onStartOverRequest,
  onStartOverConfirm,
  onStartOverCancel,
  onAddReplica,
  onReconfigureRequest,
  onReconfigureConfirm,
  onReconfigureCancel,
  onCancel,
}: WizardEntryGateProps) {
  const hostLabel = primaryHost ?? 'your server'

  if (confirmStartOver) {
    return (
      <ConfirmPanel
        testId="wizard-entry-start-over-confirm"
        title="Start over?"
        body={`This will remove the edge ingestor configuration for ${hostLabel} from this app and clear its keys. The remote pod may still be running on the VPS if it cannot be reached.`}
        confirmLabel="Start over"
        busy={busy}
        onConfirm={onStartOverConfirm}
        onCancel={onStartOverCancel}
      />
    )
  }

  if (confirmReconfigure) {
    return (
      <ConfirmPanel
        testId="wizard-entry-reconfigure-confirm"
        title="Reconfigure edge ingestor?"
        body={`This will tear down the existing replica on ${hostLabel} and remove its keys from this app. You will need to re-enter SSH credentials to deploy again.`}
        confirmLabel="Reconfigure"
        busy={busy}
        onConfirm={onReconfigureConfirm}
        onCancel={onReconfigureCancel}
      />
    )
  }

  if (configurationState === 'setup_in_progress') {
    return (
      <EntryPanel testId="wizard-entry-setup-in-progress">
        <p style={bodyStyle}>
          You have a setup in progress on <strong>{hostLabel}</strong>.
        </p>
        <div style={actionsStyle}>
          <button type="button" style={btnPrimary} disabled={busy} onClick={onResumeSetup}>
            Resume setup
          </button>
          <button type="button" style={btnDanger} disabled={busy} onClick={onStartOverRequest}>
            Start over
          </button>
          <button type="button" style={btnSecondary} disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </EntryPanel>
    )
  }

  if (configurationState === 'configured_active' || configurationState === 'configured_unreachable') {
    return (
      <EntryPanel testId="wizard-entry-configured">
        <p style={bodyStyle}>Edge ingestor is already configured.</p>
        <div style={actionsStyle}>
          <button type="button" style={btnPrimary} disabled={busy} onClick={onAddReplica}>
            Add another replica
          </button>
          <button type="button" style={btnSecondary} disabled={busy} onClick={onReconfigureRequest}>
            Reconfigure
          </button>
          <button type="button" style={btnSecondary} disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </EntryPanel>
    )
  }

  return null
}

function EntryPanel({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <div data-testid={testId} style={{ padding: '8px 0' }}>
      {children}
    </div>
  )
}

function ConfirmPanel({
  testId,
  title,
  body,
  confirmLabel,
  busy,
  onConfirm,
  onCancel,
}: {
  testId: string
  title: string
  body: string
  confirmLabel: string
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div data-testid={testId} style={{ padding: '8px 0' }}>
      <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>{title}</h2>
      <p style={bodyStyle}>{body}</p>
      <div style={actionsStyle}>
        <button type="button" style={btnDanger} disabled={busy} onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button type="button" style={btnSecondary} disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

const bodyStyle: CSSProperties = {
  margin: '0 0 16px',
  color: '#cbd5e1',
  fontSize: 13,
  lineHeight: 1.5,
}

const actionsStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
}
