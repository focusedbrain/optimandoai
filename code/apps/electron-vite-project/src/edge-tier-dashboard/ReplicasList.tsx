import type { ReplicaStatus } from './types.js'
import { formatTimestamp, formatCertsPerMinute, healthColor, healthLabel } from './format.js'
import { ReplicaKebabMenu } from './ReplicaKebabMenu.js'
import type { ReplicaActionKind } from './replicaActions.js'

export interface ReplicasListProps {
  replicas: ReplicaStatus[]
  onViewDetails: (replica: ReplicaStatus) => void
  onReplicaAction?: (action: ReplicaActionKind, replica: ReplicaStatus) => void
  onViewReplacementExhausted?: (replica: ReplicaStatus) => void
}

export function ReplicasList({
  replicas,
  onViewDetails,
  onReplicaAction,
  onViewReplacementExhausted,
}: ReplicasListProps) {
  if (replicas.length === 0) {
    return (
      <p data-testid="edge-dashboard-replicas-empty" style={{ color: 'var(--text-secondary)', margin: 0 }}>
        No replicas configured.
      </p>
    )
  }

  return (
    <div data-testid="edge-dashboard-replicas">
      <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600 }}>Replicas</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
            <th style={{ padding: '6px 8px' }}>Host</th>
            <th style={{ padding: '6px 8px' }}>Health</th>
            <th style={{ padding: '6px 8px' }}>Recovery</th>
            <th style={{ padding: '6px 8px' }}>Last cert</th>
            <th style={{ padding: '6px 8px' }}>Certs/min</th>
            <th style={{ padding: '6px 8px' }} />
          </tr>
        </thead>
        <tbody>
          {replicas.map((replica) => (
            <tr key={replica.edge_pod_id} style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={{ padding: '6px 8px' }}>
                <div>{replica.host}:{replica.port}</div>
                <div style={{ color: 'var(--text-secondary)', fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>
                  {replica.edge_pod_id}
                </div>
              </td>
              <td style={{ padding: '6px 8px', color: healthColor(replica.health), fontWeight: 600 }}>
                {healthLabel(replica.health)}
              </td>
              <td style={{ padding: '6px 8px' }}>
                {replica.degraded ? (
                  <button
                    type="button"
                    data-testid={`replica-recovery-warning-${replica.edge_pod_id}`}
                    onClick={() => onViewReplacementExhausted?.(replica)}
                    style={{
                      padding: '4px 8px',
                      fontSize: 10,
                      borderRadius: 6,
                      border: '1px solid #f59e0b',
                      background: '#fffbeb',
                      color: '#92400e',
                      cursor: 'pointer',
                      fontFamily: 'ui-monospace, monospace',
                    }}
                  >
                    Recovery paused
                  </button>
                ) : (
                  <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>—</span>
                )}
              </td>
              <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                {formatTimestamp(replica.last_cert_timestamp)}
              </td>
              <td style={{ padding: '6px 8px' }}>{formatCertsPerMinute(replica.certs_per_minute)}</td>
              <td style={{ padding: '6px 8px' }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button
                    type="button"
                    data-testid={`replica-view-details-${replica.edge_pod_id}`}
                    onClick={() => onViewDetails(replica)}
                    style={{
                      padding: '4px 10px',
                      fontSize: 11,
                      borderRadius: 6,
                      border: '1px solid var(--border)',
                      background: 'transparent',
                      cursor: 'pointer',
                    }}
                  >
                    View details
                  </button>
                  {onReplicaAction && (
                    <ReplicaKebabMenu replica={replica} onAction={onReplicaAction} />
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
