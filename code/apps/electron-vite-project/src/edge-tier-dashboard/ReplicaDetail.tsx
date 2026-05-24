import { useCallback, useState } from 'react'
import type { ReplicaStatus } from './types.js'
import { formatTimestamp, healthColor, healthLabel } from './format.js'

export interface ReplicaDetailProps {
  replica: ReplicaStatus
  onClose: () => void
  fetchLogs?: (edgePodId: string) => Promise<{ ok: boolean; lines?: string[]; error?: string }>
}

export function ReplicaDetail({ replica, onClose, fetchLogs }: ReplicaDetailProps) {
  const [logs, setLogs] = useState<string[] | null>(null)
  const [logsError, setLogsError] = useState<string | null>(null)
  const [loadingLogs, setLoadingLogs] = useState(false)

  const handleFetchLogs = useCallback(async () => {
    if (!fetchLogs) {
      setLogsError('Log fetch is unavailable in this environment.')
      return
    }
    setLoadingLogs(true)
    setLogsError(null)
    try {
      const result = await fetchLogs(replica.edge_pod_id)
      if (result.ok && result.lines) {
        setLogs(result.lines)
      } else {
        setLogs(null)
        setLogsError(result.error ?? 'Failed to fetch logs')
      }
    } catch (err) {
      setLogsError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingLogs(false)
    }
  }, [fetchLogs, replica.edge_pod_id])

  return (
    <div
      data-testid="edge-replica-detail"
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15,23,42,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 'min(640px, 92vw)',
          maxHeight: '80vh',
          overflow: 'auto',
          background: 'var(--bg-primary, #fff)',
          borderRadius: 10,
          border: '1px solid var(--border)',
          padding: 20,
          boxShadow: '0 12px 40px rgba(15,23,42,0.2)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Replica details</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <dl style={{ margin: 0, fontSize: 13, display: 'grid', gridTemplateColumns: '140px 1fr', rowGap: 8 }}>
          <dt style={{ color: 'var(--text-secondary)' }}>Host</dt>
          <dd style={{ margin: 0 }}>{replica.host}:{replica.port}</dd>
          <dt style={{ color: 'var(--text-secondary)' }}>Edge pod ID</dt>
          <dd style={{ margin: 0, fontFamily: 'ui-monospace, monospace' }}>{replica.edge_pod_id}</dd>
          <dt style={{ color: 'var(--text-secondary)' }}>Public key</dt>
          <dd style={{ margin: 0, fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all' }}>
            {replica.edge_public_key}
          </dd>
          <dt style={{ color: 'var(--text-secondary)' }}>Health</dt>
          <dd style={{ margin: 0, color: healthColor(replica.health), fontWeight: 600 }}>
            {healthLabel(replica.health)}
            {replica.health_error ? ` (${replica.health_error})` : ''}
          </dd>
          <dt style={{ color: 'var(--text-secondary)' }}>Last health check</dt>
          <dd style={{ margin: 0 }}>{formatTimestamp(replica.health_checked_at)}</dd>
          <dt style={{ color: 'var(--text-secondary)' }}>Last cert issued</dt>
          <dd style={{ margin: 0 }}>{formatTimestamp(replica.last_cert_timestamp)}</dd>
        </dl>

        <div style={{ marginTop: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <strong style={{ fontSize: 13 }}>Recent remote logs</strong>
            <button
              type="button"
              data-testid="replica-fetch-logs"
              onClick={() => void handleFetchLogs()}
              disabled={loadingLogs}
              style={{ padding: '4px 10px', fontSize: 11, borderRadius: 6, border: '1px solid var(--border)' }}
            >
              {loadingLogs ? 'Fetching…' : 'Fetch logs'}
            </button>
          </div>
          {logsError && (
            <p data-testid="replica-logs-error" style={{ color: '#ef4444', fontSize: 12, margin: '0 0 8px' }}>
              {logsError}
            </p>
          )}
          {logs && logs.length > 0 ? (
            <pre
              data-testid="replica-logs-content"
              style={{
                margin: 0,
                padding: 10,
                fontSize: 11,
                background: '#0f172a',
                color: '#e2e8f0',
                borderRadius: 6,
                maxHeight: 240,
                overflow: 'auto',
              }}
            >
              {logs.join('\n')}
            </pre>
          ) : (
            !logsError && (
              <p style={{ color: 'var(--text-secondary)', fontSize: 12, margin: 0 }}>
                Logs are fetched on demand via SSH (not streamed).
              </p>
            )
          )}
        </div>
      </div>
    </div>
  )
}
