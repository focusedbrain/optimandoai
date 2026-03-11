/**
 * CollapsibleSection — Reusable collapsible container for workspace sections
 */

import { useState } from 'react'

export interface CollapsibleSectionProps {
  title: string
  icon?: string
  count?: number
  badge?: React.ReactNode
  defaultExpanded?: boolean
  /** When provided with onExpandedChange, enables controlled mode */
  expanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
  children: React.ReactNode
  className?: string
  /** Ref forwarded to the section container for scroll-into-view */
  sectionRef?: React.RefObject<HTMLDivElement | null>
}

export default function CollapsibleSection({
  title,
  icon,
  count,
  badge,
  defaultExpanded = true,
  expanded: controlledExpanded,
  onExpandedChange,
  children,
  className = '',
  sectionRef,
}: CollapsibleSectionProps) {
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded)
  const isControlled = controlledExpanded !== undefined && onExpandedChange !== undefined
  const expanded = isControlled ? controlledExpanded : internalExpanded
  const setExpanded = isControlled ? (v: boolean) => onExpandedChange!(v) : setInternalExpanded

  return (
    <div
      ref={sectionRef}
      className={className}
      style={{
        marginBottom: '16px',
        background: 'var(--color-surface, rgba(255,255,255,0.03))',
        border: '1px solid var(--color-border, rgba(255,255,255,0.08))',
        borderRadius: '8px',
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        style={{
          width: '100%',
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '8px',
          padding: '12px 16px',
          cursor: 'pointer',
          userSelect: 'none',
          background: 'rgba(255,255,255,0.02)',
          border: 'none',
          color: 'var(--color-text, #e2e8f0)',
          fontSize: '14px',
          fontWeight: 600,
          textAlign: 'left',
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', minWidth: 0 }}>
          {icon != null && <span style={{ fontSize: '18px' }}>{icon}</span>}
          <span>{title}</span>
          {count != null && (
            <span
              style={{
                fontSize: '12px',
                color: 'var(--color-text-muted, #94a3b8)',
                backgroundColor: 'rgba(255,255,255,0.06)',
                padding: '2px 8px',
                borderRadius: '10px',
                fontWeight: 400,
              }}
            >
              {count}
            </span>
          )}
          {badge}
        </div>
        <span
          style={{
            fontSize: '12px',
            color: 'var(--color-text-muted, #94a3b8)',
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s',
          }}
        >
          ▼
        </span>
      </button>
      {expanded && (
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--color-border, rgba(255,255,255,0.06))' }}>
          {children}
        </div>
      )}
    </div>
  )
}
