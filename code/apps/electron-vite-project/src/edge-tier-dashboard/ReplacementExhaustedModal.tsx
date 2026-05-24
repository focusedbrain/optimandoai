import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import type { ReplicaStatus } from './types.js'
import {
  quarantineMonoStyle,
  SANDBOX_AUDIT_PALETTE,
  invokeSandboxOrchestrator,
} from '../sandbox-orchestrator/index.js'

export interface DiagnosticReportRef {
  filename: string
  timestamp_iso8601: string
  report_json: string
}

export interface ReplacementExhaustedModalProps {
  replica: ReplicaStatus
  onClose: () => void
  onResumeRecovery: (containerRole: string) => Promise<{ ok: boolean; error?: string }>
  onNuclearReset: () => void
  listReportsForRole?: (
    replicaId: string,
    containerRole: string,
  ) => Promise<DiagnosticReportRef[]>
}

export function ReplacementExhaustedModal({
  replica,
  onClose,
  onResumeRecovery,
  onNuclearReset,
  listReportsForRole,
}: ReplacementExhaustedModalProps) {
  const exhausted =
    replica.supervisor_containers?.filter((c) => c.state === 'replacement_exhausted') ?? []
  const [selectedRole, setSelectedRole] = useState(exhausted[0]?.role ?? '')
  const [reports, setReports] = useState<DiagnosticReportRef[]>([])
  const [loadingReports, setLoadingReports] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [resumeBusy, setResumeBusy] = useState(false)

  const loadReports = useCallback(
    async (role: string) => {
      const loader =
        listReportsForRole ??
        (async (replicaId: string, containerRole: string) => {
          const bridge = window.dashboard
          if (!bridge?.listDiagnosticReportsForRole) return []
          return bridge.listDiagnosticReportsForRole({
            replicaId,
            containerRole,
          }) as Promise<DiagnosticReportRef[]>
        })

      setLoadingReports(true)
      setActionError(null)
      try {
        const items = await loader(replica.edge_pod_id, role)
        setReports(items)
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoadingReports(false)
      }
    },
    [listReportsForRole, replica.edge_pod_id],
  )

  useEffect(() => {
    if (selectedRole) {
      void loadReports(selectedRole)
    }
  }, [selectedRole, loadReports])

  const handleViewReport = useCallback(async (report: DiagnosticReportRef) => {
    setActionError(null)
    try {
      const parsed = JSON.parse(report.report_json) as {
        message_under_processing?: { sha256_hex?: string } | null
      }
      const hash = parsed.message_under_processing?.sha256_hex
      if (!hash) {
        setActionError('Report has no linked quarantine hash — open Quarantine tab for details')
        return
      }
      const result = await invokeSandboxOrchestrator(
        'diagnostic_report',
        replica.edge_pod_id,
        hash,
      )
      if (!result.ok) {
        setActionError(result.error ?? 'Failed to open report in sandbox')
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    }
  }, [replica.edge_pod_id])

  const handleResume = useCallback(async () => {
    if (!selectedRole) return
    setResumeBusy(true)
    setActionError(null)
    try {
      const result = await onResumeRecovery(selectedRole)
      if (!result.ok) {
        setActionError(result.error ?? 'Failed to resume automatic recovery')
        return
      }
      onClose()
    } finally {
      setResumeBusy(false)
    }
  }, [onClose, onResumeRecovery, selectedRole])

  return (
    <div
      data-testid="replacement-exhausted-modal"
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15,23,42,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1200,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(640px, 94vw)',
          maxHeight: '88vh',
          overflow: 'auto',
          background: SANDBOX_AUDIT_PALETTE.panelBg,
          border: `1px solid ${SANDBOX_AUDIT_PALETTE.panelBorder}`,
          borderRadius: 10,
          padding: 20,
        }}
      >
        <h2
          style={{
            margin: '0 0 8px',
            fontSize: 16,
            color: SANDBOX_AUDIT_PALETTE.header,
            fontFamily: SANDBOX_AUDIT_PALETTE.mono,
          }}
        >
          Automatic recovery paused
        </h2>
        <p style={{ ...quarantineMonoStyle, margin: '0 0 12px' }}>
          {replica.host}:{replica.port} — replacement budget exhausted for one or more containers.
        </p>

        <label style={{ ...quarantineMonoStyle, display: 'block', marginBottom: 8 }}>
          Container
          <select
            data-testid="replacement-exhausted-role-select"
            value={selectedRole}
            onChange={(e) => setSelectedRole(e.target.value)}
            style={{
              display: 'block',
              width: '100%',
              marginTop: 4,
              padding: '6px 8px',
              fontFamily: SANDBOX_AUDIT_PALETTE.mono,
              fontSize: 11,
            }}
          >
            {exhausted.map((c) => (
              <option key={c.role} value={c.role}>
                {c.container_name} ({c.role})
              </option>
            ))}
          </select>
        </label>

        <div data-testid="replacement-exhausted-reports" style={{ marginBottom: 16 }}>
          <h3 style={{ ...quarantineMonoStyle, margin: '0 0 8px', fontWeight: 600 }}>
            Diagnostic reports
          </h3>
          {loadingReports && <p style={quarantineMonoStyle}>Loading reports…</p>}
          {!loadingReports && reports.length === 0 && (
            <p style={quarantineMonoStyle}>No stored reports for this container role.</p>
          )}
          <ul style={{ margin: 0, paddingLeft: 18, ...quarantineMonoStyle }}>
            {reports.map((report) => (
              <li key={report.filename} style={{ marginBottom: 6 }}>
                <span>{report.timestamp_iso8601}</span>{' '}
                <button
                  type="button"
                  data-testid={`replacement-view-report-${report.filename}`}
                  onClick={() => void handleViewReport(report)}
                  style={modalButtonStyle}
                >
                  View in sandbox
                </button>
              </li>
            ))}
          </ul>
        </div>

        {actionError && (
          <p style={{ ...quarantineMonoStyle, color: '#b91c1c', marginBottom: 12 }}>{actionError}</p>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button
            type="button"
            data-testid="replacement-resume-recovery"
            disabled={resumeBusy || !selectedRole}
            onClick={() => void handleResume()}
            style={modalButtonStyle}
          >
            Resume automatic recovery
          </button>
          <button
            type="button"
            data-testid="replacement-nuclear-reset"
            onClick={onNuclearReset}
            style={{ ...modalButtonStyle, borderColor: '#dc2626', color: '#b91c1c' }}
          >
            Nuclear reset this replica
          </button>
          <button type="button" data-testid="replacement-exhausted-close" onClick={onClose} style={modalButtonStyle}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

const modalButtonStyle: CSSProperties = {
  padding: '6px 12px',
  fontSize: 11,
  borderRadius: 6,
  border: `1px solid ${SANDBOX_AUDIT_PALETTE.panelBorder}`,
  background: '#e4e4e7',
  color: SANDBOX_AUDIT_PALETTE.text,
  cursor: 'pointer',
  fontFamily: SANDBOX_AUDIT_PALETTE.mono,
}
