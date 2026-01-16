/**
 * Focus Layout Engine
 * 
 * Deterministic layout algorithm for the Live Execution Analysis view.
 * Pure functions only - no React hooks, no side effects.
 * 
 * RULES:
 * - Same event sequence => same layout (deterministic)
 * - No randomization, no time-based jitter
 * - Consent events override all others (most recent unresolved only)
 * - Focus stickiness: stays for 2+ events unless overridden
 * 
 * @version 1.1.0
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Event types that can trigger focus changes
 */
export type LiveEventType =
  | 'semantic_extraction'
  | 'automation_step'
  | 'packaging'
  | 'depackaging'
  | 'intent_detection'
  | 'consent_required'
  | 'poe_event'

/**
 * Panel identifiers
 */
export type PanelId =
  | 'timeline'
  | 'focus'
  | 'semantic'
  | 'automation'
  | 'packaging'
  | 'intent'
  | 'consent'

/**
 * Domain categories for event classification
 */
export type EventDomain =
  | 'semantics'
  | 'automation'
  | 'packaging'
  | 'depackaging'
  | 'intent'
  | 'consent'
  | 'verification'

/**
 * Live event structure with monotonic sequence and correlation
 */
export interface LiveEvent {
  id: string
  type: LiveEventType
  timestamp: number // Unix timestamp
  seq: number // Monotonic sequence number for deterministic tie-breaking
  resolved?: boolean // For consent events
  data?: Record<string, unknown>
  // Correlation identifiers
  traceId: string // Required - identifies the execution trace
  capsuleId?: string // Optional - associated capsule
  domain: EventDomain // Event domain category
}

/**
 * Map event types to domains
 */
export const EVENT_TYPE_TO_DOMAIN: Record<LiveEventType, EventDomain> = {
  semantic_extraction: 'semantics',
  automation_step: 'automation',
  packaging: 'packaging',
  depackaging: 'depackaging',
  intent_detection: 'intent',
  consent_required: 'consent',
  poe_event: 'verification'
}

// =============================================================================
// Risk Event Types
// =============================================================================

/**
 * Risk severity levels (ordered by priority)
 */
export type RiskSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical'

/**
 * Risk categories for classification
 */
export type RiskCategory = 'policy' | 'egress' | 'docs' | 'determinism' | 'consent' | 'integrity'

/**
 * Risk event structure
 */
export interface RiskEvent {
  riskId: string
  timestamp: number
  seq: number
  severity: RiskSeverity
  category: RiskCategory
  title: string
  explanation: string
  traceId?: string // Correlate to execution trace
  eventId?: string // Link to a specific LiveEvent
  ruleId?: string // E.g. "ALIGN-README-001"
  isMock: boolean // Always true for now
}

/**
 * Severity priority for sorting (higher = more severe)
 */
export const SEVERITY_PRIORITY: Record<RiskSeverity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
}

/**
 * Compare risks by severity (descending) then timestamp (ascending)
 */
export function compareRisks(a: RiskEvent, b: RiskEvent): number {
  const severityDiff = SEVERITY_PRIORITY[b.severity] - SEVERITY_PRIORITY[a.severity]
  if (severityDiff !== 0) return severityDiff
  if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp
  return a.seq - b.seq
}

// =============================================================================
// Claims vs Observations Alignment Model
// =============================================================================

/**
 * README claims (declared in documentation)
 */
export interface ReadmeClaims {
  noExternalEgress: boolean
  deterministicOnly: boolean
  requiresConsentForExternalApi: boolean
}

/**
 * Template/automation claims (declared in automation template)
 */
export interface TemplateClaims {
  declaredIngress: string[]
  declaredEgress: string[]
  allowedDomains?: string[]
}

/**
 * Complete claim set (mock values for now)
 */
export interface ClaimSet {
  readmeClaims: ReadmeClaims
  templateClaims: TemplateClaims
}

/**
 * Default mock claims - represents what the documentation/template claims
 */
export const DEFAULT_CLAIMS: ClaimSet = {
  readmeClaims: {
    noExternalEgress: true, // Claims no external egress
    deterministicOnly: true, // Claims only deterministic steps
    requiresConsentForExternalApi: true // Claims consent required for external API
  },
  templateClaims: {
    declaredIngress: ['session_import', 'capsule_depackaging'],
    declaredEgress: ['capsule_packaging', 'internal_storage'],
    allowedDomains: ['internal.example.com']
  }
}

/**
 * Observations derived from events (what actually happened)
 */
export interface ObservationSet {
  observedExternalEgress: boolean
  observedEgressDomains: string[]
  observedAiInvolvement: boolean
  observedIngressKinds: string[]
  observedEgressKinds: string[]
  unverifiedSteps: string[]
  consentRequestedForExternalApi: boolean
}

/**
 * Create empty observations
 */
export function createEmptyObservations(): ObservationSet {
  return {
    observedExternalEgress: false,
    observedEgressDomains: [],
    observedAiInvolvement: false,
    observedIngressKinds: [],
    observedEgressKinds: [],
    unverifiedSteps: [],
    consentRequestedForExternalApi: false
  }
}

/**
 * Compute observations from events (deterministic, pure function)
 * Same events => same observations
 */
export function computeObservations(events: LiveEvent[]): ObservationSet {
  const observations = createEmptyObservations()
  const egressDomains = new Set<string>()
  const ingressKinds = new Set<string>()
  const egressKinds = new Set<string>()
  const unverified = new Set<string>()

  for (const event of events) {
    // Check for external egress
    if ((event.type === 'packaging' || event.type === 'depackaging') && 
        event.data?.externalEgress === true) {
      observations.observedExternalEgress = true
      // Extract domain if present
      const domain = event.data?.egressDomain as string | undefined
      if (domain) {
        egressDomains.add(domain)
      } else {
        egressDomains.add('external.unknown')
      }
    }

    // Check for AI involvement
    if (event.type === 'intent_detection' && 
        (event.data?.aiModel || event.data?.detected_intent)) {
      observations.observedAiInvolvement = true
    }

    // Track ingress kinds
    if (event.type === 'depackaging') {
      ingressKinds.add('capsule_depackaging')
    }
    if (event.type === 'semantic_extraction') {
      ingressKinds.add('semantic_extraction')
    }

    // Track egress kinds
    if (event.type === 'packaging') {
      egressKinds.add('capsule_packaging')
      if (event.data?.externalEgress) {
        egressKinds.add('external_egress')
      }
    }

    // Track unverified steps
    if (event.type === 'depackaging' && event.data?.verified === false) {
      unverified.add(`depackaging:${event.capsuleId || event.id}`)
    }

    // Track consent for external API
    if (event.type === 'consent_required' && event.data?.scope === 'external_api') {
      observations.consentRequestedForExternalApi = true
    }
  }

  observations.observedEgressDomains = Array.from(egressDomains).sort()
  observations.observedIngressKinds = Array.from(ingressKinds).sort()
  observations.observedEgressKinds = Array.from(egressKinds).sort()
  observations.unverifiedSteps = Array.from(unverified).sort()

  return observations
}

/**
 * Alignment status for a claim
 */
export type AlignmentStatus = 'match' | 'mismatch' | 'unknown' | 'not-applicable'

/**
 * Alignment row for display
 */
export interface AlignmentRow {
  key: string // Unique key for the alignment check
  claimLabel: string // Human-readable claim description
  claimedValue: string // What was claimed
  observedValue: string // What was observed
  status: AlignmentStatus
  linkedRuleIds: string[] // Risk rule IDs that relate to this alignment
}

/**
 * Compute alignment between claims and observations (deterministic)
 */
export function computeAlignment(claims: ClaimSet, observations: ObservationSet): AlignmentRow[] {
  const rows: AlignmentRow[] = []

  // README: noExternalEgress
  rows.push({
    key: 'readme.noExternalEgress',
    claimLabel: 'No External Egress',
    claimedValue: claims.readmeClaims.noExternalEgress ? 'true' : 'false',
    observedValue: observations.observedExternalEgress ? 'DETECTED' : 'none',
    status: claims.readmeClaims.noExternalEgress && observations.observedExternalEgress 
      ? 'mismatch' 
      : (observations.observedExternalEgress ? 'unknown' : 'match'),
    linkedRuleIds: ['ALIGN-README-001', 'EGRESS-001']
  })

  // README: deterministicOnly
  rows.push({
    key: 'readme.deterministicOnly',
    claimLabel: 'Deterministic Only',
    claimedValue: claims.readmeClaims.deterministicOnly ? 'true' : 'false',
    observedValue: observations.observedAiInvolvement ? 'AI DETECTED' : 'none',
    status: claims.readmeClaims.deterministicOnly && observations.observedAiInvolvement
      ? 'mismatch'
      : 'match',
    linkedRuleIds: ['DETERM-001']
  })

  // README: requiresConsentForExternalApi
  rows.push({
    key: 'readme.requiresConsentForExternalApi',
    claimLabel: 'Consent for External API',
    claimedValue: claims.readmeClaims.requiresConsentForExternalApi ? 'required' : 'not required',
    observedValue: observations.consentRequestedForExternalApi ? 'requested' : 'not requested',
    status: observations.consentRequestedForExternalApi ? 'match' : 'unknown',
    linkedRuleIds: ['CONSENT-001', 'POLICY-001']
  })

  // Template: declared egress vs observed
  const declaredEgressSet = new Set(claims.templateClaims.declaredEgress)
  const undeclaredEgress = observations.observedEgressKinds.filter(k => !declaredEgressSet.has(k))
  rows.push({
    key: 'template.declaredEgress',
    claimLabel: 'Declared Egress Types',
    claimedValue: claims.templateClaims.declaredEgress.join(', ') || 'none',
    observedValue: observations.observedEgressKinds.join(', ') || 'none',
    status: undeclaredEgress.length > 0 ? 'mismatch' : 'match',
    linkedRuleIds: ['EGRESS-001']
  })

  // Integrity: unverified steps
  rows.push({
    key: 'integrity.unverifiedSteps',
    claimLabel: 'All Steps Verified',
    claimedValue: 'expected',
    observedValue: observations.unverifiedSteps.length > 0 
      ? `${observations.unverifiedSteps.length} unverified` 
      : 'all verified',
    status: observations.unverifiedSteps.length > 0 ? 'mismatch' : 'match',
    linkedRuleIds: ['INTEG-001']
  })

  // Template: allowed domains
  if (claims.templateClaims.allowedDomains && claims.templateClaims.allowedDomains.length > 0) {
    const allowedSet = new Set(claims.templateClaims.allowedDomains)
    const violatingDomains = observations.observedEgressDomains.filter(d => !allowedSet.has(d))
    rows.push({
      key: 'template.allowedDomains',
      claimLabel: 'Allowed Egress Domains',
      claimedValue: claims.templateClaims.allowedDomains.join(', '),
      observedValue: observations.observedEgressDomains.length > 0 
        ? observations.observedEgressDomains.join(', ')
        : 'none',
      status: violatingDomains.length > 0 ? 'mismatch' : 'match',
      linkedRuleIds: ['ALIGN-README-001']
    })
  }

  return rows
}

/**
 * Get risks by alignment row key
 */
export function getRisksForAlignmentRow(risks: RiskEvent[], linkedRuleIds: string[]): RiskEvent[] {
  const ruleIdSet = new Set(linkedRuleIds)
  return risks.filter(r => r.ruleId && ruleIdSet.has(r.ruleId))
}

// =============================================================================
// Mock Risk Rules (Deterministic)
// =============================================================================

interface MockRiskRule {
  ruleId: string
  title: string
  explanation: string
  severity: RiskSeverity
  category: RiskCategory
  condition: (event: LiveEvent, allEvents: LiveEvent[], readmeClaimsNoEgress: boolean) => boolean
}

/**
 * Mock risk rules - deterministic checks based on event data
 */
const MOCK_RISK_RULES: MockRiskRule[] = [
  {
    ruleId: 'EGRESS-001',
    title: 'External egress detected',
    explanation: 'This packaging/depackaging event has externalEgress=true, indicating data is leaving the controlled environment.',
    severity: 'high',
    category: 'egress',
    condition: (event) => {
      if (event.type !== 'packaging' && event.type !== 'depackaging') return false
      return event.data?.externalEgress === true
    }
  },
  {
    ruleId: 'ALIGN-README-001',
    title: 'README claims violated',
    explanation: 'Documentation states "no egress" but an external egress event was detected. This is a documentation alignment failure.',
    severity: 'critical',
    category: 'docs',
    condition: (event, _allEvents, readmeClaimsNoEgress) => {
      if (!readmeClaimsNoEgress) return false
      if (event.type !== 'packaging' && event.type !== 'depackaging') return false
      return event.data?.externalEgress === true
    }
  },
  {
    ruleId: 'DETERM-001',
    title: 'Non-deterministic component',
    explanation: 'An AI/LLM-related event was detected. AI outputs are inherently non-deterministic and may produce varying results.',
    severity: 'medium',
    category: 'determinism',
    condition: (event) => {
      if (event.type !== 'intent_detection') return false
      return event.data?.aiModel !== undefined || event.data?.detected_intent !== undefined
    }
  },
  {
    ruleId: 'CONSENT-001',
    title: 'Unresolved consent',
    explanation: 'A consent requirement is pending resolution. Execution may be blocked or unauthorized until resolved.',
    severity: 'critical',
    category: 'consent',
    condition: (event) => {
      return event.type === 'consent_required' && !event.resolved
    }
  },
  {
    ruleId: 'INTEG-001',
    title: 'Unverified capsule',
    explanation: 'A depackaging event processed a capsule with verified=false. Data integrity cannot be confirmed.',
    severity: 'high',
    category: 'integrity',
    condition: (event) => {
      if (event.type !== 'depackaging') return false
      return event.data?.verified === false
    }
  },
  {
    ruleId: 'POLICY-001',
    title: 'Policy scope exceeded',
    explanation: 'Event scope exceeds declared policy boundaries (external_api access detected).',
    severity: 'medium',
    category: 'policy',
    condition: (event) => {
      if (event.type !== 'consent_required') return false
      return event.data?.scope === 'external_api'
    }
  }
]

/**
 * Generate risk events from live events (deterministic, pure function)
 * 
 * @param events - All live events
 * @param readmeClaimsNoEgress - Mock flag for README alignment check
 * @returns Array of RiskEvents
 */
export function generateRiskEvents(
  events: LiveEvent[],
  readmeClaimsNoEgress: boolean = true // Mock: assume README claims no egress
): RiskEvent[] {
  const risks: RiskEvent[] = []
  let riskSeq = 0

  for (const event of events) {
    for (const rule of MOCK_RISK_RULES) {
      if (rule.condition(event, events, readmeClaimsNoEgress)) {
        riskSeq++
        risks.push({
          riskId: `risk_${event.id}_${rule.ruleId}`,
          timestamp: event.timestamp,
          seq: riskSeq,
          severity: rule.severity,
          category: rule.category,
          title: rule.title,
          explanation: rule.explanation,
          traceId: event.traceId,
          eventId: event.id,
          ruleId: rule.ruleId,
          isMock: true
        })
      }
    }
  }

  return risks.sort(compareRisks)
}

/**
 * Filter risks by trace (respects trace filter, global risks always visible)
 */
export function filterRisksByTrace(risks: RiskEvent[], traceFilter: TraceId | 'all'): RiskEvent[] {
  if (traceFilter === 'all') return risks
  return risks.filter(r => !r.traceId || r.traceId === traceFilter)
}

/**
 * Get risks linked to a specific event
 */
export function getRisksForEvent(risks: RiskEvent[], eventId: string): RiskEvent[] {
  return risks.filter(r => r.eventId === eventId)
}

/**
 * Get risks linked to a specific trace (including global risks)
 */
export function getRisksForTrace(risks: RiskEvent[], traceId: string): RiskEvent[] {
  return risks.filter(r => !r.traceId || r.traceId === traceId)
}

/**
 * Get highest severity from a list of risks
 */
export function getHighestSeverity(risks: RiskEvent[]): RiskSeverity | null {
  if (risks.length === 0) return null
  return risks.reduce((highest, r) => {
    return SEVERITY_PRIORITY[r.severity] > SEVERITY_PRIORITY[highest.severity] ? r : highest
  }).severity
}

/**
 * Get top N most severe risks
 */
export function getTopRisks(risks: RiskEvent[], count: number): RiskEvent[] {
  return [...risks].sort(compareRisks).slice(0, count)
}

/**
 * Available traces for filtering
 */
export type TraceId = 'trace_A' | 'trace_B'

/**
 * Filter state for events
 */
export interface EventFilter {
  traceId: TraceId | 'all'
  domains: Set<EventDomain>
}

/**
 * Create default filter (all traces, all domains)
 */
export function createDefaultFilter(): EventFilter {
  return {
    traceId: 'all',
    domains: new Set<EventDomain>([
      'semantics',
      'automation',
      'packaging',
      'depackaging',
      'intent',
      'consent',
      'verification'
    ])
  }
}

/**
 * Apply filter to events (pure function)
 */
export function filterEvents(events: LiveEvent[], filter: EventFilter): LiveEvent[] {
  return events.filter(event => {
    // Check trace filter
    if (filter.traceId !== 'all' && event.traceId !== filter.traceId) {
      return false
    }
    // Check domain filter
    if (!filter.domains.has(event.domain)) {
      return false
    }
    return true
  })
}

/**
 * Focus stickiness state
 */
export interface FocusStickinessState {
  currentPanelId: PanelId
  currentEventId: string | null
  eventsSinceFocusChange: number
  lockedUntilEventCount: number // Focus locked until this many events since change
}

/**
 * Focus state computed by the engine
 */
export interface FocusState {
  focusedPanelId: PanelId
  focusReason: string
  focusEventId: string | null
  isConsentOverride: boolean
  unresolvedConsentCount: number
  stickinessApplied: boolean // True if focus was kept due to stickiness
}

/**
 * Layout specification computed by the engine
 */
export interface LayoutSpec {
  timelineWidth: number // pixels
  timelineMode: 'sidebar' | 'strip' // sidebar = left column, strip = top row
  focusHeightRatio: number // 0.60 - 0.75
  secondaryMode: 'grid' | 'tabs' | 'minimized'
  secondaryPanels: PanelId[] // Order of secondary panels
}

/**
 * Viewport dimensions
 */
export interface ViewportSize {
  width: number
  height: number
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Event type to panel mapping
 */
export const EVENT_TO_PANEL: Record<LiveEventType, PanelId> = {
  semantic_extraction: 'semantic',
  automation_step: 'automation',
  packaging: 'packaging',
  depackaging: 'packaging',
  intent_detection: 'intent',
  consent_required: 'consent',
  poe_event: 'focus'
}

/**
 * Priority order for event types
 * Higher value = higher priority
 */
export const EVENT_PRIORITY: Record<LiveEventType, number> = {
  poe_event: 1,
  intent_detection: 2,
  semantic_extraction: 3,
  automation_step: 4,
  packaging: 5,
  depackaging: 5,
  consent_required: 10 // Highest priority
}

/**
 * All secondary panel IDs (excludes timeline and focus)
 */
const SECONDARY_PANELS: PanelId[] = ['semantic', 'automation', 'packaging', 'intent', 'consent']

/**
 * Layout breakpoints
 */
const BREAKPOINTS = {
  narrow: 900,
  medium: 1200
} as const

/**
 * Timeline width constraints
 */
const TIMELINE = {
  minWidth: 280,
  maxWidth: 360,
  stripHeight: 80 // When in strip mode
} as const

/**
 * Focus stickiness: minimum events before focus can change (unless overridden)
 */
const FOCUS_STICKINESS_THRESHOLD = 2

// =============================================================================
// Pure Sorting Functions
// =============================================================================

/**
 * Compare two events for stable, deterministic ordering
 * Sort by (timestamp ASC, seq ASC) - newer events have higher values
 * Returns negative if a < b, positive if a > b, 0 if equal
 */
export function compareEvents(a: LiveEvent, b: LiveEvent): number {
  // First compare by timestamp
  if (a.timestamp !== b.timestamp) {
    return a.timestamp - b.timestamp
  }
  // Same timestamp: use seq for deterministic tie-breaking
  return a.seq - b.seq
}

/**
 * Get the most recent event from a list (deterministic)
 */
function getMostRecentEvent(events: LiveEvent[]): LiveEvent | null {
  if (events.length === 0) return null
  return [...events].sort(compareEvents).pop() ?? null
}

/**
 * Get unresolved consent events
 */
function getUnresolvedConsents(events: LiveEvent[]): LiveEvent[] {
  return events.filter(e => e.type === 'consent_required' && !e.resolved)
}

// =============================================================================
// Focus Computation (Pure Functions)
// =============================================================================

/**
 * Compute the "natural" focus based on events (without stickiness)
 */
function computeNaturalFocus(events: LiveEvent[]): { panelId: PanelId; eventId: string | null; reason: string; isConsent: boolean; priority: number } {
  if (events.length === 0) {
    return {
      panelId: 'focus',
      eventId: null,
      reason: 'No events - awaiting activity',
      isConsent: false,
      priority: 0
    }
  }

  // Check for unresolved consents - focus ONLY the most recent one
  const unresolvedConsents = getUnresolvedConsents(events)
  
  if (unresolvedConsents.length > 0) {
    const mostRecentConsent = getMostRecentEvent(unresolvedConsents)!
    return {
      panelId: 'consent',
      eventId: mostRecentConsent.id,
      reason: `Consent required - ${unresolvedConsents.length} pending`,
      isConsent: true,
      priority: EVENT_PRIORITY.consent_required
    }
  }

  // No unresolved consents - focus on most recent event's panel
  const mostRecentEvent = getMostRecentEvent(events)!
  const targetPanel = EVENT_TO_PANEL[mostRecentEvent.type]

  return {
    panelId: targetPanel,
    eventId: mostRecentEvent.id,
    reason: `Latest event: ${mostRecentEvent.type}`,
    isConsent: false,
    priority: EVENT_PRIORITY[mostRecentEvent.type]
  }
}

/**
 * Apply focus stickiness rules
 * 
 * RULES:
 * 1. Consent override ALWAYS wins (no stickiness)
 * 2. If current focus is from consent and consent is still unresolved, keep it
 * 3. If < STICKINESS_THRESHOLD events since last focus change, keep current unless:
 *    a) New event has higher priority
 *    b) Consent override activates
 * 4. After threshold, switch to natural focus
 */
function applyStickiness(
  naturalFocus: { panelId: PanelId; eventId: string | null; reason: string; isConsent: boolean; priority: number },
  stickiness: FocusStickinessState,
  events: LiveEvent[]
): { focus: FocusState; newStickiness: FocusStickinessState } {
  const unresolvedConsents = getUnresolvedConsents(events)
  const unresolvedConsentCount = unresolvedConsents.length

  // Case 1: Consent override - always wins, resets stickiness
  if (naturalFocus.isConsent) {
    return {
      focus: {
        focusedPanelId: naturalFocus.panelId,
        focusReason: naturalFocus.reason,
        focusEventId: naturalFocus.eventId,
        isConsentOverride: true,
        unresolvedConsentCount,
        stickinessApplied: false
      },
      newStickiness: {
        currentPanelId: naturalFocus.panelId,
        currentEventId: naturalFocus.eventId,
        eventsSinceFocusChange: 0,
        lockedUntilEventCount: FOCUS_STICKINESS_THRESHOLD
      }
    }
  }

  // Case 2: Check if we should apply stickiness
  const withinStickyWindow = stickiness.eventsSinceFocusChange < stickiness.lockedUntilEventCount
  const currentEvent = events.find(e => e.id === stickiness.currentEventId)
  const currentPriority = currentEvent ? EVENT_PRIORITY[currentEvent.type] : 0
  const newPriorityHigher = naturalFocus.priority > currentPriority

  // Stay sticky if within window and new event is not higher priority
  if (withinStickyWindow && !newPriorityHigher && stickiness.currentPanelId !== 'focus') {
    return {
      focus: {
        focusedPanelId: stickiness.currentPanelId,
        focusReason: `Sticky focus (${stickiness.eventsSinceFocusChange + 1}/${stickiness.lockedUntilEventCount} events)`,
        focusEventId: stickiness.currentEventId,
        isConsentOverride: false,
        unresolvedConsentCount,
        stickinessApplied: true
      },
      newStickiness: {
        ...stickiness,
        eventsSinceFocusChange: stickiness.eventsSinceFocusChange + 1
      }
    }
  }

  // Case 3: Switch to natural focus
  const panelChanged = naturalFocus.panelId !== stickiness.currentPanelId
  
  return {
    focus: {
      focusedPanelId: naturalFocus.panelId,
      focusReason: naturalFocus.reason,
      focusEventId: naturalFocus.eventId,
      isConsentOverride: false,
      unresolvedConsentCount,
      stickinessApplied: false
    },
    newStickiness: panelChanged ? {
      currentPanelId: naturalFocus.panelId,
      currentEventId: naturalFocus.eventId,
      eventsSinceFocusChange: 0,
      lockedUntilEventCount: FOCUS_STICKINESS_THRESHOLD
    } : {
      ...stickiness,
      eventsSinceFocusChange: stickiness.eventsSinceFocusChange + 1
    }
  }
}

/**
 * Compute the focus state based on events (without stickiness)
 * Use computeFocusStateWithStickiness for full determinism
 */
export function computeFocusState(events: LiveEvent[]): FocusState {
  const naturalFocus = computeNaturalFocus(events)
  const unresolvedConsentCount = getUnresolvedConsents(events).length

  return {
    focusedPanelId: naturalFocus.panelId,
    focusReason: naturalFocus.reason,
    focusEventId: naturalFocus.eventId,
    isConsentOverride: naturalFocus.isConsent,
    unresolvedConsentCount,
    stickinessApplied: false
  }
}

/**
 * Compute focus state with stickiness
 */
export function computeFocusStateWithStickiness(
  events: LiveEvent[],
  stickiness: FocusStickinessState
): { focus: FocusState; newStickiness: FocusStickinessState } {
  const naturalFocus = computeNaturalFocus(events)
  return applyStickiness(naturalFocus, stickiness, events)
}

/**
 * Create initial stickiness state
 */
export function createInitialStickinessState(): FocusStickinessState {
  return {
    currentPanelId: 'focus',
    currentEventId: null,
    eventsSinceFocusChange: 0,
    lockedUntilEventCount: FOCUS_STICKINESS_THRESHOLD
  }
}

// =============================================================================
// Layout Computation
// =============================================================================

/**
 * Compute layout specification based on focus state and viewport
 */
export function computeLayoutSpec(
  focusState: FocusState,
  viewport: ViewportSize
): LayoutSpec {
  const isNarrow = viewport.width < BREAKPOINTS.narrow
  const isMedium = viewport.width < BREAKPOINTS.medium

  // Timeline width: responsive clamp
  let timelineWidth: number
  let timelineMode: 'sidebar' | 'strip'

  if (isNarrow) {
    timelineWidth = viewport.width // Full width when strip
    timelineMode = 'strip'
  } else {
    const availableWidth = viewport.width * 0.25
    timelineWidth = Math.max(TIMELINE.minWidth, Math.min(TIMELINE.maxWidth, availableWidth))
    timelineMode = 'sidebar'
  }

  // Focus height ratio based on consent override
  const focusHeightRatio = focusState.isConsentOverride ? 0.75 : 0.60

  // Secondary panel mode
  let secondaryMode: 'grid' | 'tabs' | 'minimized'
  if (focusState.isConsentOverride) {
    secondaryMode = 'minimized'
  } else if (isNarrow || isMedium) {
    secondaryMode = 'tabs'
  } else {
    secondaryMode = 'grid'
  }

  // Order secondary panels (focused panel goes first if it's a secondary)
  const secondaryPanels = getSecondaryPanelOrder(focusState.focusedPanelId)

  return {
    timelineWidth,
    timelineMode,
    focusHeightRatio,
    secondaryMode,
    secondaryPanels
  }
}

/**
 * Get secondary panels in order, with focused panel first
 */
function getSecondaryPanelOrder(focusedPanel: PanelId): PanelId[] {
  if (focusedPanel === 'timeline' || focusedPanel === 'focus') {
    return SECONDARY_PANELS
  }
  
  const order = SECONDARY_PANELS.filter(p => p !== focusedPanel)
  if (SECONDARY_PANELS.includes(focusedPanel)) {
    order.unshift(focusedPanel)
  }
  return order
}

// =============================================================================
// CSS Variable Generator
// =============================================================================

/**
 * Generate CSS custom properties for layout
 * All properties are scoped to .live-execution-canvas
 */
export function generateLayoutCSSVars(spec: LayoutSpec): Record<string, string> {
  return {
    '--lea-timeline-width': spec.timelineMode === 'strip' ? '100%' : `${spec.timelineWidth}px`,
    '--lea-timeline-height': spec.timelineMode === 'strip' ? `${TIMELINE.stripHeight}px` : '100%',
    '--lea-focus-height': `${spec.focusHeightRatio * 100}%`,
    '--lea-secondary-height': `${(1 - spec.focusHeightRatio) * 100}%`,
    '--lea-layout-transition': '220ms ease-out'
  }
}

// =============================================================================
// Event Creation with Monotonic Sequence
// =============================================================================

let globalSeqCounter = 0

/**
 * Get next monotonic sequence number
 * Guaranteed to be unique and increasing
 */
export function getNextSeq(): number {
  globalSeqCounter++
  return globalSeqCounter
}

/**
 * Reset sequence counter (for testing only)
 */
export function resetSeqCounter(): void {
  globalSeqCounter = 0
}

/**
 * Generate a unique event ID
 */
let eventIdCounter = 0

function generateEventId(): string {
  eventIdCounter++
  return `live_evt_${eventIdCounter}`
}

/**
 * Create a live event with monotonic sequence and correlation
 */
export function createLiveEvent(
  type: LiveEventType,
  timestamp: number,
  traceId: string,
  domain: EventDomain,
  data?: Record<string, unknown>,
  resolved?: boolean,
  capsuleId?: string
): LiveEvent {
  return {
    id: generateEventId(),
    type,
    timestamp,
    seq: getNextSeq(),
    resolved,
    data,
    traceId,
    domain,
    capsuleId
  }
}

/**
 * Reset event ID counter (for testing)
 */
export function resetEventIdCounter(): void {
  eventIdCounter = 0
}

// =============================================================================
// Demo Event Sequence with Traces
// =============================================================================

/**
 * Demo event spec with trace correlation
 */
interface DemoEventSpec {
  type: LiveEventType
  offset: number
  traceId: TraceId
  capsuleId?: string
  resolved?: boolean
  data?: Record<string, unknown>
}

/**
 * Demo event sequence for testing with two deterministic traces:
 * 
 * Trace A: packaging -> semantic_extraction -> automation_step -> intent_detection -> poe_event
 * Trace B: depackaging -> consent_required -> automation_step -> packaging
 * 
 * Events are interleaved by timestamp offset.
 * Includes data that triggers risk rules for demo purposes.
 */
export const DEMO_EVENT_SEQUENCE: DemoEventSpec[] = [
  // Trace A - Event 1: packaging (with externalEgress -> triggers EGRESS-001 + ALIGN-README-001)
  { 
    type: 'packaging', 
    offset: 0,
    traceId: 'trace_A',
    capsuleId: 'cap_traceA_001',
    data: { capsule_id: 'cap_traceA_001', artefacts: 3, hash_prefix: '7f3a...', externalEgress: true }
  },
  // Trace B - Event 1: depackaging (verified: false -> triggers INTEG-001)
  { 
    type: 'depackaging', 
    offset: 500,
    traceId: 'trace_B',
    capsuleId: 'cap_traceB_input',
    data: { capsule_id: 'cap_traceB_input', artefacts: 2, verified: false }
  },
  // Trace A - Event 2: semantic_extraction
  { 
    type: 'semantic_extraction', 
    offset: 1000,
    traceId: 'trace_A',
    capsuleId: 'cap_traceA_001',
    data: { field: 'user_email', value: '[REDACTED]', source: 'form_input' }
  },
  // Trace B - Event 2: consent_required (unresolved -> triggers CONSENT-001, scope: external_api -> triggers POLICY-001)
  { 
    type: 'consent_required', 
    offset: 1500,
    traceId: 'trace_B',
    capsuleId: 'cap_traceB_input',
    resolved: false,
    data: { consent_type: 'data_processing', scope: 'external_api', required_by: 'policy_v2.3' }
  },
  // Trace A - Event 3: automation_step
  { 
    type: 'automation_step', 
    offset: 2000,
    traceId: 'trace_A',
    capsuleId: 'cap_traceA_001',
    data: { step: 'validate_input', status: 'completed', duration_ms: 45 }
  },
  // Trace B - Event 3: automation_step
  { 
    type: 'automation_step', 
    offset: 2500,
    traceId: 'trace_B',
    capsuleId: 'cap_traceB_input',
    data: { step: 'process_consent', status: 'waiting', duration_ms: 0 }
  },
  // Trace A - Event 4: intent_detection (AI event -> triggers DETERM-001)
  {
    type: 'intent_detection',
    offset: 3000,
    traceId: 'trace_A',
    capsuleId: 'cap_traceA_001',
    data: { detected_intent: 'data_export', confidence: 0.87, requires_review: true, aiModel: 'classifier-v2' }
  },
  // Trace B - Event 4: packaging (output, no egress)
  { 
    type: 'packaging', 
    offset: 3500,
    traceId: 'trace_B',
    capsuleId: 'cap_traceB_output',
    data: { capsule_id: 'cap_traceB_output', artefacts: 1, hash_prefix: '9e2b...', externalEgress: false }
  },
  // Trace A - Event 5: poe_event
  { 
    type: 'poe_event', 
    offset: 4000,
    traceId: 'trace_A',
    capsuleId: 'cap_traceA_001',
    data: { checkpoint: 'demo_checkpoint', note: 'PoAE NOT IMPLEMENTED - demo only' }
  },
  // Trace B - Bonus: consent resolved
  { 
    type: 'consent_required', 
    offset: 4500, 
    traceId: 'trace_B',
    capsuleId: 'cap_traceB_input',
    resolved: true,
    data: { consent_type: 'data_processing', resolved_by: 'user_approval' }
  }
]

/**
 * Create demo events with a base timestamp
 */
export function createDemoEvents(baseTimestamp: number, count: number): LiveEvent[] {
  const events: LiveEvent[] = []
  const limitedSequence = DEMO_EVENT_SEQUENCE.slice(0, count)
  
  for (const spec of limitedSequence) {
    const domain = EVENT_TYPE_TO_DOMAIN[spec.type]
    events.push(createLiveEvent(
      spec.type,
      baseTimestamp + spec.offset,
      spec.traceId,
      domain,
      spec.data,
      spec.resolved,
      spec.capsuleId
    ))
  }
  
  return events
}

/**
 * Get all available trace IDs
 */
export const AVAILABLE_TRACES: TraceId[] = ['trace_A', 'trace_B']

/**
 * Get all available domains
 */
export const ALL_DOMAINS: EventDomain[] = [
  'semantics',
  'automation',
  'packaging',
  'depackaging',
  'intent',
  'consent',
  'verification'
]
