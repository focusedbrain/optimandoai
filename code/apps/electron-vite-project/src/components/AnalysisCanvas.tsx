import { useEffect, useState, useCallback } from 'react'
import './AnalysisCanvas.css'
import DashboardHome from './DashboardHome'
import PreExecutionAnalysis from './PreExecutionAnalysis'
import LiveExecutionAnalysis from './LiveExecutionAnalysis'
import PostExecutionVerification from './PostExecutionVerification'
import { useCanvasState, type AnalysisPhase, type AnalysisOpenPayload, type DrawerTabId } from './analysis'
import { StatusBadge } from './analysis/StatusBadge'

interface PhaseOption {
  id: AnalysisPhase
  label: string
  description: string
}

const phases: PhaseOption[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    description: 'Priority actions across all phases'
  },
  {
    id: 'pre-execution',
    label: 'Pre-Execution',
    description: 'Inspect automation artifacts'
  },
  {
    id: 'live',
    label: 'Live Execution',
    description: 'Monitor active executions'
  },
  {
    id: 'post-execution',
    label: 'Post-Execution',
    description: 'Verify completed executions'
  }
]

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
  const [state, actions, helpers] = useCanvasState()
  
  // Deep-link state to pass to child views (consumed once)
  const [liveDeepLink, setLiveDeepLink] = useState<DeepLinkState | null>(null)
  const [preExecutionDeepLink, setPreExecutionDeepLink] = useState<DeepLinkState | null>(null)

  // Handle deep-link payload from IPC
  useEffect(() => {
    if (!deepLinkPayload) return
    
    console.log('[AnalysisCanvas] Processing deep-link payload:', deepLinkPayload)
    
    // Handle phase switch
    const targetPhase = deepLinkPayload.phase || 'live' // Default to live if not specified
    if (targetPhase !== state.activePhase) {
      actions.setActivePhase(targetPhase)
    }
    
    // Extract deep-link fields for child components
    const childDeepLink: DeepLinkState = {}
    if (deepLinkPayload.traceId) childDeepLink.traceId = deepLinkPayload.traceId
    if (deepLinkPayload.eventId) childDeepLink.eventId = deepLinkPayload.eventId
    if (deepLinkPayload.drawerTab) childDeepLink.drawerTab = deepLinkPayload.drawerTab
    if (deepLinkPayload.ruleId) childDeepLink.ruleId = deepLinkPayload.ruleId
    
    // Only set if we have actual deep-link fields
    if (Object.keys(childDeepLink).length > 0) {
      // Route to appropriate phase
      if (targetPhase === 'pre-execution') {
        setPreExecutionDeepLink(childDeepLink)
      } else if (targetPhase === 'live') {
        setLiveDeepLink(childDeepLink)
      }
      // post-execution deep-links can be added later
    }
    
    // Signal that we've consumed the payload
    onDeepLinkConsumed?.()
  }, [deepLinkPayload, state.activePhase, actions, onDeepLinkConsumed])
  
  // Callback for LiveExecutionAnalysis to signal deep-link consumed
  const handleLiveDeepLinkConsumed = useCallback(() => {
    setLiveDeepLink(null)
  }, [])
  
  // Callback for PreExecutionAnalysis to signal deep-link consumed
  const handlePreExecutionDeepLinkConsumed = useCallback(() => {
    setPreExecutionDeepLink(null)
  }, [])
  
  const handlePhaseChange = (phase: AnalysisPhase) => {
    actions.setActivePhase(phase)
  }

  // Handle navigation from Dashboard CTA buttons
  const handleDashboardNavigate = useCallback((
    phase: AnalysisPhase, 
    deepLink?: { ruleId?: string; eventId?: string; drawerTab?: 'evidence' | 'risks' }
  ) => {
    // Switch to target phase
    actions.setActivePhase(phase)
    
    // Set deep-link state if provided
    if (deepLink) {
      const linkState: DeepLinkState = {}
      if (deepLink.ruleId) linkState.ruleId = deepLink.ruleId
      if (deepLink.eventId) linkState.eventId = deepLink.eventId
      if (deepLink.drawerTab) linkState.drawerTab = deepLink.drawerTab
      
      if (phase === 'pre-execution') {
        setPreExecutionDeepLink(linkState)
      } else if (phase === 'live') {
        setLiveDeepLink(linkState)
      }
    }
  }, [actions])

  return (
    <div className="analysis-canvas">
      {/* Header */}
      <div className="analysis-header">
        <h1 className="analysis-title">Analysis Dashboard</h1>
        <span className="analysis-badge">Enterprise Preview</span>
        <StatusBadge flags={helpers.currentFlags} size="medium" />
      </div>

      {/* Phase Selector */}
      <div className="phase-selector">
        {phases.map((phase) => (
          <button
            key={phase.id}
            className={`phase-button ${state.activePhase === phase.id ? 'phase-button--active' : ''}`}
            onClick={() => handlePhaseChange(phase.id)}
            aria-pressed={state.activePhase === phase.id}
          >
            <span className="phase-button__label">{phase.label}</span>
            <span className="phase-button__description">{phase.description}</span>
          </button>
        ))}
      </div>

      {/* Phase Content */}
      <div className="phase-content">
        {state.activePhase === 'dashboard' && (
          <DashboardHome 
            onNavigate={handleDashboardNavigate}
          />
        )}
        {state.activePhase === 'pre-execution' && (
          <PreExecutionAnalysis 
            flags={state.preExecution.flags}
            deepLink={preExecutionDeepLink ?? undefined}
            onDeepLinkConsumed={handlePreExecutionDeepLinkConsumed}
          />
        )}
        {state.activePhase === 'live' && (
          <LiveExecutionAnalysis 
            flags={state.liveExecution.flags}
            deepLink={liveDeepLink ?? undefined}
            onDeepLinkConsumed={handleLiveDeepLinkConsumed}
          />
        )}
        {state.activePhase === 'post-execution' && (
          <PostExecutionVerification 
            flags={state.postExecution.flags}
          />
        )}
      </div>
    </div>
  )
}
