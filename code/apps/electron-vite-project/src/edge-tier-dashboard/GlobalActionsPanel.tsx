import { FallbackPolicySettings } from './FallbackPolicySettings.js'
import { KnownHostsSettings } from './KnownHostsSettings.js'
import type { DashboardFallbackPolicy } from './types.js'

export interface GlobalActionsPanelProps {
  replicaCount: number
  fallbackPolicy: DashboardFallbackPolicy
  onRotateKeys: () => void
  onPauseEdgeTier: () => void
  onFallbackPolicyChange: (policy: DashboardFallbackPolicy) => void
  policySaving?: boolean
}

export function GlobalActionsPanel({
  replicaCount,
  fallbackPolicy,
  onRotateKeys,
  onPauseEdgeTier,
  onFallbackPolicyChange,
  policySaving,
}: GlobalActionsPanelProps) {
  return (
    <section
      data-testid="edge-global-actions"
      style={{
        marginBottom: 24,
        padding: 16,
        borderRadius: 10,
        border: '1px solid var(--border)',
        background: 'var(--bg-secondary, #f8fafc)',
      }}
    >
      <h2 style={{ margin: '0 0 12px', fontSize: 15 }}>Global actions</h2>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
        <button
          type="button"
          data-testid="global-rotate-keys"
          onClick={onRotateKeys}
          disabled={replicaCount === 0}
          style={{
            padding: '8px 14px',
            borderRadius: 6,
            border: '1px solid #6366f1',
            background: '#eef2ff',
            cursor: replicaCount === 0 ? 'not-allowed' : 'pointer',
            opacity: replicaCount === 0 ? 0.5 : 1,
          }}
        >
          Rotate edge keys
        </button>
        <button
          type="button"
          data-testid="global-pause-edge-tier"
          onClick={onPauseEdgeTier}
          style={{
            padding: '8px 14px',
            borderRadius: 6,
            border: '1px solid #dc2626',
            background: '#fef2f2',
            color: '#b91c1c',
            cursor: 'pointer',
          }}
        >
          Pause edge tier
        </button>
      </div>
      <FallbackPolicySettings
        policy={fallbackPolicy}
        onChange={onFallbackPolicyChange}
        disabled={policySaving}
      />
      <KnownHostsSettings disabled={policySaving} />
    </section>
  )
}
