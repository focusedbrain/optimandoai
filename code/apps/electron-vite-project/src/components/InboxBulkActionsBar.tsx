/**
 * Shared bulk-actions bar — Remove / Archive / Move to Pending Review / Categorize.
 * Used by normal inbox (via EmailInboxToolbar) and Bulk Inbox.
 */

import React from 'react'

export interface InboxBulkActionsBarProps {
  selectedCount: number
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
  selectedCount,
  deleteOnlyBulkActions = false,
  onBulkDelete,
  onBulkArchive,
  onBulkMoveToPendingReview,
  onBulkCategorize,
}: InboxBulkActionsBarProps) {
  if (selectedCount <= 0) return null

  return (
    <div className="inbox-bulk-actions-bar" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 11, color: 'var(--color-text-muted, #94a3b8)' }}>
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
              color: 'var(--color-text, #e2e8f0)',
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
                color: 'var(--color-text, #e2e8f0)',
                cursor: 'pointer',
              }}
            >
              Categorize
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
