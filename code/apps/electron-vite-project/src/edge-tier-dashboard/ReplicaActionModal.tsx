import { useMemo, useState } from 'react'
import { LiveLogPanel } from '../edge-tier-wizard/LiveLogPanel.js'
import type { LogEvent } from '../edge-tier-wizard/types.js'
import { SshKeyEntryForm, type SshKeyEntryFormValues } from './SshKeyEntryForm.js'
import type { ReplicaStatus } from './types.js'
import {
  canConfirmDestructiveReplicaAction,
  replicaActionDescription,
  replicaActionRequiresHostConfirm,
  replicaActionTitle,
  type ReplicaActionKind,
} from './replicaActions.js'

export interface ReplicaActionModalProps {
  replica: ReplicaStatus
  action: ReplicaActionKind
  running?: boolean
  logEvents?: LogEvent[]
  error?: string | null
  onClose: () => void
  onSubmit: (values: SshKeyEntryFormValues) => void
}

export function ReplicaActionModal({
  replica,
  action,
  running,
  logEvents = [],
  error,
  onClose,
  onSubmit,
}: ReplicaActionModalProps) {
  const [sshValues, setSshValues] = useState<SshKeyEntryFormValues>({
    sshUser: 'root',
    sshPort: '22',
    sshKey: '',
    passphrase: '',
  })
  const [hostConfirm, setHostConfirm] = useState('')

  const needsHostConfirm = replicaActionRequiresHostConfirm(action)
  const hostConfirmed = !needsHostConfirm || canConfirmDestructiveReplicaAction(hostConfirm, replica.host)
  const canSubmit =
    !running &&
    Boolean(sshValues.sshUser.trim()) &&
    Boolean(sshValues.sshKey.trim()) &&
    hostConfirmed

  const submitLabel = useMemo(() => {
    if (running) return 'Running…'
    switch (action) {
      case 'restart':
        return 'Restart'
      case 'redeploy':
        return 'Redeploy'
      case 'remove':
        return 'Remove'
    }
  }, [action, running])

  return (
    <div
      data-testid="replica-action-modal"
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15,23,42,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1100,
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
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>{replicaActionTitle(action)}</h2>
          <button type="button" onClick={onClose} disabled={running} aria-label="Close">
            ✕
          </button>
        </div>

        <p style={{ margin: '0 0 16px', color: 'var(--text-secondary)', fontSize: 13 }}>
          {replicaActionDescription(action, replica.host)}
        </p>

        {needsHostConfirm && (
          <label style={{ display: 'block', marginBottom: 12, fontSize: 12 }}>
            Type <strong>{replica.host}</strong> to confirm
            <input
              data-testid="replica-action-host-confirm"
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
        )}

        <SshKeyEntryForm host={replica.host} values={sshValues} onChange={setSshValues} disabled={running} />

        {error && (
          <p data-testid="replica-action-error" style={{ color: '#ef4444', fontSize: 12 }}>
            {error}
          </p>
        )}

        <LiveLogPanel events={logEvents} emptyMessage={running ? 'Waiting for output…' : 'Output appears here when the action runs.'} />

        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} disabled={running}>
            Cancel
          </button>
          <button
            type="button"
            data-testid="replica-action-submit"
            disabled={!canSubmit}
            onClick={() => onSubmit(sshValues)}
            style={{
              padding: '8px 14px',
              borderRadius: 6,
              border: 'none',
              background: action === 'remove' ? '#dc2626' : '#4f46e5',
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
