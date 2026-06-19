/**
 * Shared sync controls for Bulk Inbox and standard Inbox — single source of truth (Bulk layout).
 * Order: sync window select → Auto checkbox → Pull / Sync button.
 */

import React from 'react'
import { DEDICATED_SANDBOX_HOST_TRIGGERED_STATUS } from '../lib/dedicatedSandboxIngestionUi'

export interface EmailInboxSyncControlsProps {
  accountSyncWindowDays: number
  onSyncWindowChange: (days: number) => void | Promise<void>
  primaryAccountId: string | null | undefined
  /** Active (or fallback) account rows that participate in Pull / Auto-sync. */
  autoSyncEligibleAccountIds: string[]
  autoSyncEnabled: boolean
  /** When true, enables background pull for every id in `autoSyncEligibleAccountIds`. */
  onToggleAutoSync: (enabled: boolean) => void
  onUnifiedSync: () => void
  syncing: boolean
  remoteSyncBusy: boolean
  /** When every account is IMAP, the primary button is "Pull" and no remote reconcile runs. */
  pullOnly: boolean
  /**
   * Dedicated sandbox (PROMPT 3): hide local Sync / Auto / toolbar sync window;
   * show read-only host-triggered status instead.
   */
  hostTriggeredIngestion?: boolean
  /**
   * Sandbox orchestrator (read-only ingestion). Hides remote folder-sync affordances;
   * pull is local fetch only — Smart Sync runs on the host device.
   */
  readOnlyIngestionNode?: boolean
}

/** Maps stored `0` (legacy all-mail) to the 1y option value used in the UI. */
export function emailInboxSyncWindowSelectValue(days: number): number {
  return days === 0 ? 365 : days
}

export default function EmailInboxSyncControls({
  accountSyncWindowDays,
  onSyncWindowChange,
  primaryAccountId,
  autoSyncEligibleAccountIds,
  autoSyncEnabled,
  onToggleAutoSync,
  onUnifiedSync,
  syncing,
  remoteSyncBusy,
  pullOnly,
  hostTriggeredIngestion = false,
  readOnlyIngestionNode = false,
}: EmailInboxSyncControlsProps) {
  const patchOk = typeof window !== 'undefined' && !!window.emailInbox?.patchAccountSyncPreferences

  const syncButtonTitle = readOnlyIngestionNode
    ? 'Fetch new mail on this device (read-only — does not move folders on your provider; Smart Sync runs on your host device)'
    : pullOnly
      ? 'Fetch new mail from the server (IMAP: local classification only; no server folder moves)'
      : 'Pull new mail on this host device, then mirror lifecycle folders to Gmail / Microsoft 365 / Zoho when Smart Sync applies'

  const syncButtonLabel =
    syncing || remoteSyncBusy ? '↻ Syncing…' : readOnlyIngestionNode || pullOnly ? '↻ Pull' : '↻ Sync'

  if (hostTriggeredIngestion) {
    return (
      <span
        className="bulk-view-host-triggered-sync-status"
        role="status"
        title={DEDICATED_SANDBOX_HOST_TRIGGERED_STATUS}
        style={{
          fontSize: 11,
          lineHeight: 1.45,
          color: 'var(--text-secondary, var(--text-secondary-prof, #64748b))',
        }}
      >
        {DEDICATED_SANDBOX_HOST_TRIGGERED_STATUS}
      </span>
    )
  }

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
      <label className="bulk-view-sync-label bulk-view-sync-label--compact" title="Auto-sync every few minutes (all connected accounts)">
        <input
          type="checkbox"
          checked={autoSyncEnabled}
          disabled={autoSyncEligibleAccountIds.length === 0}
          onChange={() => {
            if (autoSyncEligibleAccountIds.length > 0) onToggleAutoSync(!autoSyncEnabled)
          }}
        />
        Auto
      </label>
      <button
        type="button"
        className="bulk-view-pull-btn"
        onClick={() => void onUnifiedSync()}
        disabled={syncing || remoteSyncBusy || !primaryAccountId}
        title={syncButtonTitle}
      >
        {syncButtonLabel}
      </button>
    </>
  )
}
