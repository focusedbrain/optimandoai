/**
 * EmailInboxToolbar — Normal inbox: workflow buckets + type + sync (bulk-only batch/Auto-Sort UI lives in Bulk view).
 */

import React from 'react'
import type { InboxFilter } from '../stores/useEmailInboxStore'
import { INBOX_WORKFLOW_FILTER_KEYS } from '../stores/useEmailInboxStore'
import { pickDefaultEmailAccountRowId } from '@ext/shared/email/pickDefaultAccountRow'
import EmailInboxSyncControls from './EmailInboxSyncControls'
import { InboxMessageKindSelect } from './InboxMessageKindSelect'

export interface EmailInboxToolbarProps {
  filter: InboxFilter
  onFilterChange: (partial: Partial<InboxFilter>) => void
  /** Per-bucket totals (server), same semantics as bulk inbox. */
  tabCounts: Record<string, number>
  /** Total rows in the active bucket. */
  total: number
  accounts: Array<{ id: string; email: string }>
  autoSyncEnabled: boolean
  syncing: boolean
  remoteSyncBusy: boolean
  onUnifiedSync: () => void
  accountSyncWindowDays?: number
  onSyncWindowChange: (days: number) => void | Promise<void>
  onToggleAutoSync: (accountId: string, enabled: boolean) => void
  pullOnly: boolean
}

const WORKFLOW_LABELS: Record<(typeof INBOX_WORKFLOW_FILTER_KEYS)[number], string> = {
  all: 'All',
  urgent: 'Urgent',
  pending_delete: 'Pending Delete',
  pending_review: 'Pending Review',
  archived: 'Archived',
}

const WORKFLOW_BTN_CLASS: Partial<Record<(typeof INBOX_WORKFLOW_FILTER_KEYS)[number], string>> = {
  urgent: 'bulk-view-toolbar-filter-btn--urgent',
  pending_delete: 'bulk-view-toolbar-filter-btn--pending',
  pending_review: 'bulk-view-toolbar-filter-btn--review',
  archived: 'bulk-view-toolbar-filter-btn--archived',
}

export default function EmailInboxToolbar({
  filter,
  onFilterChange,
  tabCounts,
  total,
  accounts,
  autoSyncEnabled,
  syncing,
  remoteSyncBusy,
  onUnifiedSync,
  accountSyncWindowDays = 30,
  onSyncWindowChange,
  onToggleAutoSync,
  pullOnly,
}: EmailInboxToolbarProps) {
  const primaryAccountId = pickDefaultEmailAccountRowId(accounts)

  return (
    <div className="bulk-view-toolbar bulk-view-toolbar--stacked email-inbox-normal-toolbar">
      <div className="bulk-view-toolbar-row bulk-view-toolbar-row--tabs">
        <div className="bulk-view-toolbar-tabs">
          {INBOX_WORKFLOW_FILTER_KEYS.map((tab) => {
            const active = filter.filter === tab
            const count = active ? total : (tabCounts[tab] ?? 0)
            const extra = WORKFLOW_BTN_CLASS[tab]
            return (
              <button
                key={tab}
                type="button"
                onClick={() => onFilterChange({ filter: tab })}
                className={`bulk-view-toolbar-filter-btn${extra ? ` ${extra}` : ''}`}
                data-active={active}
              >
                {WORKFLOW_LABELS[tab]} ({count})
              </button>
            )
          })}
        </div>
      </div>

      <div className="bulk-view-toolbar-row bulk-view-toolbar-row--message-kind">
        <InboxMessageKindSelect
          id="inbox-message-kind-normal"
          variant="bulk"
          value={filter.messageKind}
          onChange={(messageKind) => onFilterChange({ messageKind, sourceType: 'all' })}
        />
      </div>

      <div className="bulk-view-toolbar-row bulk-view-toolbar-row--main">
        <div className="bulk-view-toolbar-left" aria-hidden style={{ minWidth: 8 }} />
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
    </div>
  )
}
