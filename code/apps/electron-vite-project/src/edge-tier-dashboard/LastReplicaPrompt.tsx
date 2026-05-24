import type { ReplicaStatus } from './types.js'

export interface LastReplicaPromptProps {
  onAddReplica: () => void
  onDisableEdgeTier: () => void
  onDismiss: () => void
}

export function LastReplicaPrompt({ onAddReplica, onDisableEdgeTier, onDismiss }: LastReplicaPromptProps) {
  return (
    <div
      data-testid="last-replica-prompt"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15,23,42,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1200,
      }}
    >
      <div
        style={{
          width: 'min(480px, 92vw)',
          background: 'var(--bg-primary, #fff)',
          borderRadius: 10,
          border: '1px solid var(--border)',
          padding: 20,
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: 16 }}>No replicas remain</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
          You removed your last edge replica. Add another replica or disable edge tier to return to local-only mode.
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onDismiss}>
            Later
          </button>
          <button type="button" data-testid="last-replica-disable" onClick={onDisableEdgeTier}>
            Disable edge tier
          </button>
          <button
            type="button"
            data-testid="last-replica-add"
            onClick={onAddReplica}
            style={{ background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 12px' }}
          >
            Add replica
          </button>
        </div>
      </div>
    </div>
  )
}

export type { ReplicaStatus }
