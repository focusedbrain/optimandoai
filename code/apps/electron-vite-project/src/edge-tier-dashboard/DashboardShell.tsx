import { useCallback, useEffect, useRef, useState } from 'react'
import { EdgeTierWizardModal } from '../edge-tier-wizard/index.js'
import type { LogEvent } from '../edge-tier-wizard/types.js'
import { ReplicasList } from './ReplicasList.js'
import { VerificationsList } from './VerificationsList.js'
import { ReplicaDetail } from './ReplicaDetail.js'
import { ReplicaActionModal } from './ReplicaActionModal.js'
import { LastReplicaPrompt } from './LastReplicaPrompt.js'
import { HostKeyMismatchModal } from './HostKeyMismatchModal.js'
import { extractHostKeyMismatch, type HostKeyMismatchPayload } from './hostKeyMismatchTypes.js'
import type { SshKeyEntryFormValues } from './SshKeyEntryForm.js'
import { GlobalActionsPanel } from './GlobalActionsPanel.js'
import { RotateKeysModal } from './RotateKeysModal.js'
import { PauseEdgeTierModal } from './PauseEdgeTierModal.js'
import { QuarantinePanel } from './QuarantinePanel.js'
import { ReplacementExhaustedModal } from './ReplacementExhaustedModal.js'
import { NuclearResetModal } from './NuclearResetModal.js'
import type {
  DashboardUpdatePayload,
  ReplicaStatus,
  DashboardFallbackPolicy,
  QuarantineDashboardSummary,
  ReplacementBudgetNotification,
} from './types.js'
import type { ReplicaActionKind } from './replicaActions.js'
import {
  SandboxViewerModal,
  registerSandboxViewShowHandler,
  quarantineMonoStyle,
  SANDBOX_AUDIT_PALETTE,
} from '../sandbox-orchestrator/index.js'
import type { SandboxViewContent } from '../sandbox-orchestrator/index.js'
import {
  EDGE_INGESTOR_NOT_CONFIGURED_BODY,
  EDGE_INGESTOR_NOT_CONFIGURED_TITLE,
  EDGE_INGESTOR_SETUP_BUTTON,
} from '../components/edge-ingestor/edgeIngestorCopy.js'

export type DashboardTab = 'replicas' | 'verifications' | 'quarantine'

const emptyQuarantineSummary: QuarantineDashboardSummary = {
  total_count: 0,
  by_replica: [],
  recent_failures: [],
}

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
  onReplicaAction?: (action: ReplicaActionKind, replica: ReplicaStatus) => void
  onNuclearReset?: (replica: ReplicaStatus) => void
  fallbackPolicy?: DashboardFallbackPolicy
  onRotateKeys?: () => void
  onPauseEdgeTier?: () => void
  onFallbackPolicyChange?: (policy: DashboardFallbackPolicy) => void
  policySaving?: boolean
  quarantineSummary?: QuarantineDashboardSummary
  selectedQuarantineReplicaId?: string | null
  onSelectQuarantineReplica?: (replicaId: string | null) => void
  replacementBudgetNotifications?: ReplacementBudgetNotification[]
  onViewReplacementExhausted?: (replica: ReplicaStatus) => void
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
  onReplicaAction,
  onNuclearReset,
  fallbackPolicy = 'reject',
  onRotateKeys,
  onPauseEdgeTier,
  onFallbackPolicyChange,
  policySaving,
  quarantineSummary = emptyQuarantineSummary,
  selectedQuarantineReplicaId = null,
  onSelectQuarantineReplica,
  replacementBudgetNotifications = [],
  onViewReplacementExhausted,
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
        <h2 style={{ marginTop: 0, fontSize: 18 }}>{EDGE_INGESTOR_NOT_CONFIGURED_TITLE}</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 20 }}>
          {EDGE_INGESTOR_NOT_CONFIGURED_BODY}
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
          {EDGE_INGESTOR_SETUP_BUTTON}
        </button>
      </div>
    )
  }

  return (
    <div data-testid="edge-dashboard" style={{ padding: '24px 32px', maxWidth: 960, margin: '0 auto' }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ margin: '0 0 4px', fontSize: 20 }}>Edge Ingestor</h1>
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 13 }}>
          Off-band replica health and recent certificate verifications.
        </p>
      </header>

      {loading && <p style={{ color: 'var(--text-secondary)' }}>Loading…</p>}
      {error && <p style={{ color: '#ef4444' }}>{error}</p>}

      {onRotateKeys && onPauseEdgeTier && onFallbackPolicyChange && (
        <GlobalActionsPanel
          replicaCount={replicas.length}
          fallbackPolicy={fallbackPolicy}
          onRotateKeys={onRotateKeys}
          onPauseEdgeTier={onPauseEdgeTier}
          onFallbackPolicyChange={onFallbackPolicyChange}
          policySaving={policySaving}
        />
      )}

      {replacementBudgetNotifications.length > 0 && (
        <div
          data-testid="edge-dashboard-replacement-budget-alerts"
          style={{
            ...quarantineMonoStyle,
            marginBottom: 16,
            padding: '10px 12px',
            background: '#fffbeb',
            border: '1px solid #f59e0b',
            borderRadius: 6,
            color: '#92400e',
          }}
        >
          {replacementBudgetNotifications.map((n) => (
            <p key={`${n.replica_id}:${n.container_role}`} style={{ margin: '0 0 8px' }}>
              {n.message}
            </p>
          ))}
        </div>
      )}

      {quarantineSummary.total_count > 0 && (
        <div
          data-testid="edge-dashboard-recent-failures"
          style={{
            ...quarantineMonoStyle,
            marginBottom: 16,
            padding: '8px 10px',
            background: SANDBOX_AUDIT_PALETTE.panelBg,
            border: `1px solid ${SANDBOX_AUDIT_PALETTE.panelBorder}`,
            borderRadius: 6,
          }}
        >
          Recent failures: {quarantineSummary.total_count} quarantined message
          {quarantineSummary.total_count === 1 ? '' : 's'}
          {activeTab !== 'quarantine' && onSelectQuarantineReplica && (
            <>
              {' '}
              —{' '}
              <button
                type="button"
                data-testid="edge-dashboard-open-quarantine"
                onClick={() => onTabChange('quarantine')}
                style={{
                  border: 'none',
                  background: 'transparent',
                  padding: 0,
                  cursor: 'pointer',
                  color: SANDBOX_AUDIT_PALETTE.header,
                  fontFamily: SANDBOX_AUDIT_PALETTE.mono,
                  fontSize: 11,
                  textDecoration: 'underline',
                }}
              >
                Review quarantine
              </button>
            </>
          )}
        </div>
      )}

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
        <button
          type="button"
          data-testid="edge-dashboard-tab-quarantine"
          onClick={() => onTabChange('quarantine')}
          style={{
            padding: '6px 12px',
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: activeTab === 'quarantine' ? '#e2e8f0' : 'transparent',
            fontWeight: activeTab === 'quarantine' ? 600 : 400,
            cursor: 'pointer',
          }}
        >
          Quarantine
        </button>
      </div>

      {activeTab === 'replicas' ? (
        <ReplicasList
          replicas={replicas}
          onViewDetails={onViewDetails}
          onReplicaAction={onReplicaAction}
          onNuclearReset={onNuclearReset}
          onViewReplacementExhausted={onViewReplacementExhausted}
        />
      ) : activeTab === 'verifications' ? (
        <VerificationsList verifications={verifications} />
      ) : (
        <QuarantinePanel
          summary={quarantineSummary}
          selectedReplicaId={selectedQuarantineReplicaId}
          onSelectReplica={onSelectQuarantineReplica ?? (() => undefined)}
          replicas={replicas.map((r) => ({ edge_pod_id: r.edge_pod_id, host: r.host }))}
        />
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
  const [actionModal, setActionModal] = useState<{
    replica: ReplicaStatus
    action: ReplicaActionKind
  } | null>(null)
  const [actionRunning, setActionRunning] = useState(false)
  const [actionLogs, setActionLogs] = useState<LogEvent[]>([])
  const [actionError, setActionError] = useState<string | null>(null)
  const [showLastReplicaPrompt, setShowLastReplicaPrompt] = useState(false)
  const [rotateOpen, setRotateOpen] = useState(false)
  const [pauseOpen, setPauseOpen] = useState(false)
  const [rotateRunning, setRotateRunning] = useState(false)
  const [pauseRunning, setPauseRunning] = useState(false)
  const [rotateLogs, setRotateLogs] = useState<LogEvent[]>([])
  const [rotateError, setRotateError] = useState<string | null>(null)
  const [rotatePartialFailure, setRotatePartialFailure] = useState<{
    failed_index: number
    total_replicas: number
    completed_replica_ids: string[]
  } | null>(null)
  const [policySaving, setPolicySaving] = useState(false)
  const [hostKeyMismatch, setHostKeyMismatch] = useState<{
    payload: HostKeyMismatchPayload
    retry: () => Promise<void>
  } | null>(null)
  const [hostKeyTrustBusy, setHostKeyTrustBusy] = useState(false)
  const [selectedQuarantineReplicaId, setSelectedQuarantineReplicaId] = useState<string | null>(
    null,
  )
  const [sandboxView, setSandboxView] = useState<SandboxViewContent | null>(null)
  const [replacementExhaustedReplica, setReplacementExhaustedReplica] =
    useState<ReplicaStatus | null>(null)
  const [nuclearResetReplica, setNuclearResetReplica] = useState<ReplicaStatus | null>(null)
  const [nuclearResetRunning, setNuclearResetRunning] = useState(false)
  const [nuclearResetLogs, setNuclearResetLogs] = useState<LogEvent[]>([])
  const [nuclearResetError, setNuclearResetError] = useState<string | null>(null)
  const progressUnsubRef = useRef<(() => void) | null>(null)
  const globalProgressUnsubRef = useRef<(() => void) | null>(null)

  const closeActionModal = useCallback(() => {
    progressUnsubRef.current?.()
    progressUnsubRef.current = null
    setActionModal(null)
    setActionRunning(false)
    setActionLogs([])
    setActionError(null)
  }, [])

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
        fallback_policy: 'reject',
        replicas: replicas as ReplicaStatus[],
        verifications: verifications as DashboardUpdatePayload['verifications'],
      })
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    registerSandboxViewShowHandler((view) => setSandboxView(view))
    return () => registerSandboxViewShowHandler(null)
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
      setPayload(update as DashboardUpdatePayload)
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

  const runReplicaAction = useCallback(
    async (values: SshKeyEntryFormValues) => {
      if (!actionModal) return
      const bridge = window.dashboard
      if (!bridge) {
        setActionError('Dashboard bridge unavailable')
        return
      }

      const operationId = crypto.randomUUID()
      setActionRunning(true)
      setActionError(null)
      setActionLogs([])

      progressUnsubRef.current?.()
      progressUnsubRef.current = bridge.onReplicaActionProgress(({ operationId: id, event }) => {
        if (id !== operationId) return
        setActionLogs((prev) => [
          ...prev,
          {
            kind: event.kind as LogEvent['kind'],
            message: String(event.message ?? ''),
            stage_name: typeof event.stage_name === 'string' ? event.stage_name : undefined,
          },
        ])
      })

      const input = {
        operationId,
        replicaId: actionModal.replica.edge_pod_id,
        sshUser: values.sshUser.trim(),
        sshPort: Number(values.sshPort) || 22,
        sshKey: values.sshKey,
        passphrase: values.passphrase.trim() || undefined,
      }

      try {
        let result: { ok: boolean; error?: string; result?: { wasLastReplica?: boolean } }
        switch (actionModal.action) {
          case 'restart':
            result = await bridge.restartReplica(input)
            break
          case 'redeploy':
            result = await bridge.redeployReplica(input)
            break
          case 'remove':
            result = await bridge.removeReplica(input)
            break
        }
        if (!result.ok) {
          const mismatch = extractHostKeyMismatch(result)
          if (mismatch) {
            setHostKeyMismatch({
              payload: mismatch,
              retry: async () => runReplicaAction(values),
            })
            return
          }
          setActionError(result.error ?? 'Action failed')
          return
        }
        if (result.result?.wasLastReplica) {
          closeActionModal()
          setShowLastReplicaPrompt(true)
          void refresh()
          return
        }
        closeActionModal()
        void refresh()
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err))
      } finally {
        setActionRunning(false)
        progressUnsubRef.current?.()
        progressUnsubRef.current = null
      }
    },
    [actionModal, closeActionModal, refresh],
  )

  const closeNuclearResetModal = useCallback(() => {
    progressUnsubRef.current?.()
    progressUnsubRef.current = null
    setNuclearResetReplica(null)
    setNuclearResetRunning(false)
    setNuclearResetLogs([])
    setNuclearResetError(null)
  }, [])

  const runNuclearReset = useCallback(
    async (values: {
      ssh: SshKeyEntryFormValues
      hostConfirm: string
      resetConfirm: string
      reason: string
    }) => {
      if (!nuclearResetReplica) return
      const bridge = window.dashboard
      if (!bridge?.nuclearResetReplica) {
        setNuclearResetError('Nuclear reset unavailable')
        return
      }

      const operationId = crypto.randomUUID()
      setNuclearResetRunning(true)
      setNuclearResetError(null)
      setNuclearResetLogs([])

      progressUnsubRef.current?.()
      progressUnsubRef.current = bridge.onReplicaActionProgress(({ operationId: id, event }) => {
        if (id !== operationId) return
        setNuclearResetLogs((prev) => [
          ...prev,
          {
            kind: event.kind as LogEvent['kind'],
            message: String(event.message ?? ''),
            stage_name: typeof event.stage_name === 'string' ? event.stage_name : undefined,
          },
        ])
      })

      const input = {
        operationId,
        replicaId: nuclearResetReplica.edge_pod_id,
        sshUser: values.ssh.sshUser.trim(),
        sshPort: Number(values.ssh.sshPort) || 22,
        sshKey: values.ssh.sshKey,
        passphrase: values.ssh.passphrase.trim() || undefined,
        hostConfirm: values.hostConfirm,
        resetConfirm: values.resetConfirm,
        reason: values.reason.trim(),
      }

      try {
        const result = await bridge.nuclearResetReplica(input)
        if (!result.ok) {
          const mismatch = extractHostKeyMismatch(result)
          if (mismatch) {
            setHostKeyMismatch({
              payload: mismatch,
              retry: async () => runNuclearReset(values),
            })
            return
          }
          setNuclearResetError(result.error ?? 'Nuclear reset failed')
          return
        }
        closeNuclearResetModal()
        void refresh()
      } catch (err) {
        setNuclearResetError(err instanceof Error ? err.message : String(err))
      } finally {
        setNuclearResetRunning(false)
        progressUnsubRef.current?.()
        progressUnsubRef.current = null
      }
    },
    [closeNuclearResetModal, nuclearResetReplica, refresh],
  )

  const handleDisableEdgeTier = useCallback(async () => {
    const bridge = window.dashboard
    if (!bridge?.pauseEdgeTier) return
    await bridge.pauseEdgeTier()
    setShowLastReplicaPrompt(false)
    void refresh()
  }, [refresh])

  const handlePauseEdgeTier = useCallback(async () => {
    const bridge = window.dashboard
    if (!bridge?.pauseEdgeTier) return
    setPauseRunning(true)
    try {
      await bridge.pauseEdgeTier()
      setPauseOpen(false)
      void refresh()
    } finally {
      setPauseRunning(false)
    }
  }, [refresh])

  const handleFallbackPolicyChange = useCallback(async (policy: DashboardFallbackPolicy) => {
    const bridge = window.dashboard
    if (!bridge?.setFallbackPolicy) return
    setPolicySaving(true)
    try {
      await bridge.setFallbackPolicy(policy)
      setPayload((prev) => (prev ? { ...prev, fallback_policy: policy } : prev))
    } finally {
      setPolicySaving(false)
    }
  }, [])

  const runRotateAllKeys = useCallback(
    async (values: SshKeyEntryFormValues) => {
      const bridge = window.dashboard
      if (!bridge?.rotateAllEdgeKeys) {
        setRotateError('Dashboard bridge unavailable')
        return
      }
      const operationId = crypto.randomUUID()
      setRotateRunning(true)
      setRotateError(null)
      setRotateLogs([])
      setRotatePartialFailure(null)

      globalProgressUnsubRef.current?.()
      globalProgressUnsubRef.current = bridge.onGlobalActionProgress(({ operationId: id, event }) => {
        if (id !== operationId) return
        setRotateLogs((prev) => [
          ...prev,
          {
            kind: event.kind as LogEvent['kind'],
            message: String(event.message ?? ''),
            stage_name: typeof event.stage_name === 'string' ? event.stage_name : undefined,
          },
        ])
      })

      try {
        const result = await bridge.rotateAllEdgeKeys({
          operationId,
          sshUser: values.sshUser.trim(),
          sshPort: Number(values.sshPort) || 22,
          sshKey: values.sshKey,
          passphrase: values.passphrase.trim() || undefined,
        })
        if (!result.ok) {
          const mismatch = extractHostKeyMismatch(result)
          if (mismatch) {
            setHostKeyMismatch({
              payload: mismatch,
              retry: async () => runRotateAllKeys(values),
            })
            return
          }
          setRotateError(result.error ?? 'Rotation failed')
          if (result.partial_failure) {
            setRotatePartialFailure({
              failed_index: result.partial_failure.failed_index,
              total_replicas: result.partial_failure.total_replicas,
              completed_replica_ids: result.partial_failure.completed_replica_ids,
            })
          }
          return
        }
        setRotateOpen(false)
        void refresh()
      } catch (err) {
        setRotateError(err instanceof Error ? err.message : String(err))
      } finally {
        setRotateRunning(false)
        globalProgressUnsubRef.current?.()
        globalProgressUnsubRef.current = null
      }
    },
    [refresh],
  )

  const handleTrustHostKey = useCallback(async () => {
    if (!hostKeyMismatch) return
    setHostKeyTrustBusy(true)
    try {
      await window.edgeTier?.removeKnownHost?.({
        host: hostKeyMismatch.payload.host,
        port: hostKeyMismatch.payload.port,
      })
      const retry = hostKeyMismatch.retry
      setHostKeyMismatch(null)
      await retry()
    } finally {
      setHostKeyTrustBusy(false)
    }
  }, [hostKeyMismatch])

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
        onReplicaAction={(action, replica) => {
          setActionModal({ action, replica })
          setActionLogs([])
          setActionError(null)
        }}
        onNuclearReset={(replica) => {
          setNuclearResetReplica(replica)
          setNuclearResetLogs([])
          setNuclearResetError(null)
        }}
        fallbackPolicy={payload?.fallback_policy ?? 'reject'}
        onRotateKeys={() => {
          setRotateOpen(true)
          setRotateError(null)
          setRotateLogs([])
          setRotatePartialFailure(null)
        }}
        onPauseEdgeTier={() => setPauseOpen(true)}
        onFallbackPolicyChange={(policy) => void handleFallbackPolicyChange(policy)}
        policySaving={policySaving}
        quarantineSummary={payload?.quarantine_summary ?? emptyQuarantineSummary}
        selectedQuarantineReplicaId={selectedQuarantineReplicaId}
        onSelectQuarantineReplica={setSelectedQuarantineReplicaId}
        replacementBudgetNotifications={payload?.replacement_budget_notifications ?? []}
        onViewReplacementExhausted={setReplacementExhaustedReplica}
        loading={loading && !payload}
        error={error}
        fetchLogs={fetchLogs}
      />
      {actionModal && (
        <ReplicaActionModal
          replica={actionModal.replica}
          action={actionModal.action}
          running={actionRunning}
          logEvents={actionLogs}
          error={actionError}
          onClose={closeActionModal}
          onSubmit={(values) => void runReplicaAction(values)}
        />
      )}
      {showLastReplicaPrompt && (
        <LastReplicaPrompt
          onAddReplica={() => {
            setShowLastReplicaPrompt(false)
            setWizardOpen(true)
          }}
          onDisableEdgeTier={() => void handleDisableEdgeTier()}
          onDismiss={() => setShowLastReplicaPrompt(false)}
        />
      )}
      {rotateOpen && (
        <RotateKeysModal
          replicaCount={payload?.replicas.length ?? 0}
          running={rotateRunning}
          logEvents={rotateLogs}
          error={rotateError}
          partialFailure={rotatePartialFailure}
          onClose={() => {
            if (!rotateRunning) setRotateOpen(false)
          }}
          onSubmit={(values) => void runRotateAllKeys(values)}
        />
      )}
      {pauseOpen && (
        <PauseEdgeTierModal
          running={pauseRunning}
          onClose={() => {
            if (!pauseRunning) setPauseOpen(false)
          }}
          onConfirm={() => void handlePauseEdgeTier()}
        />
      )}
      {wizardOpen && (
        <EdgeTierWizardModal
          open={wizardOpen}
          onClose={() => {
            setWizardOpen(false)
            void refresh()
          }}
        />
      )}
      {hostKeyMismatch && (
        <HostKeyMismatchModal
          payload={hostKeyMismatch.payload}
          busy={hostKeyTrustBusy}
          onTrustNewKey={() => void handleTrustHostKey()}
          onCancel={() => setHostKeyMismatch(null)}
        />
      )}
      <SandboxViewerModal view={sandboxView} onClose={() => setSandboxView(null)} />
      {replacementExhaustedReplica && (
        <ReplacementExhaustedModal
          replica={replacementExhaustedReplica}
          onClose={() => setReplacementExhaustedReplica(null)}
          onResumeRecovery={async (containerRole) => {
            const bridge = window.dashboard
            if (!bridge?.resumeAutomaticRecovery) {
              return { ok: false, error: 'Recovery resume unavailable' }
            }
            return bridge.resumeAutomaticRecovery({
              replicaId: replacementExhaustedReplica.edge_pod_id,
              containerRole,
            })
          }}
          onNuclearReset={() => {
            setReplacementExhaustedReplica(null)
            setNuclearResetReplica(replacementExhaustedReplica)
            setNuclearResetLogs([])
            setNuclearResetError(null)
          }}
        />
      )}
      {nuclearResetReplica && (
        <NuclearResetModal
          replica={nuclearResetReplica}
          running={nuclearResetRunning}
          logEvents={nuclearResetLogs}
          error={nuclearResetError}
          onClose={closeNuclearResetModal}
          onSubmit={(values) => void runNuclearReset(values)}
        />
      )}
    </>
  )
}
