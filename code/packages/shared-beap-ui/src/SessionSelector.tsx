import React from 'react'
import type { SessionOption } from './types'

export interface SessionSelectorProps {
  sessions: SessionOption[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  loading?: boolean
  compact?: boolean
  emptyLabel?: string
  label?: string
  ariaLabel?: string
}

/**
 * Session selector dropdown. Receives session list as prop — no data loading.
 */
export function SessionSelector({
  sessions,
  selectedId,
  onSelect,
  loading = false,
  compact = false,
  emptyLabel = '— No session —',
  label = 'Session (optional)',
  ariaLabel,
}: SessionSelectorProps) {
  const rootClass = `beap-ui-session-selector${compact ? ' beap-ui--compact' : ''}`

  return (
    <div className={rootClass}>
      <label className="beap-ui-field-label">{label}</label>
      <select
        className="beap-ui-select"
        value={selectedId || ''}
        onChange={(e) => onSelect(e.target.value || null)}
        disabled={loading}
        aria-label={ariaLabel || label}
      >
        <option value="">
          {loading ? 'Loading sessions…' : emptyLabel}
        </option>
        {sessions.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
            {s.description ? ` — ${s.description}` : ''}
          </option>
        ))}
      </select>
    </div>
  )
}
