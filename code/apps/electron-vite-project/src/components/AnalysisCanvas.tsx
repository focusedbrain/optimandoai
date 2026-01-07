import { useEffect, useState, useCallback } from 'react'
import './AnalysisCanvas.css'
import PreExecutionAnalysis from './PreExecutionAnalysis'
import LiveExecutionAnalysis from './LiveExecutionAnalysis'
import PostExecutionVerification from './PostExecutionVerification'
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
  const [liveDeepLink, setLiveDeepLink] = useState<DeepLinkState | null>(null)
  const [preExecutionDeepLink, setPreExecutionDeepLink] = useState<DeepLinkState | null>(null)

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
  
  const handleLiveDeepLinkConsumed = useCallback(() => {
    setLiveDeepLink(null)
  }, [])
  
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
        {/* System Overview KPI Strip - ORIGINAL, UNCHANGED */}
        <section className="unified-dashboard__overview">
          <HeroKPIStrip kpis={kpis} title="System Overview" />
        </section>

        {/* Three Column Layout - Side by Side */}
        <div className="unified-dashboard__columns">
          {/* Pre-Execution Column */}
          <div className="unified-dashboard__column unified-dashboard__column--pre">
            <div className="unified-dashboard__column-header">
              <div className="unified-dashboard__column-header-left">
                <h2 className="unified-dashboard__column-title">Pre-Execution</h2>
                <span className="unified-dashboard__column-subtitle">Awaiting approvals</span>
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

          {/* Live Execution Column */}
          <div className="unified-dashboard__column unified-dashboard__column--live">
            <div className="unified-dashboard__column-header">
              <div className="unified-dashboard__column-header-left">
                <h2 className="unified-dashboard__column-title">Live Execution</h2>
                <span className="unified-dashboard__column-subtitle">Active processes</span>
              </div>
              <div className="unified-dashboard__column-actions">
                <button className="unified-dashboard__action-btn" onClick={handleLiveAnalyse}>
                  <span className="unified-dashboard__action-btn-icon">🔍</span>
                  Analyse
                </button>
              </div>
            </div>
            <div className="unified-dashboard__column-content">
              <LiveExecutionAnalysis 
                flags={state.liveExecution.flags}
                deepLink={liveDeepLink ?? undefined}
                onDeepLinkConsumed={handleLiveDeepLinkConsumed}
                compact={true}
              />
            </div>
          </div>

          {/* Post-Execution Column */}
          <div className="unified-dashboard__column unified-dashboard__column--post">
            <div className="unified-dashboard__column-header">
              <div className="unified-dashboard__column-header-left">
                <h2 className="unified-dashboard__column-title">Post-Execution</h2>
                <span className="unified-dashboard__column-subtitle">Verified logs</span>
              </div>
              <div className="unified-dashboard__column-actions">
                <button className="unified-dashboard__action-btn" onClick={handlePostAnalyse}>
                  <span className="unified-dashboard__action-btn-icon">🔍</span>
                  Analyse
                </button>
                <button className="unified-dashboard__action-btn" onClick={handlePostExport}>
                  <span className="unified-dashboard__action-btn-icon">📤</span>
                  Export
                </button>
              </div>
            </div>
            <div className="unified-dashboard__column-content">
              <PostExecutionVerification 
                flags={state.postExecution.flags}
                compact={true}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
