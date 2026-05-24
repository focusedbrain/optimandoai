import React, { useState } from 'react'
import { SshKeyEntryForm, type SshKeyEntryFormValues } from '../../edge-tier-dashboard/SshKeyEntryForm.js'
import { EDGE_FETCH_MOVE_BACK_WARNING } from './edgeFetchCopy.js'

export interface EdgeFetchMoveBackDialogProps {
  open: boolean
  accountEmail: string
  replicaHost: string
  replicaId: string
  onCancel: () => void
  onConfirm: (values: SshKeyEntryFormValues & { replicaId: string }) => void
  busy?: boolean
}

export function EdgeFetchMoveBackDialog({
  open,
  accountEmail,
  replicaHost,
  replicaId,
  onCancel,
  onConfirm,
  busy,
}: EdgeFetchMoveBackDialogProps) {
  const [sshValues, setSshValues] = useState<SshKeyEntryFormValues>({
    sshUser: 'root',
    sshPort: '22',
    sshKey: '',
    passphrase: '',
  })

  if (!open) return null

  return (
    <div
      className="edge-fetch-modal-backdrop"
      data-testid="edge-fetch-move-back-dialog"
      role="dialog"
      aria-modal="true"
    >
      <div className="edge-fetch-modal">
        <h3>Move {accountEmail} back to this computer</h3>
        <p className="edge-fetch-modal-warning">{EDGE_FETCH_MOVE_BACK_WARNING}</p>
        <SshKeyEntryForm host={replicaHost} values={sshValues} onChange={setSshValues} disabled={busy} />
        <div className="edge-fetch-modal-actions">
          <button type="button" data-testid="edge-fetch-move-back-cancel" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            data-testid="edge-fetch-move-back-confirm"
            disabled={!sshValues.sshKey.trim() || busy}
            onClick={() => onConfirm({ ...sshValues, replicaId })}
          >
            {busy ? 'Moving back…' : 'Move back to this computer'}
          </button>
        </div>
      </div>
    </div>
  )
}
