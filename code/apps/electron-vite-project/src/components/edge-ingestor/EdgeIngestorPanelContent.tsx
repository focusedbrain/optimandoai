/**
 * Email verification panel — settings section above connected email accounts (Prompt C).
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { EdgeTierWizardModal } from '../../edge-tier-wizard/index.js'
import { ReplicaActionModal } from '../../edge-tier-dashboard/ReplicaActionModal.js'
import { ReplicaDetail } from '../../edge-tier-dashboard/ReplicaDetail.js'
import type { ReplicaStatus } from '../../edge-tier-dashboard/types.js'
import type { ReplicaActionKind } from '../../edge-tier-dashboard/replicaActions.js'
import type { SshKeyEntryFormValues } from '../../edge-tier-dashboard/SshKeyEntryForm.js'
import type { LogEvent } from '../../edge-tier-wizard/types.js'
import { HostKeyMismatchModal } from '../../edge-tier-dashboard/HostKeyMismatchModal.js'
import { extractHostKeyMismatch, type HostKeyMismatchPayload } from '../../edge-tier-dashboard/hostKeyMismatchTypes.js'
import { healthLabel } from '../../edge-tier-dashboard/format.js'
import {
  configurationStateFromDashboardPayload,
  type EdgeConfigurationState,
} from '../../edge-tier/configurationState.js'
import { WIZARD_UPGRADE_URL } from '../../edge-tier-wizard/copy.js'
import { openAppExternalUrl } from '../../lib/openAppExternalUrl.js'
import { SwitchBackToLocalModal } from './SwitchBackToLocalModal.js'
import {
  ALLOW_TEMPORARY_LOCAL_BUTTON,
  configuredActiveBody,
  configuredUnreachableBody,
  EMAIL_VERIFICATION_CURRENT_SETUP,
  EMAIL_VERIFICATION_LEARN_MORE,
  EMAIL_VERIFICATION_LEARN_MORE_PARAGRAPHS,
  EMAIL_VERIFICATION_SUMMARY,
  EMAIL_VERIFICATION_TITLE,
  EMAIL_VERIFICATION_UPGRADE,
  HOST_FALLBACK_CONFIRM_BODY,
  MANAGE_REPLICAS_BUTTON,
  PAID_TIER_BADGE,
  REMOVE_REPLICA_BUTTON,
  RESUME_SETUP_BUTTON,
  RETRY_CONNECTION_BUTTON,
  SETUP_SERVER_VERIFICATION_BUTTON,
  setupInProgressBody,
  SWITCH_BACK_TO_LOCAL_BUTTON,
} from './emailVerificationCopy.js'

const muted = '#64748b'
const text = '#0f172a'

const primaryBtnStyle: CSSProperties = {
  padding: '6px 12px',
  borderRadius: 6,
  border: 'none',
  background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
  color: '#fff',
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 11,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
}

const secondaryBtnStyle: CSSProperties = {
  padding: '6px 12px',
  borderRadius: 6,
  border: '1px solid rgba(15,23,42,0.15)',
  background: '#fff',
  color: text,
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 11,
}

const dangerBtnStyle: CSSProperties = {
  ...secondaryBtnStyle,
  border: '1px solid rgba(220,38,38,0.35)',
  color: '#b91c1c',
}

function replicaBorder(health: ReplicaStatus['health']): string {
  if (health === 'healthy') return '1px solid rgba(34,197,94,0.3)'
  if (health === 'unhealthy') return '1px solid rgba(239,68,68,0.35)'
  return '1px solid rgba(148,163,184,0.35)'
}

function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return 'just now'
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export interface EdgeIngestorPanelContentProps {
  onReplicaCountChange?: (count: number) => void
}

export function EdgeIngestorPanelContent({ onReplicaCountChange }: EdgeIngestorPanelContentProps) {
  const [replicas, setReplicas] = useState<ReplicaStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [learnMoreOpen, setLearnMoreOpen] = useState(false)
  const [replicasExpanded, setReplicasExpanded] = useState(false)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [detailReplica, setDetailReplica] = useState<ReplicaStatus | null>(null)
  const [actionModal, setActionModal] = useState<{ action: ReplicaActionKind; replica: ReplicaStatus } | null>(null)
  const [actionRunning, setActionRunning] = useState(false)
  const [actionLogs, setActionLogs] = useState<LogEvent[]>([])
  const [actionError, setActionError] = useState<string | null>(null)
  const [hostKeyMismatch, setHostKeyMismatch] = useState<{
    payload: HostKeyMismatchPayload
    retry: () => Promise<void>
  } | null>(null)
  const [hostKeyTrustBusy, setHostKeyTrustBusy] = useState(false)
  const [configurationState, setConfigurationState] =
    useState<EdgeConfigurationState>('not_configured')
  const [holdQueueCount, setHoldQueueCount] = useState(0)
  const [isPaidTier, setIsPaidTier] = useState<boolean | null>(null)
  const [switchBackOpen, setSwitchBackOpen] = useState(false)
  const [switchBackRunning, setSwitchBackRunning] = useState(false)
  const [fallbackConfirmOpen, setFallbackConfirmOpen] = useState(false)
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false)
  const [removeRunning, setRemoveRunning] = useState(false)
  const progressUnsubRef = useRef<(() => void) | null>(null)

  const primaryHost = replicas[0]?.host ?? 'your server'

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
    const unsub = dashboardBridge.onUpdates((payload) => {
      setConfigurationState(configurationStateFromDashboardPayload(payload))
      void refreshReplicas()
    })
    return unsub
  }, [refreshReplicas])

  useEffect(() => {
    const refreshMode = async () => {
      const snap = await window.ingestionMode?.get?.()
      if (!snap) return
      const hold = (snap as { holdQueue?: { count?: number } }).holdQueue
      setHoldQueueCount(hold?.count ?? 0)
    }
    void refreshMode()
    const off = window.ingestionMode?.onUpdated?.((snap) => {
      const hold = (snap as { holdQueue?: { count?: number } }).holdQueue
      setHoldQueueCount(hold?.count ?? 0)
    })
    return () => off?.()
  }, [])

  useEffect(() => {
    void (async () => {
      const tier = await window.wizard?.refreshTier?.()
      if (tier) setIsPaidTier(tier.isPaidTier)
    })()
  }, [])

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

  const openWizard = useCallback(async () => {
    const tier = await window.wizard?.refreshTier?.()
    const paid = tier?.isPaidTier ?? isPaidTier ?? false
    if (!paid) {
      await openAppExternalUrl(WIZARD_UPGRADE_URL)
      return
    }
    setWizardOpen(true)
  }, [isPaidTier])

  const handleSwitchBack = async () => {
    setSwitchBackRunning(true)
    try {
      await window.wizard?.startOverLocally?.()
      setSwitchBackOpen(false)
      void refreshReplicas()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setSwitchBackRunning(false)
    }
  }

  const handleRemoveReplicaLocally = async () => {
    setRemoveRunning(true)
    try {
      await window.wizard?.startOverLocally?.()
      setRemoveConfirmOpen(false)
      void refreshReplicas()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setRemoveRunning(false)
    }
  }

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
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setHostKeyTrustBusy(false)
    }
  }, [hostKeyMismatch])

  const lastContact = formatRelativeTime(
    replicas[0]?.last_cert_timestamp ?? replicas[0]?.health_checked_at,
  )

  const showPaidBadge = isPaidTier === false

  const renderCurrentSetup = () => {
    if (loading) {
      return (
        <div style={{ padding: 8, fontSize: 12, color: muted }} data-testid="email-verification-loading">
          Loading current setup…
        </div>
      )
    }

    switch (configurationState) {
      case 'not_configured':
        return (
          <div data-testid="email-verification-not-configured">
            <p style={{ margin: '0 0 12px', fontSize: 12, color: muted }}>
              Verification is currently running on this computer.
            </p>
            <button
              type="button"
              data-testid="email-verification-setup-button"
              style={{
                ...primaryBtnStyle,
                opacity: showPaidBadge ? 0.85 : 1,
              }}
              onClick={() => void openWizard()}
            >
              {SETUP_SERVER_VERIFICATION_BUTTON}
              {showPaidBadge ? (
                <span
                  style={{
                    marginLeft: 4,
                    padding: '1px 5px',
                    borderRadius: 4,
                    background: 'rgba(255,255,255,0.2)',
                    fontSize: 9,
                  }}
                >
                  {PAID_TIER_BADGE}
                </span>
              ) : null}
            </button>
          </div>
        )

      case 'setup_in_progress':
        return (
          <div data-testid="email-verification-setup-in-progress">
            <p style={{ margin: '0 0 12px', fontSize: 12, color: muted }}>
              {setupInProgressBody(primaryHost)}
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button type="button" style={primaryBtnStyle} onClick={() => setWizardOpen(true)}>
                {RESUME_SETUP_BUTTON}
              </button>
              <button
                type="button"
                data-testid="email-verification-remove-replica"
                style={dangerBtnStyle}
                onClick={() => setRemoveConfirmOpen(true)}
              >
                {REMOVE_REPLICA_BUTTON}
              </button>
            </div>
          </div>
        )

      case 'configured_active':
        return (
          <div data-testid="email-verification-configured-active">
            <p style={{ margin: '0 0 12px', fontSize: 12, color: '#166534' }}>
              ✓ {configuredActiveBody(primaryHost, lastContact)}
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button
                type="button"
                data-testid="email-verification-manage-replicas"
                style={secondaryBtnStyle}
                onClick={() => setReplicasExpanded((v) => !v)}
              >
                {MANAGE_REPLICAS_BUTTON}
              </button>
              <button
                type="button"
                data-testid="email-verification-switch-back-local"
                style={dangerBtnStyle}
                onClick={() => setSwitchBackOpen(true)}
              >
                {SWITCH_BACK_TO_LOCAL_BUTTON}
              </button>
            </div>
          </div>
        )

      case 'configured_unreachable':
        return (
          <div data-testid="email-verification-configured-unreachable">
            <p style={{ margin: '0 0 12px', fontSize: 12, color: '#b45309' }}>
              ⚠ {configuredUnreachableBody(holdQueueCount)}
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button
                type="button"
                data-testid="email-verification-retry-connection"
                style={primaryBtnStyle}
                onClick={() => void window.ingestionMode?.retryEdge?.()}
              >
                {RETRY_CONNECTION_BUTTON}
              </button>
              {!fallbackConfirmOpen ? (
                <button
                  type="button"
                  data-testid="email-verification-allow-temporary-local"
                  style={secondaryBtnStyle}
                  onClick={() => setFallbackConfirmOpen(true)}
                >
                  {ALLOW_TEMPORARY_LOCAL_BUTTON}
                </button>
              ) : (
                <div
                  data-testid="email-verification-fallback-confirm"
                  style={{
                    flex: '1 1 100%',
                    padding: 10,
                    borderRadius: 8,
                    border: '1px solid rgba(245,158,11,0.35)',
                    background: '#fffbeb',
                  }}
                >
                  <p style={{ margin: '0 0 10px', fontSize: 11, color: '#92400e' }}>
                    {HOST_FALLBACK_CONFIRM_BODY}
                  </p>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" style={secondaryBtnStyle} onClick={() => setFallbackConfirmOpen(false)}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      style={primaryBtnStyle}
                      onClick={() => {
                        void window.ingestionMode?.authorizeHostFallback?.()
                        setFallbackConfirmOpen(false)
                      }}
                    >
                      Allow for this session
                    </button>
                  </div>
                </div>
              )}
              <button
                type="button"
                style={secondaryBtnStyle}
                onClick={() => setReplicasExpanded((v) => !v)}
              >
                {MANAGE_REPLICAS_BUTTON}
              </button>
            </div>
          </div>
        )

      default:
        return null
    }
  }

  const showReplicaList =
    replicasExpanded &&
    replicas.length > 0 &&
    (configurationState === 'configured_active' || configurationState === 'configured_unreachable')

  return (
    <>
      <div
        data-testid="edge-ingestor-panel-content"
        data-configuration-state={configurationState}
        style={{ marginBottom: 16 }}
      >
        <h3 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700, color: text }}>
          {EMAIL_VERIFICATION_TITLE}
        </h3>

        <p style={{ margin: '0 0 8px', fontSize: 11, lineHeight: 1.5, color: muted }}>
          {EMAIL_VERIFICATION_SUMMARY}
        </p>
        <p style={{ margin: '0 0 10px', fontSize: 11, lineHeight: 1.5, color: muted }}>
          {EMAIL_VERIFICATION_UPGRADE}
        </p>

        <button
          type="button"
          data-testid="email-verification-learn-more-toggle"
          onClick={() => setLearnMoreOpen((v) => !v)}
          style={{
            padding: 0,
            border: 'none',
            background: 'transparent',
            color: '#4f46e5',
            cursor: 'pointer',
            fontSize: 11,
            fontWeight: 600,
            marginBottom: 14,
          }}
        >
          {learnMoreOpen ? 'Hide details' : EMAIL_VERIFICATION_LEARN_MORE}
        </button>

        {learnMoreOpen ? (
          <div
            data-testid="email-verification-learn-more"
            style={{
              marginBottom: 14,
              padding: 12,
              borderRadius: 8,
              border: '1px solid rgba(15,23,42,0.08)',
              background: '#f8fafc',
            }}
          >
            {EMAIL_VERIFICATION_LEARN_MORE_PARAGRAPHS.map((paragraph) => (
              <p key={paragraph.slice(0, 32)} style={{ margin: '0 0 10px', fontSize: 11, lineHeight: 1.55, color: muted }}>
                {paragraph}
              </p>
            ))}
          </div>
        ) : null}

        <div
          style={{
            borderTop: '1px solid rgba(15,23,42,0.08)',
            paddingTop: 12,
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              color: muted,
              marginBottom: 10,
            }}
          >
            {EMAIL_VERIFICATION_CURRENT_SETUP}
          </div>
          <div data-testid="email-verification-current-setup">{renderCurrentSetup()}</div>
        </div>

        {showReplicaList ? (
          <div
            data-testid="email-verification-replica-list"
            style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}
          >
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
                  <div style={{ fontSize: 13, fontWeight: 500, color: text }}>
                    {replica.host}:{replica.port}
                    <span style={{ color: muted, marginLeft: 6, fontSize: 11 }}>
                      · {healthLabel(replica.health)}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: muted, marginTop: 2 }}>
                    Last contact: {formatRelativeTime(replica.last_cert_timestamp ?? replica.health_checked_at)}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={() => setDetailReplica(replica)}
                    style={secondaryBtnStyle}
                  >
                    Details
                  </button>
                  <button
                    type="button"
                    onClick={() => setActionModal({ action: 'remove', replica })}
                    style={dangerBtnStyle}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {configurationState === 'configured_active' || configurationState === 'configured_unreachable' ? (
          <button
            type="button"
            style={{ ...primaryBtnStyle, marginTop: 12 }}
            onClick={() => void openWizard()}
          >
            + Add server
          </button>
        ) : null}
      </div>

      {removeConfirmOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          data-testid="email-verification-remove-modal"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 12000,
            background: 'rgba(15, 23, 42, 0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
          onClick={removeRunning ? undefined : () => setRemoveConfirmOpen(false)}
        >
          <div
            style={{
              width: 'min(440px, 100%)',
              padding: 24,
              borderRadius: 12,
              background: '#fff',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ margin: '0 0 12px', fontSize: 17 }}>Remove replica?</h2>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: muted, lineHeight: 1.5 }}>
              This removes the verification server configuration from this app. The remote server may still be
              running until you remove it manually.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setRemoveConfirmOpen(false)} disabled={removeRunning}>
                Cancel
              </button>
              <button
                type="button"
                disabled={removeRunning}
                onClick={() => void handleRemoveReplicaLocally()}
                style={{ ...dangerBtnStyle, padding: '8px 14px' }}
              >
                {removeRunning ? 'Removing…' : REMOVE_REPLICA_BUTTON}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {switchBackOpen ? (
        <SwitchBackToLocalModal
          host={primaryHost}
          running={switchBackRunning}
          onClose={() => setSwitchBackOpen(false)}
          onConfirm={() => void handleSwitchBack()}
        />
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

      <EdgeTierWizardModal open={wizardOpen} onClose={() => { setWizardOpen(false); void refreshReplicas() }} />

      {hostKeyMismatch ? (
        <HostKeyMismatchModal
          payload={hostKeyMismatch.payload}
          busy={hostKeyTrustBusy}
          onTrustNewKey={() => void handleTrustHostKey()}
          onCancel={() => setHostKeyMismatch(null)}
        />
      ) : null}
    </>
  )
}
