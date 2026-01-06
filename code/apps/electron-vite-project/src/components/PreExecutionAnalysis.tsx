import { useState, useEffect } from 'react'
import './PreExecutionAnalysis.css'
import { VerificationFlags, DEFAULT_VERIFICATION_FLAGS, canClaimVerified, type DrawerTabId, ReadinessGauge, QuickActionBar, type QuickAction } from './analysis'

/**
 * Deep-link state for pre-execution
 */
interface PreExecutionDeepLink {
  traceId?: string    // Ignored in pre-execution (safe no-op)
  eventId?: string    // Ignored in pre-execution (safe no-op)
  drawerTab?: DrawerTabId
  ruleId?: string
}

interface PreExecutionAnalysisProps {
  flags?: VerificationFlags
  deepLink?: PreExecutionDeepLink
  onDeepLinkConsumed?: () => void
}

// =============================================================================
// Mock Awaiting Approvals Data
// =============================================================================

interface AwaitingApproval {
  id: string
  type: 'consent' | 'policy-review' | 'manager-approval' | 'external-access'
  title: string
  description: string
  templateName: string
  requestedAt: string
  status: 'pending' | 'approved' | 'review'
  priority: 'high' | 'normal' | 'low'
}

// Pre-Execution Workflow Analysis (same structure as Post-Execution, but pending consent)
const mockPreExecutionWorkflow = {
  sender: {
    organization: 'Acme Corp',
    user: 'john.smith@acme.corp',
    authorization: {
      poaeId: 'poae_sender_auth_001',
      timestamp: '2026-01-06T10:11:00.000Z',
      action: 'WORKFLOW_INITIATED',
      hash: 'sha256:sender_init_a1b2c3d4e5f6',
      status: 'verified'
    },
    packaging: {
      beapId: 'beap_pkg_001',
      timestamp: '2026-01-06T10:11:30.000Z',
      capsuleId: 'cap_8a7b6c5d4e3f',
      artefacts: [
        { name: 'invoice_2026_001.pdf', type: 'PDF', size: '8.2KB', hash: 'sha256:1a2b3c4d5e6f7a8b' },
        { name: 'attachment_001.png', type: 'PNG', size: '4.1KB', hash: 'sha256:3c4d5e6f7a8b9c0d' }
      ]
    }
  },
  automationSteps: [
    { id: 1, name: 'Capsule Depackaging', status: 'pending', duration: '--', hash: '--' },
    { id: 2, name: 'Artefact Extraction', status: 'pending', duration: '--', hash: '--' },
    { id: 3, name: 'OCR Processing', status: 'pending', duration: '--', hash: '--' },
    { id: 4, name: 'Validation', status: 'pending', duration: '--', hash: '--' },
    { id: 5, name: 'External API Call', status: 'pending', duration: '--', hash: '--' },
    { id: 6, name: 'Result Packaging', status: 'pending', duration: '--', hash: '--' }
  ],
  receiver: {
    organization: 'Partner Inc',
    user: 'jane.doe@partner.inc',
    authorization: {
      poaeId: 'poae_receiver_pending',
      timestamp: '--',
      action: 'AWAITING_CONSENT',
      hash: '--',
      status: 'pending'
    },
    unpackaging: {
      beapId: '--',
      timestamp: '--',
      capsuleId: '--',
      artefacts: []
    }
  },
  automationTemplate: {
    id: 'tpl_7f3a9b2c1d4e5f6a',
    name: 'Invoice Processing Workflow',
    version: '2.1.0',
    steps: [
      'capsule_depackage',
      'extract_artefacts',
      'run_ocr',
      'validate_schema',
      'external_api_call',
      'package_results'
    ],
    policies: [
      'policy:data-processing-allowed',
      'policy:external-api-allowed'
    ]
  }
}

const mockAwaitingApprovals: AwaitingApproval[] = [
  {
    id: 'approval_001',
    type: 'external-access',
    title: 'External API Access Request',
    description: 'Vendor lookup API requires authorization before execution can proceed',
    templateName: 'Invoice Processing Workflow v2.1.0',
    requestedAt: '2026-01-06T10:12:00.000Z',
    status: 'pending',
    priority: 'high'
  },
  {
    id: 'approval_002',
    type: 'manager-approval',
    title: 'High-Value Transaction Review',
    description: 'Invoice amount exceeds $10,000 threshold - manager sign-off required',
    templateName: 'Invoice Processing Workflow v2.1.0',
    requestedAt: '2026-01-06T10:11:30.000Z',
    status: 'pending',
    priority: 'high'
  },
  {
    id: 'approval_003',
    type: 'consent',
    title: 'Data Processing Consent',
    description: 'Customer data processing consent confirmation',
    templateName: 'Document Classification v1.3.0',
    requestedAt: '2026-01-06T09:45:00.000Z',
    status: 'approved',
    priority: 'normal'
  },
  {
    id: 'approval_004',
    type: 'policy-review',
    title: 'AI Model Usage Review',
    description: 'OCR model deployment requires policy compliance verification',
    templateName: 'Email Extraction Pipeline v1.0.0',
    requestedAt: '2026-01-06T09:30:00.000Z',
    status: 'approved',
    priority: 'normal'
  }
]

// =============================================================================
// Mock Data - Static, no backend calls
// =============================================================================

const mockTemplateData = {
  id: 'tpl_7f3a9b2c1d4e5f6a',
  name: 'Invoice Processing Workflow',
  version: '2.1.0',
  author: 'publisher:acme-corp',
  created: '2026-01-03T14:22:31Z',
  hash: 'sha256:a1b2c3d4e5f6...',
  signature: 'Valid (acme-corp.pub)',
  status: 'verified' as const
}

const mockSessionData = {
  id: 'session_9e8d7c6b5a4f',
  capsuleCount: 2,
  contextKeys: ['invoice_data', 'vendor_info', 'approval_rules'],
  importedAt: '2026-01-06T10:12:45Z'
}

const mockAutomationSteps = [
  { id: 1, name: 'Session Import', type: 'internal', status: 'declared' },
  { id: 2, name: 'Capsule Depackaging', type: 'internal', status: 'declared' },
  { id: 3, name: 'Artefact Extraction', type: 'internal', status: 'declared' },
  { id: 4, name: 'OCR Processing', type: 'ai', status: 'declared' },
  { id: 5, name: 'Validation', type: 'deterministic', status: 'declared' },
  { id: 6, name: 'External API Call', type: 'external', status: 'declared' },
  { id: 7, name: 'Capsule Packaging', type: 'internal', status: 'declared' }
]

const mockConsentRequirements = [
  { id: 1, type: 'Policy Gate', requirement: 'policy:data-processing-allowed', status: 'passed' },
  { id: 2, type: 'Policy Gate', requirement: 'policy:external-api-allowed', status: 'passed' },
  { id: 3, type: 'Human Approval', requirement: 'Manager sign-off (amounts > $10,000)', status: 'passed' },
  { id: 4, type: 'Receiver Consent', requirement: 'Recipient notification opt-in', status: 'passed' }
]

const mockRiskSummary = {
  overallScore: 92,
  level: 'low' as const,
  categories: [
    { name: 'Documentation Alignment', score: 95, issues: 0 },
    { name: 'Consent Coverage', score: 100, issues: 0 },
    { name: 'Ingress/Egress Paths', score: 88, issues: 0 },
    { name: 'AI Involvement', score: 90, issues: 0 }
  ],
  blockingIssues: 0,
  warnings: 0
}

// Mock preflight alignment rows (similar to live mode)
interface PreflightAlignmentRow {
  key: string
  claimLabel: string
  claimedValue: string
  observedValue: string
  status: 'match' | 'mismatch' | 'unknown'
  linkedRuleIds: string[]
}

const mockPreflightAlignment: PreflightAlignmentRow[] = [
  {
    key: 'readme.noExternalEgress',
    claimLabel: 'External API Declared',
    claimedValue: 'true',
    observedValue: 'External API configured',
    status: 'match',
    linkedRuleIds: []
  },
  {
    key: 'readme.deterministicOnly',
    claimLabel: 'AI Components Declared',
    claimedValue: 'OCR Processing',
    observedValue: 'OCR Processing (declared)',
    status: 'match',
    linkedRuleIds: []
  },
  {
    key: 'template.declaredSteps',
    claimLabel: 'All Steps Declared',
    claimedValue: '7 steps',
    observedValue: '7 declared',
    status: 'match',
    linkedRuleIds: []
  },
  {
    key: 'consent.policyGates',
    claimLabel: 'Policy Gates Satisfied',
    claimedValue: 'All passed',
    observedValue: 'All passed',
    status: 'match',
    linkedRuleIds: []
  },
  {
    key: 'signature.valid',
    claimLabel: 'Template Signature',
    claimedValue: 'Verified',
    observedValue: 'Valid (acme-corp.pub)',
    status: 'match',
    linkedRuleIds: []
  }
]

// Mock preflight risk rules
interface PreflightRiskRule {
  ruleId: string
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical'
  category: string
  title: string
  explanation: string
  alignmentKey: string
}

const mockPreflightRisks: PreflightRiskRule[] = [
  {
    ruleId: 'PRE-EGRESS-001',
    severity: 'info',
    category: 'egress',
    title: 'External API Configuration',
    explanation: 'This template includes an external API integration. The API endpoint is properly declared and configured with appropriate guardrails.',
    alignmentKey: 'readme.noExternalEgress'
  },
  {
    ruleId: 'PRE-DETERMINISM-001',
    severity: 'info',
    category: 'determinism',
    title: 'AI Component Declared',
    explanation: 'This template includes AI-assisted OCR Processing. The component is properly declared and outputs are validated through the guardrail system.',
    alignmentKey: 'readme.deterministicOnly'
  },
  {
    ruleId: 'PRE-STEPS-001',
    severity: 'info',
    category: 'integrity',
    title: 'All Steps Declared',
    explanation: 'All automation steps are properly declared in the template manifest. The execution graph is fully transparent.',
    alignmentKey: 'template.declaredSteps'
  },
  {
    ruleId: 'PRE-CONSENT-001',
    severity: 'info',
    category: 'consent',
    title: 'Policy Gates Configured',
    explanation: 'All required policy gates are configured and passing. The automation operates within the defined guardrails.',
    alignmentKey: 'consent.policyGates'
  }
]

// Mock template source code with annotations
interface TemplateAnnotation {
  lineStart: number
  lineEnd: number
  type: 'ai' | 'external' | 'guardrail' | 'consent'
  label: string
  description: string
}

const mockTemplateSource = `# Invoice Processing Workflow v2.1.0
# Author: publisher:acme-corp
# Signature: Valid (acme-corp.pub)

workflow:
  name: "Invoice Processing"
  version: "2.1.0"
  
  steps:
    - id: session_import
      type: internal
      action: import_session
      
    - id: depackage
      type: internal
      action: capsule_depackage
      
    - id: extract
      type: internal
      action: artefact_extraction
      
    - id: ocr_processing
      type: ai_assisted
      action: ocr_extract
      model: "ocr-v3-standard"
      guardrails:
        - output_validation: true
        - confidence_threshold: 0.95
      
    - id: validation
      type: deterministic
      action: schema_validate
      
    - id: api_call
      type: external
      action: vendor_api_lookup
      endpoint: "api.vendor.internal"
      policy_gate: "policy:external-api-allowed"
      consent_required: false
      
    - id: package
      type: internal
      action: capsule_package

  guardrails:
    consent_mode: "pre-approved"
    policy_enforcement: "strict"
    audit_logging: "full"
`

const mockTemplateAnnotations: TemplateAnnotation[] = [
  {
    lineStart: 23,
    lineEnd: 30,
    type: 'ai',
    label: 'AI-Assisted OCR',
    description: 'This step uses AI for optical character recognition. Output validation and confidence thresholds are enforced.'
  },
  {
    lineStart: 36,
    lineEnd: 42,
    type: 'external',
    label: 'External API',
    description: 'External vendor API integration with policy gate protection. Only internal endpoints are allowed.'
  },
  {
    lineStart: 46,
    lineEnd: 49,
    type: 'guardrail',
    label: 'Guardrail Configuration',
    description: 'System-wide guardrails ensure policy compliance, consent enforcement, and full audit logging.'
  }
]

// =============================================================================
// Panel Components
// =============================================================================

function PanelHeader({ title, badge }: { title: string; badge?: string }) {
  return (
    <div className="panel-header">
      <span className="panel-title">{title}</span>
      <span className="panel-badge panel-badge--info">Analysis</span>
      {badge && <span className="panel-badge panel-badge--info">{badge}</span>}
    </div>
  )
}

function TemplateInspector() {
  return (
    <div className="panel">
      <PanelHeader title="Session / Template Inspector" />
      <div className="panel-content">
        <div className="inspector-section">
          <div className="inspector-label">Template</div>
          <div className="inspector-grid">
            <div className="inspector-row">
              <span className="inspector-key">ID</span>
              <code className="inspector-value">{mockTemplateData.id}</code>
            </div>
            <div className="inspector-row">
              <span className="inspector-key">Name</span>
              <span className="inspector-value">{mockTemplateData.name}</span>
            </div>
            <div className="inspector-row">
              <span className="inspector-key">Version</span>
              <span className="inspector-value">{mockTemplateData.version}</span>
            </div>
            <div className="inspector-row">
              <span className="inspector-key">Author</span>
              <code className="inspector-value">{mockTemplateData.author}</code>
            </div>
            <div className="inspector-row">
              <span className="inspector-key">Hash</span>
              <code className="inspector-value inspector-value--mono">{mockTemplateData.hash}</code>
            </div>
            <div className="inspector-row">
              <span className="inspector-key">Signature</span>
              <span className="inspector-value">
                <span className="status-indicator status-indicator--verified">✓</span>
                {mockTemplateData.signature}
              </span>
            </div>
          </div>
        </div>
        <div className="inspector-divider" />
        <div className="inspector-section">
          <div className="inspector-label">Session Context</div>
          <div className="inspector-grid">
            <div className="inspector-row">
              <span className="inspector-key">Session ID</span>
              <code className="inspector-value">{mockSessionData.id}</code>
            </div>
            <div className="inspector-row">
              <span className="inspector-key">Capsules</span>
              <span className="inspector-value">{mockSessionData.capsuleCount}</span>
            </div>
            <div className="inspector-row">
              <span className="inspector-key">Context Keys</span>
              <span className="inspector-value">
                {mockSessionData.contextKeys.map(k => (
                  <code key={k} className="inspector-tag">{k}</code>
                ))}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function AutomationOverview() {
  return (
    <div className="panel">
      <PanelHeader title="Automation Overview" badge="Static Graph" />
      <div className="panel-content">
        <div className="automation-graph">
          {mockAutomationSteps.map((step, index) => (
            <div key={step.id} className="automation-step-wrapper">
              <div className={`automation-step automation-step--${step.type} ${step.status === 'undeclared' ? 'automation-step--undeclared' : ''}`}>
                <div className="automation-step__number">{step.id}</div>
                <div className="automation-step__content">
                  <div className="automation-step__name">{step.name}</div>
                  <div className="automation-step__type">{step.type}</div>
                </div>
                {step.status === 'undeclared' && (
                  <div className="automation-step__warning">⚠ Undeclared</div>
                )}
              </div>
              {index < mockAutomationSteps.length - 1 && (
                <div className="automation-connector">↓</div>
              )}
            </div>
          ))}
        </div>
        <div className="automation-legend">
          <div className="legend-item">
            <span className="legend-dot legend-dot--internal" /> Internal
          </div>
          <div className="legend-item">
            <span className="legend-dot legend-dot--deterministic" /> Deterministic
          </div>
          <div className="legend-item">
            <span className="legend-dot legend-dot--ai" /> AI-Assisted
          </div>
          <div className="legend-item">
            <span className="legend-dot legend-dot--external" /> External
          </div>
        </div>
      </div>
    </div>
  )
}

function TemplateSourceViewer() {
  const lines = mockTemplateSource.split('\n')
  
  const getLineAnnotation = (lineNum: number): TemplateAnnotation | null => {
    return mockTemplateAnnotations.find(
      a => lineNum >= a.lineStart && lineNum <= a.lineEnd
    ) || null
  }
  
  const getAnnotationClass = (type: TemplateAnnotation['type']): string => {
    switch (type) {
      case 'ai': return 'template-line--ai'
      case 'external': return 'template-line--external'
      case 'guardrail': return 'template-line--guardrail'
      case 'consent': return 'template-line--consent'
      default: return ''
    }
  }
  
  return (
    <div className="panel template-source-panel">
      <PanelHeader title="Template Source" badge="Annotated" />
      <div className="panel-content">
        <div className="template-source">
          <div className="template-annotations-legend">
            <span className="annotation-legend-item annotation-legend-item--ai">AI Component</span>
            <span className="annotation-legend-item annotation-legend-item--external">External Integration</span>
            <span className="annotation-legend-item annotation-legend-item--guardrail">Guardrail</span>
          </div>
          <div className="template-code">
            {lines.map((line, idx) => {
              const lineNum = idx + 1
              const annotation = getLineAnnotation(lineNum)
              return (
                <div 
                  key={lineNum}
                  className={`template-line ${annotation ? getAnnotationClass(annotation.type) : ''}`}
                >
                  <span className="template-line__num">{lineNum}</span>
                  <span className="template-line__content">{line || ' '}</span>
                  {annotation && lineNum === annotation.lineStart && (
                    <span className="template-line__annotation" title={annotation.description}>
                      {annotation.label}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
        <div className="template-info">
          <div className="template-info__item">
            <span className="template-info__label">Total Lines</span>
            <span className="template-info__value">{lines.length}</span>
          </div>
          <div className="template-info__item">
            <span className="template-info__label">Annotations</span>
            <span className="template-info__value">{mockTemplateAnnotations.length}</span>
          </div>
          <div className="template-info__item">
            <span className="template-info__label">Status</span>
            <span className="template-info__value template-info__value--success">✓ Validated</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function ConsentRequirements() {
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'passed':
        return <span className="consent-status consent-status--passed">✓ Passed</span>
      case 'failed':
        return <span className="consent-status consent-status--failed">✗ Failed</span>
      case 'pending':
        return <span className="consent-status consent-status--pending">⏳ Pending</span>
      default:
        return null
    }
  }

  return (
    <div className="panel">
      <PanelHeader title="Consent Requirements" />
      <div className="panel-content">
        <table className="consent-table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Requirement</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {mockConsentRequirements.map((req) => (
              <tr key={req.id} className={req.status === 'failed' ? 'consent-row--failed' : ''}>
                <td className="consent-type">{req.type}</td>
                <td className="consent-requirement">
                  <code>{req.requirement}</code>
                </td>
                <td>{getStatusBadge(req.status)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function RiskSummary() {
  const getLevelColor = (level: string) => {
    switch (level) {
      case 'high': return 'risk-level--high'
      case 'medium': return 'risk-level--medium'
      case 'low': return 'risk-level--low'
      default: return ''
    }
  }

  return (
    <div className="panel">
      <PanelHeader title="Risk Summary" />
      <div className="panel-content">
        <div className="risk-score-card">
          <div className="risk-score-header">
            <span className="risk-score-label">Overall Risk Level</span>
            <span className={`risk-score-level ${getLevelColor(mockRiskSummary.level)}`}>
              {mockRiskSummary.level.toUpperCase()}
            </span>
          </div>
          <div className="risk-score-bar">
            <div 
              className="risk-score-bar__fill" 
              style={{ width: `${mockRiskSummary.overallScore}%` }}
            />
          </div>
          <div className="risk-score-value">{mockRiskSummary.overallScore}/100</div>
          <div className="risk-score-counts">
            <span className="risk-count risk-count--blocking">
              {mockRiskSummary.blockingIssues} Blocking
            </span>
            <span className="risk-count risk-count--warning">
              {mockRiskSummary.warnings} Warnings
            </span>
          </div>
        </div>
        <div className="risk-categories">
          {mockRiskSummary.categories.map((cat) => (
            <div key={cat.name} className="risk-category">
              <div className="risk-category__header">
                <span className="risk-category__name">{cat.name}</span>
                <span className="risk-category__score">{cat.score}/100</span>
              </div>
              <div className="risk-category__bar">
                <div 
                  className="risk-category__bar-fill" 
                  style={{ width: `${cat.score}%` }}
                />
              </div>
              {cat.issues > 0 && (
                <span className="risk-category__issues">{cat.issues} issue(s)</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// Preflight Alignment Panel
// =============================================================================

interface PreflightAlignmentPanelProps {
  rows: PreflightAlignmentRow[]
  highlightedRuleId: string | null
  onRowClick: (row: PreflightAlignmentRow) => void
}

function getAlignmentStatusLabel(status: PreflightAlignmentRow['status']): string {
  switch (status) {
    case 'match': return '✓ MATCH'
    case 'mismatch': return '✗ MISMATCH'
    case 'unknown': return '? UNKNOWN'
    default: return status
  }
}

function PreflightAlignmentPanel({ rows, highlightedRuleId, onRowClick }: PreflightAlignmentPanelProps) {
  const mismatchCount = rows.filter(r => r.status === 'mismatch').length
  
  const isRowHighlighted = (row: PreflightAlignmentRow): boolean => {
    if (!highlightedRuleId) return false
    return row.linkedRuleIds.includes(highlightedRuleId)
  }
  
  return (
    <div className="panel preflight-alignment-panel">
      <PanelHeader title="Claims vs Observations" badge={`${mismatchCount} mismatch`} />
      <div className="panel-content">
        <div className="preflight-alignment-table">
          <div className="preflight-alignment-header">
            <span className="preflight-alignment-cell preflight-alignment-cell--claim">Claim</span>
            <span className="preflight-alignment-cell preflight-alignment-cell--claimed">Declared</span>
            <span className="preflight-alignment-cell preflight-alignment-cell--observed">Observed</span>
            <span className="preflight-alignment-cell preflight-alignment-cell--status">Status</span>
          </div>
          <div className="preflight-alignment-body">
            {rows.map(row => {
              const isHighlighted = isRowHighlighted(row)
              return (
                <button
                  key={row.key}
                  type="button"
                  className={`preflight-alignment-row preflight-alignment-row--${row.status}${isHighlighted ? ' preflight-alignment-row--highlighted' : ''}`}
                  onClick={() => onRowClick(row)}
                  data-highlighted={isHighlighted}
                >
                  <span className="preflight-alignment-cell preflight-alignment-cell--claim">
                    {row.claimLabel}
                  </span>
                  <span className="preflight-alignment-cell preflight-alignment-cell--claimed">
                    <code>{row.claimedValue}</code>
                  </span>
                  <span className="preflight-alignment-cell preflight-alignment-cell--observed">
                    <code>{row.observedValue}</code>
                  </span>
                  <span className={`preflight-alignment-cell preflight-alignment-cell--status preflight-alignment-status--${row.status}`}>
                    {getAlignmentStatusLabel(row.status)}
                    {row.linkedRuleIds.length > 0 && (
                      <span className="preflight-alignment-risk-count">{row.linkedRuleIds.length}</span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// Preflight Risk Details Panel
// =============================================================================

interface PreflightRiskDetailsPanelProps {
  isOpen: boolean
  selectedRuleId: string | null
  risks: PreflightRiskRule[]
  onClose: () => void
}

function getSeverityBadgeClass(severity: PreflightRiskRule['severity']): string {
  return `preflight-risk-severity preflight-risk-severity--${severity}`
}

function PreflightRiskDetailsPanel({ isOpen, selectedRuleId, risks, onClose }: PreflightRiskDetailsPanelProps) {
  if (!isOpen) return null
  
  // Filter to selected rule or show all
  const displayRisks = selectedRuleId 
    ? risks.filter(r => r.ruleId === selectedRuleId)
    : risks
  
  return (
    <div className="preflight-risk-panel">
      <div className="preflight-risk-panel__header">
        <span className="preflight-risk-panel__title">Preflight Risk Details</span>
        <span className="panel-badge panel-badge--info">Analysis</span>
        <button 
          className="preflight-risk-panel__close"
          onClick={onClose}
          aria-label="Close risk details"
        >
          ✕
        </button>
      </div>
      <div className="preflight-risk-panel__content">
        {displayRisks.length === 0 ? (
          <div className="preflight-risk-panel__empty">
            No risks found{selectedRuleId ? ` for rule ${selectedRuleId}` : ''}.
          </div>
        ) : (
          displayRisks.map(risk => (
            <div key={risk.ruleId} className="preflight-risk-item">
              <div className="preflight-risk-item__header">
                <span className={getSeverityBadgeClass(risk.severity)}>
                  {risk.severity.toUpperCase()}
                </span>
                <span className="preflight-risk-item__category">{risk.category}</span>
                <code className="preflight-risk-item__ruleid">{risk.ruleId}</code>
              </div>
              <div className="preflight-risk-item__title">{risk.title}</div>
              <div className="preflight-risk-item__explanation">{risk.explanation}</div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// =============================================================================
// Deep-Link Not Found Banner
// =============================================================================

interface DeepLinkNotFoundBannerProps {
  message: string
  onDismiss: () => void
}

function DeepLinkNotFoundBanner({ message, onDismiss }: DeepLinkNotFoundBannerProps) {
  return (
    <div className="preflight-notfound-banner">
      <span className="preflight-notfound-banner__icon">⚠</span>
      <span className="preflight-notfound-banner__message">{message}</span>
      <button 
        className="preflight-notfound-banner__dismiss"
        onClick={onDismiss}
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  )
}

// =============================================================================
// Pre-Execution Workflow Analysis Modal
// =============================================================================

interface PreExecutionWorkflowModalProps {
  isOpen: boolean
  onClose: () => void
  approvalId: string
  showTemplates: boolean
  onToggleTemplates: () => void
  onApprove: () => void
}

function PreExecutionWorkflowModal({ isOpen, onClose, showTemplates, onToggleTemplates, onApprove }: PreExecutionWorkflowModalProps) {
  if (!isOpen) return null
  
  const workflow = mockPreExecutionWorkflow
  
  return (
    <div className="pre-workflow-modal-overlay" onClick={onClose}>
      <div className="pre-workflow-modal" onClick={e => e.stopPropagation()}>
        <div className="pre-workflow-modal__header">
          <h2 className="pre-workflow-modal__title">
            🔍 Pre-Execution Analysis
          </h2>
          <p className="pre-workflow-modal__subtitle">
            Review workflow before giving consent
          </p>
          <button className="pre-workflow-modal__close" onClick={onClose}>×</button>
        </div>
        
        <div className="pre-workflow-modal__content">
          {/* Sender Side - Verified */}
          <div className="pre-workflow-section pre-workflow-section--sender">
            <div className="pre-workflow-section__header">
              <span className="pre-workflow-section__icon">📤</span>
              <div className="pre-workflow-section__title-group">
                <h3 className="pre-workflow-section__title">Sender: {workflow.sender.organization}</h3>
                <span className="pre-workflow-section__user">{workflow.sender.user}</span>
              </div>
            </div>
            
            {/* Sender Authorization PoAE™ - Verified */}
            <div className="pre-workflow-poae pre-workflow-poae--verified">
              <div className="pre-workflow-poae__badge">🔐 PoAE™ Authorization</div>
              <div className="pre-workflow-poae__details">
                <div className="pre-workflow-poae__row">
                  <span className="pre-workflow-poae__label">Action:</span>
                  <span className="pre-workflow-poae__value">{workflow.sender.authorization.action}</span>
                </div>
                <div className="pre-workflow-poae__row">
                  <span className="pre-workflow-poae__label">Time:</span>
                  <span className="pre-workflow-poae__value">{new Date(workflow.sender.authorization.timestamp).toLocaleString()}</span>
                </div>
                <div className="pre-workflow-poae__row">
                  <span className="pre-workflow-poae__label">Hash:</span>
                  <code className="pre-workflow-poae__hash">{workflow.sender.authorization.hash}</code>
                </div>
              </div>
              <span className="pre-workflow-poae__status pre-workflow-poae__status--verified">✓ Verified</span>
            </div>
            
            {/* BEAP™ Packaging */}
            <div className="pre-workflow-beap">
              <div className="pre-workflow-beap__header">
                <span className="pre-workflow-beap__icon">📦</span>
                <span className="pre-workflow-beap__title">BEAP™ Package Ready</span>
                <code className="pre-workflow-beap__id">{workflow.sender.packaging.capsuleId}</code>
              </div>
              <div className="pre-workflow-beap__artefacts">
                <div className="pre-workflow-beap__artefacts-title">Artefacts (read-only)</div>
                {workflow.sender.packaging.artefacts.map((art, idx) => (
                  <div key={idx} className="pre-workflow-artefact">
                    <span className="pre-workflow-artefact__icon">📄</span>
                    <span className="pre-workflow-artefact__name">{art.name}</span>
                    <span className="pre-workflow-artefact__type">{art.type}</span>
                    <span className="pre-workflow-artefact__size">{art.size}</span>
                    <code className="pre-workflow-artefact__hash">{art.hash.slice(0, 16)}...</code>
                  </div>
                ))}
              </div>
            </div>
          </div>
          
          {/* Automation Steps - Pending */}
          <div className="pre-workflow-section pre-workflow-section--automation">
            <div className="pre-workflow-section__header">
              <span className="pre-workflow-section__icon">⚙️</span>
              <h3 className="pre-workflow-section__title">Planned Automation Steps</h3>
              <span className="pre-workflow-section__badge pre-workflow-section__badge--pending">
                Awaiting Consent
              </span>
              <button 
                className="pre-workflow-section__template-btn"
                onClick={onToggleTemplates}
              >
                {showTemplates ? '▲ Hide Template' : '▼ View Template'}
              </button>
            </div>
            
            {showTemplates && (
              <div className="pre-workflow-template">
                <div className="pre-workflow-template__header">
                  <span className="pre-workflow-template__name">{workflow.automationTemplate.name}</span>
                  <span className="pre-workflow-template__version">v{workflow.automationTemplate.version}</span>
                </div>
                <div className="pre-workflow-template__steps">
                  <div className="pre-workflow-template__label">Template Steps:</div>
                  {workflow.automationTemplate.steps.map((step, idx) => (
                    <div key={idx} className="pre-workflow-template__step">
                      <span className="pre-workflow-template__step-num">{idx + 1}</span>
                      <code className="pre-workflow-template__step-name">{step}</code>
                    </div>
                  ))}
                </div>
                <div className="pre-workflow-template__policies">
                  <div className="pre-workflow-template__label">Required Policies:</div>
                  {workflow.automationTemplate.policies.map((policy, idx) => (
                    <code key={idx} className="pre-workflow-template__policy">{policy}</code>
                  ))}
                </div>
              </div>
            )}
            
            <div className="pre-workflow-steps">
              {workflow.automationSteps.map((step, idx) => (
                <div key={step.id} className="pre-workflow-step pre-workflow-step--pending">
                  <div className="pre-workflow-step__connector">
                    <div className="pre-workflow-step__dot pre-workflow-step__dot--pending" />
                    {idx < workflow.automationSteps.length - 1 && <div className="pre-workflow-step__line" />}
                  </div>
                  <div className="pre-workflow-step__content">
                    <div className="pre-workflow-step__header">
                      <span className="pre-workflow-step__num">{step.id}</span>
                      <span className="pre-workflow-step__name">{step.name}</span>
                      <span className="pre-workflow-step__status pre-workflow-step__status--pending">○ Pending</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          
          {/* Receiver Side - Pending Consent */}
          <div className="pre-workflow-section pre-workflow-section--receiver pre-workflow-section--pending">
            <div className="pre-workflow-section__header">
              <span className="pre-workflow-section__icon">📥</span>
              <div className="pre-workflow-section__title-group">
                <h3 className="pre-workflow-section__title">Receiver: {workflow.receiver.organization}</h3>
                <span className="pre-workflow-section__user">{workflow.receiver.user}</span>
              </div>
            </div>
            
            {/* Receiver Authorization PoAE™ - PENDING */}
            <div className="pre-workflow-poae pre-workflow-poae--pending">
              <div className="pre-workflow-poae__badge">🔐 PoAE™ Authorization Required</div>
              <div className="pre-workflow-poae__details">
                <div className="pre-workflow-poae__row">
                  <span className="pre-workflow-poae__label">Action:</span>
                  <span className="pre-workflow-poae__value">{workflow.receiver.authorization.action}</span>
                </div>
                <div className="pre-workflow-poae__row">
                  <span className="pre-workflow-poae__label">Status:</span>
                  <span className="pre-workflow-poae__value pre-workflow-poae__value--pending">Waiting for your consent</span>
                </div>
              </div>
              <span className="pre-workflow-poae__status pre-workflow-poae__status--pending">○ Pending</span>
            </div>
            
            <div className="pre-workflow-consent-notice">
              <span className="pre-workflow-consent-notice__icon">ℹ</span>
              <span className="pre-workflow-consent-notice__text">
                Your consent will create a PoAE™ attestation event, enabling the automation to proceed.
              </span>
            </div>
          </div>
        </div>
        
        <div className="pre-workflow-modal__footer">
          <div className="pre-workflow-modal__summary">
            <span className="pre-workflow-modal__summary-item">
              <span className="pre-workflow-modal__summary-icon pre-workflow-modal__summary-icon--verified">✓</span>
              1 PoAE™ Verified
            </span>
            <span className="pre-workflow-modal__summary-item">
              <span className="pre-workflow-modal__summary-icon pre-workflow-modal__summary-icon--pending">○</span>
              1 PoAE™ Pending
            </span>
            <span className="pre-workflow-modal__summary-item">
              <span className="pre-workflow-modal__summary-icon pre-workflow-modal__summary-icon--pending">○</span>
              {workflow.automationSteps.length} Steps Awaiting
            </span>
          </div>
          <div className="pre-workflow-modal__actions">
            <button className="pre-workflow-modal__btn pre-workflow-modal__btn--secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="pre-workflow-modal__btn pre-workflow-modal__btn--approve" onClick={onApprove}>
              ✓ Approve & Create PoAE™
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// Awaiting Approvals Hero Section
// =============================================================================

interface AwaitingApprovalsHeroProps {
  showAll: boolean
  onToggleShowAll: () => void
  onAnalyse: (approvalId: string) => void
  onApprove: (approvalId: string) => void
}

function AwaitingApprovalsHero({ showAll, onToggleShowAll, onAnalyse, onApprove }: AwaitingApprovalsHeroProps) {
  const pendingApprovals = mockAwaitingApprovals.filter(a => a.status === 'pending')
  const latestApproval = pendingApprovals[0] || mockAwaitingApprovals[0]
  const pendingCount = pendingApprovals.length
  
  const getApprovalIcon = (type: AwaitingApproval['type']) => {
    switch (type) {
      case 'consent': return '✋'
      case 'policy-review': return '🛡️'
      case 'manager-approval': return '👤'
      case 'external-access': return '🔗'
      default: return '📋'
    }
  }
  
  const getApprovalTypeLabel = (type: AwaitingApproval['type']) => {
    switch (type) {
      case 'consent': return 'Consent Required'
      case 'policy-review': return 'Policy Review'
      case 'manager-approval': return 'Manager Approval'
      case 'external-access': return 'External Access'
      default: return 'Approval Required'
    }
  }
  
  return (
    <div className={`preflight-hero ${pendingCount > 0 ? 'preflight-hero--pending' : ''}`}>
      <div className="preflight-hero__header">
        <div className="preflight-hero__icon">{getApprovalIcon(latestApproval.type)}</div>
        <div className="preflight-hero__title-group">
          <h2 className="preflight-hero__title">Awaiting Approvals</h2>
          <p className="preflight-hero__subtitle">
            {pendingCount > 0 
              ? `${pendingCount} approval${pendingCount > 1 ? 's' : ''} pending review`
              : 'All approvals processed'
            }
          </p>
        </div>
        <div className="preflight-hero__status">
          <span className={`preflight-hero__status-badge preflight-hero__status-badge--${pendingCount > 0 ? 'pending' : 'passed'}`}>
            {pendingCount > 0 ? `${pendingCount} Pending` : '✓ All Clear'}
          </span>
        </div>
      </div>

      {/* Latest/Priority Approval */}
      {latestApproval && (
        <div className="preflight-hero__latest">
          <div className="preflight-hero__event-type">
            <span className={`preflight-hero__priority preflight-hero__priority--${latestApproval.priority}`}>
              {latestApproval.priority.toUpperCase()}
            </span>
            {getApprovalTypeLabel(latestApproval.type)}
          </div>
          <h3 className="preflight-hero__event-title">{latestApproval.title}</h3>
          <p className="preflight-hero__event-desc">{latestApproval.description}</p>
          <div className="preflight-hero__event-meta">
            <span className="preflight-hero__event-template">{latestApproval.templateName}</span>
            <span className="preflight-hero__event-time">
              Requested: {new Date(latestApproval.requestedAt).toLocaleString()}
            </span>
          </div>
        </div>
      )}

      {/* Primary Action Buttons */}
      <div className="preflight-hero__actions">
        <button 
          className="preflight-hero__btn preflight-hero__btn--analyse" 
          onClick={() => onAnalyse(latestApproval.id)}
        >
          <span className="preflight-hero__btn-icon">🔍</span>
          Analyse Before Consent
        </button>
        {latestApproval.status === 'pending' && (
          <button 
            className="preflight-hero__btn preflight-hero__btn--approve" 
            onClick={() => onApprove(latestApproval.id)}
          >
            <span className="preflight-hero__btn-icon">✓</span>
            Approve
          </button>
        )}
        <button className="preflight-hero__btn preflight-hero__btn--secondary" onClick={onToggleShowAll}>
          {showAll ? '▲ Hide All' : '▼ Show All'}
        </button>
      </div>

      {/* All Approvals List */}
      {showAll && (
        <div className="preflight-hero__history">
          <div className="preflight-hero__history-title">All Approval Requests</div>
          <div className="preflight-hero__history-list">
            {mockAwaitingApprovals.map((approval) => (
              <div key={approval.id} className={`preflight-hero__history-item preflight-hero__history-item--${approval.status}`}>
                <div className="preflight-hero__history-item-main">
                  <span className="preflight-hero__history-icon">{getApprovalIcon(approval.type)}</span>
                  <div className="preflight-hero__history-info">
                    <span className="preflight-hero__history-title-text">{approval.title}</span>
                    <span className="preflight-hero__history-template">{approval.templateName}</span>
                  </div>
                  <span className={`preflight-hero__history-status preflight-hero__history-status--${approval.status}`}>
                    {approval.status === 'approved' ? '✓' : approval.status === 'pending' ? '○' : '◐'}
                  </span>
                  <span className="preflight-hero__history-time">
                    {new Date(approval.requestedAt).toLocaleTimeString()}
                  </span>
                </div>
                <div className="preflight-hero__history-item-actions">
                  <button className="preflight-hero__history-analyse" onClick={() => onAnalyse(approval.id)}>
                    Analyse
                  </button>
                  {approval.status === 'pending' && (
                    <button className="preflight-hero__history-approve" onClick={() => onApprove(approval.id)}>
                      Approve
                    </button>
                  )}
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
// Main Component
// =============================================================================

export default function PreExecutionAnalysis({ 
  flags = DEFAULT_VERIFICATION_FLAGS,
  deepLink,
  onDeepLinkConsumed
}: PreExecutionAnalysisProps) {
  // Check flags before making any verification claims
  const isVerified = canClaimVerified(flags)
  
  // State for deep-link handling
  const [highlightedRuleId, setHighlightedRuleId] = useState<string | null>(null)
  const [isRiskPanelOpen, setIsRiskPanelOpen] = useState(false)
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null)
  const [notFoundMessage, setNotFoundMessage] = useState<string | null>(null)
  const [showAllEvents, setShowAllEvents] = useState(false)
  
  // Handle deep-link
  useEffect(() => {
    if (!deepLink) return
    
    console.log('[PreExecutionAnalysis] Processing deep-link:', deepLink)
    let consumed = false
    
    // traceId and eventId are ignored in pre-execution (safe no-op)
    if (deepLink.traceId) {
      console.log('[PreExecutionAnalysis] traceId ignored in pre-execution mode')
    }
    if (deepLink.eventId) {
      console.log('[PreExecutionAnalysis] eventId ignored in pre-execution mode')
    }
    
    // Handle ruleId: highlight matching alignment row
    if (deepLink.ruleId) {
      const ruleExists = mockPreflightRisks.some(r => r.ruleId === deepLink.ruleId)
      if (ruleExists) {
        setHighlightedRuleId(deepLink.ruleId)
        setSelectedRuleId(deepLink.ruleId)
        // If drawerTab is 'risks' or ruleId is provided, open the risk panel
        if (deepLink.drawerTab === 'risks' || deepLink.ruleId) {
          setIsRiskPanelOpen(true)
        }
        consumed = true
      } else {
        setNotFoundMessage(`Rule "${deepLink.ruleId}" not found in preflight analysis.`)
        consumed = true
      }
    }
    
    // Handle drawerTab: if 'risks', open risk panel
    if (deepLink.drawerTab === 'risks' && !deepLink.ruleId) {
      setIsRiskPanelOpen(true)
      consumed = true
    }
    
    // Signal consumption
    if (consumed || Object.keys(deepLink).length > 0) {
      onDeepLinkConsumed?.()
    }
  }, [deepLink, onDeepLinkConsumed])
  
  // Handle alignment row click
  const handleAlignmentRowClick = (row: PreflightAlignmentRow) => {
    if (row.linkedRuleIds.length > 0) {
      setSelectedRuleId(row.linkedRuleIds[0])
      setHighlightedRuleId(row.linkedRuleIds[0])
      setIsRiskPanelOpen(true)
    }
  }
  
  // Handle risk panel close
  const handleRiskPanelClose = () => {
    setIsRiskPanelOpen(false)
    setSelectedRuleId(null)
    setHighlightedRuleId(null)
  }
  
  // Handle not-found banner dismiss
  const handleDismissNotFound = () => {
    setNotFoundMessage(null)
  }
  
  // Compute readiness metrics
  const failedGates = mockConsentRequirements.filter(r => r.status === 'failed').length
  const pendingConsents = mockConsentRequirements.filter(r => r.status === 'pending').length
  const totalWarnings = mockRiskSummary.warnings
  
  // Readiness score calculation (mock)
  const readinessScore = failedGates > 0 ? 45 : pendingConsents > 0 ? 70 : 100
  const readinessStatus: 'ready' | 'warnings' | 'blocked' = 
    failedGates > 0 ? 'blocked' : 
    pendingConsents > 0 || totalWarnings > 0 ? 'warnings' : 
    'ready'

  // Quick actions based on current state
  const quickActions: QuickAction[] = [
    {
      label: 'View Template Source',
      onClick: () => {
        document.querySelector('.template-source-panel')?.scrollIntoView({ behavior: 'smooth' })
      },
      variant: 'primary'
    },
    {
      label: 'View Annotations',
      onClick: () => setIsRiskPanelOpen(true),
      variant: 'secondary'
    }
  ]
  
  // Workflow Analysis Modal State
  const [isWorkflowModalOpen, setIsWorkflowModalOpen] = useState(false)
  const [selectedApprovalId, setSelectedApprovalId] = useState<string | null>(null)
  const [showTemplates, setShowTemplates] = useState(false)

  const handleAnalyseApproval = (approvalId: string) => {
    console.log('[PreExecution] Analysing approval:', approvalId)
    setSelectedApprovalId(approvalId)
    setIsWorkflowModalOpen(true)
  }
  
  const handleApprove = (approvalId: string) => {
    console.log('[PreExecution] Approving:', approvalId)
    // In real implementation, this would trigger the approval flow
    setIsWorkflowModalOpen(false)
  }
  
  const handleWorkflowApprove = () => {
    if (selectedApprovalId) {
      handleApprove(selectedApprovalId)
    }
  }
  
  return (
    <div className="pre-execution-analysis" data-verified={isVerified}>
      {/* Awaiting Approvals Hero Section */}
      <AwaitingApprovalsHero 
        showAll={showAllEvents}
        onToggleShowAll={() => setShowAllEvents(!showAllEvents)}
        onAnalyse={handleAnalyseApproval}
        onApprove={handleApprove}
      />
      
      {/* Readiness Summary */}
      <div className="pre-execution-hero">
        <ReadinessGauge 
          score={readinessScore}
          status={readinessStatus}
          blockingCount={failedGates}
          warningCount={totalWarnings + pendingConsents}
          onViewDetails={() => setIsRiskPanelOpen(true)}
        />
        <QuickActionBar 
          actions={quickActions}
          title="Quick Actions"
        />
      </div>

      {/* Not-found banner */}
      {notFoundMessage && (
        <DeepLinkNotFoundBanner 
          message={notFoundMessage}
          onDismiss={handleDismissNotFound}
        />
      )}
      
      <div className="pre-execution-grid">
        <div className="grid-col grid-col--left">
          <TemplateInspector />
          <ConsentRequirements />
        </div>
        <div className="grid-col grid-col--right">
          <AutomationOverview />
          <RiskSummary />
        </div>
      </div>
      
      {/* Template Source Viewer */}
      <TemplateSourceViewer />
      
      {/* Preflight Alignment Panel */}
      <PreflightAlignmentPanel
        rows={mockPreflightAlignment}
        highlightedRuleId={highlightedRuleId}
        onRowClick={handleAlignmentRowClick}
      />
      
      {/* Preflight Risk Details Panel */}
      <PreflightRiskDetailsPanel
        isOpen={isRiskPanelOpen}
        selectedRuleId={selectedRuleId}
        risks={mockPreflightRisks}
        onClose={handleRiskPanelClose}
      />
      
      {/* Pre-Execution Workflow Analysis Modal */}
      <PreExecutionWorkflowModal
        isOpen={isWorkflowModalOpen}
        onClose={() => setIsWorkflowModalOpen(false)}
        approvalId={selectedApprovalId || ''}
        showTemplates={showTemplates}
        onToggleTemplates={() => setShowTemplates(!showTemplates)}
        onApprove={handleWorkflowApprove}
      />
    </div>
  )
}

