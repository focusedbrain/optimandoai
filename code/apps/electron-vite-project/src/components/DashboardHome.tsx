/**
 * Dashboard Home Component
 * 
 * Landing page showing the highest priority action across all analysis phases.
 * Uses full available width with proper scrolling.
 */

import { useState } from 'react'
import './DashboardHome.css'
import { type AnalysisPhase, HeroKPIStrip, type KPIData } from './analysis'
import {
  getMockDashboardState,
  type PreExecutionSnapshot,
  type LiveExecutionSnapshot,
  type PostExecutionSnapshot
} from './analysis/computePriorityAction'

interface DashboardHomeProps {
  onNavigate: (phase: AnalysisPhase, deepLink?: { ruleId?: string; eventId?: string; drawerTab?: 'evidence' | 'risks' }) => void
}

// =============================================================================
// Mock Event History
// =============================================================================

interface SystemEvent {
  id: string
  type: 'pre-execution' | 'live' | 'post-execution' | 'approval' | 'optimization' | 'p2p-session' | 'beap-package' | 'unpackaging' | 'group-chat'
  title: string
  description: string
  timestamp: string
  status: 'success' | 'info' | 'warning'
  phase: AnalysisPhase
}

const mockSystemEvents: SystemEvent[] = [
  {
    id: 'evt_001',
    type: 'approval',
    title: 'External API Access Pending',
    description: 'Vendor lookup API requires authorization before Invoice Processing can proceed',
    timestamp: '2026-01-06T10:15:00.000Z',
    status: 'warning',
    phase: 'pre-execution'
  },
  {
    id: 'evt_002',
    type: 'live',
    title: 'BEAP™ Package Unpackaging',
    description: 'Extracting artefacts from incoming capsule cap_8a7b6c5d',
    timestamp: '2026-01-06T10:14:58.500Z',
    status: 'info',
    phase: 'live'
  },
  {
    id: 'evt_003',
    type: 'optimization',
    title: 'OCR Processing Optimization',
    description: 'Analyzing execution patterns for improved performance',
    timestamp: '2026-01-06T10:14:55.000Z',
    status: 'info',
    phase: 'live'
  },
  {
    id: 'evt_004',
    type: 'post-execution',
    title: 'PoAE™ Verification Complete',
    description: 'Document Classification Workflow verified with 3 attestation events',
    timestamp: '2026-01-06T10:14:28.892Z',
    status: 'success',
    phase: 'post-execution'
  },
  {
    id: 'evt_005',
    type: 'pre-execution',
    title: 'Manager Approval Granted',
    description: 'High-value transaction review completed for Invoice Processing',
    timestamp: '2026-01-06T10:12:00.000Z',
    status: 'success',
    phase: 'pre-execution'
  },
  {
    id: 'evt_006',
    type: 'live',
    title: 'P2P Session Started',
    description: 'Collaborative editing session initiated with Partner Inc',
    timestamp: '2026-01-06T10:10:00.000Z',
    status: 'info',
    phase: 'live'
  },
  {
    id: 'evt_007',
    type: 'live',
    title: 'BEAP™ Package Built',
    description: 'Output capsule created with 3 artefacts for external delivery',
    timestamp: '2026-01-06T10:08:00.000Z',
    status: 'success',
    phase: 'live'
  }
]

// =============================================================================
// System Event Hero Section
// =============================================================================

interface SystemEventHeroProps {
  showAllEvents: boolean
  onToggleShowAll: () => void
  onAnalyse: (eventId: string) => void
  onNavigate: DashboardHomeProps['onNavigate']
}

function SystemEventHero({ showAllEvents, onToggleShowAll, onAnalyse, onNavigate }: SystemEventHeroProps) {
  const latestEvent = mockSystemEvents[0]
  
  const getEventIcon = (type: SystemEvent['type']) => {
    switch (type) {
      case 'post-execution': return '🔐'
      case 'live': return '⚡'
      case 'pre-execution': return '📋'
      case 'approval': return '✋'
      case 'optimization': return '🎯'
      case 'p2p-session': return '👥'
      case 'beap-package': return '📦'
      case 'unpackaging': return '📂'
      case 'group-chat': return '💬'
      default: return '📊'
    }
  }
  
  const getEventTypeLabel = (type: SystemEvent['type']) => {
    switch (type) {
      case 'post-execution': return 'PoAE™ Verification'
      case 'live': return 'Live Execution'
      case 'pre-execution': return 'Pre-Execution'
      case 'approval': return 'Approval Required'
      case 'optimization': return 'Optimization'
      case 'p2p-session': return 'P2P Session'
      case 'beap-package': return 'BEAP™ Package'
      case 'unpackaging': return 'BEAP™ Unpackaging'
      case 'group-chat': return 'Group Chat'
      default: return 'System Event'
    }
  }
  
  const isPendingApproval = latestEvent.type === 'approval' && latestEvent.status === 'warning'
  
  return (
    <div className={`system-hero ${isPendingApproval ? 'system-hero--pending' : ''}`}>
      <div className="system-hero__header">
        <div className="system-hero__icon">{getEventIcon(latestEvent.type)}</div>
        <div className="system-hero__title-group">
          <h2 className="system-hero__title">
            {isPendingApproval ? 'Action Required' : 'Latest System Event'}
          </h2>
          <p className="system-hero__subtitle">{getEventTypeLabel(latestEvent.type)}</p>
        </div>
        <div className="system-hero__status">
          <span className={`system-hero__status-badge system-hero__status-badge--${latestEvent.status}`}>
            {latestEvent.status === 'success' ? '✓ Complete' : latestEvent.status === 'warning' ? '○ Pending' : 'ℹ Info'}
          </span>
        </div>
      </div>

      {/* Latest Event Details */}
      <div className="system-hero__latest">
        <h3 className="system-hero__event-title">{latestEvent.title}</h3>
        <p className="system-hero__event-desc">{latestEvent.description}</p>
        <div className="system-hero__event-meta">
          <span className="system-hero__event-time">
            {new Date(latestEvent.timestamp).toLocaleString()}
          </span>
          <span className="system-hero__event-id">ID: {latestEvent.id}</span>
        </div>
      </div>

      {/* Primary Action Buttons */}
      <div className="system-hero__actions">
        <button className="system-hero__btn system-hero__btn--analyse" onClick={() => onAnalyse(latestEvent.id)}>
          <span className="system-hero__btn-icon">🔍</span>
          {isPendingApproval ? 'Analyse Before Consent' : 'Analyse Event'}
        </button>
        {isPendingApproval && (
          <button className="system-hero__btn system-hero__btn--approve">
            <span className="system-hero__btn-icon">✓</span>
            Approve
          </button>
        )}
        <button className="system-hero__btn system-hero__btn--secondary" onClick={onToggleShowAll}>
          {showAllEvents ? '▲ Hide All' : '▼ Show All'}
        </button>
      </div>

      {/* Event History */}
      {showAllEvents && (
        <div className="system-hero__history">
          <div className="system-hero__history-title">Recent System Events</div>
          <div className="system-hero__history-list">
            {mockSystemEvents.map((event) => (
              <div key={event.id} className="system-hero__history-item">
                <div className="system-hero__history-item-main">
                  <span className="system-hero__history-icon">{getEventIcon(event.type)}</span>
                  <div className="system-hero__history-info">
                    <span className="system-hero__history-title-text">{event.title}</span>
                    <span className="system-hero__history-desc">{event.description}</span>
                  </div>
                  <span className="system-hero__history-time">
                    {new Date(event.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <div className="system-hero__history-item-actions">
                  <button className="system-hero__history-analyse" onClick={() => onAnalyse(event.id)}>
                    Analyse
                  </button>
                  <button className="system-hero__history-goto" onClick={() => onNavigate(event.phase)}>
                    View
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
// Event Analysis Modal
// =============================================================================

interface EventAnalysisModalProps {
  isOpen: boolean
  onClose: () => void
  event: SystemEvent | undefined
  onApprove: () => void
}

function EventAnalysisModal({ isOpen, onClose, event, onApprove }: EventAnalysisModalProps) {
  const [showTemplates, setShowTemplates] = useState(false)
  
  if (!isOpen || !event) return null
  
  // Mock workflow data (same pattern as Post-Execution)
  const mockWorkflow = {
    sender: {
      organization: 'Acme Corp',
      user: 'john.smith@acme.corp',
      authorization: {
        action: 'WORKFLOW_INITIATED',
        timestamp: '2026-01-06T10:11:00.000Z',
        hash: 'sha256:sender_init_a1b2c3d4e5f6',
        status: 'verified' as const
      }
    },
    automationSteps: [
      { id: 1, name: 'Capsule Depackaging', status: event.phase === 'pre-execution' ? 'pending' : 'verified' },
      { id: 2, name: 'Artefact Extraction', status: event.phase === 'pre-execution' ? 'pending' : 'verified' },
      { id: 3, name: 'OCR Processing', status: event.phase === 'pre-execution' ? 'pending' : event.phase === 'live' ? 'running' : 'verified' },
      { id: 4, name: 'Validation', status: event.phase === 'pre-execution' ? 'pending' : event.phase === 'live' ? 'pending' : 'verified' },
      { id: 5, name: 'External API Call', status: event.phase === 'pre-execution' ? 'pending' : event.phase === 'live' ? 'pending' : 'verified' },
      { id: 6, name: 'Result Packaging', status: event.phase === 'pre-execution' ? 'pending' : 'pending' }
    ],
    receiver: {
      organization: 'Partner Inc',
      user: 'jane.doe@partner.inc',
      authorization: {
        action: event.phase === 'pre-execution' ? 'AWAITING_CONSENT' : event.phase === 'post-execution' ? 'EXECUTION_COMPLETED' : 'IN_PROGRESS',
        timestamp: event.phase === 'pre-execution' ? '--' : '2026-01-06T10:14:28.892Z',
        hash: event.phase === 'pre-execution' ? '--' : 'sha256:receiver_complete_9z8y7x6w',
        status: event.phase === 'pre-execution' ? 'pending' : 'verified' as 'pending' | 'verified'
      }
    },
    template: {
      name: 'Invoice Processing Workflow',
      version: '2.1.0',
      steps: ['capsule_depackage', 'extract_artefacts', 'run_ocr', 'validate_schema', 'external_api_call', 'package_results'],
      policies: ['policy:data-processing-allowed', 'policy:external-api-allowed']
    }
  }
  
  const isPending = event.type === 'approval' && event.status === 'warning'
  
  return (
    <div className="event-modal-overlay" onClick={onClose}>
      <div className="event-modal" onClick={e => e.stopPropagation()}>
        <div className="event-modal__header">
          <h2 className="event-modal__title">
            🔍 {isPending ? 'Pre-Execution Analysis' : 'Event Analysis'}
          </h2>
          <p className="event-modal__subtitle">{event.title}</p>
          <button className="event-modal__close" onClick={onClose}>×</button>
        </div>
        
        <div className="event-modal__content">
          {/* Sender Section */}
          <div className="event-modal__section event-modal__section--sender">
            <div className="event-modal__section-header">
              <span className="event-modal__section-icon">📤</span>
              <div>
                <h3 className="event-modal__section-title">Sender: {mockWorkflow.sender.organization}</h3>
                <span className="event-modal__section-user">{mockWorkflow.sender.user}</span>
              </div>
            </div>
            <div className="event-modal__poae event-modal__poae--verified">
              <div className="event-modal__poae-badge">🔐 PoAE™ Authorization</div>
              <div className="event-modal__poae-row">
                <span>Action:</span>
                <span>{mockWorkflow.sender.authorization.action}</span>
              </div>
              <div className="event-modal__poae-row">
                <span>Hash:</span>
                <code>{mockWorkflow.sender.authorization.hash}</code>
              </div>
              <span className="event-modal__poae-status event-modal__poae-status--verified">✓ Verified</span>
            </div>
          </div>
          
          {/* Automation Steps */}
          <div className="event-modal__section event-modal__section--automation">
            <div className="event-modal__section-header">
              <span className="event-modal__section-icon">⚙️</span>
              <h3 className="event-modal__section-title">Automation Steps</h3>
              <button 
                className="event-modal__template-btn"
                onClick={() => setShowTemplates(!showTemplates)}
              >
                {showTemplates ? '▲ Hide Template' : '▼ View Template'}
              </button>
            </div>
            
            {showTemplates && (
              <div className="event-modal__template">
                <div className="event-modal__template-header">
                  <span>{mockWorkflow.template.name}</span>
                  <span>v{mockWorkflow.template.version}</span>
                </div>
                <div className="event-modal__template-policies">
                  {mockWorkflow.template.policies.map((policy, idx) => (
                    <code key={idx} className="event-modal__policy">{policy}</code>
                  ))}
                </div>
              </div>
            )}
            
            <div className="event-modal__steps">
              {mockWorkflow.automationSteps.map((step, idx) => (
                <div key={step.id} className={`event-modal__step event-modal__step--${step.status}`}>
                  <div className="event-modal__step-connector">
                    <div className={`event-modal__step-dot event-modal__step-dot--${step.status}`} />
                    {idx < mockWorkflow.automationSteps.length - 1 && <div className="event-modal__step-line" />}
                  </div>
                  <div className="event-modal__step-content">
                    <span className="event-modal__step-num">{step.id}</span>
                    <span className="event-modal__step-name">{step.name}</span>
                    <span className={`event-modal__step-status event-modal__step-status--${step.status}`}>
                      {step.status === 'verified' ? '✓' : step.status === 'running' ? '●' : '○'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          
          {/* Receiver Section */}
          <div className={`event-modal__section event-modal__section--receiver ${mockWorkflow.receiver.authorization.status === 'pending' ? 'event-modal__section--pending' : ''}`}>
            <div className="event-modal__section-header">
              <span className="event-modal__section-icon">📥</span>
              <div>
                <h3 className="event-modal__section-title">Receiver: {mockWorkflow.receiver.organization}</h3>
                <span className="event-modal__section-user">{mockWorkflow.receiver.user}</span>
              </div>
            </div>
            <div className={`event-modal__poae event-modal__poae--${mockWorkflow.receiver.authorization.status}`}>
              <div className="event-modal__poae-badge">
                🔐 PoAE™ {mockWorkflow.receiver.authorization.status === 'pending' ? 'Required' : 'Authorization'}
              </div>
              <div className="event-modal__poae-row">
                <span>Action:</span>
                <span>{mockWorkflow.receiver.authorization.action}</span>
              </div>
              {mockWorkflow.receiver.authorization.hash !== '--' && (
                <div className="event-modal__poae-row">
                  <span>Hash:</span>
                  <code>{mockWorkflow.receiver.authorization.hash}</code>
                </div>
              )}
              <span className={`event-modal__poae-status event-modal__poae-status--${mockWorkflow.receiver.authorization.status}`}>
                {mockWorkflow.receiver.authorization.status === 'verified' ? '✓ Verified' : '○ Pending'}
              </span>
            </div>
            
            {isPending && (
              <div className="event-modal__consent-notice">
                <span>ℹ</span>
                <span>Your consent will create a PoAE™ attestation event, enabling the automation to proceed.</span>
              </div>
            )}
          </div>
        </div>
        
        <div className="event-modal__footer">
          <button className="event-modal__btn event-modal__btn--secondary" onClick={onClose}>
            Close
          </button>
          {isPending && (
            <button className="event-modal__btn event-modal__btn--approve" onClick={onApprove}>
              ✓ Approve & Create PoAE™
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// Context Snapshot Cards
// =============================================================================

interface SnapshotCardProps {
  title: string
  icon: string
  children: React.ReactNode
  onGoTo: () => void
  status?: 'normal' | 'warning' | 'critical'
}

function SnapshotCard({ title, icon, children, onGoTo, status = 'normal' }: SnapshotCardProps) {
  return (
    <div className={`dash-snapshot dash-snapshot--${status}`}>
      <div className="dash-snapshot-header">
        <span className="dash-snapshot-icon">{icon}</span>
        <span className="dash-snapshot-title">{title}</span>
      </div>
      <div className="dash-snapshot-content">
        {children}
      </div>
      <button className="dash-snapshot-btn" onClick={onGoTo}>
        Go to {title} →
      </button>
    </div>
  )
}

function PreExecutionSnapshot({ data, onNavigate }: { data: PreExecutionSnapshot, onNavigate: DashboardHomeProps['onNavigate'] }) {
  const hasReviews = data.pendingConsents > 0
  const status = hasReviews ? 'warning' : 'normal'
  
  return (
    <SnapshotCard 
      title="Pre-Execution" 
      icon="📋" 
      onGoTo={() => onNavigate('pre-execution')}
      status={status}
    >
      <div className="dash-snapshot-stats">
        <div className="dash-stat">
          <span className="dash-stat-value">{data.riskLevel === 'low' ? 'OPTIMAL' : data.riskLevel === 'medium' ? 'NOMINAL' : 'ATTENTION'}</span>
          <span className="dash-stat-label">Status</span>
        </div>
        <div className="dash-stat">
          <span className="dash-stat-value">
            {data.mismatchCount}
          </span>
          <span className="dash-stat-label">Annotations</span>
        </div>
        <div className="dash-stat">
          <span className="dash-stat-value">
            {data.failedGates + data.pendingConsents}
          </span>
          <span className="dash-stat-label">Pending</span>
        </div>
      </div>
    </SnapshotCard>
  )
}

function LiveExecutionSnapshotCard({ data, onNavigate }: { data: LiveExecutionSnapshot, onNavigate: DashboardHomeProps['onNavigate'] }) {
  const hasReviews = data.unresolvedConsents > 0
  const status = hasReviews ? 'warning' : 'normal'
  
  return (
    <SnapshotCard 
      title="Live Execution" 
      icon="⚡" 
      onGoTo={() => onNavigate('live')}
      status={status}
    >
      <div className="dash-snapshot-stats">
        <div className="dash-stat">
          <span className={`dash-stat-value ${data.isStreaming ? 'dash-stat-value--active' : 'dash-stat-value--success'}`}>
            {data.isStreaming ? 'PROCESSING' : 'READY'}
          </span>
          <span className="dash-stat-label">Status</span>
        </div>
        <div className="dash-stat">
          <span className="dash-stat-value">{data.eventCount}</span>
          <span className="dash-stat-label">Events</span>
        </div>
        <div className="dash-stat">
          <span className="dash-stat-value">
            {data.activeWarnings}
          </span>
          <span className="dash-stat-label">Flagged</span>
        </div>
      </div>
    </SnapshotCard>
  )
}

function PostExecutionSnapshotCard({ data, onNavigate }: { data: PostExecutionSnapshot, onNavigate: DashboardHomeProps['onNavigate'] }) {
  return (
    <SnapshotCard 
      title="Post-Execution" 
      icon="✓" 
      onGoTo={() => onNavigate('post-execution')}
      status="normal"
    >
      <div className="dash-snapshot-stats">
        <div className="dash-stat">
          <span className={`dash-stat-value dash-stat-value--success`}>
            {data.status === 'completed' ? 'COMPLETE' : data.status === 'pending' ? 'PENDING' : 'REVIEW'}
          </span>
          <span className="dash-stat-label">Last Run</span>
        </div>
        <div className="dash-stat">
          <span className={`dash-stat-value ${data.poaeReady ? 'dash-stat-value--success' : ''}`}>
            {data.poaeReady ? 'ACTIVE' : 'PENDING'}
          </span>
          <span className="dash-stat-label">PoAE™</span>
        </div>
        <div className="dash-stat">
          <span className="dash-stat-value dash-stat-value--success">
            {data.verificationComplete ? 'YES' : 'IN PROGRESS'}
          </span>
          <span className="dash-stat-label">Verified</span>
        </div>
      </div>
    </SnapshotCard>
  )
}

// =============================================================================
// Main Dashboard Component
// =============================================================================

export default function DashboardHome({ onNavigate }: DashboardHomeProps) {
  const [showAllEvents, setShowAllEvents] = useState(false)
  
  // Get mock dashboard state (deterministic)
  const dashboardState = getMockDashboardState()
  
  // Modal state for event analysis
  const [isAnalysisModalOpen, setIsAnalysisModalOpen] = useState(false)
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  
  const handleAnalyse = (eventId: string) => {
    console.log('[Dashboard] Analysing event:', eventId)
    setSelectedEventId(eventId)
    setIsAnalysisModalOpen(true)
  }
  
  const selectedEvent = mockSystemEvents.find(e => e.id === selectedEventId)

  // Compute KPI data for hero strip
  const pendingActions = 
    dashboardState.preExecution.pendingConsents + 
    dashboardState.liveExecution.unresolvedConsents

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

  return (
    <div className="dash-container">
      {/* System Overview - KPI Strip (FIRST) */}
      <HeroKPIStrip kpis={kpis} title="System Overview" />
      
      {/* Latest System Event Hero (with embedded actions) */}
      <SystemEventHero 
        showAllEvents={showAllEvents}
        onToggleShowAll={() => setShowAllEvents(!showAllEvents)}
        onAnalyse={handleAnalyse}
        onNavigate={onNavigate}
      />

      {/* Context Snapshots - Quick Navigation */}
      <section className="dash-section">
        <h3 className="dash-section-title">Quick Navigation</h3>
        <div className="dash-snapshots">
          <PreExecutionSnapshot 
            data={dashboardState.preExecution} 
            onNavigate={onNavigate} 
          />
          <LiveExecutionSnapshotCard 
            data={dashboardState.liveExecution} 
            onNavigate={onNavigate} 
          />
          <PostExecutionSnapshotCard 
            data={dashboardState.postExecution} 
            onNavigate={onNavigate} 
          />
        </div>
      </section>
      
      {/* Event Analysis Modal */}
      <EventAnalysisModal 
        isOpen={isAnalysisModalOpen}
        onClose={() => setIsAnalysisModalOpen(false)}
        event={selectedEvent}
        onApprove={() => {
          console.log('[Dashboard] Approving event:', selectedEventId)
          setIsAnalysisModalOpen(false)
        }}
      />
    </div>
  )
}

