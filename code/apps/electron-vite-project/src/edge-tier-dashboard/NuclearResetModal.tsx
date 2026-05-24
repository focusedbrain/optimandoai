import { useMemo, useState } from 'react'
import { LiveLogPanel } from '../edge-tier-wizard/LiveLogPanel.js'
import type { LogEvent } from '../edge-tier-wizard/types.js'
import { SshKeyEntryForm, type SshKeyEntryFormValues } from './SshKeyEntryForm.js'
import type { ReplicaStatus } from './types.js'
import {
  canConfirmNuclearReset,
  NUCLEAR_RESET_CONFIRM_TOKEN,
} from './nuclearResetConfirm.js'

export interface NuclearResetModalProps {
  replica: ReplicaStatus
  running?: boolean
  logEvents?: LogEvent[]
  error?: string | null
  onClose: () => void
  onSubmit: (values: {
    ssh: SshKeyEntryFormValues
    hostConfirm: string
    resetConfirm: string
    reason: string
  }) => void
}

const WIPE_ITEMS = [
  'The pod and all its containers',
  'All quarantine entries on the VM',
  'All credential bundles on the VM (encrypted, but wiped)',
  'The edge signing keypair (new Ed25519, new attestation, new edge_pod_id)',
  'Edge-fetched email accounts will need re-authorization (cert chain changes)',
]

export function NuclearResetModal({
  replica,
  running,
  logEvents = [],
  error,
  onClose,
  onSubmit,
}: NuclearResetModalProps) {
  const [sshValues, setSshValues] = useState<SshKeyEntryFormValues>({
    sshUser: 'root',
    sshPort: '22',
    sshKey: '',
    passphrase: '',
  })
  const [hostConfirm, setHostConfirm] = useState('')
  const [resetConfirm, setResetConfirm] = useState('')
  const [reason, setReason] = useState('')

  const confirmed = canConfirmNuclearReset({
    hostConfirm,
    expectedHost: replica.host,
    resetConfirm,
    reason,
  })

  const canSubmit =
    !running &&
    Boolean(sshValues.sshUser.trim()) &&
    Boolean(sshValues.sshKey.trim()) &&
    confirmed

  const submitLabel = useMemo(() => (running ? 'Resetting…' : 'Nuclear reset'), [running])

  return (
    <div
      data-testid="nuclear-reset-modal"
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15,23,42,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1200,
      }}
      onClick={running ? undefined : onClose}
    >
      <div
        style={{
          width: 'min(580px, 94vw)',
          maxHeight: '88vh',
          overflow: 'auto',
          background: 'var(--bg-primary, #fff)',
          borderRadius: 10,
          border: '1px solid #fecaca',
          padding: 20,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 16, color: '#991b1b' }}>Nuclear reset</h2>
          <button type="button" onClick={onClose} disabled={running} aria-label="Close">
            ✕
          </button>
        </div>

        <p style={{ margin: '0 0 12px', color: 'var(--text-secondary)', fontSize: 13 }}>
          Wipe everything on <strong>{replica.host}</strong> and deploy a fresh edge pod. This cannot
          be undone.
        </p>

        <ul
          data-testid="nuclear-reset-wipe-list"
          style={{ margin: '0 0 16px', paddingLeft: 20, fontSize: 12, color: '#7f1d1d' }}
        >
          {WIPE_ITEMS.map((item) => (
            <li key={item} style={{ marginBottom: 4 }}>
              {item}
            </li>
          ))}
        </ul>

        <label style={{ display: 'block', marginBottom: 12, fontSize: 12 }}>
          Type <strong>{replica.host}</strong> to confirm
          <input
            data-testid="nuclear-reset-host-confirm"
            style={{
              display: 'block',
              width: '100%',
              marginTop: 4,
              padding: '8px 10px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              boxSizing: 'border-box',
            }}
            value={hostConfirm}
            disabled={running}
            onChange={(e) => setHostConfirm(e.target.value)}
            placeholder={replica.host}
          />
        </label>

        <label style={{ display: 'block', marginBottom: 12, fontSize: 12 }}>
          Type <strong>{NUCLEAR_RESET_CONFIRM_TOKEN}</strong> to confirm
          <input
            data-testid="nuclear-reset-token-confirm"
            style={{
              display: 'block',
              width: '100%',
              marginTop: 4,
              padding: '8px 10px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              boxSizing: 'border-box',
            }}
            value={resetConfirm}
            disabled={running}
            onChange={(e) => setResetConfirm(e.target.value)}
            placeholder={NUCLEAR_RESET_CONFIRM_TOKEN}
          />
        </label>

        <label style={{ display: 'block', marginBottom: 12, fontSize: 12 }}>
          Reason for reset (required)
          <textarea
            data-testid="nuclear-reset-reason"
            style={{
              display: 'block',
              width: '100%',
              marginTop: 4,
              padding: '8px 10px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              boxSizing: 'border-box',
              minHeight: 72,
              resize: 'vertical',
            }}
            value={reason}
            disabled={running}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why are you resetting this replica?"
          />
        </label>

        <SshKeyEntryForm host={replica.host} values={sshValues} onChange={setSshValues} disabled={running} />

        {error && (
          <p data-testid="nuclear-reset-error" style={{ color: '#ef4444', fontSize: 12 }}>
            {error}
          </p>
        )}

        <LiveLogPanel
          events={logEvents}
          emptyMessage={running ? 'Waiting for output…' : 'Output appears here when reset runs.'}
        />

        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} disabled={running}>
            Cancel
          </button>
          <button
            type="button"
            data-testid="nuclear-reset-submit"
            disabled={!canSubmit}
            onClick={() =>
              onSubmit({
                ssh: sshValues,
                hostConfirm,
                resetConfirm,
                reason,
              })
            }
            style={{
              padding: '8px 14px',
              borderRadius: 6,
              border: 'none',
              background: '#dc2626',
              color: '#fff',
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              opacity: canSubmit ? 1 : 0.5,
            }}
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
