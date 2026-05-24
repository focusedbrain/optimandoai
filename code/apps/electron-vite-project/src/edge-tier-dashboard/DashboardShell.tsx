import { useCallback, useEffect, useState } from 'react'
import { EdgeTierWizardModal } from '../edge-tier-wizard/index.js'
import { ReplicasList } from './ReplicasList.js'
import { VerificationsList } from './VerificationsList.js'
import { ReplicaDetail } from './ReplicaDetail.js'
import type { DashboardUpdatePayload, ReplicaStatus } from './types.js'

export type DashboardTab = 'replicas' | 'verifications'

export interface DashboardShellViewProps {
  edgeTierEnabled: boolean
  replicas: ReplicaStatus[]
  verifications: DashboardUpdatePayload['verifications']
  activeTab: DashboardTab
  onTabChange: (tab: DashboardTab) => void
  selectedReplica: ReplicaStatus | null
  onViewDetails: (replica: ReplicaStatus) => void
  onCloseDetail: () => void
  onLaunchWizard: () => void
  loading?: boolean
  error?: string | null
  fetchLogs?: (edgePodId: string) => Promise<{ ok: boolean; lines?: string[]; error?: string }>
}

export function DashboardShellView({
  edgeTierEnabled,
  replicas,
  verifications,
  activeTab,
  onTabChange,
  selectedReplica,
  onViewDetails,
  onCloseDetail,
  onLaunchWizard,
  loading,
  error,
  fetchLogs,
}: DashboardShellViewProps) {
  if (!edgeTierEnabled) {
    return (
      <div
        data-testid="edge-dashboard-empty"
        style={{
          maxWidth: 560,
          margin: '48px auto',
          padding: 24,
          textAlign: 'center',
          border: '1px dashed var(--border)',
          borderRadius: 10,
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Edge tier is not configured</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 20 }}>
          Start the wizard to deploy your first replica.
        </p>
        <button
          type="button"
          data-testid="edge-dashboard-launch-wizard"
          onClick={onLaunchWizard}
          style={{
            padding: '8px 16px',
            borderRadius: 8,
            border: '1px solid #6366f1',
            background: '#eef2ff',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          Set up edge tier
        </button>
      </div>
    )
  }

  return (
    <div data-testid="edge-dashboard" style={{ padding: '24px 32px', maxWidth: 960, margin: '0 auto' }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ margin: '0 0 4px', fontSize: 20 }}>Edge tier</h1>
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 13 }}>
          Replica health and recent certificate verifications.
        </p>
      </header>

      {loading && <p style={{ color: 'var(--text-secondary)' }}>Loading…</p>}
      {error && <p style={{ color: '#ef4444' }}>{error}</p>}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          type="button"
          data-testid="edge-dashboard-tab-replicas"
          onClick={() => onTabChange('replicas')}
          style={{
            padding: '6px 12px',
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: activeTab === 'replicas' ? '#e2e8f0' : 'transparent',
            fontWeight: activeTab === 'replicas' ? 600 : 400,
            cursor: 'pointer',
          }}
        >
          Replicas
        </button>
        <button
          type="button"
          data-testid="edge-dashboard-tab-verifications"
          onClick={() => onTabChange('verifications')}
          style={{
            padding: '6px 12px',
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: activeTab === 'verifications' ? '#e2e8f0' : 'transparent',
            fontWeight: activeTab === 'verifications' ? 600 : 400,
            cursor: 'pointer',
          }}
        >
          Verifications
        </button>
      </div>

      {activeTab === 'replicas' ? (
        <ReplicasList replicas={replicas} onViewDetails={onViewDetails} />
      ) : (
        <VerificationsList verifications={verifications} />
      )}

      {selectedReplica && (
        <ReplicaDetail replica={selectedReplica} onClose={onCloseDetail} fetchLogs={fetchLogs} />
      )}
    </div>
  )
}

export function DashboardShell() {
  const [payload, setPayload] = useState<DashboardUpdatePayload | null>(null)
  const [activeTab, setActiveTab] = useState<DashboardTab>('replicas')
  const [selectedReplica, setSelectedReplica] = useState<ReplicaStatus | null>(null)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const bridge = window.dashboard
    if (!bridge) {
      setError('Dashboard bridge unavailable')
      setLoading(false)
      return
    }
    try {
      const [replicas, verifications, status] = await Promise.all([
        bridge.getReplicas(),
        bridge.getVerifications(),
        window.edgeTier?.getStatus?.() ?? Promise.resolve(null),
      ])
      const enabled =
        status && typeof status === 'object' && 'edge_tier_enabled' in status
          ? Boolean((status as { edge_tier_enabled: boolean }).edge_tier_enabled)
          : false
      setPayload({
        edge_tier_enabled: enabled,
        replicas,
        verifications,
      })
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const bridge = window.dashboard
    if (!bridge) {
      setError('Dashboard bridge unavailable')
      setLoading(false)
      return
    }

    void bridge.subscribeUpdates().then(() => undefined)
    const unsub = bridge.onUpdates((update) => {
      setPayload(update)
      setLoading(false)
      setError(null)
    })
    void refresh()
    return unsub
  }, [refresh])

  const fetchLogs = useCallback(async (edgePodId: string) => {
    const bridge = window.dashboard
    if (!bridge?.fetchReplicaLogs) {
      return { ok: false, error: 'Log fetch unavailable' }
    }
    return bridge.fetchReplicaLogs(edgePodId)
  }, [])

  return (
    <>
      <DashboardShellView
        edgeTierEnabled={payload?.edge_tier_enabled ?? false}
        replicas={payload?.replicas ?? []}
        verifications={payload?.verifications ?? []}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        selectedReplica={selectedReplica}
        onViewDetails={setSelectedReplica}
        onCloseDetail={() => setSelectedReplica(null)}
        onLaunchWizard={() => setWizardOpen(true)}
        loading={loading && !payload}
        error={error}
        fetchLogs={fetchLogs}
      />
      {wizardOpen && (
        <EdgeTierWizardModal
          open={wizardOpen}
          onClose={() => {
            setWizardOpen(false)
            void refresh()
          }}
        />
      )}
    </>
  )
}
