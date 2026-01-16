import { useState, useCallback, useMemo, useLayoutEffect, useRef, useEffect } from 'react'
import './LiveExecutionAnalysis.css'
import { VerificationFlags, DEFAULT_VERIFICATION_FLAGS, canClaimVerified, type DrawerTabId, ExecutionStatusHero } from './analysis'
import {
  LiveEvent,
  LiveEventType,
  PanelId,
  FocusState,
  LayoutSpec,
  FocusStickinessState,
  EventFilter,
  EventDomain,
  TraceId,
  RiskEvent,
  AlignmentRow,
  AlignmentStatus,
  computeFocusStateWithStickiness,
  computeLayoutSpec,
  generateLayoutCSSVars,
  createLiveEvent,
  createInitialStickinessState,
  createDefaultFilter,
  filterEvents,
  generateRiskEvents,
  filterRisksByTrace,
  getTopRisks,
  computeObservations,
  computeAlignment,
  getRisksForAlignmentRow,
  DEFAULT_CLAIMS,
  SEVERITY_PRIORITY,
  DEMO_EVENT_SEQUENCE,
  AVAILABLE_TRACES,
  ALL_DOMAINS,
  EVENT_TYPE_TO_DOMAIN,
  compareEvents
} from './analysis/focusLayoutEngine'
import EvidenceDrawer from './analysis/EvidenceDrawer'

/**
 * Deep-link state for external navigation
 */
interface LiveDeepLink {
  traceId?: string
  eventId?: string
  drawerTab?: DrawerTabId
  ruleId?: string
}

interface LiveExecutionAnalysisProps {
  flags?: VerificationFlags
  /** Deep-link state from IPC */
  deepLink?: LiveDeepLink
  /** Callback when deep-link has been consumed */
  onDeepLinkConsumed?: () => void
  /** Compact mode for unified dashboard column view */
  compact?: boolean
}

// =============================================================================
// Panel Header Component
// =============================================================================

// =============================================================================
// Mock Active Processes (What's happening NOW)
// =============================================================================

interface ActiveProcess {
  id: string
  type: 'optimization' | 'unpackaging' | 'automation' | 'packaging' | 'ai-processing' | 'validation'
  title: string
  description: string
  startedAt: string
  progress: number  // 0-100
  status: 'running' | 'paused' | 'waiting'
  templateName: string
}

const mockActiveProcesses: ActiveProcess[] = [
  {
    id: 'proc_001',
    type: 'automation',
    title: 'Invoice Processing Automation',
    description: 'Executing automation steps 4/7 - OCR Processing in progress',
    startedAt: '2026-01-06T10:14:22.341Z',
    progress: 57,
    status: 'running',
    templateName: 'Invoice Processing Workflow v2.1.0'
  },
  {
    id: 'proc_002',
    type: 'unpackaging',
    title: 'BEAP™ Package Unpackaging',
    description: 'Extracting artefacts from incoming capsule cap_new_8a7b6c',
    startedAt: '2026-01-06T10:14:20.000Z',
    progress: 85,
    status: 'running',
    templateName: 'Document Classification v1.3.0'
  },
  {
    id: 'proc_003',
    type: 'optimization',
    title: 'Performance Optimization',
    description: 'Analyzing execution patterns for OCR step optimization',
    startedAt: '2026-01-06T10:12:00.000Z',
    progress: 42,
    status: 'running',
    templateName: 'System Optimization'
  },
  {
    id: 'proc_004',
    type: 'ai-processing',
    title: 'AI Model Inference',
    description: 'Running classification model on extracted documents',
    startedAt: '2026-01-06T10:14:24.613Z',
    progress: 23,
    status: 'waiting',
    templateName: 'Invoice Processing Workflow v2.1.0'
  },
  {
    id: 'proc_005',
    type: 'packaging',
    title: 'BEAP™ Package Creation',
    description: 'Preparing output capsule with processed artefacts',
    startedAt: '2026-01-06T10:14:28.000Z',
    progress: 0,
    status: 'waiting',
    templateName: 'Invoice Processing Workflow v2.1.0'
  }
]

// =============================================================================
// Active Processes Hero Section (What's happening NOW)
// =============================================================================

interface ActiveProcessesHeroProps {
  showAll: boolean
  onToggleShowAll: () => void
  onAnalyse: (processId: string) => void
}

function ActiveProcessesHero({ showAll, onToggleShowAll, onAnalyse }: ActiveProcessesHeroProps) {
  const runningProcesses = mockActiveProcesses.filter(p => p.status === 'running')
  const primaryProcess = runningProcesses[0] || mockActiveProcesses[0]
  const activeCount = runningProcesses.length
  
  const getProcessIcon = (type: ActiveProcess['type']) => {
    switch (type) {
      case 'optimization': return '⚡'
      case 'unpackaging': return '📂'
      case 'automation': return '⚙️'
      case 'packaging': return '📦'
      case 'ai-processing': return '🤖'
      case 'validation': return '✓'
      default: return '📊'
    }
  }
  
  const getProcessTypeLabel = (type: ActiveProcess['type']) => {
    switch (type) {
      case 'optimization': return 'Optimization'
      case 'unpackaging': return 'BEAP™ Unpackaging'
      case 'automation': return 'Automation'
      case 'packaging': return 'BEAP™ Packaging'
      case 'ai-processing': return 'AI Processing'
      case 'validation': return 'Validation'
      default: return 'Process'
    }
  }
  
  return (
    <div className={`live-hero ${activeCount > 0 ? 'live-hero--active' : ''}`}>
      <div className="live-hero__header">
        <div className="live-hero__icon live-hero__icon--pulsing">{getProcessIcon(primaryProcess.type)}</div>
        <div className="live-hero__title-group">
          <h2 className="live-hero__title">Active Processes</h2>
          <p className="live-hero__subtitle">
            {activeCount > 0 
              ? `${activeCount} process${activeCount > 1 ? 'es' : ''} running now`
              : 'No active processes'
            }
          </p>
        </div>
        <div className="live-hero__status">
          <span className={`live-hero__status-badge live-hero__status-badge--${primaryProcess.status}`}>
            {primaryProcess.status === 'running' ? '● Running' : primaryProcess.status === 'paused' ? '❚❚ Paused' : '○ Waiting'}
          </span>
        </div>
      </div>

      {/* Status Box + Execution Info (similar to Pre-Execution Match box) */}
      <div className="live-hero__status-row">
        <div className="live-hero__status-box">
          <div className="live-hero__status-icon">⚡</div>
          <div className="live-hero__status-content">
            <span className="live-hero__status-title">Active</span>
            <span className="live-hero__status-desc">{activeCount} processes running</span>
          </div>
        </div>
        <div className="live-hero__queue-info">
          <div className="live-hero__queue-item">
            <span className="live-hero__queue-label">Queue</span>
            <span className="live-hero__queue-value">{mockActiveProcesses.filter(p => p.status === 'waiting').length} waiting</span>
          </div>
          <div className="live-hero__queue-item">
            <span className="live-hero__queue-label">Paused</span>
            <span className="live-hero__queue-value">{mockActiveProcesses.filter(p => p.status === 'paused').length}</span>
          </div>
        </div>
      </div>

      {/* Primary Active Process */}
      <div className="live-hero__latest">
        <div className="live-hero__process-type">
          {getProcessTypeLabel(primaryProcess.type)}
        </div>
        <h3 className="live-hero__event-title">{primaryProcess.title}</h3>
        <p className="live-hero__event-desc">{primaryProcess.description}</p>
        
        {/* Progress Bar */}
        <div className="live-hero__progress">
          <div className="live-hero__progress-bar">
            <div 
              className={`live-hero__progress-fill live-hero__progress-fill--${primaryProcess.status}`}
              style={{ width: `${primaryProcess.progress}%` }}
            />
          </div>
          <span className="live-hero__progress-text">{primaryProcess.progress}%</span>
        </div>
        
        <div className="live-hero__event-meta">
          <span className="live-hero__event-template">{primaryProcess.templateName}</span>
          <span className="live-hero__event-time">
            Started: {new Date(primaryProcess.startedAt).toLocaleTimeString()}
          </span>
        </div>
        
        {/* Execution Steps Indicator */}
        <div className="live-hero__steps">
          <div className="live-hero__step live-hero__step--completed">
            <span className="live-hero__step-dot">✓</span>
            <span className="live-hero__step-label">Init</span>
          </div>
          <div className="live-hero__step-connector live-hero__step-connector--completed" />
          <div className={`live-hero__step ${primaryProcess.progress > 0 ? 'live-hero__step--active' : ''}`}>
            <span className="live-hero__step-dot">●</span>
            <span className="live-hero__step-label">Process</span>
          </div>
          <div className="live-hero__step-connector" />
          <div className="live-hero__step">
            <span className="live-hero__step-dot">○</span>
            <span className="live-hero__step-label">Validate</span>
          </div>
          <div className="live-hero__step-connector" />
          <div className="live-hero__step">
            <span className="live-hero__step-dot">○</span>
            <span className="live-hero__step-label">Complete</span>
          </div>
        </div>
      </div>

      {/* Primary Action Buttons */}
      <div className="live-hero__actions">
        <button className="live-hero__btn live-hero__btn--analyse" onClick={() => onAnalyse(primaryProcess.id)}>
          <span className="live-hero__btn-icon">🔍</span>
          Analyse Process
        </button>
        <button className="live-hero__btn live-hero__btn--secondary" onClick={onToggleShowAll}>
          {showAll ? '▲ Hide All' : `▼ Show All (${mockActiveProcesses.length})`}
        </button>
      </div>

      {/* All Active Processes */}
      {showAll && (
        <div className="live-hero__history">
          <div className="live-hero__history-title">All Active Processes</div>
          <div className="live-hero__history-list">
            {mockActiveProcesses.map((process) => (
              <div key={process.id} className={`live-hero__history-item live-hero__history-item--${process.status}`}>
                <div className="live-hero__history-item-main">
                  <span className="live-hero__history-icon">{getProcessIcon(process.type)}</span>
                  <div className="live-hero__history-info">
                    <span className="live-hero__history-title-text">{process.title}</span>
                    <span className="live-hero__history-template">{process.templateName}</span>
                  </div>
                  <div className="live-hero__history-progress">
                    <div className="live-hero__history-progress-bar">
                      <div 
                        className={`live-hero__history-progress-fill live-hero__history-progress-fill--${process.status}`}
                        style={{ width: `${process.progress}%` }}
                      />
                    </div>
                    <span className="live-hero__history-progress-text">{process.progress}%</span>
                  </div>
                  <span className={`live-hero__history-status live-hero__history-status--${process.status}`}>
                    {process.status === 'running' ? '●' : process.status === 'paused' ? '❚❚' : '○'}
                  </span>
                </div>
                <div className="live-hero__history-item-actions">
                  <button className="live-hero__history-analyse" onClick={() => onAnalyse(process.id)}>
                    Analyse
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// =============================================================================
// Panel Header Component
// =============================================================================

interface PanelHeaderProps {
  title: string
  isExpanded?: boolean
  badge?: string
  status?: 'active' | 'consent'
}

function PanelHeader({ title, isExpanded, badge, status = 'active' }: PanelHeaderProps) {
  return (
    <div className={`lea-panel-header ${isExpanded ? 'lea-panel-header--expanded' : ''}`}>
      <span className="lea-panel-title">{title}</span>
      {status === 'consent' && (
        <span className="lea-panel-badge lea-panel-badge--consent">Action Required</span>
      )}
      {badge && <span className="lea-panel-badge lea-panel-badge--info">{badge}</span>}
    </div>
  )
}

// =============================================================================
// Event Icon Helper
// =============================================================================

function getEventIcon(type: LiveEventType): string {
  switch (type) {
    case 'semantic_extraction': return '📄'
    case 'automation_step': return '⚙'
    case 'packaging': return '📦'
    case 'depackaging': return '📂'
    case 'intent_detection': return '🎯'
    case 'consent_required': return '✋'
    case 'poe_event': return '🔐'
    default: return '•'
  }
}

function getEventLabel(type: LiveEventType): string {
  switch (type) {
    case 'semantic_extraction': return 'Semantic Extraction'
    case 'automation_step': return 'Automation Step'
    case 'packaging': return 'Packaging'
    case 'depackaging': return 'Depackaging'
    case 'intent_detection': return 'Intent Detection'
    case 'consent_required': return 'Consent Required'
    case 'poe_event': return 'PoAE Event [MOCK]'
    default: return type
  }
}

// =============================================================================
// Timeline Panel
// =============================================================================

interface TimelinePanelProps {
  events: LiveEvent[]
  focusEventId: string | null
  selectedEventId: string | null
  mode: 'sidebar' | 'strip'
  onSelectEvent: (eventId: string) => void
  risksByEventId: Map<string, RiskEvent[]>
  onSelectEventRisks: (eventId: string) => void
}

function TimelinePanel({ 
  events, 
  focusEventId, 
  selectedEventId, 
  mode, 
  onSelectEvent,
  risksByEventId,
  onSelectEventRisks
}: TimelinePanelProps) {
  return (
    <div className={`lea-timeline-panel lea-timeline-panel--${mode}`}>
      <PanelHeader title="Execution Timeline" badge={`${events.length} events`} />
      <div className="lea-timeline-content">
        <div className="lea-timeline-list">
          {events.slice().reverse().map((event, index) => {
            const eventRisks = risksByEventId.get(event.id) || []
            const highestSeverity = eventRisks.length > 0 
              ? eventRisks.reduce((max, r) => SEVERITY_PRIORITY[r.severity] > SEVERITY_PRIORITY[max.severity] ? r : max).severity
              : null
            
            return (
              <button
                type="button"
                key={event.id} 
                className={`lea-timeline-event lea-timeline-event--${event.type.replace('_', '-')} ${event.id === focusEventId ? 'lea-timeline-event--focused' : ''} ${event.id === selectedEventId ? 'lea-timeline-event--selected' : ''} ${index === 0 ? 'lea-timeline-event--latest' : ''}`}
                onClick={() => onSelectEvent(event.id)}
                aria-pressed={event.id === selectedEventId}
              >
                <div className="lea-timeline-event__icon">{getEventIcon(event.type)}</div>
                <div className="lea-timeline-event__content">
                  <div className="lea-timeline-event__title">{getEventLabel(event.type)}</div>
                  <div className="lea-timeline-event__meta">
                    <span className="lea-timeline-event__time">
                      {new Date(event.timestamp).toLocaleTimeString()}
                    </span>
                    <span className="lea-timeline-event__seq">seq:{event.seq}</span>
                  </div>
                </div>
                
                {/* Risk Badge - inline indicator */}
                {eventRisks.length > 0 && highestSeverity && (
                  <button
                    type="button"
                    className={`lea-timeline-risk-badge lea-timeline-risk-badge--${highestSeverity}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelectEventRisks(event.id)
                    }}
                    title={`${eventRisks.length} risk${eventRisks.length !== 1 ? 's' : ''} - click to view`}
                  >
                    {eventRisks.length}
                  </button>
                )}
                
                {event.id === selectedEventId && <div className="lea-timeline-event__badge lea-timeline-event__badge--selected">Selected</div>}
                {event.id === focusEventId && event.id !== selectedEventId && <div className="lea-timeline-event__badge">Focus</div>}
                {event.type === 'consent_required' && !event.resolved && (
                  <div className="lea-timeline-event__badge lea-timeline-event__badge--consent">Pending</div>
                )}
              </button>
            )
          })}
          {events.length === 0 && (
            <div className="lea-timeline-empty">Waiting for events...</div>
          )}
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// Focus Panel (Primary Display)
// =============================================================================

interface FocusPanelProps {
  focusState: FocusState
  events: LiveEvent[]
  onResolveConsent?: () => void
}

function FocusPanel({ focusState, events, onResolveConsent }: FocusPanelProps) {
  const focusedEvent = events.find(e => e.id === focusState.focusEventId)
  
  const renderFocusContent = () => {
    if (!focusedEvent && focusState.focusedPanelId !== 'consent') {
      return (
        <div className="lea-focus-empty">
          <div className="lea-focus-empty__icon">⏳</div>
          <div className="lea-focus-empty__text">{focusState.focusReason}</div>
        </div>
      )
    }

    // Consent Override View
    if (focusState.isConsentOverride) {
      return (
        <div className="lea-focus-consent">
          <div className="lea-focus-consent__header">
            <span className="lea-focus-consent__icon">✋</span>
            <span className="lea-focus-consent__title">Human Consent Required</span>
          </div>
          <div className="lea-focus-consent__count">
            {focusState.unresolvedConsentCount} pending consent request(s)
          </div>
          {focusedEvent && (
            <div className="lea-focus-consent__details">
              <div className="lea-focus-detail-row">
                <span className="lea-focus-detail-label">Event ID:</span>
                <code className="lea-focus-detail-value">{focusedEvent.id}</code>
              </div>
              <div className="lea-focus-detail-row">
                <span className="lea-focus-detail-label">Seq:</span>
                <code className="lea-focus-detail-value">{focusedEvent.seq}</code>
              </div>
              <div className="lea-focus-detail-row">
                <span className="lea-focus-detail-label">Type:</span>
                <span className="lea-focus-detail-value">{String(focusedEvent.data?.consent_type || 'Unknown')}</span>
              </div>
              <div className="lea-focus-detail-row">
                <span className="lea-focus-detail-label">Scope:</span>
                <span className="lea-focus-detail-value">{String(focusedEvent.data?.scope || 'N/A')}</span>
              </div>
              <div className="lea-focus-detail-row">
                <span className="lea-focus-detail-label">Required By:</span>
                <span className="lea-focus-detail-value">{String(focusedEvent.data?.required_by || 'Policy')}</span>
              </div>
            </div>
          )}
          <div className="lea-focus-consent__notice">
            <span className="lea-focus-consent__notice-icon">ℹ</span>
            This is a simulation. In production, consent would block execution until resolved.
          </div>
          {onResolveConsent && (
            <button className="lea-focus-consent__resolve" onClick={onResolveConsent}>
              Simulate Consent Resolution
            </button>
          )}
        </div>
      )
    }

    // PoAE Demo View
    if (focusState.focusedPanelId === 'focus' && focusedEvent?.type === 'poe_event') {
      return (
        <div className="lea-focus-poae">
          <div className="lea-focus-poae__header">
            <span className="lea-focus-poae__icon">🔐</span>
            <span className="lea-focus-poae__title">PoAE™ Verification</span>
            <span className="lea-focus-poae__badge lea-focus-poae__badge--verified">VERIFIED</span>
          </div>
          <div className="lea-focus-poae__notice lea-focus-poae__notice--success">
            <strong>✓ Proof of Authenticated Execution™</strong>
            <br />
            Cryptographic attestation chain complete.
            <br />
            All execution events verified and recorded.
          </div>
          {focusedEvent.data && (
            <div className="lea-focus-poae__data">
              <div className="lea-focus-detail-row">
                <span className="lea-focus-detail-label">Checkpoint:</span>
                <span className="lea-focus-detail-value">{String(focusedEvent.data.checkpoint)}</span>
              </div>
              <div className="lea-focus-detail-row">
                <span className="lea-focus-detail-label">Note:</span>
                <span className="lea-focus-detail-value">{String(focusedEvent.data.note)}</span>
              </div>
            </div>
          )}
        </div>
      )
    }

    // Standard Event View
    if (focusedEvent) {
      return (
        <div className="lea-focus-event">
          <div className="lea-focus-event__header">
            <span className="lea-focus-event__icon">{getEventIcon(focusedEvent.type)}</span>
            <span className="lea-focus-event__title">{getEventLabel(focusedEvent.type)}</span>
            {focusState.stickinessApplied && (
              <span className="lea-focus-event__sticky-badge">Sticky</span>
            )}
          </div>
          <div className="lea-focus-event__meta">
            <span>{new Date(focusedEvent.timestamp).toLocaleString()}</span>
            <span>seq:{focusedEvent.seq}</span>
          </div>
          {focusedEvent.data && (
            <div className="lea-focus-event__details">
              {Object.entries(focusedEvent.data).map(([key, value]) => (
                <div key={key} className="lea-focus-detail-row">
                  <span className="lea-focus-detail-label">{key}:</span>
                  <code className="lea-focus-detail-value">{String(value)}</code>
                </div>
              ))}
            </div>
          )}
        </div>
      )
    }

    return null
  }

  return (
    <div className={`lea-focus-panel lea-focus-panel--${focusState.focusedPanelId}`}>
      <div className="lea-focus-panel__header">
        <span className="lea-focus-panel__title">Focus: {focusState.focusReason}</span>
        {focusState.stickinessApplied && (
          <span className="lea-panel-badge lea-panel-badge--sticky">Sticky</span>
        )}
      </div>
      <div className="lea-focus-panel__content">
        {renderFocusContent()}
      </div>
    </div>
  )
}

// =============================================================================
// Secondary Panels
// =============================================================================

interface SecondaryPanelProps {
  panelId: PanelId
  events: LiveEvent[]
  isMinimized: boolean
  isFocused: boolean
  isSelectedTab: boolean
  onSelectTab: () => void
}

function SecondaryPanel({ panelId, events, isMinimized, isFocused, isSelectedTab, onSelectTab }: SecondaryPanelProps) {
  const getPanelTitle = (): string => {
    switch (panelId) {
      case 'semantic': return 'Semantic Extraction'
      case 'automation': return 'Automation Steps'
      case 'packaging': return 'Packaging / Depackaging'
      case 'intent': return 'Intent Detection'
      case 'consent': return 'Consent History'
      default: return panelId
    }
  }

  const getRelevantEvents = (): LiveEvent[] => {
    switch (panelId) {
      case 'semantic':
        return events.filter(e => e.type === 'semantic_extraction').slice(-3)
      case 'automation':
        return events.filter(e => e.type === 'automation_step').slice(-3)
      case 'packaging':
        return events.filter(e => e.type === 'packaging' || e.type === 'depackaging').slice(-4)
      case 'intent':
        return events.filter(e => e.type === 'intent_detection').slice(-3)
      case 'consent':
        return events.filter(e => e.type === 'consent_required').slice(-3)
      default:
        return []
    }
  }

  const relevantEvents = getRelevantEvents()
  const iconType: LiveEventType = panelId === 'semantic' ? 'semantic_extraction' 
    : panelId === 'automation' ? 'automation_step' 
    : panelId === 'packaging' ? 'packaging' 
    : panelId === 'intent' ? 'intent_detection' 
    : 'consent_required'

  // Minimized mode: render as clickable tab
  if (isMinimized) {
    return (
      <button 
        className={`lea-secondary-tab ${isFocused ? 'lea-secondary-tab--active' : ''} ${isSelectedTab ? 'lea-secondary-tab--selected' : ''}`}
        onClick={onSelectTab}
        type="button"
      >
        <span className="lea-secondary-tab__icon">{getEventIcon(iconType)}</span>
        <span className="lea-secondary-tab__title">{getPanelTitle()}</span>
        <span className="lea-secondary-tab__count">{relevantEvents.length}</span>
      </button>
    )
  }

  return (
    <div className={`lea-secondary-panel ${isFocused ? 'lea-secondary-panel--focused' : ''}`}>
      <PanelHeader title={getPanelTitle()} badge={`${relevantEvents.length}`} />
      <div className="lea-secondary-panel__content">
        {relevantEvents.length > 0 ? (
          <div className="lea-secondary-event-list">
            {relevantEvents.slice(-2).map(event => (
              <div key={event.id} className="lea-secondary-event">
                <span className="lea-secondary-event__icon">{getEventIcon(event.type)}</span>
                <span className="lea-secondary-event__label">{getEventLabel(event.type)}</span>
                <span className="lea-secondary-event__seq">#{event.seq}</span>
                <span className="lea-secondary-event__time">
                  {new Date(event.timestamp).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="lea-secondary-empty">No events</div>
        )}
      </div>
    </div>
  )
}

// =============================================================================
// Alignment Panel Component
// =============================================================================

interface AlignmentPanelProps {
  alignmentRows: AlignmentRow[]
  risks: RiskEvent[]
  onRowClick: (row: AlignmentRow) => void
  highlightedRuleId?: string | null
}

function getStatusLabel(status: AlignmentStatus): string {
  switch (status) {
    case 'match': return '✓ MATCH'
    case 'mismatch': return '✗ MISMATCH'
    case 'unknown': return '? UNKNOWN'
    case 'not-applicable': return '— N/A'
    default: return status
  }
}

function AlignmentPanel({ alignmentRows, risks, onRowClick, highlightedRuleId }: AlignmentPanelProps) {
  const mismatchCount = alignmentRows.filter(r => r.status === 'mismatch').length
  
  // Check if a row should be highlighted based on its linkedRuleIds
  const isRowHighlighted = (row: AlignmentRow): boolean => {
    if (!highlightedRuleId) return false
    return row.linkedRuleIds.includes(highlightedRuleId)
  }
  
  return (
    <div className="lea-alignment-panel">
      <div className="lea-alignment-header">
        <span className="lea-alignment-title">Claims vs Observations</span>
        <span className="lea-alignment-badge">MOCK</span>
        {mismatchCount > 0 && (
          <span className="lea-alignment-mismatch-count">{mismatchCount} mismatch</span>
        )}
      </div>
      <div className="lea-alignment-table">
        <div className="lea-alignment-table__header">
          <span className="lea-alignment-cell lea-alignment-cell--claim">Claim</span>
          <span className="lea-alignment-cell lea-alignment-cell--claimed">Declared</span>
          <span className="lea-alignment-cell lea-alignment-cell--observed">Observed</span>
          <span className="lea-alignment-cell lea-alignment-cell--status">Status</span>
        </div>
        <div className="lea-alignment-table__body">
          {alignmentRows.map(row => {
            const linkedRisks = getRisksForAlignmentRow(risks, row.linkedRuleIds)
            const isHighlighted = isRowHighlighted(row)
            return (
              <button
                key={row.key}
                type="button"
                className={`lea-alignment-row lea-alignment-row--${row.status}${isHighlighted ? ' lea-alignment-row--highlighted' : ''}`}
                onClick={() => onRowClick(row)}
                title={linkedRisks.length > 0 
                  ? `${linkedRisks.length} related risk(s) - click to view` 
                  : 'Click for details'}
                data-highlighted={isHighlighted}
              >
                <span className="lea-alignment-cell lea-alignment-cell--claim">
                  {row.claimLabel}
                </span>
                <span className="lea-alignment-cell lea-alignment-cell--claimed">
                  <code>{row.claimedValue}</code>
                </span>
                <span className="lea-alignment-cell lea-alignment-cell--observed">
                  <code>{row.observedValue}</code>
                </span>
                <span className={`lea-alignment-cell lea-alignment-cell--status lea-alignment-status--${row.status}`}>
                  {getStatusLabel(row.status)}
                  {linkedRisks.length > 0 && (
                    <span className="lea-alignment-risk-count">{linkedRisks.length}</span>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// Main Component
// =============================================================================

export default function LiveExecutionAnalysis({ 
  flags = DEFAULT_VERIFICATION_FLAGS,
  deepLink,
  onDeepLinkConsumed,
  compact = false
}: LiveExecutionAnalysisProps) {
  const isVerified = canClaimVerified(flags)
  const containerRef = useRef<HTMLDivElement>(null)
  
  // State
  const [events, setEvents] = useState<LiveEvent[]>([])
  const [demoIndex, setDemoIndex] = useState(0)
  const [viewport, setViewport] = useState({ width: 1200, height: 800 })
  const [stickiness, setStickiness] = useState<FocusStickinessState>(createInitialStickinessState)
  const [selectedTabId, setSelectedTabId] = useState<PanelId>('semantic')
  
  // Event Inspector State
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [drawerTab, setDrawerTab] = useState<DrawerTabId>('evidence')
  
  // Highlight state for alignment/risk rules
  const [highlightedRuleId, setHighlightedRuleId] = useState<string | null>(null)
  
  // Filter State
  const [filter, setFilter] = useState<EventFilter>(createDefaultFilter)
  const [autoFocus, setAutoFocus] = useState(true)
  
  // Hero Section State
  const [showAllExecutions, setShowAllExecutions] = useState(false)
  
  // ==========================================================================
  // Deep-Link Handling
  // ==========================================================================
  
  useEffect(() => {
    if (!deepLink) return
    
    console.log('[LiveExecutionAnalysis] Processing deep-link:', deepLink)
    let consumed = false
    
    // Handle traceId: set trace filter
    if (deepLink.traceId) {
      // Check if this trace exists in AVAILABLE_TRACES (array of strings)
      if (AVAILABLE_TRACES.includes(deepLink.traceId as TraceId)) {
        setFilter(prev => ({ ...prev, traceId: deepLink.traceId as TraceId }))
        consumed = true
      } else {
        console.warn('[LiveExecutionAnalysis] Unknown traceId:', deepLink.traceId)
      }
    }
    
    // Handle eventId: select event and open drawer
    if (deepLink.eventId) {
      setSelectedEventId(deepLink.eventId)
      setIsDrawerOpen(true)
      consumed = true
    }
    
    // Handle drawerTab: set drawer tab
    if (deepLink.drawerTab) {
      setDrawerTab(deepLink.drawerTab)
      // Also open drawer if not already opening from eventId
      if (!deepLink.eventId) {
        setIsDrawerOpen(true)
      }
      consumed = true
    }
    
    // Handle ruleId: highlight matching alignment row
    if (deepLink.ruleId) {
      setHighlightedRuleId(deepLink.ruleId)
      // Also set drawer tab to risks if not already specified
      if (!deepLink.drawerTab) {
        setDrawerTab('risks')
      }
      if (!deepLink.eventId) {
        setIsDrawerOpen(true)
      }
      consumed = true
    }
    
    // Signal consumption
    if (consumed || Object.keys(deepLink).length > 0) {
      onDeepLinkConsumed?.()
    }
  }, [deepLink, onDeepLinkConsumed])
  
  // Computed: filtered events
  const filteredEvents = useMemo(() => {
    return filterEvents(events, filter)
  }, [events, filter])
  
  // Computed: all risks (deterministic from events)
  const allRisks = useMemo(() => {
    return generateRiskEvents(events, true) // Mock: assume README claims no egress
  }, [events])
  
  // Computed: filtered risks (respects trace filter)
  const filteredRisks = useMemo(() => {
    return filterRisksByTrace(allRisks, filter.traceId)
  }, [allRisks, filter.traceId])
  
  // Computed: top risks for banner (critical/high only, max 2)
  const topBannerRisks = useMemo(() => {
    const criticalHighRisks = filteredRisks.filter(
      r => r.severity === 'critical' || r.severity === 'high'
    )
    return getTopRisks(criticalHighRisks, 2)
  }, [filteredRisks])
  
  // Computed: risks by event ID (for inline badges)
  const risksByEventId = useMemo(() => {
    const map = new Map<string, RiskEvent[]>()
    for (const risk of filteredRisks) {
      if (risk.eventId) {
        const existing = map.get(risk.eventId) || []
        existing.push(risk)
        map.set(risk.eventId, existing)
      }
    }
    return map
  }, [filteredRisks])
  
  // Computed: observations from filtered events (deterministic)
  const observations = useMemo(() => {
    return computeObservations(filteredEvents)
  }, [filteredEvents])
  
  // Computed: alignment rows (claims vs observations)
  const alignmentRows = useMemo(() => {
    return computeAlignment(DEFAULT_CLAIMS, observations)
  }, [observations])
  
  // Check for unresolved consents in ALL events (for banner, even if filtered out)
  const hasUnresolvedConsent = useMemo(() => {
    return events.some(e => e.type === 'consent_required' && !e.resolved)
  }, [events])

  // Track viewport size
  useLayoutEffect(() => {
    const updateViewport = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect()
        setViewport({ width: rect.width, height: rect.height })
      }
    }
    
    updateViewport()
    window.addEventListener('resize', updateViewport)
    return () => window.removeEventListener('resize', updateViewport)
  }, [])

  // Compute focus state with stickiness (deterministic) - uses FILTERED events
  const { focus: computedFocusState, newStickiness } = useMemo(() => {
    return computeFocusStateWithStickiness(filteredEvents, stickiness)
  }, [filteredEvents, stickiness])
  
  // If Auto Focus is OFF, use a static focus state (no automatic focus changes)
  const focusState: FocusState = useMemo(() => {
    if (autoFocus) {
      return computedFocusState
    }
    // Auto Focus OFF: keep a neutral focus state, but still track consent override for banner
    return {
      focusedPanelId: 'focus' as PanelId,
      focusReason: 'Auto Focus OFF',
      focusEventId: null,
      isConsentOverride: false, // Don't force focus, but banner will still show
      unresolvedConsentCount: computedFocusState.unresolvedConsentCount,
      stickinessApplied: false
    }
  }, [autoFocus, computedFocusState])

  // Update stickiness when events change (only if auto focus is on)
  const prevEventsLengthRef = useRef(filteredEvents.length)
  useLayoutEffect(() => {
    if (autoFocus && filteredEvents.length !== prevEventsLengthRef.current) {
      prevEventsLengthRef.current = filteredEvents.length
      setStickiness(newStickiness)
    }
  }, [autoFocus, filteredEvents.length, newStickiness])

  // Compute layout spec (deterministic)
  const layoutSpec: LayoutSpec = useMemo(() => {
    return computeLayoutSpec(focusState, viewport)
  }, [focusState, viewport])

  // Generate CSS variables
  const cssVars = useMemo(() => {
    return generateLayoutCSSVars(layoutSpec)
  }, [layoutSpec])

  // Advance demo sequence
  const advanceDemo = useCallback(() => {
    if (demoIndex >= DEMO_EVENT_SEQUENCE.length) {
      return // Sequence complete
    }
    
    const spec = DEMO_EVENT_SEQUENCE[demoIndex]
    const baseTimestamp = events.length === 0 ? Date.now() : events[0].timestamp
    const domain = EVENT_TYPE_TO_DOMAIN[spec.type]
    
    const newEvent = createLiveEvent(
      spec.type,
      baseTimestamp + spec.offset,
      spec.traceId,
      domain,
      spec.data,
      spec.resolved,
      spec.capsuleId
    )
    
    setEvents(prev => [...prev, newEvent])
    setDemoIndex(prev => prev + 1)
  }, [demoIndex, events])

  // Resolve consent by event ID (deterministic by ID, not "most recent")
  const resolveConsentById = useCallback((eventId: string) => {
    setEvents(prev => {
      const updated = [...prev]
      const idx = updated.findIndex(e => e.id === eventId && e.type === 'consent_required')
      if (idx !== -1) {
        updated[idx] = { ...updated[idx], resolved: true }
      }
      return updated
    })
  }, [])

  // Legacy: resolve most recent consent (for Focus Panel)
  const resolveConsent = useCallback(() => {
    setEvents(prev => {
      const updated = [...prev]
      const unresolvedConsents = updated
        .filter(e => e.type === 'consent_required' && !e.resolved)
        .sort((a, b) => b.seq - a.seq)
      
      if (unresolvedConsents.length > 0) {
        const toResolve = unresolvedConsents[0]
        const idx = updated.findIndex(e => e.id === toResolve.id)
        if (idx !== -1) {
          updated[idx] = { ...updated[idx], resolved: true }
        }
      }
      return updated
    })
  }, [])

  // Clear all events
  const clearEvents = useCallback(() => {
    setEvents([])
    setDemoIndex(0)
    setStickiness(createInitialStickinessState())
    setSelectedTabId('semantic')
    setSelectedEventId(null)
    setIsDrawerOpen(false)
    setFilter(createDefaultFilter())
    setAutoFocus(true)
    setHighlightedRuleId(null)
  }, [])

  // Event selection handler
  const handleSelectEvent = useCallback((eventId: string) => {
    setSelectedEventId(eventId)
    setIsDrawerOpen(true)
    setDrawerTab('evidence') // Default to evidence tab
  }, [])

  // Select event and open to risks tab
  const handleSelectEventRisks = useCallback((eventId: string) => {
    setSelectedEventId(eventId)
    setIsDrawerOpen(true)
    setDrawerTab('risks')
  }, [])

  // Handle alignment row click - open drawer with risks tab
  const handleAlignmentRowClick = useCallback((row: AlignmentRow) => {
    // Find the first event that has a linked risk
    const linkedRisks = getRisksForAlignmentRow(filteredRisks, row.linkedRuleIds)
    if (linkedRisks.length > 0 && linkedRisks[0].eventId) {
      setSelectedEventId(linkedRisks[0].eventId)
      setIsDrawerOpen(true)
      setDrawerTab('risks')
    } else {
      // Open drawer without specific event selection
      setIsDrawerOpen(true)
      setDrawerTab('risks')
    }
  }, [filteredRisks])

  // Close drawer
  const handleCloseDrawer = useCallback(() => {
    setIsDrawerOpen(false)
  }, [])

  // Filter handlers
  const handleTraceFilterChange = useCallback((traceId: TraceId | 'all') => {
    setFilter(prev => ({ ...prev, traceId }))
  }, [])

  const handleDomainToggle = useCallback((domain: EventDomain) => {
    setFilter(prev => {
      const newDomains = new Set(prev.domains)
      if (newDomains.has(domain)) {
        newDomains.delete(domain)
      } else {
        newDomains.add(domain)
      }
      return { ...prev, domains: newDomains }
    })
  }, [])

  const handleJumpToTrace = useCallback((traceId: TraceId) => {
    setFilter(prev => ({ ...prev, traceId }))
  }, [])

  // Auto-select: default to focused event or most recent from FILTERED events
  useEffect(() => {
    if (filteredEvents.length === 0) {
      setSelectedEventId(null)
      return
    }
    
    // If no selection or selection no longer exists in filtered events, select default
    const selectionExists = selectedEventId && filteredEvents.some(e => e.id === selectedEventId)
    if (!selectionExists) {
      // Default: focused event if any (and in filtered), else most recent filtered
      if (focusState.focusEventId && filteredEvents.some(e => e.id === focusState.focusEventId)) {
        setSelectedEventId(focusState.focusEventId)
      } else {
        const mostRecent = [...filteredEvents].sort(compareEvents).pop()
        if (mostRecent) {
          setSelectedEventId(mostRecent.id)
        }
      }
    }
  }, [filteredEvents, selectedEventId, focusState.focusEventId])

  // Get selected event object (from all events, not filtered - to support viewing)
  const selectedEvent = useMemo(() => {
    return events.find(e => e.id === selectedEventId) ?? null
  }, [events, selectedEventId])

  // Get secondary panels that are not currently focused
  const secondaryPanels = useMemo(() => {
    return layoutSpec.secondaryPanels.filter(p => 
      p !== focusState.focusedPanelId || focusState.focusedPanelId === 'focus'
    )
  }, [layoutSpec.secondaryPanels, focusState.focusedPanelId])

  // Handle tab selection (stable across layout recomputes)
  const handleTabSelect = useCallback((panelId: PanelId) => {
    setSelectedTabId(panelId)
  }, [])

  // Compute execution status metrics for hero
  const isStreaming = events.length > 0 && demoIndex < DEMO_EVENT_SEQUENCE.length
  const hasUnresolved = events.some(e => e.type === 'consent_required' && !e.resolved)
  const executionStatus: 'executing' | 'paused' | 'idle' = 
    hasUnresolved ? 'paused' : 
    isStreaming ? 'executing' : 
    'idle'
  
  const riskCounts = useMemo(() => {
    return {
      critical: filteredRisks.filter(r => r.severity === 'critical').length,
      high: filteredRisks.filter(r => r.severity === 'high').length,
      medium: filteredRisks.filter(r => r.severity === 'medium').length
    }
  }, [filteredRisks])
  
  const handleAnalyseExecution = (eventId: string) => {
    console.log('[LiveExecution] Analysing execution:', eventId)
    setIsDrawerOpen(true)
  }
  
  return (
    <div 
      ref={containerRef}
      className={`live-execution-canvas${compact ? ' live-execution-canvas--compact' : ''}`}
      data-verified={isVerified}
      data-timeline-mode={layoutSpec.timelineMode}
      data-secondary-mode={layoutSpec.secondaryMode}
      data-consent-override={focusState.isConsentOverride}
      data-stickiness={focusState.stickinessApplied}
      style={cssVars as React.CSSProperties}
    >
      {/* Active Processes Hero Section */}
      <ActiveProcessesHero 
        showAll={showAllExecutions}
        onToggleShowAll={() => setShowAllExecutions(!showAllExecutions)}
        onAnalyse={handleAnalyseExecution}
      />
      
      {/* Execution Status Summary */}
      <div className="lea-hero-section">
        <ExecutionStatusHero 
          status={executionStatus}
          eventCount={events.length}
          duration={events.length > 0 ? `${Math.floor((Date.now() - events[0].timestamp) / 1000)}s` : undefined}
          riskCounts={riskCounts}
          onViewTimeline={() => {
            // Scroll to timeline
            document.querySelector('.lea-timeline-zone')?.scrollIntoView({ behavior: 'smooth' })
          }}
        />
      </div>

      {/* Control Bar (Z1: Header) */}
      <div className="lea-header-zone">
        <div className="lea-control-bar">
          <div className="lea-control-bar__left">
            <span className="lea-status">
              <span className="lea-status__dot" />
              Live
            </span>
            <span className="lea-event-count">{events.length} events</span>
            <span className="lea-demo-progress">
              Step {demoIndex}/{DEMO_EVENT_SEQUENCE.length}
            </span>
          </div>
          <div className="lea-control-bar__right">
            <button 
              className="lea-btn"
              onClick={advanceDemo}
              disabled={demoIndex >= DEMO_EVENT_SEQUENCE.length}
            >
              ▶ Advance
            </button>
            <button 
              className={`lea-btn ${isDrawerOpen ? 'lea-btn--active' : 'lea-btn--secondary'}`}
              onClick={() => setIsDrawerOpen(!isDrawerOpen)}
              disabled={events.length === 0}
            >
              🔍 Inspector
            </button>
            <button 
              className="lea-btn lea-btn--secondary"
              onClick={clearEvents}
            >
              Clear
            </button>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="lea-filter-bar">
          {/* Trace Filter */}
          <div className="lea-filter-group">
            <span className="lea-filter-label">Trace:</span>
            <div className="lea-filter-buttons">
              <button
                className={`lea-filter-btn ${filter.traceId === 'all' ? 'lea-filter-btn--active' : ''}`}
                onClick={() => handleTraceFilterChange('all')}
              >
                All
              </button>
              {AVAILABLE_TRACES.map(traceId => (
                <button
                  key={traceId}
                  className={`lea-filter-btn ${filter.traceId === traceId ? 'lea-filter-btn--active' : ''}`}
                  onClick={() => handleTraceFilterChange(traceId)}
                >
                  {traceId.replace('_', ' ').toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* Domain Filter */}
          <div className="lea-filter-group">
            <span className="lea-filter-label">Domain:</span>
            <div className="lea-filter-toggles">
              {ALL_DOMAINS.map(domain => (
                <button
                  key={domain}
                  className={`lea-filter-toggle ${filter.domains.has(domain) ? 'lea-filter-toggle--active' : ''}`}
                  onClick={() => handleDomainToggle(domain)}
                  title={domain}
                >
                  {domain.slice(0, 3).toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* Auto Focus Toggle */}
          <div className="lea-filter-group lea-filter-group--auto-focus">
            <span className="lea-filter-label">Auto Focus:</span>
            <button
              className={`lea-auto-focus-btn ${autoFocus ? 'lea-auto-focus-btn--on' : 'lea-auto-focus-btn--off'}`}
              onClick={() => setAutoFocus(!autoFocus)}
            >
              {autoFocus ? 'ON' : 'OFF'}
            </button>
          </div>

          {/* Filter Stats */}
          <div className="lea-filter-stats">
            <span>{filteredEvents.length}/{events.length} visible</span>
            {filteredRisks.length > 0 && (
              <span className="lea-filter-stats__risks">
                {filteredRisks.length} risk{filteredRisks.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        {/* Top Risk Banners - always visible in Live phase */}
        {topBannerRisks.length > 0 && (
          <div className="lea-risk-banners">
            {topBannerRisks.map(risk => (
              <div 
                key={risk.riskId} 
                className={`lea-risk-banner lea-risk-banner--${risk.severity}`}
              >
                <span className={`lea-risk-banner__severity lea-risk-banner__severity--${risk.severity}`}>
                  {risk.severity.toUpperCase()}
                </span>
                <span className="lea-risk-banner__title">{risk.title}</span>
                {risk.ruleId && (
                  <code className="lea-risk-banner__rule">{risk.ruleId}</code>
                )}
                <span className="lea-risk-banner__mock">MOCK</span>
                {risk.eventId && (
                  <button 
                    className="lea-risk-banner__view"
                    onClick={() => handleSelectEventRisks(risk.eventId!)}
                  >
                    View
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Consent Banner - visible even if filtered out or auto focus off */}
        {hasUnresolvedConsent && (
          <div className="lea-consent-banner">
            <span className="lea-consent-banner__icon">✋</span>
            <span className="lea-consent-banner__text">
              Unresolved consent required ({events.filter(e => e.type === 'consent_required' && !e.resolved).length} pending)
            </span>
            {!autoFocus && (
              <span className="lea-consent-banner__note">(Auto Focus OFF - focus not forced)</span>
            )}
          </div>
        )}

        {/* Simulation Notice */}
        <div className="lea-notice">
          <span className="lea-notice__icon">ℹ</span>
          <span className="lea-notice__text">
            Deterministic execution. Auto Focus: {autoFocus ? 'ON' : 'OFF'}
          </span>
          <span className="lea-notice__badge">Active</span>
        </div>
      </div>

      {/* Main Layout (Z2) */}
      <div className="lea-main-zone">
        {/* Timeline Panel - shows FILTERED events with risk badges */}
        <TimelinePanel 
          events={filteredEvents}
          focusEventId={focusState.focusEventId}
          selectedEventId={selectedEventId}
          mode={layoutSpec.timelineMode}
          onSelectEvent={handleSelectEvent}
          risksByEventId={risksByEventId}
          onSelectEventRisks={handleSelectEventRisks}
        />

        {/* Dynamic Area */}
        <div className="lea-dynamic-area">
          {/* Focus Panel (Primary) */}
          <div className="lea-focus-zone">
            <FocusPanel 
              focusState={focusState}
              events={filteredEvents}
              onResolveConsent={focusState.isConsentOverride ? resolveConsent : undefined}
            />
          </div>

          {/* Secondary Panel Grid */}
          <div className={`lea-secondary-zone lea-secondary-zone--${layoutSpec.secondaryMode}`}>
            {secondaryPanels.map(panelId => (
              <SecondaryPanel
                key={panelId}
                panelId={panelId}
                events={filteredEvents}
                isMinimized={layoutSpec.secondaryMode === 'minimized'}
                isFocused={focusState.focusedPanelId === panelId}
                isSelectedTab={selectedTabId === panelId}
                onSelectTab={() => handleTabSelect(panelId)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Alignment Panel (always visible, compact) */}
      <AlignmentPanel
        alignmentRows={alignmentRows}
        risks={filteredRisks}
        onRowClick={handleAlignmentRowClick}
        highlightedRuleId={highlightedRuleId}
      />

      {/* Footer Zone (Z3) */}
      <div className="lea-footer-zone">
        <div className="lea-layout-info">
          <span className="lea-layout-info__item">
            Focus: <code>{focusState.focusedPanelId}</code>
          </span>
          <span className="lea-layout-info__item">
            Selected: <code>{selectedEventId ? selectedEventId.slice(0, 12) + '...' : 'none'}</code>
          </span>
          <span className="lea-layout-info__item">
            Drawer: <code>{isDrawerOpen ? 'open' : 'closed'}</code>
          </span>
          <span className="lea-layout-info__item">
            Sticky: <code>{focusState.stickinessApplied ? 'yes' : 'no'}</code>
          </span>
        </div>
      </div>

      {/* Evidence Drawer with Risks Tab */}
      <EvidenceDrawer
        event={selectedEvent}
        isOpen={isDrawerOpen}
        onClose={handleCloseDrawer}
        onResolveConsent={resolveConsentById}
        onJumpToTrace={handleJumpToTrace}
        risks={filteredRisks}
        initialTab={drawerTab}
      />
    </div>
  )
}
