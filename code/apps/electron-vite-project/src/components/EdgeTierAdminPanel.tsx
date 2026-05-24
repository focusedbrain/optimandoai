/**
 * Edge tier admin panel — Phase 3 (P3.10).
 *
 * Developer-grade read-only view: edge tier status + recent cert verifications.
 * Phase 4 builds the full wizard/dashboard UI; this seeds strategy §4.2 data.
 */

import { useCallback, useEffect, useState } from 'react'

import { EdgeTierWizardModal } from '../edge-tier-wizard/index.js'

export interface EdgeVerificationRow {
  timestamp: string
  edge_pod_id: string
  sub: string
  result: string
  phase: 'shallow' | 'deep'
}

export interface EdgeReplicaStatusRow {
  host: string
  port: number
  edge_pod_id: string
  edge_public_key: string
  last_success_at?: string
  last_failure_at?: string
  last_failure_reason?: string
}

export interface EdgeTierStatusView {
  mode: 'LOCAL_HOST' | 'LOCAL_VERIFY'
  edge_tier_enabled: boolean
  fallback_policy: 'reject' | 'local_only'
  replicas: EdgeReplicaStatusRow[]
  jwks_last_refreshed_at: string | null
}

export interface EdgeTierAdminPanelFormProps {
  status: EdgeTierStatusView | null
  verifications: EdgeVerificationRow[]
  loading?: boolean
  error?: string | null
  onSetupEdgeTier?: () => void
}

function formatTs(iso: string | undefined | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function resultColor(result: string): string {
  if (result === 'verified' || result === 'key_redelivered_after_restart') return '#22c55e'
  if (result === 'vault_locked_waiting') return '#f59e0b'
  return '#ef4444'
}

/**
 * Pure form — exported for unit tests.
 */
export function EdgeTierAdminPanelForm({
  status,
  verifications,
  loading,
  error,
  onSetupEdgeTier,
}: EdgeTierAdminPanelFormProps) {
  return (
    <div
      data-testid="edge-tier-admin-panel"
      style={{
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        fontSize: 12,
        color: '#e2e8f0',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>Edge tier status</div>
        {onSetupEdgeTier && (
          <button
            type="button"
            data-testid="edge-tier-setup-button"
            onClick={onSetupEdgeTier}
            style={{
              padding: '4px 10px',
              fontSize: 11,
              borderRadius: 6,
              border: '1px solid #6366f1',
              background: '#312e81',
              color: '#e0e7ff',
              cursor: 'pointer',
            }}
          >
            Set up edge tier
          </button>
        )}
      </div>
      {loading && <div style={{ color: '#94a3b8', marginBottom: 8 }}>Loading…</div>}
      {error && <div style={{ color: '#ef4444', marginBottom: 8 }}>{error}</div>}
      {status && (
        <div
          style={{
            marginBottom: 16,
            padding: 10,
            borderRadius: 6,
            border: '1px solid rgba(148,163,184,0.25)',
            background: 'rgba(15,23,42,0.6)',
          }}
        >
          <div style={{ marginBottom: 6 }}>
            <span style={{ color: '#94a3b8' }}>Mode: </span>
            <strong>{status.mode}</strong>
            <span style={{ color: '#64748b', marginLeft: 8 }}>
              (edge tier {status.edge_tier_enabled ? 'enabled' : 'disabled'})
            </span>
          </div>
          <div style={{ marginBottom: 6 }}>
            <span style={{ color: '#94a3b8' }}>Fallback policy: </span>
            {status.fallback_policy}
          </div>
          <div style={{ marginBottom: 8 }}>
            <span style={{ color: '#94a3b8' }}>JWKS last refreshed: </span>
            {formatTs(status.jwks_last_refreshed_at)}
          </div>
          <div style={{ fontWeight: 600, marginBottom: 4, color: '#94a3b8' }}>Replicas</div>
          {status.replicas.length === 0 ? (
            <div style={{ color: '#64748b' }}>None configured</div>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 16 }}>
              {status.replicas.map((r) => (
                <li key={r.edge_pod_id} style={{ marginBottom: 6 }}>
                  <div>
                    {r.host}:{r.port} — <span style={{ color: '#cbd5e1' }}>{r.edge_pod_id}</span>
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>
                    last OK: {formatTs(r.last_success_at)} | last fail:{' '}
                    {formatTs(r.last_failure_at)}
                    {r.last_failure_reason ? ` (${r.last_failure_reason})` : ''}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 13 }}>Edge verifications (last 50)</div>
      {verifications.length === 0 ? (
        <div style={{ color: '#64748b' }}>No verification events recorded yet.</div>
      ) : (
        <table
          style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}
          data-testid="edge-verifications-table"
        >
          <thead>
            <tr style={{ textAlign: 'left', color: '#94a3b8' }}>
              <th style={{ padding: '4px 6px', borderBottom: '1px solid #334155' }}>Time</th>
              <th style={{ padding: '4px 6px', borderBottom: '1px solid #334155' }}>Edge pod</th>
              <th style={{ padding: '4px 6px', borderBottom: '1px solid #334155' }}>Sub</th>
              <th style={{ padding: '4px 6px', borderBottom: '1px solid #334155' }}>Phase</th>
              <th style={{ padding: '4px 6px', borderBottom: '1px solid #334155' }}>Result</th>
            </tr>
          </thead>
          <tbody>
            {verifications.map((v, i) => (
              <tr key={`${v.timestamp}-${i}`}>
                <td style={{ padding: '4px 6px', borderBottom: '1px solid #1e293b' }}>
                  {formatTs(v.timestamp)}
                </td>
                <td style={{ padding: '4px 6px', borderBottom: '1px solid #1e293b' }}>
                  {v.edge_pod_id}
                </td>
                <td style={{ padding: '4px 6px', borderBottom: '1px solid #1e293b' }}>{v.sub}</td>
                <td style={{ padding: '4px 6px', borderBottom: '1px solid #1e293b' }}>{v.phase}</td>
                <td
                  style={{
                    padding: '4px 6px',
                    borderBottom: '1px solid #1e293b',
                    color: resultColor(v.result),
                  }}
                >
                  {v.result}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p style={{ marginTop: 12, fontSize: 10, color: '#64748b', lineHeight: 1.4 }}>
        Read-only audit trail sourced from the LOCAL_VERIFY verifier container. Each row is one
        /verify-cert check (shallow before validation, deep after).
      </p>
    </div>
  )
}

export function EdgeTierAdminPanel() {
  const [open, setOpen] = useState(false)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [status, setStatus] = useState<EdgeTierStatusView | null>(null)
  const [verifications, setVerifications] = useState<EdgeVerificationRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const bridge = window.edgeTier
    if (!bridge?.getStatus || !bridge?.getVerifications) {
      setError('Edge tier IPC unavailable')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const [st, ver] = await Promise.all([bridge.getStatus(), bridge.getVerifications(50)])
      setStatus(st as EdgeTierStatusView)
      setVerifications(ver as EdgeVerificationRow[])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    void refresh()
    const id = setInterval(() => void refresh(), 5000)
    const bridge = window.edgeTier
    const unsub = bridge?.onVerificationsUpdated?.(() => void refresh())
    return () => {
      clearInterval(id)
      unsub?.()
    }
  }, [open, refresh])

  return (
    <>
      <EdgeTierWizardModal open={wizardOpen} onClose={() => setWizardOpen(false)} />
      <button
        type="button"
        data-testid="edge-tier-admin-toggle"
        onClick={() => setOpen((v) => !v)}
        style={{
          position: 'fixed',
          bottom: 48,
          right: 12,
          zIndex: 9998,
          padding: '6px 10px',
          fontSize: 11,
          borderRadius: 6,
          border: '1px solid #475569',
          background: open ? '#334155' : '#1e293b',
          color: '#e2e8f0',
          cursor: 'pointer',
        }}
        title="Edge tier status and verification audit trail (Phase 3 dev view)"
      >
        {open ? 'Hide edge tier' : 'Edge tier'}
      </button>
      {open && (
        <div
          style={{
            position: 'fixed',
            bottom: 88,
            right: 12,
            width: 520,
            maxHeight: '55vh',
            overflow: 'auto',
            zIndex: 9998,
            padding: 12,
            borderRadius: 8,
            border: '1px solid #475569',
            background: 'rgba(15,23,42,0.95)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
          }}
        >
          <EdgeTierAdminPanelForm
            status={status}
            verifications={verifications}
            loading={loading}
            error={error}
            onSetupEdgeTier={() => setWizardOpen(true)}
          />
        </div>
      )}
    </>
  )
}
