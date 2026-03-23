/**
 * Inbox Type = origin only (All / Native BEAP / Depackaged Email).
 * Status uses tabs; Handshakes uses its own section — not mixed here.
 */

import { coerceInboxMessageKindFilter, type InboxMessageKindFilter } from '../lib/inboxMessageKind'

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
  { value: 'handshake', label: 'Native BEAP' },
  { value: 'depackaged', label: 'Depackaged Email' },
]

export function InboxMessageKindSelect({ value, onChange, id, variant = 'default' }: InboxMessageKindSelectProps) {
  const safeValue = coerceInboxMessageKindFilter(value)
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
        value={safeValue}
        onChange={(e) => onChange(e.target.value as InboxMessageKindFilter)}
        aria-label="Filter by message type: All, Native BEAP, or Depackaged Email"
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
