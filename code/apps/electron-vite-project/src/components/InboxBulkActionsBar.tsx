/**
 * Shared bulk-select strip — Select all (loaded + matching), count, Remove / Archive / workflow actions.
 * Used by normal inbox (via EmailInboxToolbar) and Bulk Inbox row-select mode.
 */

import React, { useEffect, useRef } from 'react'

export interface InboxBulkActionsBarProps {
  /** When false, the entire strip is hidden. */
  selectMode: boolean
  selectedCount: number
  loadedCount: number
  /** Tab/filter total (e.g. tabCounts.pending_delete). */
  totalMatchingCount: number
  /** Human tab name for “Select all N in …” (e.g. "Pending Delete"). */
  currentTabLabel: string
  headerChecked: boolean
  headerIndeterminate: boolean
  onHeaderCheckboxChange: () => void
  /** True when more messages match the filter than are loaded and not all are selected yet. */
  showSelectAllMatchingLink: boolean
  matchingSelectInProgress?: boolean
  onSelectAllMatching: () => void
  onClearSelection: () => void
  /**
   * Sandbox delete-only: show Remove only (hides sort/workflow actions).
   * Bulk Inbox is host-only; normal inbox passes this when `isSandbox`.
   */
  deleteOnlyBulkActions?: boolean
  onBulkDelete: () => void
  onBulkArchive: () => void
  onBulkMoveToPendingReview?: () => void
  onBulkCategorize?: () => void
}

export default function InboxBulkActionsBar({
  selectMode,
  selectedCount,
  loadedCount,
  totalMatchingCount,
  currentTabLabel,
  headerChecked,
  headerIndeterminate,
  onHeaderCheckboxChange,
  showSelectAllMatchingLink,
  matchingSelectInProgress = false,
  onSelectAllMatching,
  onClearSelection,
  deleteOnlyBulkActions = false,
  onBulkDelete,
  onBulkArchive,
  onBulkMoveToPendingReview,
  onBulkCategorize,
}: InboxBulkActionsBarProps) {
  const headerRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const el = headerRef.current
    if (el) {
      ;(el as HTMLInputElement & { indeterminate?: boolean }).indeterminate = headerIndeterminate
    }
  }, [headerIndeterminate])

  if (!selectMode) return null

  const fg = 'var(--text-primary, var(--text-primary-prof, #e2e8f0))'
  const fgSecondary = 'var(--text-secondary, var(--text-secondary-prof, #94a3b8))'
  const linkColor = 'var(--color-primary, #7c3aed)'

  return (
    <div
      className="inbox-bulk-actions-bar"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '6px 0 4px',
        borderBottom: '1px solid var(--border, var(--color-border, rgba(255,255,255,0.08)))',
        color: fg,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 11,
            fontWeight: 600,
            color: fg,
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <input
            ref={headerRef}
            type="checkbox"
            checked={headerChecked}
            onChange={onHeaderCheckboxChange}
            aria-label={
              loadedCount > 0
                ? `Select all ${loadedCount} loaded message${loadedCount !== 1 ? 's' : ''}`
                : 'Select all loaded messages'
            }
          />
          Select all
          {loadedCount > 0 ? (
            <span style={{ fontWeight: 500, color: fgSecondary }}>({loadedCount} loaded)</span>
          ) : null}
        </label>

        {showSelectAllMatchingLink ? (
          <button
            type="button"
            onClick={onSelectAllMatching}
            disabled={matchingSelectInProgress}
            style={{
              padding: 0,
              border: 'none',
              background: 'transparent',
              fontSize: 11,
              fontWeight: 600,
              color: linkColor,
              cursor: matchingSelectInProgress ? 'wait' : 'pointer',
              textDecoration: 'underline',
            }}
          >
            {matchingSelectInProgress
              ? 'Selecting…'
              : `Select all ${totalMatchingCount} in ${currentTabLabel}`}
          </button>
        ) : null}

        {selectedCount > 0 ? (
          <button
            type="button"
            onClick={onClearSelection}
            style={{
              padding: 0,
              border: 'none',
              background: 'transparent',
              fontSize: 11,
              fontWeight: 500,
              color: fgSecondary,
              cursor: 'pointer',
              textDecoration: 'underline',
            }}
          >
            Clear selection
          </button>
        ) : null}
      </div>

      {selectedCount > 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: fgSecondary }}>
            {selectedCount} selected
          </span>
          <button
            type="button"
            onClick={onBulkDelete}
            title="Remove selected from WRDesk inbox only — does not delete from the origin mailbox"
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
            Remove
          </button>
          {!deleteOnlyBulkActions ? (
            <>
              <button
                type="button"
                onClick={onBulkArchive}
                style={{
                  padding: '5px 10px',
                  fontSize: 10,
                  fontWeight: 600,
                  borderRadius: 4,
                  border: '1px solid var(--color-border, rgba(255,255,255,0.2))',
                  background: 'var(--color-surface, rgba(255,255,255,0.04))',
                  color: fg,
                  cursor: 'pointer',
                }}
              >
                Archive
              </button>
              {onBulkMoveToPendingReview ? (
                <button
                  type="button"
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
              ) : null}
              {onBulkCategorize ? (
                <button
                  type="button"
                  onClick={onBulkCategorize}
                  style={{
                    padding: '5px 10px',
                    fontSize: 10,
                    fontWeight: 600,
                    borderRadius: 4,
                    border: '1px solid var(--color-border, rgba(255,255,255,0.2))',
                    background: 'var(--color-surface, rgba(255,255,255,0.04))',
                    color: fg,
                    cursor: 'pointer',
                  }}
                >
                  Categorize
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
