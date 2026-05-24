/**
 * Edge Ingestor — inbox placement above email provider setup (P4.5 UX).
 */

import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { EdgeTierWizardModal } from '../edge-tier-wizard/index.js'
import { DashboardShell } from '../edge-tier-dashboard/index.js'
import {
  EDGE_INGESTOR_ACTION_BUTTON,
  EDGE_INGESTOR_CONFIGURED_LABEL,
  EDGE_INGESTOR_EXPLAINER,
  EDGE_INGESTOR_MANAGE_BUTTON,
  EDGE_INGESTOR_NOT_CONFIGURED_BODY,
  EDGE_INGESTOR_NOT_CONFIGURED_TITLE,
  EDGE_INGESTOR_SECTION_TITLE,
  EDGE_INGESTOR_SETUP_BUTTON,
} from './edge-ingestor/edgeIngestorCopy.js'

export interface EdgeIngestorSectionProps {
  /** Bulk inbox uses a compact bar; standard inbox uses a card above providers. */
  variant?: 'inbox' | 'bulk'
}

const sectionStyle: CSSProperties = {
  padding: '14px 18px',
  borderBottom: '1px solid #e2e8f0',
  background: 'linear-gradient(180deg, #f8fafc 0%, #ffffff 100%)',
  color: '#1e293b',
}

const titleStyle: CSSProperties = {
  margin: '0 0 6px',
  fontSize: 13,
  fontWeight: 700,
  letterSpacing: 0.2,
}

const explainerStyle: CSSProperties = {
  margin: '0 0 12px',
  fontSize: 12,
  lineHeight: 1.55,
  color: '#475569',
  maxWidth: 720,
}

const actionRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 10,
}

const primaryBtnStyle: CSSProperties = {
  padding: '6px 14px',
  borderRadius: 8,
  border: '1px solid #6366f1',
  background: '#eef2ff',
  color: '#312e81',
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 12,
}

const secondaryBtnStyle: CSSProperties = {
  padding: '6px 12px',
  borderRadius: 8,
  border: '1px solid #cbd5e1',
  background: '#fff',
  color: '#334155',
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 12,
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

const managePanelStyle: CSSProperties = {
  position: 'relative',
  width: 'min(960px, 100%)',
  maxHeight: 'min(92vh, 900px)',
  overflow: 'auto',
  borderRadius: 12,
  background: '#fff',
  border: '1px solid #e2e8f0',
  boxShadow: '0 16px 40px rgba(15, 23, 42, 0.18)',
}

function readEdgeEnabled(status: Record<string, unknown> | null): boolean {
  return Boolean(status && typeof status === 'object' && status.edge_tier_enabled === true)
}

export function EdgeIngestorSection({ variant = 'inbox' }: EdgeIngestorSectionProps) {
  const [edgeEnabled, setEdgeEnabled] = useState<boolean | null>(null)
  const [replicaCount, setReplicaCount] = useState(0)
  const [setupDialogOpen, setSetupDialogOpen] = useState(false)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)

  const refreshStatus = useCallback(async () => {
    const edgeBridge = window.edgeTier
    const dashboardBridge = window.dashboard
    if (!edgeBridge?.getStatus) {
      setEdgeEnabled(false)
      setReplicaCount(0)
      return
    }
    try {
      const [status, replicas] = await Promise.all([
        edgeBridge.getStatus(),
        dashboardBridge?.getReplicas?.() ?? Promise.resolve([]),
      ])
      setEdgeEnabled(readEdgeEnabled(status as Record<string, unknown>))
      setReplicaCount(Array.isArray(replicas) ? replicas.length : 0)
    } catch {
      setEdgeEnabled(false)
      setReplicaCount(0)
    }
  }, [])

  useEffect(() => {
    void refreshStatus()
    const dashboardBridge = window.dashboard
    if (!dashboardBridge?.onUpdates) return
    const unsub = dashboardBridge.onUpdates(() => {
      void refreshStatus()
    })
    return unsub
  }, [refreshStatus])

  const handlePrimaryClick = () => {
    if (edgeEnabled) {
      setManageOpen(true)
      return
    }
    setSetupDialogOpen(true)
  }

  const handleLaunchWizard = () => {
    setSetupDialogOpen(false)
    setWizardOpen(true)
  }

  const handleWizardClose = () => {
    setWizardOpen(false)
    void refreshStatus()
  }

  const compact = variant === 'bulk'

  return (
    <>
      <section
        data-testid="edge-ingestor-section"
        className={compact ? 'bulk-view-edge-ingestor-section' : 'inbox-edge-ingestor-section'}
        style={{
          ...sectionStyle,
          ...(compact ? { padding: '10px 16px' } : {}),
        }}
      >
        <h3 style={titleStyle}>{EDGE_INGESTOR_SECTION_TITLE}</h3>
        <p style={{ ...explainerStyle, ...(compact ? { marginBottom: 10, fontSize: 11 } : {}) }}>
          {EDGE_INGESTOR_EXPLAINER}
        </p>
        <div style={actionRowStyle}>
          <button
            type="button"
            data-testid="edge-ingestor-action-button"
            style={primaryBtnStyle}
            onClick={handlePrimaryClick}
          >
            {EDGE_INGESTOR_ACTION_BUTTON}
          </button>
          {edgeEnabled ? (
            <>
              <span data-testid="edge-ingestor-configured-badge" style={{ fontSize: 12, color: '#15803d', fontWeight: 600 }}>
                {EDGE_INGESTOR_CONFIGURED_LABEL}
                {replicaCount > 0 ? ` · ${replicaCount} replica${replicaCount === 1 ? '' : 's'}` : ''}
              </span>
              <button
                type="button"
                data-testid="edge-ingestor-manage-button"
                style={secondaryBtnStyle}
                onClick={() => setManageOpen(true)}
              >
                {EDGE_INGESTOR_MANAGE_BUTTON}
              </button>
            </>
          ) : null}
        </div>
      </section>

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
            <h2 id="edge-ingestor-setup-title" style={{ margin: '0 0 12px', fontSize: 18, color: '#0f172a' }}>
              {EDGE_INGESTOR_NOT_CONFIGURED_TITLE}
            </h2>
            <p style={{ margin: '0 0 20px', color: '#64748b', fontSize: 14, lineHeight: 1.5 }}>
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

      {manageOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          data-testid="edge-ingestor-manage-dialog"
          style={overlayStyle}
          onClick={() => setManageOpen(false)}
        >
          <div style={managePanelStyle} onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              aria-label="Close Edge Ingestor management"
              data-testid="edge-ingestor-manage-close"
              onClick={() => setManageOpen(false)}
              style={{
                position: 'sticky',
                top: 8,
                float: 'right',
                margin: '8px 12px 0 0',
                zIndex: 1,
                border: '1px solid #cbd5e1',
                borderRadius: 8,
                background: '#fff',
                padding: '4px 10px',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              Close
            </button>
            <DashboardShell />
          </div>
        </div>
      ) : null}

      <EdgeTierWizardModal open={wizardOpen} onClose={handleWizardClose} />
    </>
  )
}
