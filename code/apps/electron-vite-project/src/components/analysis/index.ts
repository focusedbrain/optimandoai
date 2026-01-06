/**
 * Analysis Canvas State Module
 * 
 * Canvas-scoped state management for the Analysis Dashboard.
 * 
 * @module analysis
 * @version 1.0.0
 */

// State types and factories
export {
  type AnalysisPhase,
  type DrawerTabId,
  type AnalysisOpenPayload,
  type CanvasState,
  type PreExecutionState,
  type LiveExecutionState,
  type PostExecutionState,
  type VerificationFlags,
  type CanvasEventType,
  type CanvasEvent,
  type DataSourceStatus,
  VALID_PHASES,
  VALID_DRAWER_TABS,
  sanitizeAnalysisOpenPayload,
  DEFAULT_VERIFICATION_FLAGS,
  createInitialCanvasState,
  createInitialPreExecutionState,
  createInitialLiveExecutionState,
  createInitialPostExecutionState,
  canClaimVerified,
  canClaimPoAE,
  getStatusBadgeText,
  getStatusBadgeVariant,
  generateEventId,
  resetEventCounter
} from './canvasState'

// React hook
export {
  useCanvasState,
  type CanvasStateActions,
  type CanvasStateHelpers
} from './useCanvasState'

// Hero KPI Components
export {
  KPICard,
  HeroKPIStrip,
  StatusHero,
  QuickActionBar,
  ReadinessGauge,
  ExecutionStatusHero,
  VerificationStatusHero,
  type KPIStatus,
  type KPIData,
  type StatusHeroData,
  type QuickAction
} from './HeroKPI'

// Priority Action Computation
export {
  computePriorityAction,
  getMockDashboardState,
  getStatusLabel,
  getStatusColor,
  type PriorityTier,
  type ActionStatus,
  type PrimaryCTA,
  type PriorityAction,
  type PreExecutionSnapshot,
  type LiveExecutionSnapshot,
  type PostExecutionSnapshot,
  type DashboardState
} from './computePriorityAction'

// Focus Layout Engine (pure functions)
export {
  type LiveEventType,
  type PanelId,
  type LiveEvent,
  type EventDomain,
  type TraceId,
  type EventFilter,
  type FocusState,
  type FocusStickinessState,
  type LayoutSpec,
  type ViewportSize,
  type RiskEvent,
  type RiskSeverity,
  type RiskCategory,
  type ReadmeClaims,
  type TemplateClaims,
  type ClaimSet,
  type ObservationSet,
  type AlignmentStatus,
  type AlignmentRow,
  EVENT_TO_PANEL,
  EVENT_TYPE_TO_DOMAIN,
  EVENT_PRIORITY,
  SEVERITY_PRIORITY,
  AVAILABLE_TRACES,
  ALL_DOMAINS,
  DEFAULT_CLAIMS,
  compareEvents,
  compareRisks,
  filterEvents,
  createDefaultFilter,
  computeFocusState,
  computeFocusStateWithStickiness,
  createInitialStickinessState,
  computeLayoutSpec,
  generateLayoutCSSVars,
  createLiveEvent,
  createDemoEvents,
  getNextSeq,
  resetSeqCounter,
  DEMO_EVENT_SEQUENCE,
  resetEventIdCounter,
  generateRiskEvents,
  filterRisksByTrace,
  getRisksForEvent,
  getRisksForTrace,
  getHighestSeverity,
  getTopRisks,
  createEmptyObservations,
  computeObservations,
  computeAlignment,
  getRisksForAlignmentRow
} from './focusLayoutEngine'

