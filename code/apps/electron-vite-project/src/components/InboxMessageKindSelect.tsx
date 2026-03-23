/**
 * Shared compact dropdown for product-facing inbox type (workflow labels).
 * Same options in Normal + Bulk inbox; internal `value`s stay stable for IPC/filters.
 */

import type { InboxMessageKindFilter } from '../lib/inboxMessageKind'

export interface InboxMessageKindSelectProps {
  value: InboxMessageKindFilter
  onChange: (value: InboxMessageKindFilter) => void
  /** Unique id when multiple instances could exist in DOM */
  id: string
  /** Bulk inbox uses light toolbar + existing batch select styling */
  variant?: 'default' | 'bulk'
}

const OPTIONS: { value: InboxMessageKindFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'depackaged', label: 'Manual Review' },
  { value: 'auto_filed', label: 'Auto-filed' },
  { value: 'handshake', label: 'Handshakes' },
]

export function InboxMessageKindSelect({ value, onChange, id, variant = 'default' }: InboxMessageKindSelectProps) {
  const selectClass =
    variant === 'bulk'
      ? 'bulk-view-selection-group-select inbox-message-kind-select--bulk'
      : 'inbox-message-kind-toolbar__select'

  return (
    <div className="inbox-message-kind-toolbar">
      <label htmlFor={id} className="inbox-message-kind-toolbar__label">
        Type
      </label>
      <select
        id={id}
        className={selectClass}
        value={value}
        onChange={(e) => onChange(e.target.value as InboxMessageKindFilter)}
        aria-label="Filter by type: All, Manual Review, Auto-filed, or Handshakes"
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}
