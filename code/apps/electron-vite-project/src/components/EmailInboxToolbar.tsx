/**
 * EmailInboxToolbar — Workflow filter tabs (with counts), sync controls (shared with Bulk Inbox), bulk row actions when items selected.
 */

import React from 'react'
import type { InboxFilter, InboxTabCounts } from '../stores/useEmailInboxStore'
import type { InboxMessageKindFilter } from '../lib/inboxMessageKind'
import { pickDefaultEmailAccountRowId } from '@ext/shared/email/pickDefaultAccountRow'
import EmailInboxSyncControls from './EmailInboxSyncControls'
import { InboxMessageKindSelect } from './InboxMessageKindSelect'
import InboxBulkActionsBar from './InboxBulkActionsBar'

// ── Types ──

export interface EmailInboxToolbarProps {
  filter: InboxFilter
  onFilterChange: (partial: Partial<InboxFilter>) => void
  tabCounts: InboxTabCounts
  messageKind: InboxMessageKindFilter
  onMessageKindChange: (kind: InboxMessageKindFilter) => void
  accounts: Array<{ id: string; email: string }>
  autoSyncEnabled: boolean
  syncing: boolean
  remoteSyncBusy: boolean
  /** Same behavior as Bulk Inbox: pull then optional remote reconcile. */
  onUnifiedSync: () => void
  /** Current sync window in days (0 = all mail in DB). */
  accountSyncWindowDays?: number
  onSyncWindowChange: (days: number) => void | Promise<void>
  autoSyncEligibleAccountIds: string[]
  onToggleAutoSync: (enabled: boolean) => void
  /** When every account is IMAP, primary button shows Pull (matches Bulk). */
  pullOnly: boolean
  /** Dedicated sandbox: host-triggered ingestion — hide local pull controls. */
  hostTriggeredIngestion?: boolean
  /** Sandbox orchestrator — read-only pull; no remote folder-sync affordances. */
  readOnlyIngestionNode?: boolean
  /**
   * Sandbox delete-only inbox: hide workflow filter tabs and non-delete bulk actions
   * (Archive, Pending Review, Categorize). Select + Remove remain.
   */
  deleteOnlyBulkActions?: boolean
  bulkMode: boolean
  onBulkModeChange: (enabled: boolean) => void
  selectedCount: number
  onBulkDelete: () => void
  onBulkArchive: () => void
  onBulkMoveToPendingReview?: () => void
  onBulkCategorize?: () => void
  /** Open a new email compose form. Shown on the sync row (host only). */
  onEmailCompose?: () => void
  /** Open the BEAP capsule composer. Shown on the sync row (host only). */
  onBeapCompose?: () => void
}

// ── Filter tabs (aligned with Bulk Inbox workflow buckets) ──

const FILTER_TABS = ['all', 'urgent', 'pending_delete', 'pending_review', 'archived'] as const
const FILTER_LABELS: Record<(typeof FILTER_TABS)[number], string> = {
  all: 'All',
  urgent: 'Urgent',
  pending_delete: 'Pending Delete',
  pending_review: 'Pending Review',
  archived: 'Archived',
}

// ── Main component ──

export default function EmailInboxToolbar({
  filter,
  onFilterChange,
  tabCounts,
  messageKind,
  onMessageKindChange,
  accounts,
  autoSyncEnabled,
  syncing,
  remoteSyncBusy,
  onUnifiedSync,
  accountSyncWindowDays = 30,
  onSyncWindowChange,
  autoSyncEligibleAccountIds,
  onToggleAutoSync,
  pullOnly,
  hostTriggeredIngestion = false,
  readOnlyIngestionNode = false,
  deleteOnlyBulkActions = false,
  bulkMode,
  onBulkModeChange,
  selectedCount,
  onBulkDelete,
  onBulkArchive,
  onBulkMoveToPendingReview,
  onBulkCategorize,
  onEmailCompose,
  onBeapCompose,
}: EmailInboxToolbarProps) {
  const primaryAccountId = pickDefaultEmailAccountRowId(accounts)
  const visibleFilterTabs = deleteOnlyBulkActions
    ? (['all'] as const)
    : FILTER_TABS

  return (
    <div className="email-inbox-toolbar">
      {/* Filter tabs row */}
      <div className="inbox-toolbar-tabs" role="tablist" aria-label="Inbox filters">
        {visibleFilterTabs.map((tab) => {
          return (
            <button
              key={tab}
              className={`inbox-toolbar-tab${tab === filter.filter ? ' inbox-toolbar-tab--active' : ''}`}
              role="tab"
              aria-selected={tab === filter.filter}
              id={`inbox-tab-${tab}`}
              type="button"
              onClick={() => onFilterChange({ filter: tab })}
            >
              {FILTER_LABELS[tab]} ({tabCounts[tab]})
            </button>
          )
        })}
      </div>

      <div className="inbox-toolbar-settings">
        <div className="inbox-toolbar-settings-row">
          <label
            className="inbox-toolbar-bulk-select-toggle"
            title={
              deleteOnlyBulkActions
                ? 'Show checkboxes to select messages for delete'
                : 'Show checkboxes to select messages for bulk actions'
            }
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--text-primary, var(--text-primary-prof, #e2e8f0))',
              cursor: 'pointer',
              flexShrink: 0,
              marginRight: 8,
            }}
          >
            <input
              type="checkbox"
              checked={bulkMode}
              onChange={(e) => onBulkModeChange(e.target.checked)}
              aria-label={
                deleteOnlyBulkActions
                  ? 'Select messages for delete'
                  : 'Select messages for bulk actions'
              }
            />
            Select
          </label>
          <span className="inbox-toolbar-settings-label">Type</span>
          <InboxMessageKindSelect
            id="inbox-message-kind-normal"
            variant="bulk"
            suppressBuiltInLabel
            value={messageKind}
            onChange={onMessageKindChange}
          />
        </div>
        <div className="inbox-toolbar-settings-row inbox-toolbar-settings-row--sync">
          <EmailInboxSyncControls
            accountSyncWindowDays={accountSyncWindowDays}
            onSyncWindowChange={onSyncWindowChange}
            primaryAccountId={primaryAccountId}
            autoSyncEligibleAccountIds={autoSyncEligibleAccountIds}
            autoSyncEnabled={autoSyncEnabled}
            onToggleAutoSync={onToggleAutoSync}
            onUnifiedSync={onUnifiedSync}
            syncing={syncing}
            remoteSyncBusy={remoteSyncBusy}
            pullOnly={pullOnly}
            hostTriggeredIngestion={hostTriggeredIngestion}
            readOnlyIngestionNode={readOnlyIngestionNode}
          />
          {(onEmailCompose || onBeapCompose) && (
            <div className="inbox-toolbar-composers-right inbox-toolbar-composers-right--compact">
              {onEmailCompose && (
                <button
                  type="button"
                  onClick={onEmailCompose}
                  title="New Email"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 26,
                    height: 26,
                    padding: 0,
                    borderRadius: 6,
                    background: '#2563eb',
                    color: '#fff',
                    border: 'none',
                    fontSize: 13,
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  ✉
                </button>
              )}
              {onBeapCompose && (
                <button
                  type="button"
                  onClick={onBeapCompose}
                  title="New BEAP™ Message"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: 26,
                    padding: '0 7px',
                    borderRadius: 6,
                    background: '#7c3aed',
                    color: '#fff',
                    border: 'none',
                    fontSize: 10,
                    fontWeight: 700,
                    cursor: 'pointer',
                    letterSpacing: '0.3px',
                    flexShrink: 0,
                  }}
                >
                  BEAP
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <InboxBulkActionsBar
        selectedCount={selectedCount}
        deleteOnlyBulkActions={deleteOnlyBulkActions}
        onBulkDelete={onBulkDelete}
        onBulkArchive={onBulkArchive}
        onBulkMoveToPendingReview={onBulkMoveToPendingReview}
        onBulkCategorize={onBulkCategorize}
      />
    </div>
  )
}
