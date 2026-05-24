import React from 'react'
import type { EdgeFetchAccountSnapshot, EdgeFetchUiState } from './edgeFetchCopy.js'
import { edgeFetchStateLabel } from './edgeFetchCopy.js'

export interface EmailAccountEdgeFetchRowProps {
  accountId: string
  provider: 'gmail' | 'microsoft365' | 'zoho' | 'imap'
  snapshot: EdgeFetchAccountSnapshot | null
  canMigrate: boolean
  migrateDisabledReason?: string
  onMoveToEdge?: () => void
  onMoveBack?: () => void
  onReauthorize?: () => void
  onViewStatus?: () => void
  busy?: boolean
}

function isSpinnerState(state: EdgeFetchUiState): boolean {
  return state === 'awaiting_key' || state === 'migrating' || state === 'migrating_back'
}

export function EmailAccountEdgeFetchRow({
  accountId,
  provider,
  snapshot,
  canMigrate,
  migrateDisabledReason,
  onMoveToEdge,
  onMoveBack,
  onReauthorize,
  onViewStatus,
  busy,
}: EmailAccountEdgeFetchRowProps) {
  const state: EdgeFetchUiState = snapshot?.state ?? 'not_on_edge'
  const label = edgeFetchStateLabel(state)
  const oauthCapable = provider === 'gmail' || provider === 'microsoft365'

  return (
    <div className="edge-fetch-row" data-testid={`edge-fetch-row-${accountId}`} data-state={state}>
      <div className="edge-fetch-row-meta">
        <span className="edge-fetch-row-label">Fetched by</span>
        <strong data-testid="edge-fetch-fetched-by">{label.fetchedBy}</strong>
        {label.progress ? (
          <span className="edge-fetch-row-progress" data-testid="edge-fetch-progress">
            {isSpinnerState(state) ? '⏳ ' : ''}
            {label.progress}
          </span>
        ) : null}
        {label.detail ? <span className="edge-fetch-row-detail">{label.detail}</span> : null}
        {snapshot?.lastError ? (
          <span className="edge-fetch-row-error" data-testid="edge-fetch-last-error">
            {snapshot.lastError}
          </span>
        ) : null}
      </div>

      <div className="edge-fetch-row-actions">
        {state === 'not_on_edge' && oauthCapable ? (
          <span title={!canMigrate ? migrateDisabledReason : undefined}>
            <button
              type="button"
              data-testid="edge-fetch-move-to-edge"
              disabled={!canMigrate || busy}
              onClick={onMoveToEdge}
            >
              Move to edge
            </button>
          </span>
        ) : null}

        {state === 'active' ? (
          <>
            <button type="button" data-testid="edge-fetch-view-status" disabled={busy} onClick={onViewStatus}>
              View status
            </button>
            <button type="button" data-testid="edge-fetch-move-back" disabled={busy} onClick={onMoveBack}>
              Move back to this computer
            </button>
          </>
        ) : null}

        {state === 'degraded' ? (
          <button
            type="button"
            className="edge-fetch-btn-highlight"
            data-testid="edge-fetch-reauthorize"
            disabled={busy}
            onClick={onReauthorize}
          >
            Re-authorize
          </button>
        ) : null}

        {isSpinnerState(state) ? (
          <span className="edge-fetch-row-spinner" data-testid="edge-fetch-spinner">
            ⏳ {label.progress ?? 'Working…'}
          </span>
        ) : null}
      </div>
    </div>
  )
}
