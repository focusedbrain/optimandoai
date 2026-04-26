import type { ActiveHandshakeHealthIssue } from '@shared/handshake/activeHandshakeHealthIssue'
import { handshakeHealthBannerMessage } from '../lib/handshakeHealthBannerCopy'

export function HandshakeHealthOrchestratorBanner(props: {
  issue: ActiveHandshakeHealthIssue
  extraCount: number
  onDismiss: (issue: ActiveHandshakeHealthIssue) => void
  onOpenPairingSettings: (handshakeId: string) => void
}) {
  const { issue, extraCount, onDismiss, onOpenPairingSettings } = props
  const isInfo = issue.health === 'SUBOPTIMAL'
  const isBroken = issue.health === 'BROKEN'

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpenPairingSettings(issue.handshake_id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpenPairingSettings(issue.handshake_id)
        }
      }}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '12px',
        padding: '10px 14px',
        borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.12))',
        background: isInfo
          ? 'rgba(30, 64, 175, 0.12)'
          : isBroken
            ? 'rgba(220, 38, 38, 0.12)'
            : 'rgba(245, 158, 11, 0.12)',
        cursor: 'pointer',
        flexShrink: 0,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: '13px',
            fontWeight: 600,
            lineHeight: 1.45,
            color: isInfo ? 'var(--color-text, #e2e8f0)' : isBroken ? '#fecaca' : '#fde68a',
          }}
        >
          {handshakeHealthBannerMessage(issue)}
        </div>
        {extraCount > 0 ? (
          <div
            style={{
              marginTop: '6px',
              fontSize: '11px',
              color: 'var(--color-text-muted, #94a3b8)',
            }}
          >
            {extraCount} more connection issue{extraCount === 1 ? '' : 's'} — click to open Settings
          </div>
        ) : (
          <div
            style={{
              marginTop: '6px',
              fontSize: '11px',
              color: 'var(--color-text-muted, #94a3b8)',
            }}
          >
            Open Settings → Orchestrator Mode (pairing) on this device
          </div>
        )}
      </div>
      <button
        type="button"
        aria-label="Dismiss notice"
        onClick={(e) => {
          e.stopPropagation()
          onDismiss(issue)
        }}
        style={{
          flexShrink: 0,
          padding: '4px 8px',
          fontSize: '12px',
          fontWeight: 600,
          background: 'transparent',
          border: '1px solid var(--color-border, rgba(255,255,255,0.2))',
          borderRadius: '6px',
          color: 'var(--color-text-muted, #94a3b8)',
          cursor: 'pointer',
        }}
      >
        Dismiss
      </button>
    </div>
  )
}
