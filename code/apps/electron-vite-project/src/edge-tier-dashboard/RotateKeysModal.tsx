import { useState } from 'react'
import { LiveLogPanel } from '../edge-tier-wizard/LiveLogPanel.js'
import type { LogEvent } from '../edge-tier-wizard/types.js'
import { SshKeyEntryForm, type SshKeyEntryFormValues } from './SshKeyEntryForm.js'

export interface RotateKeysModalProps {
  replicaCount: number
  running?: boolean
  logEvents?: LogEvent[]
  error?: string | null
  partialFailure?: {
    failed_index: number
    total_replicas: number
    completed_replica_ids: string[]
  } | null
  onClose: () => void
  onSubmit: (values: SshKeyEntryFormValues) => void
}

export function RotateKeysModal({
  replicaCount,
  running,
  logEvents = [],
  error,
  partialFailure,
  onClose,
  onSubmit,
}: RotateKeysModalProps) {
  const [confirmed, setConfirmed] = useState(false)
  const [sshValues, setSshValues] = useState<SshKeyEntryFormValues>({
    sshUser: 'root',
    sshPort: '22',
    sshKey: '',
    passphrase: '',
  })

  const canSubmit =
    !running &&
    confirmed &&
    Boolean(sshValues.sshUser.trim()) &&
    Boolean(sshValues.sshKey.trim()) &&
    replicaCount > 0

  return (
    <div
      data-testid="rotate-keys-modal"
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15,23,42,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1150,
      }}
      onClick={running ? undefined : onClose}
    >
      <div
        style={{
          width: 'min(560px, 94vw)',
          maxHeight: '88vh',
          overflow: 'auto',
          background: 'var(--bg-primary, #fff)',
          borderRadius: 10,
          border: '1px solid var(--border)',
          padding: 20,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Rotate edge keys</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
          This redeploys every replica sequentially with a freshly minted keypair and SSO attestation.
          Expect several minutes for {replicaCount} replica{replicaCount === 1 ? '' : 's'}. Messages in
          flight may fail verification until rotation completes.
        </p>

        {partialFailure && (
          <div
            data-testid="rotate-partial-failure"
            style={{
              marginBottom: 12,
              padding: 10,
              borderRadius: 8,
              background: '#fef2f2',
              border: '1px solid #fecaca',
              fontSize: 12,
            }}
          >
            Rotation stopped on replica {partialFailure.failed_index + 1} of {partialFailure.total_replicas}.
            {partialFailure.completed_replica_ids.length > 0
              ? ` ${partialFailure.completed_replica_ids.length} replica(s) were rotated successfully — retry to continue.`
              : ' No replicas were rotated — fix the issue and retry.'}
          </div>
        )}

        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 16, fontSize: 12 }}>
          <input
            type="checkbox"
            data-testid="rotate-keys-confirm"
            checked={confirmed}
            disabled={running}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <span>I understand this will redeploy all replicas with new keys.</span>
        </label>

        <SshKeyEntryForm
          host={`${replicaCount} replica${replicaCount === 1 ? '' : 's'}`}
          values={sshValues}
          onChange={setSshValues}
          disabled={running}
        />

        {error && (
          <p data-testid="rotate-keys-error" style={{ color: '#ef4444', fontSize: 12 }}>
            {error}
          </p>
        )}

        <LiveLogPanel events={logEvents} />

        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} disabled={running}>
            Cancel
          </button>
          <button
            type="button"
            data-testid="rotate-keys-submit"
            disabled={!canSubmit}
            onClick={() => onSubmit(sshValues)}
            style={{
              padding: '8px 14px',
              borderRadius: 6,
              border: 'none',
              background: '#4f46e5',
              color: '#fff',
              opacity: canSubmit ? 1 : 0.5,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
            }}
          >
            {running ? 'Rotating…' : 'Rotate all keys'}
          </button>
        </div>
      </div>
    </div>
  )
}
