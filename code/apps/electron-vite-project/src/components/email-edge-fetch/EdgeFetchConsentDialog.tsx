import React, { useMemo, useState } from 'react'
import { SshKeyEntryForm, type SshKeyEntryFormValues } from '../../edge-tier-dashboard/SshKeyEntryForm.js'
import { EDGE_FETCH_CONSENT_ITEMS } from './edgeFetchCopy.js'

export interface EdgeFetchConsentDialogProps {
  open: boolean
  accountEmail: string
  replicaHost: string
  onCancel: () => void
  onConfirm: (values: SshKeyEntryFormValues & { replicaId: string }) => void
  busy?: boolean
  replicaId: string
  mode?: 'migrate' | 'reauthorize'
}

export function EdgeFetchConsentDialog({
  open,
  accountEmail,
  replicaHost,
  onCancel,
  onConfirm,
  busy,
  replicaId,
  mode = 'migrate',
}: EdgeFetchConsentDialogProps) {
  const [checks, setChecks] = useState<boolean[]>(() => EDGE_FETCH_CONSENT_ITEMS.map(() => false))
  const [sshValues, setSshValues] = useState<SshKeyEntryFormValues>({
    sshUser: 'root',
    sshPort: '22',
    sshKey: '',
    passphrase: '',
  })

  const allChecked = useMemo(() => checks.every(Boolean), [checks])

  if (!open) return null

  return (
    <div
      className="edge-fetch-modal-backdrop"
      data-testid="edge-fetch-consent-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edge-fetch-consent-title"
    >
      <div className="edge-fetch-modal">
        <h3 id="edge-fetch-consent-title">
          {mode === 'reauthorize' ? `Re-authorize ${accountEmail} on edge` : `Move ${accountEmail} to edge fetch`}
        </h3>
        {mode === 'migrate' ? (
          <p className="edge-fetch-modal-lead">
            Email for this account will be fetched on your REMOTE_EDGE VM and ingested through the BEAP pod.
          </p>
        ) : (
          <p className="edge-fetch-modal-lead">
            Provider credentials on the edge need a fresh OAuth sign-in. Your desktop will open the browser for
            re-consent, then transfer updated credentials to the mail-fetcher.
          </p>
        )}

        {mode === 'migrate' ? (
        <div className="edge-fetch-consent-list">
          {EDGE_FETCH_CONSENT_ITEMS.map((text, i) => (
            <label key={text} className="edge-fetch-consent-item">
              <input
                type="checkbox"
                data-testid={`edge-fetch-consent-check-${i}`}
                checked={checks[i]}
                disabled={busy}
                onChange={(e) => {
                  const next = [...checks]
                  next[i] = e.target.checked
                  setChecks(next)
                }}
              />
              <span>{text}</span>
            </label>
          ))}
        </div>
        ) : null}

        <SshKeyEntryForm host={replicaHost} values={sshValues} onChange={setSshValues} disabled={busy} />

        <div className="edge-fetch-modal-actions">
          <button type="button" data-testid="edge-fetch-consent-cancel" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            data-testid="edge-fetch-consent-confirm"
            disabled={(mode === 'migrate' && !allChecked) || !sshValues.sshKey.trim() || busy}
            onClick={() => onConfirm({ ...sshValues, replicaId })}
          >
            {busy
              ? mode === 'reauthorize'
                ? 'Re-authorizing…'
                : 'Migrating…'
              : mode === 'reauthorize'
                ? 'Re-authorize'
                : 'Move to edge'}
          </button>
        </div>
      </div>
    </div>
  )
}
