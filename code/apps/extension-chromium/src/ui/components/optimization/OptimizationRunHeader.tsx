import React from 'react'

export type OptimizationRunHeaderProps = {
  theme?: 'pro' | 'dark' | 'standard'
  projectTitle: string
  completedAt: string
  agentCount: number
  expanded: boolean
  onToggle: () => void
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return iso
  }
}

export default function OptimizationRunHeader({
  theme = 'pro',
  projectTitle,
  completedAt,
  agentCount,
  expanded,
  onToggle,
}: OptimizationRunHeaderProps) {
  const isLight = theme === 'standard'
  const textColor = isLight ? '#0f172a' : '#e2e8f0'
  const muted = isLight ? 'rgba(15,23,42,0.55)' : 'rgba(226,232,240,0.65)'

  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        maxWidth: '92%',
        alignSelf: 'flex-start',
        textAlign: 'left',
        borderRadius: 0,
        borderLeft: `3px solid ${isLight ? 'rgba(59,130,246,0.5)' : 'rgba(129,140,248,0.65)'}`,
        background: isLight ? 'rgba(59,130,246,0.07)' : 'rgba(79,70,229,0.12)',
        borderTop: 'none',
        borderRight: 'none',
        borderBottom: 'none',
        padding: '8px 12px',
        cursor: 'pointer',
        color: textColor,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 700 }}>
        Optimization run — {projectTitle}
      </div>
      <div style={{ fontSize: 10, color: muted, marginTop: 4 }}>
        {formatTime(completedAt)} · {agentCount} agent{agentCount === 1 ? '' : 's'}{' '}
        <span style={{ marginLeft: 4 }}>{expanded ? '▼' : '▶'}</span>
      </div>
    </button>
  )
}
