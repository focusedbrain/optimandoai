/**
 * SandboxLockSurface — premium lock placeholder for outbound-composition affordances.
 *
 * Used wherever an outbound-compose slot (reply field, draft area, pBEAP/qBEAP field)
 * is replaced on the sandbox. Communicates deliberate security isolation; not an error.
 *
 * variant='field'   — replaces a textarea / full compose area (taller, fills the slot)
 * variant='compact' — replaces a small toolbar button or inline element
 */
import React from 'react'

export const SANDBOX_LOCK_COPY = 'Sending messages is disabled on the sandbox for security.'

interface SandboxLockSurfaceProps {
  variant?: 'field' | 'compact'
  className?: string
  'data-testid'?: string
}

export function SandboxLockSurface({
  variant = 'compact',
  className,
  'data-testid': testId,
}: SandboxLockSurfaceProps) {
  const isField = variant === 'field'

  return (
    <div
      className={`sandbox-lock-surface sandbox-lock-surface--${variant}${className ? ` ${className}` : ''}`}
      data-testid={testId ?? 'sandbox-lock-surface'}
      role="status"
      aria-label={SANDBOX_LOCK_COPY}
      style={{
        display: 'flex',
        alignItems: isField ? 'flex-start' : 'center',
        gap: isField ? 10 : 6,
        padding: isField ? '14px 16px' : '6px 12px',
        minHeight: isField ? 72 : undefined,
        borderRadius: isField ? 8 : 6,
        background: 'var(--bg-elevated, var(--bg-elevated-prof, #f8fafc))',
        color: 'var(--text-secondary, var(--text-secondary-prof, #64748b))',
        border: '1px solid var(--border, var(--border-prof, #e2e8f0))',
        fontSize: isField ? 13 : 12,
        userSelect: 'none',
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      <span
        aria-hidden
        style={{
          fontSize: isField ? 16 : 13,
          opacity: 0.7,
          flexShrink: 0,
          marginTop: isField ? 1 : 0,
        }}
      >
        🔒
      </span>
      <span style={{ color: 'var(--text-secondary, var(--text-secondary-prof, #64748b))' }}>
        {SANDBOX_LOCK_COPY}
      </span>
    </div>
  )
}
