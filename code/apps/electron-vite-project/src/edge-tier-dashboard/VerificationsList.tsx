import type { VerificationEvent } from './types.js'
import { formatTimestamp, resultColor } from './format.js'

export interface VerificationsListProps {
  verifications: VerificationEvent[]
}

export function VerificationsList({ verifications }: VerificationsListProps) {
  return (
    <div data-testid="edge-dashboard-verifications">
      <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600 }}>Recent cert verifications</h3>
      {verifications.length === 0 ? (
        <p style={{ color: 'var(--text-secondary)', margin: 0 }}>No verification events recorded yet.</p>
      ) : (
        <table
          data-testid="edge-verifications-table"
          style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}
        >
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
              <th style={{ padding: '6px 8px' }}>Time</th>
              <th style={{ padding: '6px 8px' }}>Edge pod</th>
              <th style={{ padding: '6px 8px' }}>Result</th>
            </tr>
          </thead>
          <tbody>
            {verifications.map((row, idx) => (
              <tr key={`${row.timestamp}-${row.edge_pod_id}-${idx}`} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{formatTimestamp(row.timestamp)}</td>
                <td style={{ padding: '6px 8px', fontFamily: 'ui-monospace, monospace' }}>{row.edge_pod_id}</td>
                <td style={{ padding: '6px 8px', color: resultColor(row.result), fontWeight: 600 }}>
                  {row.result}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
