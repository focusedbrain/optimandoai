import { useEffect, useRef, useState } from 'react'
import type { ReplicaStatus } from './types.js'
import type { ReplicaActionKind } from './replicaActions.js'

export interface ReplicaKebabMenuProps {
  replica: ReplicaStatus
  onAction: (action: ReplicaActionKind, replica: ReplicaStatus) => void
  onNuclearReset?: (replica: ReplicaStatus) => void
}

export function ReplicaKebabMenu({ replica, onAction, onNuclearReset }: ReplicaKebabMenuProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        data-testid={`replica-kebab-${replica.edge_pod_id}`}
        aria-label="Replica actions"
        onClick={() => setOpen((v) => !v)}
        style={{
          padding: '4px 8px',
          borderRadius: 6,
          border: '1px solid var(--border)',
          background: 'transparent',
          cursor: 'pointer',
        }}
      >
        ⋮
      </button>
      {open && (
        <div
          data-testid={`replica-kebab-menu-${replica.edge_pod_id}`}
          style={{
            position: 'absolute',
            right: 0,
            top: '100%',
            marginTop: 4,
            minWidth: 140,
            background: 'var(--bg-primary, #fff)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(15,23,42,0.12)',
            zIndex: 20,
          }}
        >
          {(['restart', 'redeploy', 'remove'] as const).map((action) => (
            <button
              key={action}
              type="button"
              data-testid={`replica-action-${action}-${replica.edge_pod_id}`}
              onClick={() => {
                setOpen(false)
                onAction(action, replica)
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '8px 12px',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                color: action === 'remove' ? '#dc2626' : 'inherit',
              }}
            >
              {action.charAt(0).toUpperCase() + action.slice(1)}
            </button>
          ))}
          {onNuclearReset && (
            <button
              type="button"
              data-testid={`replica-action-nuclear-reset-${replica.edge_pod_id}`}
              onClick={() => {
                setOpen(false)
                onNuclearReset(replica)
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '8px 12px',
                border: 'none',
                borderTop: '1px solid var(--border)',
                background: 'transparent',
                cursor: 'pointer',
                color: '#991b1b',
                fontWeight: 600,
              }}
            >
              Nuclear reset
            </button>
          )}
        </div>
      )}
    </div>
  )
}
