/**
 * EmailInboxToolbar — Workflow filter tabs (with counts), sync controls (shared with Bulk Inbox), bulk row actions when items selected.
 */

import React from 'react'
import type { InboxFilter, InboxTabCounts } from '../stores/useEmailInboxStore'
import type { InboxMessageKindFilter } from '../lib/inboxMessageKind'
import { pickDefaultEmailAccountRowId } from '@ext/shared/email/pickDefaultAccountRow'
import EmailInboxSyncControls from './EmailInboxSyncControls'
import { InboxMessageKindSelect } from './InboxMessageKindSelect'

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
  bulkMode: boolean
  onBulkModeChange: (enabled: boolean) => void
  selectedCount: number
  onBulkDelete: () => void
  onBulkArchive: () => void
  onBulkMoveToPendingReview?: () => void
  onBulkCategorize?: () => void
  /**
   * Internal Host→Sandbox handshakes from `internalSandboxes.listAvailable` (ledger; no vault unlock).
   * Omitted when the feature is not active or the user has no internal sandbox rows.
   */
  internalSandbox?: {
    loading: boolean
    hasUsable: boolean
    hasIdentityIncomplete: boolean
    liveStatusLabel?: string | null
    onOpenHandshake?: () => void
  }
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
  bulkMode: _bulkMode,
  onBulkModeChange: _onBulkModeChange,
  selectedCount,
  onBulkDelete,
  onBulkArchive,
  onBulkMoveToPendingReview,
  onBulkCategorize,
  internalSandbox,
}: EmailInboxToolbarProps) {
  const primaryAccountId = pickDefaultEmailAccountRowId(accounts)

  return (
    <div className="email-inbox-toolbar">
      {/* Filter tabs row */}
      <div className="inbox-toolbar-tabs" role="tablist" aria-label="Inbox filters">
        {FILTER_TABS.map((tab) => {
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
        {internalSandbox != null &&
          (internalSandbox.loading ||
            internalSandbox.hasUsable ||
            internalSandbox.hasIdentityIncomplete) && (
            <div className="inbox-toolbar-settings-row">
              <span className="inbox-toolbar-settings-label">Sandbox</span>
              {internalSandbox.loading ? (
                <span style={{ fontSize: 11, color: 'var(--color-text-muted, #94a3b8)' }}>Checking…</span>
              ) : internalSandbox.hasUsable ? (
                <button
                  type="button"
                  title={
                    internalSandbox.liveStatusLabel
                      ? `Coordination: ${internalSandbox.liveStatusLabel}`
                      : 'Open internal sandbox handshake'
                  }
                  onClick={() => internalSandbox.onOpenHandshake?.()}
                  style={{
                    padding: '4px 10px',
                    fontSize: 10,
                    fontWeight: 600,
                    borderRadius: 4,
                    border: '1px solid rgba(124, 58, 237, 0.4)',
                    background: 'rgba(124, 58, 237, 0.12)',
                    color: 'var(--purple-accent, #a78bfa)',
                    cursor: 'pointer',
                  }}
                >
                  Sandbox
                </button>
              ) : (
                <button
                  type="button"
                  title="Internal coordination identity is not complete for this sandbox yet — open handshake to finish setup"
                  onClick={() => internalSandbox.onOpenHandshake?.()}
                  style={{
                    padding: '4px 10px',
                    fontSize: 10,
                    fontWeight: 600,
                    borderRadius: 4,
                    border: '1px solid rgba(245, 158, 11, 0.45)',
                    background: 'rgba(245, 158, 11, 0.08)',
                    color: '#f59e0b',
                    cursor: 'pointer',
                  }}
                >
                  Sandbox (setup)
                </button>
              )}
            </div>
          )}
        <div className="inbox-toolbar-settings-row">
          <span className="inbox-toolbar-settings-label">Type</span>
          <InboxMessageKindSelect
            id="inbox-message-kind-normal"
            variant="bulk"
            suppressBuiltInLabel
            value={messageKind}
            onChange={onMessageKindChange}
          />
        </div>
        <div className="inbox-toolbar-settings-row">
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
          />
        </div>
      </div>

      {/* Bulk actions (when selectedCount > 0) */}
      {selectedCount > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'var(--color-text-muted, #94a3b8)' }}>
            {selectedCount} selected
          </span>
          <button
            onClick={onBulkDelete}
            style={{
              padding: '5px 10px',
              fontSize: 10,
              fontWeight: 600,
              borderRadius: 4,
              border: '1px solid rgba(239,68,68,0.3)',
              background: 'rgba(239,68,68,0.1)',
              color: '#ef4444',
              cursor: 'pointer',
            }}
          >
            Delete
          </button>
          <button
            onClick={onBulkArchive}
            style={{
              padding: '5px 10px',
              fontSize: 10,
              fontWeight: 600,
              borderRadius: 4,
              border: '1px solid var(--color-border, rgba(255,255,255,0.2))',
              background: 'var(--color-surface, rgba(255,255,255,0.04))',
              color: 'var(--color-text, #e2e8f0)',
              cursor: 'pointer',
            }}
          >
            Archive
          </button>
          {onBulkMoveToPendingReview && (
            <button
              onClick={onBulkMoveToPendingReview}
              style={{
                padding: '5px 10px',
                fontSize: 10,
                fontWeight: 600,
                borderRadius: 4,
                border: '1px solid rgba(245,158,11,0.4)',
                background: 'rgba(245,158,11,0.1)',
                color: '#f59e0b',
                cursor: 'pointer',
              }}
            >
              Move to Pending Review
            </button>
          )}
          {onBulkCategorize && (
            <button
              onClick={onBulkCategorize}
              style={{
                padding: '5px 10px',
                fontSize: 10,
                fontWeight: 600,
                borderRadius: 4,
                border: '1px solid var(--color-border, rgba(255,255,255,0.2))',
                background: 'var(--color-surface, rgba(255,255,255,0.04))',
                color: 'var(--color-text, #e2e8f0)',
                cursor: 'pointer',
              }}
            >
              Categorize
            </button>
          )}
        </div>
      )}
    </div>
  )
}
