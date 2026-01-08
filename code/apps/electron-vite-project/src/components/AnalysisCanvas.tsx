import { useEffect, useState, useCallback } from 'react'
import './AnalysisCanvas.css'
import PreExecutionAnalysis from './PreExecutionAnalysis'
import { useCanvasState, type AnalysisOpenPayload, type DrawerTabId, HeroKPIStrip, type KPIData } from './analysis'
import { StatusBadge } from './analysis/StatusBadge'
import { getMockDashboardState } from './analysis/computePriorityAction'

/**
 * Deep-link state to pass to child components
 * Consumed once then cleared
 */
interface DeepLinkState {
  traceId?: string
  eventId?: string
  drawerTab?: DrawerTabId
  ruleId?: string
}

interface AnalysisCanvasProps {
  /** Deep-link payload from IPC request */
  deepLinkPayload?: AnalysisOpenPayload
  /** Callback when payload has been consumed */
  onDeepLinkConsumed?: () => void
}

export default function AnalysisCanvas({ deepLinkPayload, onDeepLinkConsumed }: AnalysisCanvasProps) {
  // Canvas-scoped state - does NOT leak to sidebar
  const [state, , helpers] = useCanvasState()
  
  // Deep-link state to pass to child views (consumed once)
  const [_liveDeepLink, setLiveDeepLink] = useState<DeepLinkState | null>(null)
  const [preExecutionDeepLink, setPreExecutionDeepLink] = useState<DeepLinkState | null>(null)
  void _liveDeepLink // Reserved for future use
  
  // Show All expansion states
  const [showPostHistory, setShowPostHistory] = useState(false)
  const [showPoaeHistory, setShowPoaeHistory] = useState(false)
  const [expandedPoaeLogId, setExpandedPoaeLogId] = useState<string | null>(null)
  
  // Post-Execution Workflow Modal state
  const [isPostWorkflowModalOpen, setIsPostWorkflowModalOpen] = useState(false)

  // Get dashboard state for KPIs - using ORIGINAL logic from DashboardHome
  const dashboardState = getMockDashboardState()
  const pendingActions = 
    dashboardState.preExecution.pendingConsents + 
    dashboardState.liveExecution.unresolvedConsents

  // ORIGINAL KPI data - unchanged from DashboardHome
  const kpis: KPIData[] = [
    {
      label: 'Awaiting Approvals',
      value: pendingActions,
      status: pendingActions > 0 ? 'info' : 'success',
      icon: '✓',
      subtext: 'Consents & Reviews'
    },
    {
      label: 'Runtime Executions',
      value: dashboardState.liveExecution.isStreaming ? 'Active' : 'Ready',
      status: dashboardState.liveExecution.isStreaming ? 'success' : 'success',
      icon: '⚡',
      subtext: `${dashboardState.liveExecution.eventCount} events processed`
    },
    {
      label: 'Session Runs',
      value: dashboardState.postExecution.hasExecution ? 12 : 0,
      status: 'success',
      icon: '📊',
      subtext: 'Latest session activity'
    },
    {
      label: 'Optimization Events',
      value: 28,
      status: 'success',
      icon: '🎯',
      subtext: 'Performance metrics'
    },
    {
      label: 'PoAE™ Logs',
      value: dashboardState.postExecution.poaeReady ? 47 : 0,
      status: dashboardState.postExecution.poaeReady ? 'success' : 'info',
      icon: '🔒',
      subtext: 'Verification records'
    }
  ]

  // Handle deep-link payload from IPC
  useEffect(() => {
    if (!deepLinkPayload) return
    
    console.log('[AnalysisCanvas] Processing deep-link payload:', deepLinkPayload)
    
    // Extract deep-link fields for child components
    const childDeepLink: DeepLinkState = {}
    if (deepLinkPayload.traceId) childDeepLink.traceId = deepLinkPayload.traceId
    if (deepLinkPayload.eventId) childDeepLink.eventId = deepLinkPayload.eventId
    if (deepLinkPayload.drawerTab) childDeepLink.drawerTab = deepLinkPayload.drawerTab
    if (deepLinkPayload.ruleId) childDeepLink.ruleId = deepLinkPayload.ruleId
    
    // Only set if we have actual deep-link fields
    if (Object.keys(childDeepLink).length > 0) {
      const targetPhase = deepLinkPayload.phase || 'live'
      if (targetPhase === 'pre-execution') {
        setPreExecutionDeepLink(childDeepLink)
      } else if (targetPhase === 'live') {
        setLiveDeepLink(childDeepLink)
      }
    }
    
    onDeepLinkConsumed?.()
  }, [deepLinkPayload, onDeepLinkConsumed])
  
  const _handleLiveDeepLinkConsumed = useCallback(() => {
    setLiveDeepLink(null)
  }, [])
  void _handleLiveDeepLinkConsumed // Reserved for future use
  
  const handlePreExecutionDeepLinkConsumed = useCallback(() => {
    setPreExecutionDeepLink(null)
  }, [])
  
  // Action handlers
  const handlePreExecutionAnalyse = () => {
    console.log('[Dashboard] Analyse Pre-Execution clicked')
  }
  
  const _handlePreExecutionApprove = () => {
    console.log('[Dashboard] Approve clicked')
  }
  void _handlePreExecutionApprove // Suppress unused warning
  
  const handleLiveAnalyse = () => {
    console.log('[Dashboard] Analyse Live clicked')
  }
  
  const handlePostAnalyse = () => {
    console.log('[Dashboard] Analyse PoAE clicked')
  }
  
  const handlePostExport = () => {
    console.log('[Dashboard] Export PoAE clicked')
  }

  return (
    <div className="analysis-canvas">
      {/* Header */}
      <div className="analysis-header">
        <h1 className="analysis-title">Analysis Dashboard</h1>
        <span className="analysis-badge">Enterprise Preview</span>
        <StatusBadge flags={helpers.currentFlags} size="medium" />
      </div>

      {/* Scrollable Content - Single scrollbar for entire dashboard */}
      <div className="unified-dashboard">
        {/* Three Column Layout - Pre-Execution | Post-Execution | PoAE™ Logs */}
        <div className="unified-dashboard__columns">
          {/* Pre-Execution Column */}
          <div className="unified-dashboard__column unified-dashboard__column--pre">
            <div className="unified-dashboard__column-header">
              <div className="unified-dashboard__column-header-left">
                <h2 className="unified-dashboard__column-title">Pre-Execution</h2>
              </div>
              <div className="unified-dashboard__column-actions">
                <button className="unified-dashboard__action-btn" onClick={handlePreExecutionAnalyse}>
                  <span className="unified-dashboard__action-btn-icon">🔍</span>
                  Analyse
                </button>
              </div>
            </div>
            <div className="unified-dashboard__column-content">
          <PreExecutionAnalysis 
            flags={state.preExecution.flags}
            deepLink={preExecutionDeepLink ?? undefined}
            onDeepLinkConsumed={handlePreExecutionDeepLinkConsumed}
                compact={true}
              />
            </div>
          </div>

          {/* Post-Execution Column - Same style as Pre-Execution */}
          <div className="unified-dashboard__column unified-dashboard__column--post">
            <div className="unified-dashboard__column-header">
              <div className="unified-dashboard__column-header-left">
                <h2 className="unified-dashboard__column-title">Post-Execution</h2>
              </div>
              <div className="unified-dashboard__column-actions">
                <button className="unified-dashboard__action-btn" onClick={handlePostAnalyse}>
                  <span className="unified-dashboard__action-btn-icon">🔍</span>
                  Analyse
                </button>
              </div>
            </div>
            <div className="unified-dashboard__column-content">
              {/* Hero Section - EXACT same structure as Pre-Execution */}
              <div className="unified-dashboard__hero-card unified-dashboard__hero-card--aligned">
                {/* Subtitle + Slider Row */}
                <div className="shared-header-row">
                  <span className="shared-header-subtitle">
                    <span className="shared-header-subtitle-icon">⏳</span>
                    Awaiting Confirmations
                  </span>
                  <div className="shared-slider-nav">
                    <button className="shared-slider-btn">‹</button>
                    <span className="shared-slider-text">1 of 2</span>
                    <button className="shared-slider-btn">›</button>
                  </div>
                </div>

                {/* Status Row - EXACT same structure as Column 1 */}
                <div className="shared-status-row">
                  <div className="shared-status-box">
                    <div className="shared-status-icon">✓</div>
                    <div className="shared-status-content">
                      <span className="shared-status-title">
                        <span className="shared-status-title-icon">✅</span>
                        Success
                      </span>
                      <span className="shared-status-desc">All workflows completed</span>
                    </div>
                  </div>
                  <button className="shared-approve-btn">
                    <span className="shared-approve-icon">✓</span>
                    <span className="shared-approve-text">
                      <span className="shared-approve-label">Confirm Execution</span>
                      <span className="shared-approve-session">Invoice Batch #2847</span>
                    </span>
                  </button>
                </div>

                {/* Analyse Workflow Button - EXACT same style as Column 1 */}
                <button 
                  className="shared-analyse-workflow-btn"
                  onClick={() => setIsPostWorkflowModalOpen(true)}
                >
                  <span className="shared-analyse-workflow-icon">🔍</span>
                  Analyse Workflow
                </button>

                {/* Executed Actions Box - Actions that need confirmation */}
                <div className="unified-dashboard__executed-actions">
                  <div className="unified-dashboard__executed-actions-header">
                    <span className="unified-dashboard__executed-actions-title">Executed Actions</span>
                    <span className="unified-dashboard__executed-actions-badge">Awaiting Confirmation</span>
                  </div>
                  <div className="unified-dashboard__executed-actions-list">
                    <div className="unified-dashboard__executed-action">
                      <span className="unified-dashboard__executed-action-icon">📄</span>
                      <span className="unified-dashboard__executed-action-text">Invoice data extracted and validated</span>
                    </div>
                    <div className="unified-dashboard__executed-action">
                      <span className="unified-dashboard__executed-action-icon">🔄</span>
                      <span className="unified-dashboard__executed-action-text">Data synchronized to partner system</span>
                    </div>
                    <div className="unified-dashboard__executed-action">
                      <span className="unified-dashboard__executed-action-icon">✉️</span>
                      <span className="unified-dashboard__executed-action-text">Notification sent to stakeholders</span>
                    </div>
                    <div className="unified-dashboard__executed-action">
                      <span className="unified-dashboard__executed-action-icon">📊</span>
                      <span className="unified-dashboard__executed-action-text">Compliance report generated</span>
                    </div>
                  </div>
                </div>

                {/* Pending Requests - Same style as Policy Compliance */}
                <div className="preflight-hero__compliance-summary">
                  <div className="preflight-hero__compliance-header">
                    <span className="preflight-hero__compliance-title">Pending Requests</span>
                    <span className="preflight-hero__compliance-badge" style={{ background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b' }}>2 QUEUED</span>
                  </div>
                  <div className="preflight-hero__compliance-items">
                    <div className="preflight-hero__compliance-item">
                      <span className="preflight-hero__compliance-check" style={{ color: '#f59e0b' }}>⏳</span>
                      <span className="preflight-hero__compliance-label">Data Export Request</span>
                      <span className="preflight-hero__compliance-value" style={{ color: '#f59e0b' }}>Queued</span>
                    </div>
                    <div className="preflight-hero__compliance-item">
                      <span className="preflight-hero__compliance-check" style={{ color: '#f59e0b' }}>⏳</span>
                      <span className="preflight-hero__compliance-label">API Sync Request</span>
                      <span className="preflight-hero__compliance-value" style={{ color: '#f59e0b' }}>Queued</span>
                    </div>
                  </div>
                </div>

                {/* Spacer to push Show All to bottom */}
                <div className="unified-dashboard__spacer"></div>

                {/* Show All Button with Arrow - At Bottom */}
                <button 
                  className="unified-dashboard__show-all-btn"
                  onClick={() => setShowPostHistory(!showPostHistory)}
                >
                  {showPostHistory ? 'Hide History ▲' : 'Show All ▼'}
                </button>

                {/* History Expansion with Timeline View */}
                {showPostHistory && (
                  <div className="unified-dashboard__history">
                    <div className="unified-dashboard__history-title">Completed Workflows</div>
                    <div className="unified-dashboard__history-list">
                      {/* History Item 1 */}
                      <div className="unified-dashboard__history-item">
                        <div className="unified-dashboard__history-item-info">
                          <span className="unified-dashboard__history-item-name">Invoice Batch #2847</span>
                          <span className="unified-dashboard__history-item-meta">2 min ago</span>
                        </div>
                        <button 
                          className="unified-dashboard__history-analyse-btn"
                          onClick={() => setExpandedPoaeLogId(expandedPoaeLogId === 'post1' ? null : 'post1')}
                        >
                          {expandedPoaeLogId === 'post1' ? 'Collapse' : 'View Timeline'}
                        </button>
                      </div>
                      {expandedPoaeLogId === 'post1' && (
                        <div className="unified-dashboard__history-timeline">
                          <div className="unified-dashboard__poae-event unified-dashboard__poae-event--sender">
                            <span className="unified-dashboard__poae-event-icon">☁️</span>
                            <div className="unified-dashboard__poae-event-content">
                              <div className="unified-dashboard__poae-event-type">SENDER PoAE™</div>
                              <div className="unified-dashboard__poae-event-org">Acme Corp</div>
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
                          <div className="unified-dashboard__poae-event unified-dashboard__poae-event--receiver">
                            <span className="unified-dashboard__poae-event-icon">☁️</span>
                            <div className="unified-dashboard__poae-event-content">
                              <div className="unified-dashboard__poae-event-type">RECEIVER PoAE™</div>
                              <div className="unified-dashboard__poae-event-org">Partner Inc</div>
                            </div>
                            <span className="unified-dashboard__poae-event-badge">POLICY MATCH</span>
                          </div>
                        </div>
                      )}

                      {/* History Item 2 */}
                      <div className="unified-dashboard__history-item">
                        <div className="unified-dashboard__history-item-info">
                          <span className="unified-dashboard__history-item-name">Data Sync #1923</span>
                          <span className="unified-dashboard__history-item-meta">15 min ago</span>
                        </div>
                        <button 
                          className="unified-dashboard__history-analyse-btn"
                          onClick={() => setExpandedPoaeLogId(expandedPoaeLogId === 'post2' ? null : 'post2')}
                        >
                          {expandedPoaeLogId === 'post2' ? 'Collapse' : 'View Timeline'}
                        </button>
                      </div>
                      {expandedPoaeLogId === 'post2' && (
                        <div className="unified-dashboard__history-timeline">
                          <div className="unified-dashboard__poae-event unified-dashboard__poae-event--sender">
                            <span className="unified-dashboard__poae-event-icon">☁️</span>
                            <div className="unified-dashboard__poae-event-content">
                              <div className="unified-dashboard__poae-event-type">SENDER PoAE™</div>
                              <div className="unified-dashboard__poae-event-org">TechCorp</div>
                            </div>
                            <span className="unified-dashboard__poae-event-badge">2FA AUTH</span>
                          </div>
                          <div className="unified-dashboard__poae-event unified-dashboard__poae-event--agent">
                            <span className="unified-dashboard__poae-event-icon">🤖</span>
                            <div className="unified-dashboard__poae-event-content">
                              <div className="unified-dashboard__poae-event-label">Sync Engine</div>
                            </div>
                            <button className="unified-dashboard__poae-agent-btn">Show Agent</button>
                          </div>
                          <div className="unified-dashboard__poae-event unified-dashboard__poae-event--receiver">
                            <span className="unified-dashboard__poae-event-icon">☁️</span>
                            <div className="unified-dashboard__poae-event-content">
                              <div className="unified-dashboard__poae-event-type">RECEIVER PoAE™</div>
                              <div className="unified-dashboard__poae-event-org">DataHub Inc</div>
                            </div>
                            <span className="unified-dashboard__poae-event-badge">POLICY MATCH</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* PoAE™ Column - Full Timeline with Confirmed Actions */}
          <div className="unified-dashboard__column unified-dashboard__column--poae">
            <div className="unified-dashboard__column-header">
              <div className="unified-dashboard__column-header-left">
                <h2 className="unified-dashboard__column-title">PoAE™</h2>
                <span className="unified-dashboard__column-subtitle">Verified logs</span>
              </div>
              <div className="unified-dashboard__column-actions">
                <button className="unified-dashboard__action-btn" onClick={handlePostExport}>
                  <span className="unified-dashboard__action-btn-icon">📤</span>
                  Export
                </button>
              </div>
            </div>
            <div className="unified-dashboard__column-content">
              <div className="unified-dashboard__poae-card">
                {/* Header - Same style as Column 1 and 2 */}
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

                {/* Metadata - Compact 2 columns */}
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
                
                {/* PoAE™ Hash - Full width row */}
                <div className="unified-dashboard__poae-hash-row">
                  <span className="unified-dashboard__poae-hash-label">PoAE™ Hash:</span>
                  <span className="unified-dashboard__poae-hash-value">sha256:9f8e7d6c5b4a3210abcdef1234567890</span>
                  <button 
                    className="unified-dashboard__poae-copy-btn"
                    onClick={() => {
                      navigator.clipboard.writeText('sha256:9f8e7d6c5b4a3210abcdef1234567890')
                      console.log('[PoAE] Hash copied to clipboard')
                    }}
                    title="Copy hash to clipboard"
                  >
                    📋
                  </button>
                  <button 
                    className="unified-dashboard__poae-export-btn"
                    onClick={() => console.log('[PoAE] Exporting log for hash: sha256:9f8e7d6c5b4a3210abcdef1234567890')}
                    title="Export PoAE™ log"
                  >
                    📤 Export
                  </button>
                </div>

                {/* Timeline */}
                <div className="unified-dashboard__poae-timeline">
                  {/* Sender PoAE™ Event */}
                  <div className="unified-dashboard__poae-event unified-dashboard__poae-event--sender">
                    <span className="unified-dashboard__poae-event-icon">☁️</span>
                    <div className="unified-dashboard__poae-event-content">
                      <div className="unified-dashboard__poae-event-type">SENDER PoAE™</div>
                      <div className="unified-dashboard__poae-event-org">Acme Corp</div>
                      <div className="unified-dashboard__poae-event-hash">poae_sender_a1b2c3d4</div>
                    </div>
                    <span className="unified-dashboard__poae-event-badge">MANUAL CONSENT</span>
                  </div>
                  
                  {/* AI Agents */}
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
                  
                  {/* Receiver PoAE™ Event */}
                  <div className="unified-dashboard__poae-event unified-dashboard__poae-event--receiver">
                    <span className="unified-dashboard__poae-event-icon">☁️</span>
                    <div className="unified-dashboard__poae-event-content">
                      <div className="unified-dashboard__poae-event-type">RECEIVER PoAE™</div>
                      <div className="unified-dashboard__poae-event-org">Partner Inc</div>
                      <div className="unified-dashboard__poae-event-hash">poae_receiver_7a8b9c0d</div>
                    </div>
                    <span className="unified-dashboard__poae-event-badge">MANUAL CONSENT</span>
                  </div>

                  {/* PoAE™ Confirmed Execution Event */}
                  <div className="unified-dashboard__poae-event unified-dashboard__poae-event--execution">
                    <span className="unified-dashboard__poae-event-icon">✓</span>
                    <div className="unified-dashboard__poae-event-content">
                      <div className="unified-dashboard__poae-event-type">PoAE™ CONFIRMED EXECUTION</div>
                      <div className="unified-dashboard__poae-event-org">End-to-End Verified</div>
                      <div className="unified-dashboard__poae-event-hash">poae_exec_complete_f1e2d3c4</div>
                      {/* Confirmed Actions with green checkmarks */}
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

                {/* Spacer to push Show All to bottom */}
                <div className="unified-dashboard__spacer"></div>

                {/* Show All Button with Arrow - At Bottom */}
                <button 
                  className="unified-dashboard__show-all-btn"
                  onClick={() => setShowPoaeHistory(!showPoaeHistory)}
                >
                  {showPoaeHistory ? 'Hide History ▲' : 'Show All ▼'}
                </button>

                {/* PoAE History - Expands inside Column 3 */}
                {showPoaeHistory && (
                  <div className="unified-dashboard__column-history">
                    <div className="unified-dashboard__column-history-title">PoAE™ LOG HISTORY</div>
                    
                    {/* History Log 1 */}
                    <div className="unified-dashboard__column-history-item">
                      <div className="unified-dashboard__column-history-header">
                        <div className="unified-dashboard__column-history-info">
                          <span className="unified-dashboard__column-history-name">Invoice Processing Workflow</span>
                          <span className="unified-dashboard__column-history-meta">2 min ago • exec_9f8e7d6c</span>
                        </div>
                        <button 
                          className="unified-dashboard__column-history-btn"
                          onClick={() => setExpandedPoaeLogId(expandedPoaeLogId === 'log1' ? null : 'log1')}
                        >
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

                    {/* History Log 2 */}
                    <div className="unified-dashboard__column-history-item">
                      <div className="unified-dashboard__column-history-header">
                        <div className="unified-dashboard__column-history-info">
                          <span className="unified-dashboard__column-history-name">Data Sync Automation</span>
                          <span className="unified-dashboard__column-history-meta">15 min ago • exec_4a5b6c7d</span>
                        </div>
                        <button 
                          className="unified-dashboard__column-history-btn"
                          onClick={() => setExpandedPoaeLogId(expandedPoaeLogId === 'log2' ? null : 'log2')}
                        >
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

        {/* System Overview KPI Strip - Below columns */}
        <section className="unified-dashboard__overview">
          <HeroKPIStrip kpis={kpis} title="System Overview" />
        </section>

        {/* Live Execution - Full Width Progress Bar - Below columns */}
        <section className="unified-dashboard__live-row">
          <div className="unified-dashboard__live-header">
            <div className="unified-dashboard__live-header-left">
              <h2 className="unified-dashboard__live-title">Live Execution</h2>
              <span className="unified-dashboard__live-subtitle">Automation workflow in progress</span>
            </div>
            <div className="unified-dashboard__column-actions">
              <button className="unified-dashboard__action-btn" onClick={handleLiveAnalyse}>
                <span className="unified-dashboard__action-btn-icon">🔍</span>
                Details
              </button>
            </div>
          </div>
          <div className="unified-dashboard__live-content">
            <div className="unified-dashboard__live-steps">
              <div className="unified-dashboard__live-step unified-dashboard__live-step--complete">
                <div className="unified-dashboard__live-step-dot">✓</div>
                <div className="unified-dashboard__live-step-label">Sender PoAE™</div>
              </div>
              <div className="unified-dashboard__live-step-line unified-dashboard__live-step-line--complete"></div>
              
              <div className="unified-dashboard__live-step unified-dashboard__live-step--complete">
                <div className="unified-dashboard__live-step-dot">✓</div>
                <div className="unified-dashboard__live-step-label">Document Classifier</div>
              </div>
              <div className="unified-dashboard__live-step-line unified-dashboard__live-step-line--complete"></div>
              
              <div className="unified-dashboard__live-step unified-dashboard__live-step--complete">
                <div className="unified-dashboard__live-step-dot">✓</div>
                <div className="unified-dashboard__live-step-label">Data Extractor</div>
              </div>
              <div className="unified-dashboard__live-step-line unified-dashboard__live-step-line--active"></div>
              
              <div className="unified-dashboard__live-step unified-dashboard__live-step--active">
                <div className="unified-dashboard__live-step-dot">●</div>
                <div className="unified-dashboard__live-step-label">Compliance Validator</div>
              </div>
              <div className="unified-dashboard__live-step-line"></div>
              
              <div className="unified-dashboard__live-step">
                <div className="unified-dashboard__live-step-dot">○</div>
                <div className="unified-dashboard__live-step-label">Receiver PoAE™</div>
              </div>
              <div className="unified-dashboard__live-step-line"></div>
              
              <div className="unified-dashboard__live-step">
                <div className="unified-dashboard__live-step-dot">○</div>
                <div className="unified-dashboard__live-step-label">Confirmation</div>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Post-Execution Workflow Modal - Uses shared classes */}
      {isPostWorkflowModalOpen && (
        <div className="shared-modal-overlay" onClick={() => setIsPostWorkflowModalOpen(false)}>
          <div className="shared-modal" onClick={e => e.stopPropagation()}>
            <div className="shared-modal__header">
              <h2 className="shared-modal__title">
                <span>🔍</span> Workflow Analysis
              </h2>
              <p className="shared-modal__subtitle">Post-Execution PoAE™ Timeline</p>
              <button className="shared-modal__close" onClick={() => setIsPostWorkflowModalOpen(false)}>×</button>
            </div>
            
            <div className="shared-modal__content">
              {/* Timeline */}
              <div className="shared-modal__timeline">
                {/* Sender PoAE™ */}
                <div className="shared-modal__poae shared-modal__poae--sender">
                  <div className="shared-modal__poae-badge">
                    <span className="shared-modal__poae-icon">📤</span>
                    <span className="shared-modal__poae-label">Sender PoAE™</span>
                  </div>
                  <div className="shared-modal__poae-content">
                    <span className="shared-modal__poae-org">Acme Corp</span>
                    <code className="shared-modal__poae-hash">poae_sender_a1b2c3d4</code>
                  </div>
                  <div className="shared-modal__poae-type">Manual Consent</div>
                  <span className="shared-modal__poae-check">✓</span>
                </div>

                {/* AI Agents */}
                <div className="shared-modal__agent">
                  <span className="shared-modal__agent-icon">🤖</span>
                  <div className="shared-modal__agent-content">
                    <span className="shared-modal__agent-name">Document Classifier</span>
                  </div>
                  <button className="shared-modal__agent-btn">Show Agent</button>
                </div>

                <div className="shared-modal__agent">
                  <span className="shared-modal__agent-icon">🤖</span>
                  <div className="shared-modal__agent-content">
                    <span className="shared-modal__agent-name">Data Extractor</span>
                  </div>
                  <button className="shared-modal__agent-btn">Show Agent</button>
                </div>

                <div className="shared-modal__agent">
                  <span className="shared-modal__agent-icon">🤖</span>
                  <div className="shared-modal__agent-content">
                    <span className="shared-modal__agent-name">Compliance Validator</span>
                  </div>
                  <button className="shared-modal__agent-btn">Show Agent</button>
                </div>

                {/* Receiver PoAE™ */}
                <div className="shared-modal__poae shared-modal__poae--receiver">
                  <div className="shared-modal__poae-badge">
                    <span className="shared-modal__poae-icon">📥</span>
                    <span className="shared-modal__poae-label">Receiver PoAE™</span>
                  </div>
                  <div className="shared-modal__poae-content">
                    <span className="shared-modal__poae-org">Partner Inc</span>
                    <code className="shared-modal__poae-hash">poae_receiver_7a8b9c0d</code>
                  </div>
                  <div className="shared-modal__poae-type">Policy Match</div>
                  <span className="shared-modal__poae-check">✓</span>
                </div>
              </div>

              {/* Executed Actions - Column 2 specific */}
              <div className="shared-modal__executed">
                <div className="shared-modal__executed-title">Executed Actions</div>
                <div className="shared-modal__executed-list">
                  <div className="shared-modal__executed-item">
                    <span className="shared-modal__executed-check">✓</span>
                    <span>Invoice data extracted and validated</span>
                  </div>
                  <div className="shared-modal__executed-item">
                    <span className="shared-modal__executed-check">✓</span>
                    <span>Data synchronized to partner system</span>
                  </div>
                  <div className="shared-modal__executed-item">
                    <span className="shared-modal__executed-check">✓</span>
                    <span>Notification sent to stakeholders</span>
                  </div>
                  <div className="shared-modal__executed-item">
                    <span className="shared-modal__executed-check">✓</span>
                    <span>Compliance report generated</span>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="shared-modal__footer">
              <div className="shared-modal__summary">
                <span className="shared-modal__summary-item">
                  <span className="shared-modal__summary-icon shared-modal__summary-icon--verified">✓</span>
                  Sender PoAE™
                </span>
                <span className="shared-modal__summary-item">
                  <span className="shared-modal__summary-icon shared-modal__summary-icon--verified">✓</span>
                  3 AI Agents
                </span>
                <span className="shared-modal__summary-item">
                  <span className="shared-modal__summary-icon shared-modal__summary-icon--verified">✓</span>
                  Receiver PoAE™
                </span>
              </div>
              <div className="shared-modal__actions">
                <button className="shared-modal__btn" onClick={() => setIsPostWorkflowModalOpen(false)}>
                  Close
                </button>
                <button className="shared-modal__btn shared-modal__btn--primary">
                  ✓ Confirm Execution
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
