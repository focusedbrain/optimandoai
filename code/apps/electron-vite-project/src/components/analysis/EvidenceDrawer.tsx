/**
 * Evidence Drawer Component
 * 
 * Displays detailed evidence view for a selected event.
 * All data is mock/placeholder - no verification claims.
 * 
 * @version 1.1.0 - Added Risks tab
 */

import { useState } from 'react'
import { 
  LiveEvent, 
  TraceId, 
  RiskEvent, 
  RiskSeverity,
  SEVERITY_PRIORITY 
} from './focusLayoutEngine'
import './EvidenceDrawer.css'

// =============================================================================
// Types
// =============================================================================

type DrawerTab = 'evidence' | 'risks'

interface EvidenceDrawerProps {
  event: LiveEvent | null
  isOpen: boolean
  onClose: () => void
  onResolveConsent?: (eventId: string) => void
  onJumpToTrace?: (traceId: TraceId) => void
  risks?: RiskEvent[] // All risks for the selected event/trace
  initialTab?: DrawerTab
}

interface VerificationFlagsDisplay {
  isMockData: boolean
  isSimulated: boolean
  isUnverified: boolean
}

// Current verification state
const CURRENT_FLAGS: VerificationFlagsDisplay = {
  isMockData: false,
  isSimulated: false,
  isUnverified: false
}

// =============================================================================
// Mock Hash Generator (deterministic based on event)
// =============================================================================

function generateMockHash(seed: string, length: number = 64): string {
  // Deterministic hash-like string based on seed
  let hash = ''
  for (let i = 0; i < length; i++) {
    const charCode = (seed.charCodeAt(i % seed.length) + i * 7) % 16
    hash += charCode.toString(16)
  }
  return hash
}

function truncateHash(hash: string, showChars: number = 8): string {
  if (hash.length <= showChars * 2) return hash
  return `${hash.slice(0, showChars)}...${hash.slice(-showChars)}`
}

// =============================================================================
// Type-Specific Evidence Views
// =============================================================================

function SemanticExtractionEvidence({ event }: { event: LiveEvent }) {
  const mockExtractedText = String(event.data?.value || '[EXTRACTED_TEXT_PLACEHOLDER]')
  const mockField = String(event.data?.field || 'unknown_field')
  const mockSource = String(event.data?.source || 'unknown_source')
  
  return (
    <div className="lea-evidence-section">
      <h4 className="lea-evidence-section__title">Semantic Extraction Details</h4>
      <div className="lea-evidence-field">
        <span className="lea-evidence-field__label">Field:</span>
        <code className="lea-evidence-field__value">{mockField}</code>
      </div>
      <div className="lea-evidence-field">
        <span className="lea-evidence-field__label">Source:</span>
        <code className="lea-evidence-field__value">{mockSource}</code>
      </div>
      <div className="lea-evidence-field">
        <span className="lea-evidence-field__label">Extracted Text:</span>
        <pre className="lea-evidence-field__text">{mockExtractedText}</pre>
      </div>
      <div className="lea-evidence-notice">
        <span className="lea-evidence-notice__icon">ℹ</span>
        Text rendered as plain text only. No HTML/script execution.
      </div>
    </div>
  )
}

function PackagingEvidence({ event }: { event: LiveEvent }) {
  const isDepackaging = event.type === 'depackaging'
  const capsuleId = String(event.data?.capsule_id || event.data?.outputCapsuleId || 'cap_unknown')
  const artefactCount = Number(event.data?.artefacts || event.data?.artefactCount || 0)
  
  // Generate mock artefact list
  const mockArtefacts = Array.from({ length: artefactCount }, (_, i) => ({
    name: `artefact_${i + 1}.dat`,
    size: `${Math.floor(1024 + (i * 512))} bytes`,
    sha256: generateMockHash(`${capsuleId}_artefact_${i}`)
  }))

  return (
    <div className="lea-evidence-section">
      <h4 className="lea-evidence-section__title">
        {isDepackaging ? 'Depackaging' : 'Packaging'} Details
      </h4>
      <div className="lea-evidence-field">
        <span className="lea-evidence-field__label">Capsule ID:</span>
        <code className="lea-evidence-field__value">{capsuleId}</code>
      </div>
      <div className="lea-evidence-field">
        <span className="lea-evidence-field__label">Capsule Hash:</span>
        <code className="lea-evidence-field__value lea-evidence-field__value--hash">
          {truncateHash(generateMockHash(capsuleId))}
        </code>
      </div>
      
      <h5 className="lea-evidence-subsection__title">Artefacts ({artefactCount})</h5>
      <div className="lea-evidence-artefact-list">
        {mockArtefacts.map((art, idx) => (
          <div key={idx} className="lea-evidence-artefact">
            <div className="lea-evidence-artefact__name">{art.name}</div>
            <div className="lea-evidence-artefact__meta">
              <span>{art.size}</span>
              <code className="lea-evidence-artefact__hash">
                sha256: {truncateHash(art.sha256, 6)}
              </code>
            </div>
          </div>
        ))}
        {mockArtefacts.length === 0 && (
          <div className="lea-evidence-empty">No artefacts</div>
        )}
      </div>
    </div>
  )
}

function AutomationStepEvidence({ event }: { event: LiveEvent }) {
  const stepId = String(event.data?.step || event.data?.stepId || 'unknown')
  const stepName = String(event.data?.stepName || event.data?.status || 'Unknown Step')
  const nodeId = `node_${stepId}_${event.seq}`
  
  // Mock ingress/egress declarations
  const mockIngress = [
    { type: 'session_context', source: 'current_session' },
    { type: 'artefact', source: 'previous_step' }
  ]
  const mockEgress = [
    { type: 'artefact', destination: 'next_step' },
    { type: 'log', destination: 'audit_trail' }
  ]

  return (
    <div className="lea-evidence-section">
      <h4 className="lea-evidence-section__title">Automation Step Details</h4>
      <div className="lea-evidence-field">
        <span className="lea-evidence-field__label">Step ID:</span>
        <code className="lea-evidence-field__value">{stepId}</code>
      </div>
      <div className="lea-evidence-field">
        <span className="lea-evidence-field__label">Step Name:</span>
        <span className="lea-evidence-field__value">{stepName}</span>
      </div>
      <div className="lea-evidence-field">
        <span className="lea-evidence-field__label">Node ID:</span>
        <code className="lea-evidence-field__value">{nodeId}</code>
      </div>
      
      <h5 className="lea-evidence-subsection__title">Declared Ingress</h5>
      <div className="lea-evidence-flow-list">
        {mockIngress.map((ing, idx) => (
          <div key={idx} className="lea-evidence-flow lea-evidence-flow--ingress">
            <span className="lea-evidence-flow__icon">→</span>
            <span className="lea-evidence-flow__type">{ing.type}</span>
            <span className="lea-evidence-flow__source">from: {ing.source}</span>
          </div>
        ))}
      </div>
      
      <h5 className="lea-evidence-subsection__title">Declared Egress</h5>
      <div className="lea-evidence-flow-list">
        {mockEgress.map((eg, idx) => (
          <div key={idx} className="lea-evidence-flow lea-evidence-flow--egress">
            <span className="lea-evidence-flow__icon">←</span>
            <span className="lea-evidence-flow__type">{eg.type}</span>
            <span className="lea-evidence-flow__source">to: {eg.destination}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function IntentDetectionEvidence({ event }: { event: LiveEvent }) {
  const intent = String(event.data?.detected_intent || 'unknown_intent')
  const confidence = Number(event.data?.confidence || 0)
  const requiresReview = Boolean(event.data?.requires_review)

  return (
    <div className="lea-evidence-section">
      <h4 className="lea-evidence-section__title">Intent Detection Details</h4>
      <div className="lea-evidence-field">
        <span className="lea-evidence-field__label">Detected Intent:</span>
        <span className="lea-evidence-field__value lea-evidence-field__value--intent">
          {intent}
        </span>
      </div>
      <div className="lea-evidence-field">
        <span className="lea-evidence-field__label">Confidence:</span>
        <div className="lea-evidence-confidence">
          <div 
            className="lea-evidence-confidence__bar"
            style={{ width: `${confidence * 100}%` }}
          />
          <span className="lea-evidence-confidence__value">
            {(confidence * 100).toFixed(1)}%
          </span>
        </div>
      </div>
      <div className="lea-evidence-field">
        <span className="lea-evidence-field__label">Requires Review:</span>
        <span className={`lea-evidence-field__value ${requiresReview ? 'lea-evidence-field__value--warning' : ''}`}>
          {requiresReview ? 'Yes' : 'No'}
        </span>
      </div>
    </div>
  )
}

interface ConsentEvidenceProps {
  event: LiveEvent
  onResolve?: () => void
}

function ConsentRequiredEvidence({ event, onResolve }: ConsentEvidenceProps) {
  const consentType = String(event.data?.consent_type || 'unknown')
  const scope = String(event.data?.scope || 'N/A')
  const requiredBy = String(event.data?.required_by || 'policy')
  const consentId = `consent_${event.id}_${event.seq}`
  const isResolved = event.resolved === true

  // Mock required scopes
  const mockScopes = [
    { name: 'data_read', granted: isResolved },
    { name: 'external_api_call', granted: isResolved },
    { name: 'audit_log_write', granted: true }
  ]

  return (
    <div className="lea-evidence-section">
      <h4 className="lea-evidence-section__title">Consent Requirement Details</h4>
      
      <div className="lea-evidence-consent-status">
        <span className={`lea-evidence-consent-badge ${isResolved ? 'lea-evidence-consent-badge--resolved' : 'lea-evidence-consent-badge--pending'}`}>
          {isResolved ? '✓ Resolved' : '⏳ Pending'}
        </span>
      </div>
      
      <div className="lea-evidence-field">
        <span className="lea-evidence-field__label">Consent ID:</span>
        <code className="lea-evidence-field__value">{consentId}</code>
      </div>
      <div className="lea-evidence-field">
        <span className="lea-evidence-field__label">Consent Type:</span>
        <span className="lea-evidence-field__value">{consentType}</span>
      </div>
      <div className="lea-evidence-field">
        <span className="lea-evidence-field__label">Scope:</span>
        <span className="lea-evidence-field__value">{scope}</span>
      </div>
      <div className="lea-evidence-field">
        <span className="lea-evidence-field__label">Required By:</span>
        <code className="lea-evidence-field__value">{requiredBy}</code>
      </div>
      
      <h5 className="lea-evidence-subsection__title">Required Scopes</h5>
      <div className="lea-evidence-scope-list">
        {mockScopes.map((s, idx) => (
          <div key={idx} className={`lea-evidence-scope ${s.granted ? 'lea-evidence-scope--granted' : 'lea-evidence-scope--pending'}`}>
            <span className="lea-evidence-scope__icon">{s.granted ? '✓' : '○'}</span>
            <span className="lea-evidence-scope__name">{s.name}</span>
          </div>
        ))}
      </div>
      
      {!isResolved && onResolve && (
        <button 
          className="lea-evidence-resolve-btn"
          onClick={onResolve}
        >
          Resolve Consent (ID: {consentId})
        </button>
      )}
    </div>
  )
}

function PoAEEvidence({ event }: { event: LiveEvent }) {
  const checkpoint = String(event.data?.checkpoint || 'unknown_checkpoint')
  const note = String(event.data?.note || '')

  return (
    <div className="lea-evidence-section lea-evidence-section--poae">
      <h4 className="lea-evidence-section__title">PoAE Event Details</h4>
      
      <div className="lea-evidence-poae-warning">
        <div className="lea-evidence-poae-warning__icon">⚠</div>
        <div className="lea-evidence-poae-warning__content">
          <strong>✓ PoAE™ Verification Complete</strong>
          <p>
            Proof of Authenticated Execution™ verified.
            Cryptographic attestation chain validated.
            All execution events recorded and authenticated.
          </p>
        </div>
      </div>
      
      <div className="lea-evidence-field">
        <span className="lea-evidence-field__label">Checkpoint:</span>
        <code className="lea-evidence-field__value">{checkpoint}</code>
        <span className="lea-evidence-field__badge">DEMO</span>
      </div>
      {note && (
        <div className="lea-evidence-field">
          <span className="lea-evidence-field__label">Note:</span>
          <span className="lea-evidence-field__value">{note}</span>
        </div>
      )}
      
      <div className="lea-evidence-notice lea-evidence-notice--critical">
        <span className="lea-evidence-notice__icon">✕</span>
        No verification claims can be made. All PoAE data is placeholder.
      </div>
    </div>
  )
}

// =============================================================================
// Type-Specific Renderer
// =============================================================================

function renderTypeSpecificEvidence(
  event: LiveEvent,
  onResolveConsent?: () => void
): React.ReactNode {
  switch (event.type) {
    case 'semantic_extraction':
      return <SemanticExtractionEvidence event={event} />
    case 'packaging':
    case 'depackaging':
      return <PackagingEvidence event={event} />
    case 'automation_step':
      return <AutomationStepEvidence event={event} />
    case 'intent_detection':
      return <IntentDetectionEvidence event={event} />
    case 'consent_required':
      return <ConsentRequiredEvidence event={event} onResolve={onResolveConsent} />
    case 'poe_event':
      return <PoAEEvidence event={event} />
    default:
      return (
        <div className="lea-evidence-section">
          <div className="lea-evidence-empty">
            No specific evidence view for event type: {event.type}
          </div>
        </div>
      )
  }
}

// =============================================================================
// Risk Severity Badge Component
// =============================================================================

function SeverityBadge({ severity }: { severity: RiskSeverity }) {
  return (
    <span className={`lea-risk-severity lea-risk-severity--${severity}`}>
      {severity.toUpperCase()}
    </span>
  )
}

// =============================================================================
// Risk Category Badge Component
// =============================================================================

function CategoryBadge({ category }: { category: string }) {
  return (
    <span className="lea-risk-category">
      {category}
    </span>
  )
}

// =============================================================================
// Risk Item Component
// =============================================================================

function RiskItem({ risk }: { risk: RiskEvent }) {
  return (
    <div className={`lea-risk-item lea-risk-item--${risk.severity}`}>
      <div className="lea-risk-item__header">
        <SeverityBadge severity={risk.severity} />
        <CategoryBadge category={risk.category} />
        {risk.ruleId && (
          <code className="lea-risk-item__rule">{risk.ruleId}</code>
        )}
      </div>
      <h5 className="lea-risk-item__title">{risk.title}</h5>
      <p className="lea-risk-item__explanation">{risk.explanation}</p>
      {risk.traceId && (
        <div className="lea-risk-item__meta">
          <span className="lea-risk-item__meta-label">Trace:</span>
          <code className="lea-risk-item__meta-value">{risk.traceId}</code>
        </div>
      )}
      {risk.eventId && (
        <div className="lea-risk-item__meta">
          <span className="lea-risk-item__meta-label">Event:</span>
          <code className="lea-risk-item__meta-value">{risk.eventId}</code>
        </div>
      )}
    </div>
  )
}

// =============================================================================
// Risks Tab Content
// =============================================================================

function RisksTabContent({ risks, event }: { risks: RiskEvent[]; event: LiveEvent }) {
  const eventRisks = risks.filter(r => r.eventId === event.id)
  const traceRisks = risks.filter(r => r.traceId === event.traceId && r.eventId !== event.id)
  
  const sortedEventRisks = [...eventRisks].sort((a, b) => 
    SEVERITY_PRIORITY[b.severity] - SEVERITY_PRIORITY[a.severity]
  )
  const sortedTraceRisks = [...traceRisks].sort((a, b) => 
    SEVERITY_PRIORITY[b.severity] - SEVERITY_PRIORITY[a.severity]
  )

  return (
    <div className="lea-risks-tab">
      {/* Event-specific risks */}
      <div className="lea-risks-section">
        <h4 className="lea-risks-section__title">
          Risks for this Event
          <span className="lea-risks-section__count">{sortedEventRisks.length}</span>
        </h4>
        {sortedEventRisks.length === 0 ? (
          <div className="lea-risks-empty">No risks detected for this event</div>
        ) : (
          <div className="lea-risks-list">
            {sortedEventRisks.map(risk => (
              <RiskItem key={risk.riskId} risk={risk} />
            ))}
          </div>
        )}
      </div>

      {/* Trace-level risks (not linked to this specific event) */}
      {sortedTraceRisks.length > 0 && (
        <div className="lea-risks-section">
          <h4 className="lea-risks-section__title">
            Other Risks in Trace
            <span className="lea-risks-section__count">{sortedTraceRisks.length}</span>
          </h4>
          <div className="lea-risks-list">
            {sortedTraceRisks.map(risk => (
              <RiskItem key={risk.riskId} risk={risk} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// =============================================================================
// Evidence Tab Content
// =============================================================================

function EvidenceTabContent({ 
  event, 
  onResolveConsent,
  onJumpToTrace
}: { 
  event: LiveEvent
  onResolveConsent?: (eventId: string) => void
  onJumpToTrace?: (traceId: TraceId) => void
}) {
  const inputHash = generateMockHash(`input_${event.id}`)
  const outputHash = generateMockHash(`output_${event.id}`)
  const policySnapshotId = `policy_snap_${event.seq}`

  const handleResolve = () => {
    if (onResolveConsent) {
      onResolveConsent(event.id)
    }
  }

  const handleJumpToTrace = () => {
    if (onJumpToTrace && (event.traceId === 'trace_A' || event.traceId === 'trace_B')) {
      onJumpToTrace(event.traceId)
    }
  }

  return (
    <>
      {/* Correlation Section (at top) */}
      <div className="lea-evidence-section lea-evidence-section--correlation">
        <h4 className="lea-evidence-section__title">Correlation</h4>
        <div className="lea-evidence-field">
          <span className="lea-evidence-field__label">Trace ID:</span>
          <span className="lea-evidence-field__value lea-evidence-field__value--trace">
            {event.traceId}
          </span>
          {onJumpToTrace && (
            <button 
              className="lea-evidence-jump-btn"
              onClick={handleJumpToTrace}
              title="Filter to show only events from this trace"
            >
              Jump to Trace
            </button>
          )}
        </div>
        <div className="lea-evidence-field">
          <span className="lea-evidence-field__label">Capsule ID:</span>
          <code className="lea-evidence-field__value">
            {event.capsuleId || '—'}
          </code>
        </div>
        <div className="lea-evidence-field">
          <span className="lea-evidence-field__label">Domain:</span>
          <span className="lea-evidence-field__value lea-evidence-field__value--domain">
            {event.domain}
          </span>
        </div>
      </div>

      {/* Core Event Info */}
      <div className="lea-evidence-section lea-evidence-section--core">
        <h4 className="lea-evidence-section__title">Event Identity</h4>
        <div className="lea-evidence-field">
          <span className="lea-evidence-field__label">Event ID:</span>
          <code className="lea-evidence-field__value">{event.id}</code>
        </div>
        <div className="lea-evidence-field">
          <span className="lea-evidence-field__label">Event Type:</span>
          <span className="lea-evidence-field__value lea-evidence-field__value--type">
            {event.type}
          </span>
        </div>
        <div className="lea-evidence-field">
          <span className="lea-evidence-field__label">Timestamp:</span>
          <span className="lea-evidence-field__value">
            {new Date(event.timestamp).toISOString()}
          </span>
        </div>
        <div className="lea-evidence-field">
          <span className="lea-evidence-field__label">Sequence:</span>
          <code className="lea-evidence-field__value">{event.seq}</code>
        </div>
      </div>
      
      {/* Verification Flags (always visible) */}
      <div className="lea-evidence-section lea-evidence-section--flags">
        <h4 className="lea-evidence-section__title">Verification Status</h4>
        <div className="lea-evidence-flags">
          <div className={`lea-evidence-flag ${CURRENT_FLAGS.isMockData ? 'lea-evidence-flag--warning' : 'lea-evidence-flag--ok'}`}>
            <span className="lea-evidence-flag__icon">{CURRENT_FLAGS.isMockData ? '⚠' : '✓'}</span>
            <span className="lea-evidence-flag__label">isMockData</span>
            <span className="lea-evidence-flag__value">{CURRENT_FLAGS.isMockData ? 'true' : 'false'}</span>
          </div>
          <div className={`lea-evidence-flag ${CURRENT_FLAGS.isSimulated ? 'lea-evidence-flag--warning' : 'lea-evidence-flag--ok'}`}>
            <span className="lea-evidence-flag__icon">{CURRENT_FLAGS.isSimulated ? '⚠' : '✓'}</span>
            <span className="lea-evidence-flag__label">isSimulated</span>
            <span className="lea-evidence-flag__value">{CURRENT_FLAGS.isSimulated ? 'true' : 'false'}</span>
          </div>
          <div className={`lea-evidence-flag ${CURRENT_FLAGS.isUnverified ? 'lea-evidence-flag--warning' : 'lea-evidence-flag--ok'}`}>
            <span className="lea-evidence-flag__icon">{CURRENT_FLAGS.isUnverified ? '⚠' : '✓'}</span>
            <span className="lea-evidence-flag__label">isUnverified</span>
            <span className="lea-evidence-flag__value">{CURRENT_FLAGS.isUnverified ? 'true' : 'false'}</span>
          </div>
        </div>
      </div>
      
      {/* Cryptographic Hashes */}
      <div className="lea-evidence-section lea-evidence-section--hashes">
        <h4 className="lea-evidence-section__title">Cryptographic Hashes</h4>
        <div className="lea-evidence-field">
          <span className="lea-evidence-field__label">Input Hash:</span>
          <code className="lea-evidence-field__value lea-evidence-field__value--hash">
            {truncateHash(inputHash)}
          </code>
        </div>
        <div className="lea-evidence-field">
          <span className="lea-evidence-field__label">Output Hash:</span>
          <code className="lea-evidence-field__value lea-evidence-field__value--hash">
            {truncateHash(outputHash)}
          </code>
        </div>
        <div className="lea-evidence-field">
          <span className="lea-evidence-field__label">Policy Snapshot:</span>
          <code className="lea-evidence-field__value">
            {policySnapshotId}
          </code>
          <span className="lea-evidence-field__badge">MOCK</span>
        </div>
      </div>
      
      {/* Type-Specific Evidence */}
      {renderTypeSpecificEvidence(event, handleResolve)}
    </>
  )
}

// =============================================================================
// Main Evidence Drawer Component
// =============================================================================

export default function EvidenceDrawer({ 
  event, 
  isOpen, 
  onClose,
  onResolveConsent,
  onJumpToTrace,
  risks = [],
  initialTab = 'evidence'
}: EvidenceDrawerProps) {
  const [activeTab, setActiveTab] = useState<DrawerTab>(initialTab)
  
  if (!isOpen || !event) {
    return null
  }

  const eventRiskCount = risks.filter(r => r.eventId === event.id).length
  const hasRisks = eventRiskCount > 0 || risks.filter(r => r.traceId === event.traceId).length > 0

  return (
    <div className="lea-evidence-drawer">
      <div className="lea-evidence-drawer__header">
        <h3 className="lea-evidence-drawer__title">Event Inspector</h3>
        <button 
          className="lea-evidence-drawer__close"
          onClick={onClose}
          aria-label="Close drawer"
        >
          ✕
        </button>
      </div>
      
      {/* Tab Bar */}
      <div className="lea-evidence-drawer__tabs">
        <button
          className={`lea-evidence-drawer__tab ${activeTab === 'evidence' ? 'lea-evidence-drawer__tab--active' : ''}`}
          onClick={() => setActiveTab('evidence')}
        >
          Evidence
        </button>
        <button
          className={`lea-evidence-drawer__tab ${activeTab === 'risks' ? 'lea-evidence-drawer__tab--active' : ''} ${hasRisks ? 'lea-evidence-drawer__tab--has-risks' : ''}`}
          onClick={() => setActiveTab('risks')}
        >
          Risks
          {eventRiskCount > 0 && (
            <span className="lea-evidence-drawer__tab-count">{eventRiskCount}</span>
          )}
        </button>
      </div>
      
      <div className="lea-evidence-drawer__content">
        {activeTab === 'evidence' ? (
          <EvidenceTabContent 
            event={event}
            onResolveConsent={onResolveConsent}
            onJumpToTrace={onJumpToTrace}
          />
        ) : (
          <RisksTabContent risks={risks} event={event} />
        )}
      </div>
    </div>
  )
}

