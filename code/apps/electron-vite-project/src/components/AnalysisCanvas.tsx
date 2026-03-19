import { useEffect, useState, useCallback, useRef } from 'react'
import './AnalysisCanvas.css'
import { useCanvasState, type AnalysisOpenPayload, type DrawerTabId, HeroKPIStrip, type KPIData } from './analysis'
import { StatusBadge } from './analysis/StatusBadge'
import { getMockDashboardState } from './analysis/computePriorityAction'

interface DeepLinkState {
  traceId?: string
  eventId?: string
  drawerTab?: DrawerTabId
  ruleId?: string
}

interface AnalysisCanvasProps {
  deepLinkPayload?: AnalysisOpenPayload
  onDeepLinkConsumed?: () => void
}

type RuntimeState =
  | 'idle'
  | 'receiving'
  | 'initializing'
  | 'running'
  | 'awaiting_confirmation'
  | 'anchoring'
  | 'direct_chat'

export default function AnalysisCanvas({ deepLinkPayload, onDeepLinkConsumed }: AnalysisCanvasProps) {
  const [, , helpers] = useCanvasState()
  const [_liveDeepLink, setLiveDeepLink] = useState<DeepLinkState | null>(null)
  void _liveDeepLink
  const consumedPayloadRef = useRef<AnalysisOpenPayload | null>(null)
  const [showPoaeHistory, setShowPoaeHistory] = useState(false)
  const [expandedPoaeLogId, setExpandedPoaeLogId] = useState<string | null>(null)
  const [isActivityHistoryModalOpen, setIsActivityHistoryModalOpen] = useState(false)
  const [isActivityDetailModalOpen, setIsActivityDetailModalOpen] = useState(false)
  const [runtimeState] = useState<RuntimeState>('idle')
  const [autoModeEnabled] = useState(false)
  const activityFeed = [
    { id: 'act_9f8e', time: '11:14', type: 'BEAP', source: 'inbox@acme', shortId: '9f8e7d…' },
    { id: 'act_7a8b', time: '11:10', type: 'WRCode', source: 'Scanner', shortId: '7a8b9c…' },
    { id: 'act_2c3d', time: '11:05', type: 'Import', source: 'batch_001', shortId: '2c3d4e…' },
    { id: 'act_1a2b', time: '10:58', type: 'Local', source: 'Manual', shortId: '1a2b3c…' },
    { id: 'act_5e6f', time: '16:42', type: 'BEAP', source: 'partner', shortId: '5e6f7a…' },
    { id: 'act_9c0d', time: '14:22', type: 'API', source: 'ERP', shortId: '9c0d1e…' },
  ]
  const latestCompleted = {
    what: 'Invoice Processing #2847',
    timestamp: '2026-01-06T11:12:33',
    sessionId: 'sess_abc123',
    executionId: 'exec_9f8e7d6c'
  }
  const dashboardState = getMockDashboardState()
  const pendingActions =
    dashboardState.preExecution.pendingConsents +
    dashboardState.liveExecution.unresolvedConsents
  const kpis: KPIData[] = [
    { label: 'Awaiting Approvals', value: pendingActions, status: pendingActions > 0 ? 'info' : 'success', icon: '✓', subtext: 'Consents & Reviews' },
    { label: 'Runtime Executions', value: dashboardState.liveExecution.isStreaming ? 'Active' : 'Ready', status: 'success', icon: '⚡', subtext: `${dashboardState.liveExecution.eventCount} events processed` },
    { label: 'Session Runs', value: dashboardState.postExecution.hasExecution ? 12 : 0, status: 'success', icon: '📊', subtext: 'Latest session activity' },
    { label: 'Optimization Events', value: 28, status: 'success', icon: '🎯', subtext: 'Performance metrics' },
    { label: 'PoAE™ Logs', value: dashboardState.postExecution.poaeReady ? 47 : 0, status: dashboardState.postExecution.poaeReady ? 'success' : 'info', icon: '🔒', subtext: 'Verification records' }
  ]
  useEffect(() => {
    if (!deepLinkPayload) return
    if (consumedPayloadRef.current === deepLinkPayload) return
    consumedPayloadRef.current = deepLinkPayload
    console.log('[AnalysisCanvas] Processing deep-link payload:', deepLinkPayload)
    const childDeepLink: DeepLinkState = {}
    if (deepLinkPayload.traceId) childDeepLink.traceId = deepLinkPayload.traceId
    if (deepLinkPayload.eventId) childDeepLink.eventId = deepLinkPayload.eventId
    if (deepLinkPayload.drawerTab) childDeepLink.drawerTab = deepLinkPayload.drawerTab
    if (deepLinkPayload.ruleId) childDeepLink.ruleId = deepLinkPayload.ruleId
    if (Object.keys(childDeepLink).length > 0) {
      const targetPhase = deepLinkPayload.phase || 'live'
      if (targetPhase === 'live') setLiveDeepLink(childDeepLink)
    }
    onDeepLinkConsumed?.()
  }, [deepLinkPayload])
  const _handleLiveDeepLinkConsumed = useCallback(() => setLiveDeepLink(null), [])
  void _handleLiveDeepLinkConsumed
  const getRuntimeStateDisplay = (state: RuntimeState) => {
    const stateMap: Record<RuntimeState, { label: string; icon: string; color: string; isIdle?: boolean }> = {
      idle: { label: 'Ready & Listening', icon: '📡', color: '#10b981', isIdle: true },
      receiving: { label: 'Receiving / depackaging', icon: '📥', color: '#3b82f6' },
      initializing: { label: 'Session initializing', icon: '⚡', color: '#f59e0b' },
      running: { label: 'Running operation', icon: '🔄', color: '#10b981' },
      awaiting_confirmation: { label: 'Awaiting confirmation', icon: '⏳', color: '#f59e0b' },
      anchoring: { label: 'Anchoring PoAE™', icon: '🔒', color: '#8b5cf6' },
      direct_chat: { label: 'Direct chat active', icon: '💬', color: '#06b6d4' },
    }
    return stateMap[state]
  }
  const handleOpenSessionHistory = () => setIsActivityHistoryModalOpen(true)
  const handlePostExport = () => console.log('[Dashboard] Export PoAE clicked')
  const stateDisplay = getRuntimeStateDisplay(runtimeState)

  return (
    <div className="analysis-canvas">
      <div className="analysis-header">
        <StatusBadge flags={helpers.currentFlags} size="medium" />
      </div>

      {/* Round 2: activity-strip */}
      <div className="activity-strip">
        <span className="activity-strip__label">ACTIVITY</span>
        <div className="activity-strip__feed">
          {activityFeed.slice(0, 6).map((item, idx) => (
            <div key={item.id} className="activity-strip__item">
              {idx > 0 && <span className="activity-strip__sep">•</span>}
              <span className="activity-strip__time">{item.time}</span>
              <span className="activity-strip__type">{item.type}</span>
              <span className="activity-strip__source">{item.source}</span>
              <span className="activity-strip__id">{item.shortId}</span>
            </div>
          ))}
        </div>
        <button className="activity-strip__btn" onClick={handleOpenSessionHistory}>
          Show entire history
        </button>
      </div>

      {/* Round 3: Activity History Modal */}
      {isActivityHistoryModalOpen && (
        <div
          className="activity-modal__overlay"
          onClick={() => setIsActivityHistoryModalOpen(false)}
          onKeyDown={(e) => e.key === 'Escape' && setIsActivityHistoryModalOpen(false)}
        >
          <div className="activity-modal" onClick={(e) => e.stopPropagation()}>
            <div className="activity-modal__header">
              <h2 className="activity-modal__title">Session History</h2>
              <button className="activity-modal__close" onClick={() => setIsActivityHistoryModalOpen(false)}>×</button>
            </div>
            <div className="activity-modal__content">
              <p className="activity-modal__note">📋 This view shows complete session history. Deep-linking to full Session History view...</p>
              {activityFeed.map((item) => (
                <div key={item.id} className="activity-modal__row">
                  <span className="activity-modal__time">{item.time}</span>
                  <span className="activity-modal__type">{item.type}</span>
                  <span className="activity-modal__source">{item.source}</span>
                  <code className="activity-modal__id">{item.shortId}</code>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Round 4: Activity Detail Modal */}
      {isActivityDetailModalOpen && (
        <div
          className="activity-detail-modal__overlay"
          onClick={() => setIsActivityDetailModalOpen(false)}
          onKeyDown={(e) => e.key === 'Escape' && setIsActivityDetailModalOpen(false)}
        >
          <div className="activity-detail-modal" onClick={(e) => e.stopPropagation()}>
            <div className="activity-detail-modal__header">
              <div className="activity-detail-modal__header-left">
                <span className="activity-detail-modal__icon">✓</span>
                <h2 className="activity-detail-modal__title">Activity Details</h2>
              </div>
              <button className="activity-detail-modal__close" onClick={() => setIsActivityDetailModalOpen(false)}>×</button>
            </div>
            <div className="activity-detail-modal__content">
              <div className="activity-detail-modal__section">
                <h3 className="activity-detail-modal__section-title">Completed Activity</h3>
                <div className="activity-detail-modal__summary">
                  <div className="activity-detail-modal__summary-main">
                    <span className="activity-detail-modal__summary-icon">📄</span>
                    <span className="activity-detail-modal__summary-name">{latestCompleted.what}</span>
                  </div>
                  <span className="activity-detail-modal__summary-badge activity-detail-modal__summary-badge--success">COMPLETED</span>
                </div>
              </div>
              <div className="activity-detail-modal__section">
                <h3 className="activity-detail-modal__section-title">Execution Details</h3>
                <div className="activity-detail-modal__grid">
                  <div className="activity-detail-modal__field">
                    <span className="activity-detail-modal__field-label">Timestamp</span>
                    <span className="activity-detail-modal__field-value">
                      {new Date(latestCompleted.timestamp).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                  </div>
                  <div className="activity-detail-modal__field">
                    <span className="activity-detail-modal__field-label">Duration</span>
                    <span className="activity-detail-modal__field-value">2.4s</span>
                  </div>
                  <div className="activity-detail-modal__field">
                    <span className="activity-detail-modal__field-label">Session ID</span>
                    <span className="activity-detail-modal__field-value">
                      <code>{latestCompleted.sessionId}</code>
                      <button className="activity-detail-modal__copy-btn" onClick={() => navigator.clipboard.writeText(latestCompleted.sessionId)} title="Copy">📋</button>
                    </span>
                  </div>
                  <div className="activity-detail-modal__field">
                    <span className="activity-detail-modal__field-label">Execution ID</span>
                    <span className="activity-detail-modal__field-value">
                      <code>{latestCompleted.executionId}</code>
                      <button className="activity-detail-modal__copy-btn" onClick={() => navigator.clipboard.writeText(latestCompleted.executionId)} title="Copy">📋</button>
                    </span>
                  </div>
                </div>
              </div>
              <div className="activity-detail-modal__section">
                <h3 className="activity-detail-modal__section-title">Processing Steps</h3>
                <div className="activity-detail-modal__steps">
                  <div className="activity-detail-modal__step activity-detail-modal__step--complete">
                    <span className="activity-detail-modal__step-check">✓</span>
                    <span className="activity-detail-modal__step-name">Document received</span>
                    <span className="activity-detail-modal__step-time">11:12:31</span>
                  </div>
                  <div className="activity-detail-modal__step activity-detail-modal__step--complete">
                    <span className="activity-detail-modal__step-check">✓</span>
                    <span className="activity-detail-modal__step-name">Classification complete</span>
                    <span className="activity-detail-modal__step-time">11:12:32</span>
                  </div>
                  <div className="activity-detail-modal__step activity-detail-modal__step--complete">
                    <span className="activity-detail-modal__step-check">✓</span>
                    <span className="activity-detail-modal__step-name">Data extraction</span>
                    <span className="activity-detail-modal__step-time">11:12:33</span>
                  </div>
                  <div className="activity-detail-modal__step activity-detail-modal__step--complete">
                    <span className="activity-detail-modal__step-check">✓</span>
                    <span className="activity-detail-modal__step-name">PoAE™ anchored</span>
                    <span className="activity-detail-modal__step-time">11:12:33</span>
                  </div>
                </div>
              </div>
              <div className="activity-detail-modal__section">
                <h3 className="activity-detail-modal__section-title">Output Data</h3>
                <div className="activity-detail-modal__output">
                  <div className="activity-detail-modal__output-row">
                    <span className="activity-detail-modal__output-key">Document Type</span>
                    <span className="activity-detail-modal__output-value">Invoice</span>
                  </div>
                  <div className="activity-detail-modal__output-row">
                    <span className="activity-detail-modal__output-key">Vendor</span>
                    <span className="activity-detail-modal__output-value">Acme Corporation</span>
                  </div>
                  <div className="activity-detail-modal__output-row">
                    <span className="activity-detail-modal__output-key">Invoice Number</span>
                    <span className="activity-detail-modal__output-value">INV-2847</span>
                  </div>
                  <div className="activity-detail-modal__output-row">
                    <span className="activity-detail-modal__output-key">Total Amount</span>
                    <span className="activity-detail-modal__output-value">€4,280.00</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="activity-detail-modal__footer">
              <button className="activity-detail-modal__btn activity-detail-modal__btn--secondary" onClick={() => setIsActivityDetailModalOpen(false)}>Close</button>
              <button className="activity-detail-modal__btn activity-detail-modal__btn--primary" onClick={() => console.log('[Dashboard] Exporting activity data')}>📤 Export Data</button>
            </div>
          </div>
        </div>
      )}

      {/* Round 5: unified-dashboard + HeroKPIStrip */}
      <div className="unified-dashboard">
        <div className="main-dashboard">
          <div className="hero-column">
            <div className="hero-panel hero-panel--action-now">
              <div className="hero-panel__header">
                <h2 className="hero-panel__title">Action Now</h2>
                <span className="hero-panel__subtitle">Runtime surface</span>
              </div>
              <div className={`hero-panel__state ${stateDisplay.isIdle ? 'hero-panel__state--idle' : ''}`} style={{ borderColor: stateDisplay.color }}>
                <span className={`hero-panel__state-icon ${stateDisplay.isIdle ? 'hero-panel__state-icon--pulse' : ''}`}>{stateDisplay.icon}</span>
                <span className="hero-panel__state-label" style={{ color: stateDisplay.color }}>{stateDisplay.label}</span>
                {stateDisplay.isIdle && <span className="hero-panel__state-status">Idle</span>}
              </div>
              <div className="hero-panel__context">
                <div className="hero-panel__context-title">Live Context</div>
                <div className="hero-panel__context-grid">
                  <div className="hero-panel__context-item">
                    <span className="hero-panel__context-label">Session ID</span>
                    <span className="hero-panel__context-value">
                      <code>sess_abc123</code>
                      <button className="hero-panel__copy-btn" title="Copy" onClick={() => navigator.clipboard.writeText('sess_abc123')}>📋</button>
                    </span>
                  </div>
                  <div className="hero-panel__context-item">
                    <span className="hero-panel__context-label">Source</span>
                    <span className="hero-panel__context-value">BEAP</span>
                  </div>
                  <div className="hero-panel__context-item">
                    <span className="hero-panel__context-label">Operation</span>
                    <span className="hero-panel__context-value">Semantic analysis</span>
                  </div>
                  <div className="hero-panel__context-item">
                    <span className="hero-panel__context-label">Boundary</span>
                    <span className="hero-panel__context-value">Local</span>
                  </div>
                </div>
              </div>
              {autoModeEnabled && (
                <div className="hero-panel__intent">
                  <div className="hero-panel__intent-title">Intent Detection (Auto-Mode)</div>
                  <div className="hero-panel__intent-row">
                    <span className="hero-panel__intent-label">Detected Intent:</span>
                    <span className="hero-panel__intent-value">Process Invoice</span>
                    <span className="hero-panel__intent-confidence hero-panel__intent-confidence--high">HIGH</span>
                  </div>
                  <div className="hero-panel__intent-row">
                    <span className="hero-panel__intent-label">Class:</span>
                    <span className="hero-panel__intent-value hero-panel__intent-value--actuating">Actuating</span>
                  </div>
                </div>
              )}
            </div>
            <div className="hero-panel hero-panel--latest-completed">
              <div className="hero-panel__header hero-panel__header--compact">
                <h3 className="hero-panel__title hero-panel__title--small">Latest Completed</h3>
              </div>
              <div className="hero-panel__completed">
                <div className="hero-panel__completed-info">
                  <span className="hero-panel__completed-what">{latestCompleted.what}</span>
                  <span className="hero-panel__completed-meta">
                    {new Date(latestCompleted.timestamp).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                    {' • '}
                    <code>{latestCompleted.executionId.slice(0, 12)}…</code>
                  </span>
                </div>
                <button className="hero-panel__completed-btn" onClick={() => setIsActivityDetailModalOpen(true)}>View Activity →</button>
              </div>
            </div>
          </div>
          <div className="poae-column">
            <div className="poae-column__header">
              <div className="poae-column__header-left">
                <h2 className="poae-column__title">PoAE™</h2>
                <span className="poae-column__subtitle">Trust Anchor</span>
              </div>
              <div className="poae-column__actions">
                <button className="poae-column__action-btn" onClick={handlePostExport}>
                  <span className="poae-column__action-btn-icon">📤</span>
                  Export
                </button>
              </div>
            </div>
            <div className="poae-column__content">
              <div className="poae-column__card">
                <div className="unified-dashboard__hero-header">
                  <div className="unified-dashboard__hero-header-left">
                    <span className="unified-dashboard__hero-icon unified-dashboard__hero-icon--purple">🔒</span>
                    <div className="unified-dashboard__hero-title-group">
                      <h3 className="unified-dashboard__hero-title">Latest PoAE™ Log</h3>
                      <span className="unified-dashboard__hero-subtitle">Invoice Processing Workflow</span>
                    </div>
                  </div>
                  <span className="unified-dashboard__hero-badge unified-dashboard__hero-badge--verified">✓ VERIFIED</span>
                </div>
                <div className="unified-dashboard__poae-meta unified-dashboard__poae-meta--compact">
                  <div className="unified-dashboard__poae-meta-row">
                    <span className="unified-dashboard__poae-meta-label">TEMPLATE</span>
                    <span className="unified-dashboard__poae-meta-value">Invoice Processing Workflow</span>
                  </div>
                  <div className="unified-dashboard__poae-meta-row">
                    <span className="unified-dashboard__poae-meta-label">TIMESTAMP</span>
                    <span className="unified-dashboard__poae-meta-value">6.1.2026, 11:14:28</span>
                  </div>
                </div>
                <div className="unified-dashboard__poae-id-row unified-dashboard__poae-id-row--exec">
                  <span className="unified-dashboard__poae-id-label">Execution ID:</span>
                  <span className="unified-dashboard__poae-id-value" title="exec_9f8e7d6c5b4a3210">exec_9f8e7d6c5b4a3210</span>
                  <button className="unified-dashboard__poae-copy-btn" onClick={() => navigator.clipboard.writeText('exec_9f8e7d6c5b4a3210')} title="Copy Execution ID to clipboard">📋</button>
                </div>
                <div className="unified-dashboard__poae-id-row">
                  <span className="unified-dashboard__poae-id-label">PoAE™ Hash:</span>
                  <span className="unified-dashboard__poae-id-value" title="sha256:9f8e7d6c5b4a3210abcdef1234567890">sha256:9f8e7d6c5b4a3210abcdef1234567890</span>
                  <button className="unified-dashboard__poae-copy-btn" onClick={() => navigator.clipboard.writeText('sha256:9f8e7d6c5b4a3210abcdef1234567890')} title="Copy hash to clipboard">📋</button>
                  <button className="unified-dashboard__poae-export-btn" onClick={() => console.log('[PoAE] Exporting log')} title="Export PoAE™ log">📤 Export</button>
                </div>
                <div className="unified-dashboard__poae-timeline">
                  <div className="unified-dashboard__poae-event unified-dashboard__poae-event--sender">
                    <span className="unified-dashboard__poae-event-icon">☁️</span>
                    <div className="unified-dashboard__poae-event-content">
                      <div className="unified-dashboard__poae-event-type">SENDER PoAE™</div>
                      <div className="unified-dashboard__poae-event-org">Acme Corp</div>
                      <div className="unified-dashboard__poae-event-hash">poae_sender_a1b2c3d4</div>
                    </div>
                    <span className="unified-dashboard__poae-event-badge">MANUAL CONSENT</span>
                  </div>
                  <div className="unified-dashboard__poae-event unified-dashboard__poae-event--agent">
                    <span className="unified-dashboard__poae-event-icon">🤖</span>
                    <div className="unified-dashboard__poae-event-content">
                      <div className="unified-dashboard__poae-event-label">Document Classifier</div>
                    </div>
                    <button className="unified-dashboard__poae-agent-btn">Show Agent</button>
                  </div>
                  <div className="unified-dashboard__poae-event unified-dashboard__poae-event--agent">
                    <span className="unified-dashboard__poae-event-icon">🤖</span>
                    <div className="unified-dashboard__poae-event-content">
                      <div className="unified-dashboard__poae-event-label">Data Extractor</div>
                    </div>
                    <button className="unified-dashboard__poae-agent-btn">Show Agent</button>
                  </div>
                  <div className="unified-dashboard__poae-event unified-dashboard__poae-event--agent">
                    <span className="unified-dashboard__poae-event-icon">🤖</span>
                    <div className="unified-dashboard__poae-event-content">
                      <div className="unified-dashboard__poae-event-label">Compliance Validator</div>
                    </div>
                    <button className="unified-dashboard__poae-agent-btn">Show Agent</button>
                  </div>
                  <div className="unified-dashboard__poae-event unified-dashboard__poae-event--receiver">
                    <span className="unified-dashboard__poae-event-icon">☁️</span>
                    <div className="unified-dashboard__poae-event-content">
                      <div className="unified-dashboard__poae-event-type">RECEIVER PoAE™</div>
                      <div className="unified-dashboard__poae-event-org">Partner Inc</div>
                      <div className="unified-dashboard__poae-event-hash">poae_receiver_7a8b9c0d</div>
                    </div>
                    <span className="unified-dashboard__poae-event-badge">MANUAL CONSENT</span>
                  </div>
                  <div className="unified-dashboard__poae-event unified-dashboard__poae-event--execution">
                    <span className="unified-dashboard__poae-event-icon">✓</span>
                    <div className="unified-dashboard__poae-event-content">
                      <div className="unified-dashboard__poae-event-type">PoAE™ CONFIRMED EXECUTION</div>
                      <div className="unified-dashboard__poae-event-org">End-to-End Verified</div>
                      <div className="unified-dashboard__poae-event-hash">poae_exec_complete_f1e2d3c4</div>
                      <div className="unified-dashboard__poae-confirmed-actions">
                        <div className="unified-dashboard__poae-confirmed-action">
                          <span className="unified-dashboard__poae-confirmed-action-check">✓</span>
                          <span>Data payload delivered to receiver</span>
                        </div>
                        <div className="unified-dashboard__poae-confirmed-action">
                          <span className="unified-dashboard__poae-confirmed-action-check">✓</span>
                          <span>Automation workflow executed</span>
                        </div>
                        <div className="unified-dashboard__poae-confirmed-action">
                          <span className="unified-dashboard__poae-confirmed-action-check">✓</span>
                          <span>Cross-organization hash anchored</span>
                        </div>
                        <div className="unified-dashboard__poae-confirmed-action">
                          <span className="unified-dashboard__poae-confirmed-action-check">✓</span>
                          <span>Blockchain attestation sealed</span>
                        </div>
                      </div>
                    </div>
                    <span className="unified-dashboard__poae-event-badge unified-dashboard__poae-event-badge--verified">VERIFIED</span>
                  </div>
                </div>
                <div className="unified-dashboard__spacer"></div>
                <button className="unified-dashboard__show-all-btn" onClick={() => setShowPoaeHistory(!showPoaeHistory)}>
                  {showPoaeHistory ? 'Hide History ▲' : 'Show All ▼'}
                </button>
                {showPoaeHistory && (
                  <div className="unified-dashboard__column-history">
                    <div className="unified-dashboard__column-history-title">PoAE™ LOG HISTORY</div>
                    <div className="unified-dashboard__column-history-item">
                      <div className="unified-dashboard__column-history-header">
                        <div className="unified-dashboard__column-history-info">
                          <span className="unified-dashboard__column-history-name">Invoice Processing Workflow</span>
                          <span className="unified-dashboard__column-history-meta">2 min ago • exec_9f8e7d6c</span>
                        </div>
                        <button className="unified-dashboard__column-history-btn" onClick={() => setExpandedPoaeLogId(expandedPoaeLogId === 'log1' ? null : 'log1')}>
                          {expandedPoaeLogId === 'log1' ? 'Collapse' : 'Analyse'}
                        </button>
                      </div>
                      {expandedPoaeLogId === 'log1' && (
                        <div className="unified-dashboard__column-history-timeline">
                          <div className="unified-dashboard__column-history-event unified-dashboard__column-history-event--sender">
                            <span className="unified-dashboard__column-history-event-icon">📤</span>
                            <div className="unified-dashboard__column-history-event-content">
                              <span className="unified-dashboard__column-history-event-label">Sender PoAE™</span>
                              <span className="unified-dashboard__column-history-event-org">Acme Corp</span>
                            </div>
                            <span className="unified-dashboard__column-history-event-type">Manual Consent</span>
                          </div>
                          <div className="unified-dashboard__column-history-event unified-dashboard__column-history-event--agent">
                            <span className="unified-dashboard__column-history-event-icon">🤖</span>
                            <span className="unified-dashboard__column-history-event-name">Document Classifier</span>
                            <button className="unified-dashboard__column-history-agent-btn">Show</button>
                          </div>
                          <div className="unified-dashboard__column-history-event unified-dashboard__column-history-event--agent">
                            <span className="unified-dashboard__column-history-event-icon">🤖</span>
                            <span className="unified-dashboard__column-history-event-name">Data Extractor</span>
                            <button className="unified-dashboard__column-history-agent-btn">Show</button>
                          </div>
                          <div className="unified-dashboard__column-history-event unified-dashboard__column-history-event--receiver">
                            <span className="unified-dashboard__column-history-event-icon">📥</span>
                            <div className="unified-dashboard__column-history-event-content">
                              <span className="unified-dashboard__column-history-event-label">Receiver PoAE™</span>
                              <span className="unified-dashboard__column-history-event-org">Partner Inc</span>
                            </div>
                            <span className="unified-dashboard__column-history-event-type">Manual Consent</span>
                          </div>
                          <div className="unified-dashboard__column-history-confirmed">
                            <span className="unified-dashboard__column-history-confirmed-title">✓ Confirmed Execution</span>
                            <div className="unified-dashboard__column-history-confirmed-list">
                              <span>✓ Payload delivered</span>
                              <span>✓ Workflow executed</span>
                              <span>✓ Blockchain sealed</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="unified-dashboard__column-history-item">
                      <div className="unified-dashboard__column-history-header">
                        <div className="unified-dashboard__column-history-info">
                          <span className="unified-dashboard__column-history-name">Data Sync Automation</span>
                          <span className="unified-dashboard__column-history-meta">15 min ago • exec_4a5b6c7d</span>
                        </div>
                        <button className="unified-dashboard__column-history-btn" onClick={() => setExpandedPoaeLogId(expandedPoaeLogId === 'log2' ? null : 'log2')}>
                          {expandedPoaeLogId === 'log2' ? 'Collapse' : 'Analyse'}
                        </button>
                      </div>
                      {expandedPoaeLogId === 'log2' && (
                        <div className="unified-dashboard__column-history-timeline">
                          <div className="unified-dashboard__column-history-event unified-dashboard__column-history-event--sender">
                            <span className="unified-dashboard__column-history-event-icon">📤</span>
                            <div className="unified-dashboard__column-history-event-content">
                              <span className="unified-dashboard__column-history-event-label">Sender PoAE™</span>
                              <span className="unified-dashboard__column-history-event-org">TechCorp</span>
                            </div>
                            <span className="unified-dashboard__column-history-event-type">2FA Auth</span>
                          </div>
                          <div className="unified-dashboard__column-history-event unified-dashboard__column-history-event--agent">
                            <span className="unified-dashboard__column-history-event-icon">🤖</span>
                            <span className="unified-dashboard__column-history-event-name">Sync Engine</span>
                            <button className="unified-dashboard__column-history-agent-btn">Show</button>
                          </div>
                          <div className="unified-dashboard__column-history-event unified-dashboard__column-history-event--receiver">
                            <span className="unified-dashboard__column-history-event-icon">📥</span>
                            <div className="unified-dashboard__column-history-event-content">
                              <span className="unified-dashboard__column-history-event-label">Receiver PoAE™</span>
                              <span className="unified-dashboard__column-history-event-org">DataHub Inc</span>
                            </div>
                            <span className="unified-dashboard__column-history-event-type">Policy Match</span>
                          </div>
                          <div className="unified-dashboard__column-history-confirmed">
                            <span className="unified-dashboard__column-history-confirmed-title">✓ Confirmed Execution</span>
                            <div className="unified-dashboard__column-history-confirmed-list">
                              <span>✓ Data synchronized</span>
                              <span>✓ Blockchain anchored</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        <section className="unified-dashboard__overview">
          <HeroKPIStrip kpis={kpis} title="System Overview" />
        </section>
      </div>
    </div>
  )
}
