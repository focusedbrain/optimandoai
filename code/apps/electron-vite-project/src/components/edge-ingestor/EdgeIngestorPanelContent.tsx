/**
 * Edge Ingestor list — rows styled like connected email accounts.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { EdgeTierWizardModal } from '../../edge-tier-wizard/index.js'
import { ReplicaActionModal } from '../../edge-tier-dashboard/ReplicaActionModal.js'
import { ReplicaDetail } from '../../edge-tier-dashboard/ReplicaDetail.js'
import type { ReplicaStatus } from '../../edge-tier-dashboard/types.js'
import type { ReplicaActionKind } from '../../edge-tier-dashboard/replicaActions.js'
import type { SshKeyEntryFormValues } from '../../edge-tier-dashboard/SshKeyEntryForm.js'
import type { LogEvent } from '../../edge-tier-wizard/types.js'
import { healthColor, healthLabel } from '../../edge-tier-dashboard/format.js'
import {
  EDGE_INGESTOR_ADD_BUTTON,
  EDGE_INGESTOR_EMPTY_HINT,
  EDGE_INGESTOR_EXPLAINER,
  EDGE_INGESTOR_NOT_CONFIGURED_BODY,
  EDGE_INGESTOR_NOT_CONFIGURED_TITLE,
  EDGE_INGESTOR_SETUP_BUTTON,
  EDGE_INGESTOR_SUBSECTION_TITLE,
} from './edgeIngestorCopy.js'

const muted = '#64748b'
const text = '#0f172a'

const subsectionHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 10,
  gap: 8,
}

const primaryBtnStyle: CSSProperties = {
  padding: '6px 12px',
  borderRadius: 6,
  border: 'none',
  background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
  color: '#fff',
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 11,
  display: 'flex',
  alignItems: 'center',
  gap: 4,
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 12000,
  background: 'rgba(15, 23, 42, 0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
}

const dialogCardStyle: CSSProperties = {
  width: 'min(480px, 100%)',
  padding: 24,
  borderRadius: 12,
  background: '#fff',
  border: '1px solid #e2e8f0',
  boxShadow: '0 16px 40px rgba(15, 23, 42, 0.18)',
  textAlign: 'center',
}

function replicaBorder(health: ReplicaStatus['health']): string {
  if (health === 'healthy') return '1px solid rgba(34,197,94,0.3)'
  if (health === 'unhealthy') return '1px solid rgba(239,68,68,0.35)'
  return '1px solid rgba(148,163,184,0.35)'
}

export interface EdgeIngestorPanelContentProps {
  onReplicaCountChange?: (count: number) => void
}

export function EdgeIngestorPanelContent({ onReplicaCountChange }: EdgeIngestorPanelContentProps) {
  const [replicas, setReplicas] = useState<ReplicaStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [setupDialogOpen, setSetupDialogOpen] = useState(false)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [detailReplica, setDetailReplica] = useState<ReplicaStatus | null>(null)
  const [actionModal, setActionModal] = useState<{ action: ReplicaActionKind; replica: ReplicaStatus } | null>(null)
  const [actionRunning, setActionRunning] = useState(false)
  const [actionLogs, setActionLogs] = useState<LogEvent[]>([])
  const [actionError, setActionError] = useState<string | null>(null)
  const progressUnsubRef = useRef<(() => void) | null>(null)

  const refreshReplicas = useCallback(async () => {
    const dashboardBridge = window.dashboard
    if (!dashboardBridge?.getReplicas) {
      setReplicas([])
      setLoading(false)
      onReplicaCountChange?.(0)
      return
    }
    try {
      const rows = (await dashboardBridge.getReplicas()) as ReplicaStatus[]
      const list = Array.isArray(rows) ? rows : []
      setReplicas(list)
      onReplicaCountChange?.(list.length)
    } catch {
      setReplicas([])
      onReplicaCountChange?.(0)
    } finally {
      setLoading(false)
    }
  }, [onReplicaCountChange])

  useEffect(() => {
    void refreshReplicas()
    const dashboardBridge = window.dashboard
    if (!dashboardBridge?.onUpdates) return
    const unsub = dashboardBridge.onUpdates(() => {
      void refreshReplicas()
    })
    return unsub
  }, [refreshReplicas])

  const closeActionModal = useCallback(() => {
    progressUnsubRef.current?.()
    progressUnsubRef.current = null
    setActionModal(null)
    setActionRunning(false)
    setActionLogs([])
    setActionError(null)
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
        let result: { ok: boolean; error?: string }
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
          setActionError(result.error ?? 'Action failed')
          return
        }
        closeActionModal()
        void refreshReplicas()
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err))
      } finally {
        setActionRunning(false)
        progressUnsubRef.current?.()
        progressUnsubRef.current = null
      }
    },
    [actionModal, closeActionModal, refreshReplicas],
  )

  const fetchLogs = useCallback(async (edgePodId: string) => {
    const bridge = window.dashboard
    if (!bridge?.fetchReplicaLogs) {
      return { ok: false, error: 'Log fetch unavailable' }
    }
    return bridge.fetchReplicaLogs(edgePodId)
  }, [])

  const openSetupFlow = () => {
    if (replicas.length === 0) {
      setSetupDialogOpen(true)
      return
    }
    setWizardOpen(true)
  }

  const handleLaunchWizard = () => {
    setSetupDialogOpen(false)
    setWizardOpen(true)
  }

  const handleWizardClose = () => {
    setWizardOpen(false)
    void refreshReplicas()
  }

  return (
    <>
      <div data-testid="edge-ingestor-panel-content" style={{ marginBottom: 16 }}>
        <div style={subsectionHeaderStyle}>
          <span style={{ fontSize: 12, fontWeight: 700, color: text }}>{EDGE_INGESTOR_SUBSECTION_TITLE}</span>
          <button
            type="button"
            data-testid="edge-ingestor-add-button"
            style={primaryBtnStyle}
            onClick={openSetupFlow}
          >
            <span>+</span> {replicas.length === 0 ? EDGE_INGESTOR_SETUP_BUTTON : EDGE_INGESTOR_ADD_BUTTON}
          </button>
        </div>

        <p style={{ margin: '0 0 12px', fontSize: 11, lineHeight: 1.5, color: muted }}>{EDGE_INGESTOR_EXPLAINER}</p>

        {loading ? (
          <div style={{ padding: 12, textAlign: 'center', fontSize: 12, color: muted }}>Loading edge ingestors…</div>
        ) : replicas.length === 0 ? (
          <div
            data-testid="edge-ingestor-empty"
            style={{
              padding: 16,
              background: '#fff',
              borderRadius: 8,
              border: '1px dashed rgba(15,23,42,0.2)',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 22, marginBottom: 6 }}>🛡️</div>
            <div style={{ fontSize: 12, color: muted, marginBottom: 8 }}>{EDGE_INGESTOR_EMPTY_HINT}</div>
            <button type="button" style={primaryBtnStyle} onClick={() => setSetupDialogOpen(true)}>
              {EDGE_INGESTOR_SETUP_BUTTON}
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {replicas.map((replica) => (
              <div
                key={replica.edge_pod_id}
                data-testid={`edge-ingestor-row-${replica.edge_pod_id}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  padding: '10px 12px',
                  background: '#fff',
                  borderRadius: 8,
                  border: replicaBorder(replica.health),
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: text,
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <span>🛡️</span>
                    <span>
                      {replica.host}:{replica.port}
                    </span>
                    <span style={{ color: muted }}>·</span>
                    <span style={{ color: muted, fontWeight: 500 }}>Edge Ingestor</span>
                    <span style={{ color: muted }}>·</span>
                    <span style={{ color: healthColor(replica.health), fontWeight: 600, fontSize: 11 }}>
                      {healthLabel(replica.health)}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: healthColor(replica.health),
                      }}
                    />
                    <span style={{ color: muted }}>
                      {replica.health_error?.trim() || 'Off-band validator and depackaging unit'}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 9,
                      color: '#94a3b8',
                      marginTop: 4,
                      fontFamily: 'ui-monospace, monospace',
                      wordBreak: 'break-all',
                    }}
                  >
                    id {replica.edge_pod_id}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  <button
                    type="button"
                    data-testid={`edge-ingestor-details-${replica.edge_pod_id}`}
                    onClick={() => setDetailReplica(replica)}
                    style={{
                      background: 'rgba(15,23,42,0.06)',
                      border: '1px solid rgba(15,23,42,0.12)',
                      color: text,
                      cursor: 'pointer',
                      padding: '6px 10px',
                      fontSize: 11,
                      fontWeight: 600,
                      borderRadius: 6,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Details
                  </button>
                  <button
                    type="button"
                    data-testid={`edge-ingestor-redeploy-${replica.edge_pod_id}`}
                    title="Redeploy — update the edge ingestor on this VPS"
                    onClick={() => setActionModal({ action: 'redeploy', replica })}
                    style={{
                      background: 'rgba(15,23,42,0.06)',
                      border: '1px solid rgba(15,23,42,0.12)',
                      color: text,
                      cursor: 'pointer',
                      padding: '6px 10px',
                      fontSize: 11,
                      fontWeight: 600,
                      borderRadius: 6,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Redeploy
                  </button>
                  <button
                    type="button"
                    data-testid={`edge-ingestor-remove-${replica.edge_pod_id}`}
                    title="Remove — delete this edge ingestor from WR Desk"
                    onClick={() => setActionModal({ action: 'remove', replica })}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#94a3b8',
                      cursor: 'pointer',
                      padding: 4,
                      fontSize: 14,
                    }}
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {setupDialogOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="edge-ingestor-setup-title"
          data-testid="edge-ingestor-setup-dialog"
          style={overlayStyle}
          onClick={() => setSetupDialogOpen(false)}
        >
          <div style={dialogCardStyle} onClick={(e) => e.stopPropagation()}>
            <h2 id="edge-ingestor-setup-title" style={{ margin: '0 0 12px', fontSize: 18, color: text }}>
              {EDGE_INGESTOR_NOT_CONFIGURED_TITLE}
            </h2>
            <p style={{ margin: '0 0 20px', color: muted, fontSize: 14, lineHeight: 1.5 }}>
              {EDGE_INGESTOR_NOT_CONFIGURED_BODY}
            </p>
            <button
              type="button"
              data-testid="edge-ingestor-setup-launch"
              style={{ ...primaryBtnStyle, padding: '8px 16px', fontSize: 13 }}
              onClick={handleLaunchWizard}
            >
              {EDGE_INGESTOR_SETUP_BUTTON}
            </button>
          </div>
        </div>
      ) : null}

      {detailReplica ? (
        <ReplicaDetail replica={detailReplica} onClose={() => setDetailReplica(null)} fetchLogs={fetchLogs} />
      ) : null}

      {actionModal ? (
        <ReplicaActionModal
          replica={actionModal.replica}
          action={actionModal.action}
          running={actionRunning}
          logEvents={actionLogs}
          error={actionError}
          onClose={closeActionModal}
          onSubmit={(values) => void runReplicaAction(values)}
        />
      ) : null}

      <EdgeTierWizardModal open={wizardOpen} onClose={handleWizardClose} />
    </>
  )
}
