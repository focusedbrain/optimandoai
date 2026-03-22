/**
 * EmailInboxToolbar — Filter tabs, message type (Handshake / Depackaged), sync controls, bulk row actions when items selected.
 */

import React from 'react'
import type { InboxFilter } from '../stores/useEmailInboxStore'
import { pickDefaultEmailAccountRowId } from '@ext/shared/email/pickDefaultAccountRow'
import EmailInboxSyncControls from './EmailInboxSyncControls'
import { InboxMessageKindSelect } from './InboxMessageKindSelect'

// ── Types ──

export interface EmailInboxToolbarProps {
  filter: InboxFilter
  onFilterChange: (partial: Partial<InboxFilter>) => void
  accounts: Array<{ id: string; email: string }>
  autoSyncEnabled: boolean
  syncing: boolean
  remoteSyncBusy: boolean
  /** Same behavior as Bulk Inbox: pull then optional remote reconcile. */
  onUnifiedSync: () => void
  /** Current sync window in days (0 = all mail in DB). */
  accountSyncWindowDays?: number
  onSyncWindowChange: (days: number) => void | Promise<void>
  onToggleAutoSync: (accountId: string, enabled: boolean) => void
  /** When every account is IMAP, primary button shows Pull (matches Bulk). */
  pullOnly: boolean
  bulkMode: boolean
  onBulkModeChange: (enabled: boolean) => void
  selectedCount: number
  onBulkDelete: () => void
  onBulkArchive: () => void
  onBulkMoveToPendingReview?: () => void
  onBulkCategorize?: () => void
}

// ── Filter tabs ──

const FILTER_TABS = ['all', 'unread', 'starred', 'archived', 'pending_delete', 'pending_review', 'deleted'] as const
const FILTER_LABELS: Record<string, string> = {
  all: 'All',
  unread: 'Unread',
  starred: 'Starred',
  archived: 'Archived',
  pending_delete: 'Pending Delete',
  pending_review: '⏳ Pending Review',
  deleted: 'Deleted',
}

// ── Main component ──

export default function EmailInboxToolbar({
  filter,
  onFilterChange,
  accounts,
  autoSyncEnabled,
  syncing,
  remoteSyncBusy,
  onUnifiedSync,
  accountSyncWindowDays = 30,
  onSyncWindowChange,
  onToggleAutoSync,
  pullOnly,
  bulkMode: _bulkMode,
  onBulkModeChange: _onBulkModeChange,
  selectedCount,
  onBulkDelete,
  onBulkArchive,
  onBulkMoveToPendingReview,
  onBulkCategorize,
}: EmailInboxToolbarProps) {
  const primaryAccountId = pickDefaultEmailAccountRowId(accounts)

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '12px 14px',
        borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.08))',
        background: 'var(--color-bg, #0f172a)',
      }}
    >
      {/* Filter tabs row */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {FILTER_TABS.map((tab) => {
          const active = filter.filter === tab
          return (
            <button
              key={tab}
              onClick={() => onFilterChange({ filter: tab })}
              style={{
                padding: '6px 12px',
                fontSize: 11,
                fontWeight: 600,
                borderRadius: 999,
                border: 'none',
                background: active ? 'var(--purple-accent, #9333ea)' : '#eee',
                color: active ? '#fff' : 'var(--color-text, #0f172a)',
                cursor: 'pointer',
                textTransform: 'capitalize',
              }}
            >
              {FILTER_LABELS[tab] ?? tab}
            </button>
          )
        })}
      </div>

      {/* Message type (secondary) + sync */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <InboxMessageKindSelect
          id="inbox-message-kind-normal"
          value={filter.messageKind}
          onChange={(messageKind) => onFilterChange({ messageKind, sourceType: 'all' })}
        />

        <div style={{ flex: 1, minWidth: 8 }} />

        <div className="bulk-view-toolbar-right bulk-view-toolbar-right--compact">
          <EmailInboxSyncControls
            accountSyncWindowDays={accountSyncWindowDays}
            onSyncWindowChange={onSyncWindowChange}
            primaryAccountId={primaryAccountId}
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
