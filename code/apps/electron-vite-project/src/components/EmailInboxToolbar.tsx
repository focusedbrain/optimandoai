/**
 * EmailInboxToolbar — Filter tabs, source type, auto-sync, pull, bulk actions.
 */

import React from 'react'
import type { InboxFilter } from '../stores/useEmailInboxStore'

// ── Types ──

export interface EmailInboxToolbarProps {
  filter: InboxFilter
  onFilterChange: (partial: Partial<InboxFilter>) => void
  accounts: Array<{ id: string; email: string }>
  autoSyncEnabled: boolean
  syncing: boolean
  onSync: () => void
  onToggleAutoSync: (accountId: string, enabled: boolean) => void
  bulkMode: boolean
  onBulkModeChange: (enabled: boolean) => void
  selectedCount: number
  onBulkDelete: () => void
  onBulkArchive: () => void
  onBulkCategorize?: () => void
}

// ── Filter tabs ──

const FILTER_TABS = ['all', 'unread', 'starred', 'archived', 'pending_delete', 'deleted'] as const
const FILTER_LABELS: Record<string, string> = {
  all: 'All',
  unread: 'Unread',
  starred: 'Starred',
  archived: 'Archived',
  pending_delete: 'Pending Delete',
  deleted: 'Deleted',
}

// ── Source type tabs ──

const SOURCE_TABS = [
  { value: 'all' as const, label: 'All' },
  { value: 'email_beap' as const, label: 'BEAP' },
  { value: 'email_plain' as const, label: 'Plain' },
  { value: 'direct_beap' as const, label: 'Direct' },
]

// ── Toggle switch ──

function ToggleSwitch({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: () => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      style={{
        width: 36,
        height: 20,
        borderRadius: 10,
        border: 'none',
        background: checked ? 'var(--purple-accent, #9333ea)' : '#ccc',
        cursor: 'pointer',
        padding: 0,
        position: 'relative',
        transition: 'background 0.2s ease',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: checked ? 18 : 2,
          width: 16,
          height: 16,
          borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          transition: 'left 0.2s ease',
        }}
      />
    </button>
  )
}

// ── Main component ──

export default function EmailInboxToolbar({
  filter,
  onFilterChange,
  accounts,
  autoSyncEnabled,
  syncing,
  onSync,
  onToggleAutoSync,
  bulkMode,
  onBulkModeChange,
  selectedCount,
  onBulkDelete,
  onBulkArchive,
  onBulkCategorize,
}: EmailInboxToolbarProps) {
  const primaryAccountId = accounts[0]?.id

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

      {/* Source type filter row */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {SOURCE_TABS.map(({ value, label }) => {
          const active = filter.sourceType === value
          return (
            <button
              key={value}
              onClick={() => onFilterChange({ sourceType: value })}
              style={{
                padding: '4px 10px',
                fontSize: 10,
                fontWeight: 600,
                borderRadius: 6,
                border: `1px solid ${active ? 'var(--purple-accent, #9333ea)' : 'var(--color-border, rgba(255,255,255,0.2))'}`,
                background: active ? 'var(--purple-accent-muted, rgba(147,51,234,0.2))' : 'transparent',
                color: active ? 'var(--purple-accent, #9333ea)' : 'var(--color-text-muted, #94a3b8)',
                cursor: 'pointer',
              }}
            >
              {label}
            </button>
          )
        })}

        <div style={{ flex: 1, minWidth: 8 }} />

        {/* Auto-sync toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--color-text-muted, #94a3b8)' }}>
            Auto-sync
          </span>
          <ToggleSwitch
            checked={autoSyncEnabled}
            onChange={() => primaryAccountId && onToggleAutoSync(primaryAccountId, !autoSyncEnabled)}
          />
        </div>

        {/* Manual pull button */}
        <button
          onClick={onSync}
          disabled={syncing}
          style={{
            padding: '6px 12px',
            fontSize: 11,
            fontWeight: 600,
            borderRadius: 6,
            border: '1px solid var(--purple-accent, #9333ea)',
            background: 'var(--purple-accent-muted, rgba(147,51,234,0.2))',
            color: 'var(--purple-accent, #9333ea)',
            cursor: syncing ? 'not-allowed' : 'pointer',
            opacity: syncing ? 0.7 : 1,
          }}
        >
          {syncing ? '↻ Syncing…' : '↻ Pull'}
        </button>

        {/* Bulk mode toggle */}
        <button
          onClick={() => onBulkModeChange(!bulkMode)}
          style={{
            padding: '6px 12px',
            fontSize: 11,
            fontWeight: 600,
            borderRadius: 6,
            border: `1px solid ${bulkMode ? 'var(--purple-accent, #9333ea)' : 'var(--color-border, rgba(255,255,255,0.2))'}`,
            background: bulkMode ? 'var(--purple-accent-muted, rgba(147,51,234,0.2))' : 'transparent',
            color: bulkMode ? 'var(--purple-accent, #9333ea)' : 'var(--color-text-muted, #94a3b8)',
            cursor: 'pointer',
          }}
        >
          Bulk
        </button>
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
