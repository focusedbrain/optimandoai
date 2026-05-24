import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import type { QuarantineDashboardSummary, QuarantineListItem } from './types.js'
import { formatTimestamp } from './format.js'
import {
  quarantinePanelStyle,
  quarantineMonoStyle,
  SANDBOX_AUDIT_PALETTE,
  invokeSandboxOrchestrator,
} from '../sandbox-orchestrator/index.js'
import { SshKeyEntryForm, type SshKeyEntryFormValues } from './SshKeyEntryForm.js'

const SUBJECT_TRUNCATE = 72

export function truncateQuarantineSubject(subject: string): string {
  if (subject.length <= SUBJECT_TRUNCATE) return subject
  return `${subject.slice(0, SUBJECT_TRUNCATE - 1)}…`
}

export interface QuarantinePanelProps {
  summary: QuarantineDashboardSummary
  listItems: QuarantineListItem[]
  selectedReplicaId: string | null
  onSelectReplica: (replicaId: string | null) => void
  onRefreshList: (replicaId?: string) => Promise<void>
  onDiscard?: (
    input: {
      replicaId: string
      hash: string
      confirmationText: string
    } & Partial<SshKeyEntryFormValues>,
  ) => Promise<{ ok: boolean; error?: string; needs_ssh?: boolean }>
  onViewReport?: (replicaId: string, hash: string) => Promise<{ ok: boolean; error?: string }>
  onViewBody?: (replicaId: string, hash: string) => Promise<{ ok: boolean; error?: string }>
  replicaHost?: string
  initialDiscardItem?: QuarantineListItem | null
  loading?: boolean
  error?: string | null
}

export function QuarantinePanelView({
  summary,
  listItems,
  selectedReplicaId,
  onSelectReplica,
  onRefreshList,
  onDiscard,
  onViewReport,
  onViewBody,
  replicaHost = 'edge replica',
  initialDiscardItem = null,
  loading,
  error,
}: QuarantinePanelProps) {
  const [actionError, setActionError] = useState<string | null>(null)
  const [discardTarget, setDiscardTarget] = useState<QuarantineListItem | null>(
    initialDiscardItem,
  )
  const [confirmationText, setConfirmationText] = useState('')
  const [discardNeedsSsh, setDiscardNeedsSsh] = useState(false)
  const [discardBusy, setDiscardBusy] = useState(false)
  const [sshValues, setSshValues] = useState<SshKeyEntryFormValues>({
    sshUser: 'root',
    sshPort: '22',
    sshKey: '',
    passphrase: '',
  })

  const viewReport = onViewReport ?? ((replicaId, hash) => invokeSandboxOrchestrator('diagnostic_report', replicaId, hash))
  const viewBody = onViewBody ?? ((replicaId, hash) => invokeSandboxOrchestrator('raw_email_body', replicaId, hash))

  const handleViewReport = useCallback(
    async (item: QuarantineListItem) => {
      setActionError(null)
      const result = await viewReport(item.replica_id, item.hash)
      if (!result.ok) {
        setActionError(result.error ?? 'Failed to open report in sandbox')
      }
    },
    [viewReport],
  )

  const handleViewBody = useCallback(
    async (item: QuarantineListItem) => {
      setActionError(null)
      const result = await viewBody(item.replica_id, item.hash)
      if (!result.ok) {
        setActionError(result.error ?? 'Failed to open message body in sandbox')
      }
    },
    [viewBody],
  )

  const closeDiscard = useCallback(() => {
    setDiscardTarget(null)
    setConfirmationText('')
    setDiscardNeedsSsh(false)
  }, [])

  const submitDiscard = useCallback(
    async (sshValues?: SshKeyEntryFormValues) => {
      if (!discardTarget || !onDiscard) return
      setDiscardBusy(true)
      setActionError(null)
      try {
        const result = await onDiscard({
          replicaId: discardTarget.replica_id,
          hash: discardTarget.hash,
          confirmationText,
          ...(sshValues ?? {}),
        })
        if (!result.ok) {
          if (result.needs_ssh) {
            setDiscardNeedsSsh(true)
            setActionError(result.error ?? 'SSH credentials required')
            return
          }
          setActionError(result.error ?? 'Discard failed')
          return
        }
        closeDiscard()
        await onRefreshList(selectedReplicaId ?? undefined)
      } finally {
        setDiscardBusy(false)
      }
    },
    [closeDiscard, confirmationText, discardTarget, onDiscard, onRefreshList, selectedReplicaId],
  )

  const confirmationOk =
    discardTarget != null &&
    confirmationText.trim().length > 0 &&
    (confirmationText.trim() === discardTarget.envelope_from ||
      confirmationText.trim() === discardTarget.envelope_subject_filtered)

  return (
    <div data-testid="edge-dashboard-quarantine" style={quarantinePanelStyle}>
      <header style={{ marginBottom: 16 }}>
        <h3
          style={{
            margin: '0 0 4px',
            fontSize: 14,
            fontWeight: 600,
            color: SANDBOX_AUDIT_PALETTE.header,
            fontFamily: SANDBOX_AUDIT_PALETTE.mono,
          }}
        >
          Quarantined Messages
        </h3>
        <p style={{ ...quarantineMonoStyle, margin: 0 }}>
          Audit trail only — view reports and bodies in the sandbox orchestrator.
        </p>
      </header>

      {loading && <p style={quarantineMonoStyle}>Loading quarantine entries…</p>}
      {error && <p style={{ ...quarantineMonoStyle, color: '#b91c1c' }}>{error}</p>}
      {actionError && <p style={{ ...quarantineMonoStyle, color: '#b91c1c' }}>{actionError}</p>}

      {summary.total_count === 0 ? (
        <p data-testid="quarantine-empty" style={quarantineMonoStyle}>
          No quarantined messages.
        </p>
      ) : (
        <>
          <div data-testid="quarantine-replica-summary" style={{ marginBottom: 16 }}>
            {summary.by_replica.map((row) => (
              <button
                key={row.replica_id}
                type="button"
                data-testid={`quarantine-replica-count-${row.replica_id}`}
                onClick={() => onSelectReplica(row.replica_id)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  marginBottom: 6,
                  padding: '8px 10px',
                  borderRadius: 4,
                  border: `1px solid ${SANDBOX_AUDIT_PALETTE.panelBorder}`,
                  background:
                    selectedReplicaId === row.replica_id ? '#e4e4e7' : 'transparent',
                  cursor: 'pointer',
                  ...quarantineMonoStyle,
                }}
              >
                {row.count} message{row.count === 1 ? '' : 's'} quarantined —{' '}
                <span style={{ color: SANDBOX_AUDIT_PALETTE.textMuted }}>{row.replica_id}</span>
              </button>
            ))}
          </div>

          {selectedReplicaId && (
            <div data-testid="quarantine-list">
              <h4
                style={{
                  margin: '0 0 8px',
                  fontSize: 12,
                  fontWeight: 600,
                  fontFamily: SANDBOX_AUDIT_PALETTE.mono,
                  color: SANDBOX_AUDIT_PALETTE.header,
                }}
              >
                Entries for {selectedReplicaId}
              </h4>
              <table style={{ width: '100%', borderCollapse: 'collapse', ...quarantineMonoStyle }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${SANDBOX_AUDIT_PALETTE.panelBorder}` }}>
                    <th style={{ padding: '6px 8px', textAlign: 'left' }}>Timestamp</th>
                    <th style={{ padding: '6px 8px', textAlign: 'left' }}>Sender (sender-reported)</th>
                    <th style={{ padding: '6px 8px', textAlign: 'left' }}>Subject</th>
                    <th style={{ padding: '6px 8px', textAlign: 'left' }}>Failed role</th>
                    <th style={{ padding: '6px 8px', textAlign: 'left' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {listItems
                    .filter((item) => item.replica_id === selectedReplicaId)
                    .map((item) => (
                      <tr
                        key={item.hash}
                        data-testid={`quarantine-row-${item.hash}`}
                        style={{ borderBottom: `1px solid ${SANDBOX_AUDIT_PALETTE.panelBorder}` }}
                      >
                        <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                          {formatTimestamp(item.quarantined_at)}
                        </td>
                        <td style={{ padding: '6px 8px' }}>{item.envelope_from}</td>
                        <td style={{ padding: '6px 8px' }}>
                          {truncateQuarantineSubject(item.envelope_subject_filtered)}
                        </td>
                        <td style={{ padding: '6px 8px' }}>{item.failed_role}</td>
                        <td style={{ padding: '6px 8px' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <button
                              type="button"
                              data-testid={`quarantine-view-report-${item.hash}`}
                              onClick={() => void handleViewReport(item)}
                              style={quarantineActionButtonStyle}
                            >
                              View report in sandbox
                            </button>
                            <button
                              type="button"
                              data-testid={`quarantine-view-body-${item.hash}`}
                              onClick={() => void handleViewBody(item)}
                              style={quarantineActionButtonStyle}
                            >
                              View message body in sandbox
                            </button>
                            {onDiscard && (
                              <button
                                type="button"
                                data-testid={`quarantine-discard-${item.hash}`}
                                onClick={() => {
                                  setDiscardTarget(item)
                                  setConfirmationText('')
                                  setDiscardNeedsSsh(false)
                                  setActionError(null)
                                }}
                                style={quarantineActionButtonStyle}
                              >
                                Discard quarantined message
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {discardTarget && onDiscard && (
        <div
          data-testid="quarantine-discard-modal"
          style={{
            marginTop: 16,
            padding: 12,
            border: `1px solid ${SANDBOX_AUDIT_PALETTE.panelBorder}`,
            borderRadius: 6,
            background: '#fafafa',
          }}
        >
          <p style={{ ...quarantineMonoStyle, margin: '0 0 8px' }}>
            Type the sender-reported address or full subject to confirm discard:
          </p>
          <input
            type="text"
            data-testid="quarantine-discard-confirmation"
            value={confirmationText}
            onChange={(e) => setConfirmationText(e.target.value)}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '6px 8px',
              fontFamily: SANDBOX_AUDIT_PALETTE.mono,
              fontSize: 11,
              border: `1px solid ${SANDBOX_AUDIT_PALETTE.panelBorder}`,
              borderRadius: 4,
              marginBottom: 8,
            }}
          />
          {discardNeedsSsh && (
            <>
              <SshKeyEntryForm
                host={replicaHost}
                values={sshValues}
                onChange={setSshValues}
                disabled={discardBusy}
              />
              <button
                type="button"
                data-testid="quarantine-discard-submit-ssh"
                disabled={
                  discardBusy ||
                  !confirmationOk ||
                  !sshValues.sshUser.trim() ||
                  !sshValues.sshKey.trim()
                }
                onClick={() => void submitDiscard(sshValues)}
                style={{ ...quarantineActionButtonStyle, marginTop: 8 }}
              >
                Confirm discard with SSH
              </button>
            </>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            {!discardNeedsSsh && (
              <button
                type="button"
                data-testid="quarantine-discard-submit"
                disabled={!confirmationOk || discardBusy}
                onClick={() => void submitDiscard()}
                style={quarantineActionButtonStyle}
              >
                Confirm discard
              </button>
            )}
            <button
              type="button"
              data-testid="quarantine-discard-cancel"
              onClick={closeDiscard}
              style={quarantineActionButtonStyle}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

const quarantineActionButtonStyle: CSSProperties = {
  padding: '4px 8px',
  fontSize: 10,
  borderRadius: 4,
  border: `1px solid ${SANDBOX_AUDIT_PALETTE.panelBorder}`,
  background: '#e4e4e7',
  color: SANDBOX_AUDIT_PALETTE.text,
  cursor: 'pointer',
  fontFamily: SANDBOX_AUDIT_PALETTE.mono,
  textAlign: 'left',
}

export function QuarantinePanel(
  props: Omit<QuarantinePanelProps, 'listItems' | 'onRefreshList' | 'replicaHost'> & {
    replicas?: Array<{ edge_pod_id: string; host: string }>
  },
) {
  const [listItems, setListItems] = useState<QuarantineListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refreshList = useCallback(async (replicaId?: string) => {
    const bridge = window.dashboard
    if (!bridge?.listQuarantine) {
      setError('Quarantine list unavailable')
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const items = (await bridge.listQuarantine(replicaId)) as QuarantineListItem[]
      setListItems(items)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshList(props.selectedReplicaId ?? undefined)
  }, [props.selectedReplicaId, refreshList])

  const handleDiscard = useCallback(
    async (input: {
      replicaId: string
      hash: string
      confirmationText: string
    } & Partial<SshKeyEntryFormValues>) => {
      const bridge = window.dashboard
      if (!bridge?.discardQuarantine) {
        return { ok: false, error: 'Discard unavailable' }
      }
      return bridge.discardQuarantine(input)
    },
    [],
  )

  const replicaHost =
    props.replicas?.find((r) => r.edge_pod_id === props.selectedReplicaId)?.host ?? 'edge replica'

  return (
    <QuarantinePanelView
      {...props}
      replicaHost={replicaHost}
      listItems={listItems}
      loading={loading || props.loading}
      error={error ?? props.error ?? null}
      onRefreshList={refreshList}
      onDiscard={handleDiscard}
    />
  )
}
