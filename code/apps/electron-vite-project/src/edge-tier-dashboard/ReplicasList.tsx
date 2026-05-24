import type { ReplicaStatus } from './types.js'
import { formatTimestamp, formatCertsPerMinute, healthColor, healthLabel } from './format.js'

export interface ReplicasListProps {
  replicas: ReplicaStatus[]
  onViewDetails: (replica: ReplicaStatus) => void
}

export function ReplicasList({ replicas, onViewDetails }: ReplicasListProps) {
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
              <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                {formatTimestamp(replica.last_cert_timestamp)}
              </td>
              <td style={{ padding: '6px 8px' }}>{formatCertsPerMinute(replica.certs_per_minute)}</td>
              <td style={{ padding: '6px 8px' }}>
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
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
