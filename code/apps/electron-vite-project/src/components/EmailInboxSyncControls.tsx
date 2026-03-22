/**
 * Shared sync controls for Bulk Inbox and standard Inbox — single source of truth (Bulk layout).
 * Order: sync window select → Auto checkbox → Pull / Sync button.
 */

import React from 'react'

export interface EmailInboxSyncControlsProps {
  accountSyncWindowDays: number
  onSyncWindowChange: (days: number) => void | Promise<void>
  primaryAccountId: string | null | undefined
  autoSyncEnabled: boolean
  onToggleAutoSync: (accountId: string, enabled: boolean) => void
  onUnifiedSync: () => void
  syncing: boolean
  remoteSyncBusy: boolean
  /** When every account is IMAP, the primary button is "Pull" and no remote reconcile runs. */
  pullOnly: boolean
}

/** Maps stored `0` (legacy all-mail) to the 1y option value used in the UI. */
export function emailInboxSyncWindowSelectValue(days: number): number {
  return days === 0 ? 365 : days
}

export default function EmailInboxSyncControls({
  accountSyncWindowDays,
  onSyncWindowChange,
  primaryAccountId,
  autoSyncEnabled,
  onToggleAutoSync,
  onUnifiedSync,
  syncing,
  remoteSyncBusy,
  pullOnly,
}: EmailInboxSyncControlsProps) {
  const patchOk = typeof window !== 'undefined' && !!window.emailInbox?.patchAccountSyncPreferences

  return (
    <>
      <select
        className="bulk-view-toolbar-sync-select"
        aria-label="Initial sync window"
        value={emailInboxSyncWindowSelectValue(accountSyncWindowDays)}
        onChange={(e) => {
          const v = parseInt(e.target.value, 10)
          if (!Number.isNaN(v)) void onSyncWindowChange(v)
        }}
        disabled={!primaryAccountId || !patchOk}
        title="How far back the first inbox pull reaches (expand and Sync for more history)"
      >
        <option value={7}>7d</option>
        <option value={30}>30d</option>
        <option value={90}>90d</option>
        <option value={365}>1y</option>
      </select>
      <label className="bulk-view-sync-label bulk-view-sync-label--compact" title="Auto-sync every few minutes">
        <input
          type="checkbox"
          checked={autoSyncEnabled}
          onChange={() => {
            if (primaryAccountId) onToggleAutoSync(primaryAccountId, !autoSyncEnabled)
          }}
        />
        Auto
      </label>
      <button
        type="button"
        className="bulk-view-pull-btn"
        onClick={() => void onUnifiedSync()}
        disabled={syncing || remoteSyncBusy || !primaryAccountId}
        title={
          pullOnly
            ? 'Fetch new mail from the server (IMAP: local classification only; no server folder moves)'
            : 'Pull new mail, then enqueue remote folder sync for Gmail / Microsoft 365 / Zoho'
        }
      >
        {syncing || remoteSyncBusy ? '↻ Syncing…' : pullOnly ? '↻ Pull' : '↻ Sync'}
      </button>
    </>
  )
}
