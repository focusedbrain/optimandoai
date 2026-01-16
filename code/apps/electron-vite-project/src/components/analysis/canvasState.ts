/**
 * Analysis Canvas State Model
 * 
 * Canvas-scoped state management for the Analysis Dashboard.
 * 
 * Rules:
 * - State MUST NOT leak into sidebar or other components
 * - No shared global state
 * - No backend coupling
 * - All data must declare its verification status
 * 
 * @version 1.0.0
 */

// =============================================================================
// Analysis Phase Type
// =============================================================================

/**
 * Analysis phase identifier
 */
export type AnalysisPhase = 'dashboard' | 'pre-execution' | 'live' | 'post-execution'

/**
 * Drawer tab identifier for Evidence Drawer
 */
export type DrawerTabId = 'evidence' | 'risks'

/**
 * Deep-link payload for OPEN_ANALYSIS_DASHBOARD IPC
 * 
 * All fields are optional for backwards compatibility.
 * Unknown fields are ignored during validation.
 */
export interface AnalysisOpenPayload {
  /** Target phase to open */
  phase?: AnalysisPhase
  /** Select trace filter in live mode */
  traceId?: string
  /** Select specific event in timeline and open drawer */
  eventId?: string
  /** Which drawer tab to open */
  drawerTab?: DrawerTabId
  /** Highlight alignment row / risk rule */
  ruleId?: string
}

/**
 * Valid phase values for validation
 */
export const VALID_PHASES: readonly AnalysisPhase[] = ['dashboard', 'pre-execution', 'live', 'post-execution'] as const

/**
 * Valid drawer tab values for validation
 */
export const VALID_DRAWER_TABS: readonly DrawerTabId[] = ['evidence', 'risks'] as const

/**
 * Validate and sanitize an AnalysisOpenPayload
 * - Ignores unknown fields
 * - Returns only valid, typed fields
 * - Returns empty object if input is invalid
 */
export function sanitizeAnalysisOpenPayload(raw: unknown): AnalysisOpenPayload {
  if (!raw || typeof raw !== 'object') {
    return {}
  }
  
  const input = raw as Record<string, unknown>
  const result: AnalysisOpenPayload = {}
  
  // Validate phase
  if (typeof input.phase === 'string' && VALID_PHASES.includes(input.phase as AnalysisPhase)) {
    result.phase = input.phase as AnalysisPhase
  }
  
  // Validate traceId (non-empty string)
  if (typeof input.traceId === 'string' && input.traceId.length > 0) {
    result.traceId = input.traceId
  }
  
  // Validate eventId (non-empty string)
  if (typeof input.eventId === 'string' && input.eventId.length > 0) {
    result.eventId = input.eventId
  }
  
  // Validate drawerTab
  if (typeof input.drawerTab === 'string' && VALID_DRAWER_TABS.includes(input.drawerTab as DrawerTabId)) {
    result.drawerTab = input.drawerTab as DrawerTabId
  }
  
  // Validate ruleId (non-empty string)
  if (typeof input.ruleId === 'string' && input.ruleId.length > 0) {
    result.ruleId = input.ruleId
  }
  
  return result
}

// =============================================================================
// Verification Status Types
// =============================================================================

/**
 * Data source status - indicates how data should be treated
 */
export type DataSourceStatus = 
  | 'verified'      // Cryptographically verified (future PoAE)
  | 'recorded'      // Recorded in audit chain, not cryptographically verified
  | 'simulated'     // Simulated/generated locally for demo
  | 'mock'          // Static mock data for UI development
  | 'placeholder'   // Placeholder for unimplemented feature

/**
 * Verification flags that MUST be checked before rendering claims
 */
export interface VerificationFlags {
  /** Data is mock/demo, not real */
  isMockData: boolean
  /** Data is from simulation, not real execution */
  isSimulated: boolean
  /** Data has NOT been cryptographically verified */
  isUnverified: boolean
  /** PoAE is not implemented - all PoAE data is placeholder */
  isPoAEPlaceholder: boolean
}

/**
 * Default flags for current implementation state
 * ALL flags are true because PoAE is not implemented
 */
export const DEFAULT_VERIFICATION_FLAGS: VerificationFlags = {
  isMockData: true,
  isSimulated: true,
  isUnverified: true,
  isPoAEPlaceholder: true
}

// =============================================================================
// Canvas Event Schema
// =============================================================================

/**
 * Base event type for all canvas events
 */
export interface CanvasEvent {
  id: string
  type: CanvasEventType
  timestamp: string
  source: DataSourceStatus
  flags: VerificationFlags
}

/**
 * All possible canvas event types
 */
export type CanvasEventType =
  // Pre-Execution Events
  | 'template_loaded'
  | 'session_imported'
  | 'policy_evaluated'
  | 'consent_checked'
  | 'risk_calculated'
  // Live Execution Events
  | 'execution_started'
  | 'step_started'
  | 'step_completed'
  | 'semantic_extraction'
  | 'automation_step'
  | 'packaging'
  | 'depackaging'
  | 'consent_required'
  | 'ai_invocation'
  // Post-Execution Events
  | 'execution_completed'
  | 'evidence_recorded'
  | 'chain_updated'
  // PoAE Events (placeholder)
  | 'poae_checkpoint'
  | 'poae_attestation'

// =============================================================================
// Phase-Specific State Types
// =============================================================================

/**
 * Pre-Execution Analysis State
 */
export interface PreExecutionState {
  /** Current verification flags */
  flags: VerificationFlags
  
  /** Template being inspected */
  template: {
    id: string
    name: string
    version: string
    hash: string
    source: DataSourceStatus
  } | null
  
  /** Session context */
  session: {
    id: string
    capsuleCount: number
    contextKeys: string[]
    source: DataSourceStatus
  } | null
  
  /** Risk analysis result */
  riskAnalysis: {
    overallScore: number
    level: 'low' | 'medium' | 'high'
    blockingIssues: number
    warnings: number
    source: DataSourceStatus
  } | null
  
  /** Consent requirements */
  consentStatus: Array<{
    type: string
    requirement: string
    status: 'passed' | 'failed' | 'pending'
    source: DataSourceStatus
  }>
}

/**
 * Live Execution Analysis State
 */
export interface LiveExecutionState {
  /** Current verification flags */
  flags: VerificationFlags
  
  /** Whether event stream is active */
  isStreaming: boolean
  
  /** Currently focused event type (for dynamic layout) */
  focusedEventType: CanvasEventType | null
  
  /** Event buffer (most recent events) */
  events: Array<{
    id: string
    type: CanvasEventType
    title: string
    timestamp: string
    details: Record<string, unknown>
    source: DataSourceStatus
  }>
  
  /** Maximum events to retain */
  maxEvents: number
}

/**
 * Post-Execution Verification State
 */
export interface PostExecutionState {
  /** Current verification flags */
  flags: VerificationFlags
  
  /** Execution record */
  execution: {
    id: string
    templateId: string
    status: 'completed' | 'failed'
    startedAt: string
    completedAt: string
    durationMs: number
    source: DataSourceStatus
  } | null
  
  /** Timeline steps */
  timeline: Array<{
    id: number
    name: string
    hash: string
    durationMs: number
    source: DataSourceStatus
  }>
  
  /** Evidence bundle */
  evidence: {
    capsuleHashes: Array<{ id: string; hash: string; source: DataSourceStatus }>
    artefactHashes: Array<{ id: string; hash: string; source: DataSourceStatus }>
    policySnapshot: Array<{ id: string; hash: string; result: string; source: DataSourceStatus }>
    source: DataSourceStatus
  } | null
  
  /** PoAE status (always placeholder until implemented) */
  poaeStatus: {
    isImplemented: false
    placeholderEvents: Array<{
      type: string
      timestamp: string
      demoValue: string
    }>
  }
}

// =============================================================================
// Complete Canvas State
// =============================================================================

/**
 * Complete canvas state model
 */
export interface CanvasState {
  /** Current active phase */
  activePhase: AnalysisPhase
  
  /** Global canvas flags */
  globalFlags: VerificationFlags
  
  /** Phase-specific states */
  preExecution: PreExecutionState
  liveExecution: LiveExecutionState
  postExecution: PostExecutionState
}

// =============================================================================
// State Factory Functions
// =============================================================================

/**
 * Create initial pre-execution state with mock data
 */
export function createInitialPreExecutionState(): PreExecutionState {
  return {
    flags: { ...DEFAULT_VERIFICATION_FLAGS },
    template: null,
    session: null,
    riskAnalysis: null,
    consentStatus: []
  }
}

/**
 * Create initial live execution state
 */
export function createInitialLiveExecutionState(): LiveExecutionState {
  return {
    flags: { ...DEFAULT_VERIFICATION_FLAGS },
    isStreaming: false,
    focusedEventType: null,
    events: [],
    maxEvents: 20
  }
}

/**
 * Create initial post-execution state
 */
export function createInitialPostExecutionState(): PostExecutionState {
  return {
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

/**
 * Create complete initial canvas state
 */
export function createInitialCanvasState(): CanvasState {
  return {
    activePhase: 'dashboard',
    globalFlags: { ...DEFAULT_VERIFICATION_FLAGS },
    preExecution: createInitialPreExecutionState(),
    liveExecution: createInitialLiveExecutionState(),
    postExecution: createInitialPostExecutionState()
  }
}

// =============================================================================
// Verification Helpers
// =============================================================================

/**
 * Check if data can be presented as verified
 * Returns false if ANY flag indicates unverified state
 */
export function canClaimVerified(flags: VerificationFlags): boolean {
  return !flags.isMockData && 
         !flags.isSimulated && 
         !flags.isUnverified && 
         !flags.isPoAEPlaceholder
}

/**
 * Get appropriate badge text based on flags
 */
export function getStatusBadgeText(flags: VerificationFlags): string {
  if (flags.isMockData) return 'Mock Data'
  if (flags.isSimulated) return 'Simulated'
  if (flags.isPoAEPlaceholder) return 'Demo / Placeholder'
  if (flags.isUnverified) return 'Unverified'
  return 'Verified'
}

/**
 * Get appropriate badge variant based on flags
 */
export function getStatusBadgeVariant(flags: VerificationFlags): 'verified' | 'demo' | 'recorded' | 'warning' {
  if (flags.isMockData || flags.isPoAEPlaceholder) return 'demo'
  if (flags.isSimulated) return 'demo'
  if (flags.isUnverified) return 'recorded'
  return 'verified'
}

/**
 * Check if PoAE claims can be made
 * Always returns false until PoAE is implemented
 */
export function canClaimPoAE(_flags: VerificationFlags): boolean {
  // PoAE is not implemented - always return false
  return false
}

// =============================================================================
// Event ID Generator
// =============================================================================

let eventCounter = 0

/**
 * Generate unique event ID (canvas-scoped)
 */
export function generateEventId(): string {
  eventCounter++
  return `evt_${Date.now()}_${eventCounter.toString(36)}`
}

/**
 * Reset event counter (for testing)
 */
export function resetEventCounter(): void {
  eventCounter = 0
}

