import React from 'react'
import type { EdgeFetchAccountSnapshot } from './edgeFetchCopy.js'
import { edgeFetchStateLabel } from './edgeFetchCopy.js'

export interface EdgeFetchStatusDialogProps {
  open: boolean
  snapshot: EdgeFetchAccountSnapshot | null
  onClose: () => void
}

export function EdgeFetchStatusDialog({ open, snapshot, onClose }: EdgeFetchStatusDialogProps) {
  if (!open || !snapshot) return null
  const label = edgeFetchStateLabel(snapshot.state)

  return (
    <div className="edge-fetch-modal-backdrop" data-testid="edge-fetch-status-dialog" role="dialog" aria-modal="true">
      <div className="edge-fetch-modal edge-fetch-modal--compact">
        <h3>Edge fetch status — {snapshot.email}</h3>
        <dl className="edge-fetch-status-dl">
          <div>
            <dt>Fetched by</dt>
            <dd data-testid="edge-fetch-status-fetched-by">{label.fetchedBy}</dd>
          </div>
          <div>
            <dt>State</dt>
            <dd data-testid="edge-fetch-status-state">{snapshot.state}</dd>
          </div>
          {snapshot.remoteState ? (
            <div>
              <dt>Remote supervisor</dt>
              <dd>{snapshot.remoteState}</dd>
            </div>
          ) : null}
          {snapshot.replicaId ? (
            <div>
              <dt>Replica</dt>
              <dd>{snapshot.replicaId}</dd>
            </div>
          ) : null}
          {snapshot.lastError ? (
            <div>
              <dt>Last error</dt>
              <dd data-testid="edge-fetch-status-error">{snapshot.lastError}</dd>
            </div>
          ) : null}
        </dl>
        <div className="edge-fetch-modal-actions">
          <button type="button" data-testid="edge-fetch-status-close" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
