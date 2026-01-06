/**
 * Canvas State Hook
 * 
 * React hook for managing canvas-scoped state.
 * State is isolated to the AnalysisCanvas and does NOT leak to sidebar.
 * 
 * @version 1.0.0
 */

import { useState, useCallback, useMemo } from 'react'
import {
  CanvasState,
  PreExecutionState,
  LiveExecutionState,
  PostExecutionState,
  VerificationFlags,
  CanvasEventType,
  DataSourceStatus,
  createInitialCanvasState,
  DEFAULT_VERIFICATION_FLAGS,
  generateEventId,
  canClaimVerified,
  getStatusBadgeText,
  getStatusBadgeVariant
} from './canvasState'

// =============================================================================
// Hook Return Type
// =============================================================================

export interface CanvasStateActions {
  // Phase Navigation
  setActivePhase: (phase: CanvasState['activePhase']) => void
  
  // Pre-Execution Actions
  setPreExecutionTemplate: (template: PreExecutionState['template']) => void
  setPreExecutionSession: (session: PreExecutionState['session']) => void
  setPreExecutionRisk: (risk: PreExecutionState['riskAnalysis']) => void
  setPreExecutionConsent: (consent: PreExecutionState['consentStatus']) => void
  
  // Live Execution Actions
  setStreaming: (streaming: boolean) => void
  addLiveEvent: (event: Omit<LiveExecutionState['events'][0], 'id' | 'timestamp'>) => void
  setFocusedEventType: (type: CanvasEventType | null) => void
  clearLiveEvents: () => void
  
  // Post-Execution Actions
  setPostExecution: (execution: PostExecutionState['execution']) => void
  setPostTimeline: (timeline: PostExecutionState['timeline']) => void
  setPostEvidence: (evidence: PostExecutionState['evidence']) => void
  
  // Utility Actions
  resetPhaseState: (phase: CanvasState['activePhase']) => void
  resetAllState: () => void
}

export interface CanvasStateHelpers {
  /** Check if current data can claim verification */
  canClaimVerified: (flags?: VerificationFlags) => boolean
  /** Get badge text for flags */
  getBadgeText: (flags?: VerificationFlags) => string
  /** Get badge variant for flags */
  getBadgeVariant: (flags?: VerificationFlags) => 'verified' | 'demo' | 'recorded' | 'warning'
  /** Current phase flags */
  currentFlags: VerificationFlags
  /** Check if PoAE is available (always false for now) */
  isPoAEAvailable: boolean
}

// =============================================================================
// Hook Implementation
// =============================================================================

export function useCanvasState(): [CanvasState, CanvasStateActions, CanvasStateHelpers] {
  const [state, setState] = useState<CanvasState>(createInitialCanvasState)
  
  // ==========================================================================
  // Phase Navigation
  // ==========================================================================
  
  const setActivePhase = useCallback((phase: CanvasState['activePhase']) => {
    setState(prev => ({ ...prev, activePhase: phase }))
  }, [])
  
  // ==========================================================================
  // Pre-Execution Actions
  // ==========================================================================
  
  const setPreExecutionTemplate = useCallback((template: PreExecutionState['template']) => {
    setState(prev => ({
      ...prev,
      preExecution: { ...prev.preExecution, template }
    }))
  }, [])
  
  const setPreExecutionSession = useCallback((session: PreExecutionState['session']) => {
    setState(prev => ({
      ...prev,
      preExecution: { ...prev.preExecution, session }
    }))
  }, [])
  
  const setPreExecutionRisk = useCallback((riskAnalysis: PreExecutionState['riskAnalysis']) => {
    setState(prev => ({
      ...prev,
      preExecution: { ...prev.preExecution, riskAnalysis }
    }))
  }, [])
  
  const setPreExecutionConsent = useCallback((consentStatus: PreExecutionState['consentStatus']) => {
    setState(prev => ({
      ...prev,
      preExecution: { ...prev.preExecution, consentStatus }
    }))
  }, [])
  
  // ==========================================================================
  // Live Execution Actions
  // ==========================================================================
  
  const setStreaming = useCallback((isStreaming: boolean) => {
    setState(prev => ({
      ...prev,
      liveExecution: { ...prev.liveExecution, isStreaming }
    }))
  }, [])
  
  const addLiveEvent = useCallback((
    event: Omit<LiveExecutionState['events'][0], 'id' | 'timestamp'>
  ) => {
    setState(prev => {
      const newEvent = {
        ...event,
        id: generateEventId(),
        timestamp: new Date().toISOString()
      }
      const events = [...prev.liveExecution.events, newEvent]
        .slice(-prev.liveExecution.maxEvents)
      
      return {
        ...prev,
        liveExecution: {
          ...prev.liveExecution,
          events,
          focusedEventType: event.type
        }
      }
    })
  }, [])
  
  const setFocusedEventType = useCallback((focusedEventType: CanvasEventType | null) => {
    setState(prev => ({
      ...prev,
      liveExecution: { ...prev.liveExecution, focusedEventType }
    }))
  }, [])
  
  const clearLiveEvents = useCallback(() => {
    setState(prev => ({
      ...prev,
      liveExecution: {
        ...prev.liveExecution,
        events: [],
        focusedEventType: null
      }
    }))
  }, [])
  
  // ==========================================================================
  // Post-Execution Actions
  // ==========================================================================
  
  const setPostExecution = useCallback((execution: PostExecutionState['execution']) => {
    setState(prev => ({
      ...prev,
      postExecution: { ...prev.postExecution, execution }
    }))
  }, [])
  
  const setPostTimeline = useCallback((timeline: PostExecutionState['timeline']) => {
    setState(prev => ({
      ...prev,
      postExecution: { ...prev.postExecution, timeline }
    }))
  }, [])
  
  const setPostEvidence = useCallback((evidence: PostExecutionState['evidence']) => {
    setState(prev => ({
      ...prev,
      postExecution: { ...prev.postExecution, evidence }
    }))
  }, [])
  
  // ==========================================================================
  // Utility Actions
  // ==========================================================================
  
  const resetPhaseState = useCallback((phase: CanvasState['activePhase']) => {
    setState(prev => {
      switch (phase) {
        case 'pre-execution':
          return {
            ...prev,
            preExecution: {
              flags: { ...DEFAULT_VERIFICATION_FLAGS },
              template: null,
              session: null,
              riskAnalysis: null,
              consentStatus: []
            }
          }
        case 'live':
          return {
            ...prev,
            liveExecution: {
              flags: { ...DEFAULT_VERIFICATION_FLAGS },
              isStreaming: false,
              focusedEventType: null,
              events: [],
              maxEvents: 20
            }
          }
        case 'post-execution':
          return {
            ...prev,
            postExecution: {
              flags: { ...DEFAULT_VERIFICATION_FLAGS },
              execution: null,
              timeline: [],
              evidence: null,
              poaeStatus: {
                isImplemented: false,
                placeholderEvents: []
              }
            }
          }
        default:
          return prev
      }
    })
  }, [])
  
  const resetAllState = useCallback(() => {
    setState(createInitialCanvasState())
  }, [])
  
  // ==========================================================================
  // Helpers
  // ==========================================================================
  
  const currentFlags = useMemo((): VerificationFlags => {
    switch (state.activePhase) {
      case 'pre-execution':
        return state.preExecution.flags
      case 'live':
        return state.liveExecution.flags
      case 'post-execution':
        return state.postExecution.flags
      default:
        return state.globalFlags
    }
  }, [state.activePhase, state.preExecution.flags, state.liveExecution.flags, state.postExecution.flags, state.globalFlags])
  
  const helpers: CanvasStateHelpers = useMemo(() => ({
    canClaimVerified: (flags?: VerificationFlags) => canClaimVerified(flags ?? currentFlags),
    getBadgeText: (flags?: VerificationFlags) => getStatusBadgeText(flags ?? currentFlags),
    getBadgeVariant: (flags?: VerificationFlags) => getStatusBadgeVariant(flags ?? currentFlags),
    currentFlags,
    isPoAEAvailable: false // Always false until implemented
  }), [currentFlags])
  
  // ==========================================================================
  // Actions Object
  // ==========================================================================
  
  const actions: CanvasStateActions = useMemo(() => ({
    setActivePhase,
    setPreExecutionTemplate,
    setPreExecutionSession,
    setPreExecutionRisk,
    setPreExecutionConsent,
    setStreaming,
    addLiveEvent,
    setFocusedEventType,
    clearLiveEvents,
    setPostExecution,
    setPostTimeline,
    setPostEvidence,
    resetPhaseState,
    resetAllState
  }), [
    setActivePhase,
    setPreExecutionTemplate,
    setPreExecutionSession,
    setPreExecutionRisk,
    setPreExecutionConsent,
    setStreaming,
    addLiveEvent,
    setFocusedEventType,
    clearLiveEvents,
    setPostExecution,
    setPostTimeline,
    setPostEvidence,
    resetPhaseState,
    resetAllState
  ])
  
  return [state, actions, helpers]
}

// =============================================================================
// Type Exports
// =============================================================================

export type {
  CanvasState,
  PreExecutionState,
  LiveExecutionState,
  PostExecutionState,
  VerificationFlags,
  CanvasEventType,
  DataSourceStatus
}

export {
  DEFAULT_VERIFICATION_FLAGS,
  canClaimVerified,
  getStatusBadgeText,
  getStatusBadgeVariant
}


