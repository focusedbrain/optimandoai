/**
 * EmailInboxToolbar — Filter tabs, centered Type selector, sync controls, bulk row actions when items selected.
 *
 * Normal inbox: first row uses bulk-aligned workflow buckets with counts; integrated multi-select row removed
 * (Bulk Inbox screen handles batch tools). Layout/styles unchanged from b5292106^ / 8e1a0aba.
 */

import React from 'react'
import type { InboxFilter } from '../stores/useEmailInboxStore'
import { INBOX_WORKFLOW_FILTER_KEYS } from '../stores/useEmailInboxStore'
import { pickDefaultEmailAccountRowId } from '@ext/shared/email/pickDefaultAccountRow'
import EmailInboxSyncControls from './EmailInboxSyncControls'
import { InboxMessageKindSelect } from './InboxMessageKindSelect'

// ── Types ──

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
  /** Same behavior as Bulk Inbox: pull then optional remote reconcile. */
  onUnifiedSync: () => void
  /** Current sync window in days (0 = all mail in DB). */
  accountSyncWindowDays?: number
  onSyncWindowChange: (days: number) => void | Promise<void>
  onToggleAutoSync: (accountId: string, enabled: boolean) => void
  /** When every account is IMAP, primary button shows Pull (matches Bulk). */
  pullOnly: boolean
}

const WORKFLOW_LABELS: Record<(typeof INBOX_WORKFLOW_FILTER_KEYS)[number], string> = {
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
      {/* Filter tabs row — same pill styles as pre-b5292106; keys match bulk workflow buckets */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {INBOX_WORKFLOW_FILTER_KEYS.map((tab) => {
          const active = filter.filter === tab
          const count = active ? total : (tabCounts[tab] ?? 0)
          return (
            <button
              key={tab}
              type="button"
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
              {WORKFLOW_LABELS[tab]} ({count})
            </button>
          )
        })}
      </div>

      {/* Type centered on full toolbar width; sync flush right (balanced by left grid column). */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto 1fr',
          alignItems: 'center',
          gap: 10,
          width: '100%',
        }}
      >
        <div style={{ minWidth: 0 }} aria-hidden />
        <div style={{ justifySelf: 'center' }}>
          <InboxMessageKindSelect
            id="inbox-message-kind-normal"
            value={filter.messageKind}
            onChange={(messageKind) => onFilterChange({ messageKind, sourceType: 'all' })}
          />
        </div>
        <div
          style={{ justifySelf: 'end', minWidth: 0 }}
          className="bulk-view-toolbar-right bulk-view-toolbar-right--compact"
        >
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
