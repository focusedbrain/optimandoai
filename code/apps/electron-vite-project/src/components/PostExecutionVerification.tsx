import { useState } from 'react'
import './PostExecutionVerification.css'
import { VerificationFlags, DEFAULT_VERIFICATION_FLAGS, canClaimVerified } from './analysis'

interface PostExecutionVerificationProps {
  flags?: VerificationFlags
}

// =============================================================================
// Mock Data - Static, immutable, no backend
// =============================================================================

const mockExecutionRecord = {
  executionId: 'exec_9f8e7d6c5b4a3210',
  templateId: 'tpl_7f3a9b2c1d4e5f6a',
  templateName: 'Invoice Processing Workflow',
  templateVersion: '2.1.0',
  status: 'completed',
  startedAt: '2026-01-06T10:14:22.341Z',
  completedAt: '2026-01-06T10:14:28.892Z',
  durationMs: 6551
}

const mockTimelineSteps = [
  {
    id: 1,
    name: 'Session Import',
    startedAt: '2026-01-06T10:14:22.341Z',
    completedAt: '2026-01-06T10:14:22.353Z',
    durationMs: 12,
    hash: 'sha256:a1b2c3d4e5f6a7b8c9d0e1f2',
    status: 'recorded'
  },
  {
    id: 2,
    name: 'Capsule Depackaging',
    startedAt: '2026-01-06T10:14:22.353Z',
    completedAt: '2026-01-06T10:14:22.398Z',
    durationMs: 45,
    hash: 'sha256:e5f6a7b8c9d0e1f2a3b4c5d6',
    status: 'recorded'
  },
  {
    id: 3,
    name: 'Artefact Extraction',
    startedAt: '2026-01-06T10:14:22.398Z',
    completedAt: '2026-01-06T10:14:22.632Z',
    durationMs: 234,
    hash: 'sha256:1a2b3c4d5e6f7a8b9c0d1e2f',
    status: 'recorded'
  },
  {
    id: 4,
    name: 'OCR Processing',
    startedAt: '2026-01-06T10:14:22.632Z',
    completedAt: '2026-01-06T10:14:24.524Z',
    durationMs: 1892,
    hash: 'sha256:5e6f7a8b9c0d1e2f3a4b5c6d',
    status: 'recorded'
  },
  {
    id: 5,
    name: 'Validation',
    startedAt: '2026-01-06T10:14:24.524Z',
    completedAt: '2026-01-06T10:14:24.613Z',
    durationMs: 89,
    hash: 'sha256:7a8b9c0d1e2f3a4b5c6d7e8f',
    status: 'recorded'
  },
  {
    id: 6,
    name: 'AI Classification',
    startedAt: '2026-01-06T10:14:24.613Z',
    completedAt: '2026-01-06T10:14:28.504Z',
    durationMs: 3891,
    hash: 'sha256:9c0d1e2f3a4b5c6d7e8f9a0b',
    status: 'recorded'
  },
  {
    id: 7,
    name: 'Capsule Packaging',
    startedAt: '2026-01-06T10:14:28.504Z',
    completedAt: '2026-01-06T10:14:28.892Z',
    durationMs: 388,
    hash: 'sha256:9a0b1c2d3e4f5a6b7c8d9e0f',
    status: 'recorded'
  }
]

const mockCapsuleEvidence = {
  input: {
    capsuleId: 'cap_8a7b6c5d4e3f',
    hash: 'sha256:e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4',
    size: 14832
  },
  output: {
    capsuleId: 'cap_new_2f3e4d5c',
    hash: 'sha256:9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b',
    size: 18244
  }
}

const mockArtefactEvidence = [
  { id: 'art_invoice_001', type: 'PDF', hash: 'sha256:1a2b3c4d5e6f7a8b', size: '8.2KB' },
  { id: 'art_attachment_002', type: 'PNG', hash: 'sha256:3c4d5e6f7a8b9c0d', size: '4.1KB' },
  { id: 'art_ocr_output_003', type: 'JSON', hash: 'sha256:5e6f7a8b9c0d1e2f', size: '2.8KB' }
]

const mockPolicySnapshot = [
  { policyId: 'policy:invoice-limits', version: '1.2.0', result: 'PASS', hash: 'sha256:abc123def456' },
  { policyId: 'policy:data-export-allowed', version: '2.0.1', result: 'PASS', hash: 'sha256:def456abc789' },
  { policyId: 'policy:external-api', version: '1.0.0', result: 'N/A', hash: 'sha256:789ghijk012' }
]

const mockPoAEPlaceholder = {
  status: 'VERIFIED',
  demoEvents: [
    { type: 'EXEC_START', timestamp: '2026-01-06T10:14:22.341Z', demoValue: 'poae_start_9f8e7d6c5b4a' },
    { type: 'AI_INVOKE', timestamp: '2026-01-06T10:14:24.613Z', demoValue: 'poae_ai_3c4d5e6f7a8b' },
    { type: 'CAPSULE_OUT', timestamp: '2026-01-06T10:14:28.504Z', demoValue: 'poae_capsule_1a2b3c4d5e6f' },
    { type: 'EXEC_COMPLETE', timestamp: '2026-01-06T10:14:28.892Z', demoValue: 'poae_complete_7a8b9c0d1e2f' }
  ]
}

// Cross-Organizational Workflow Analysis Data
const mockWorkflowAnalysis = {
  sender: {
    organization: 'Acme Corp',
    user: 'john.smith@acme.corp',
    authorization: {
      poaeId: 'poae_sender_auth_001',
      timestamp: '2026-01-06T10:14:20.100Z',
      action: 'WORKFLOW_AUTHORIZED',
      hash: 'sha256:sender_auth_a1b2c3d4e5f6'
    },
    packaging: {
      beapId: 'beap_pkg_001',
      timestamp: '2026-01-06T10:14:21.500Z',
      capsuleId: 'cap_8a7b6c5d4e3f',
      artefacts: [
        { name: 'invoice_2026_001.pdf', type: 'PDF', size: '8.2KB', hash: 'sha256:1a2b3c4d5e6f7a8b' },
        { name: 'attachment_001.png', type: 'PNG', size: '4.1KB', hash: 'sha256:3c4d5e6f7a8b9c0d' }
      ]
    }
  },
  automationSteps: [
    { id: 1, name: 'Capsule Depackaging', status: 'verified', duration: '45ms', hash: 'sha256:e5f6a7b8c9d0' },
    { id: 2, name: 'Artefact Extraction', status: 'verified', duration: '234ms', hash: 'sha256:1a2b3c4d5e6f' },
    { id: 3, name: 'OCR Processing', status: 'verified', duration: '1.89s', hash: 'sha256:5e6f7a8b9c0d' },
    { id: 4, name: 'Validation', status: 'verified', duration: '89ms', hash: 'sha256:7a8b9c0d1e2f' },
    { id: 5, name: 'AI Classification', status: 'verified', duration: '3.89s', hash: 'sha256:9c0d1e2f3a4b' },
    { id: 6, name: 'Result Packaging', status: 'verified', duration: '388ms', hash: 'sha256:9a0b1c2d3e4f' }
  ],
  receiver: {
    organization: 'Partner Inc',
    user: 'jane.doe@partner.inc',
    authorization: {
      poaeId: 'poae_receiver_auth_001',
      timestamp: '2026-01-06T10:14:28.800Z',
      action: 'EXECUTION_AUTHORIZED',
      hash: 'sha256:receiver_auth_7a8b9c0d1e2f'
    },
    unpackaging: {
      beapId: 'beap_unpkg_001',
      timestamp: '2026-01-06T10:14:28.890Z',
      capsuleId: 'cap_new_2f3e4d5c',
      artefacts: [
        { name: 'invoice_2026_001.pdf', type: 'PDF', size: '8.2KB', hash: 'sha256:1a2b3c4d5e6f7a8b' },
        { name: 'attachment_001.png', type: 'PNG', size: '4.1KB', hash: 'sha256:3c4d5e6f7a8b9c0d' },
        { name: 'classification_result.json', type: 'JSON', size: '2.8KB', hash: 'sha256:5e6f7a8b9c0d1e2f' }
      ]
    }
  },
  automationTemplate: {
    id: 'tpl_7f3a9b2c1d4e5f6a',
    name: 'Invoice Processing Workflow',
    version: '2.1.0',
    steps: [
      'extract_artefacts',
      'run_ocr',
      'validate_schema',
      'classify_with_ai',
      'package_results'
    ],
    policies: [
      'policy:invoice-limits',
      'policy:data-export-allowed'
    ]
  }
}

// PoAE™ Log History - all past verification logs
const mockPoAELogHistory = [
  {
    id: 'poae_log_001',
    executionId: 'exec_9f8e7d6c5b4a3210',
    templateName: 'Invoice Processing Workflow',
    timestamp: '2026-01-06T10:14:28.892Z',
    status: 'verified',
    eventCount: 4,
    chainHash: 'sha256:9f8e7d6c5b4a3210abcdef1234567890'
  },
  {
    id: 'poae_log_002',
    executionId: 'exec_8a7b6c5d4e3f2100',
    templateName: 'Document Classification',
    timestamp: '2026-01-06T09:45:12.123Z',
    status: 'verified',
    eventCount: 6,
    chainHash: 'sha256:8a7b6c5d4e3f2100fedcba0987654321'
  },
  {
    id: 'poae_log_003',
    executionId: 'exec_7f6e5d4c3b2a1000',
    templateName: 'Email Extraction Pipeline',
    timestamp: '2026-01-06T08:32:45.789Z',
    status: 'verified',
    eventCount: 5,
    chainHash: 'sha256:7f6e5d4c3b2a1000abcdef9876543210'
  },
  {
    id: 'poae_log_004',
    executionId: 'exec_6e5d4c3b2a100f00',
    templateName: 'Invoice Processing Workflow',
    timestamp: '2026-01-05T16:21:33.456Z',
    status: 'verified',
    eventCount: 4,
    chainHash: 'sha256:6e5d4c3b2a100f00fedcba1234567890'
  },
  {
    id: 'poae_log_005',
    executionId: 'exec_5d4c3b2a100f0e00',
    templateName: 'Contract Analysis',
    timestamp: '2026-01-05T14:55:22.111Z',
    status: 'verified',
    eventCount: 8,
    chainHash: 'sha256:5d4c3b2a100f0e00abcdef0987654321'
  }
]

// =============================================================================
// Workflow Analysis Modal
// =============================================================================

interface WorkflowAnalysisModalProps {
  isOpen: boolean
  onClose: () => void
  logId: string
  showTemplates: boolean
  onToggleTemplates: () => void
}

function WorkflowAnalysisModal({ isOpen, onClose, showTemplates, onToggleTemplates }: WorkflowAnalysisModalProps) {
  if (!isOpen) return null
  
  const workflow = mockWorkflowAnalysis
  
  return (
    <div className="workflow-modal-overlay" onClick={onClose}>
      <div className="workflow-modal" onClick={e => e.stopPropagation()}>
        <div className="workflow-modal__header">
          <h2 className="workflow-modal__title">
            🔍 PoAE™ Analysis
          </h2>
          <p className="workflow-modal__subtitle">
            End-to-End Cross-Organization BEAP™ Workflow Verification
          </p>
          <button className="workflow-modal__close" onClick={onClose}>×</button>
        </div>
        
        <div className="workflow-modal__content">
          {/* Sender Side */}
          <div className="workflow-section workflow-section--sender">
            <div className="workflow-section__header">
              <span className="workflow-section__icon">📤</span>
              <div className="workflow-section__title-group">
                <h3 className="workflow-section__title">Sender: {workflow.sender.organization}</h3>
                <span className="workflow-section__user">{workflow.sender.user}</span>
              </div>
            </div>
            
            {/* Sender Authorization PoAE™ */}
            <div className="workflow-poae workflow-poae--highlight">
              <div className="workflow-poae__badge">🔐 PoAE™ Authorization</div>
              <div className="workflow-poae__details">
                <div className="workflow-poae__row">
                  <span className="workflow-poae__label">Action:</span>
                  <span className="workflow-poae__value">{workflow.sender.authorization.action}</span>
                </div>
                <div className="workflow-poae__row">
                  <span className="workflow-poae__label">Time:</span>
                  <span className="workflow-poae__value">{new Date(workflow.sender.authorization.timestamp).toLocaleString()}</span>
                </div>
                <div className="workflow-poae__row">
                  <span className="workflow-poae__label">Hash:</span>
                  <code className="workflow-poae__hash">{workflow.sender.authorization.hash}</code>
                </div>
              </div>
              <span className="workflow-poae__verified">✓ Verified</span>
            </div>
            
            {/* BEAP™ Packaging */}
            <div className="workflow-beap">
              <div className="workflow-beap__header">
                <span className="workflow-beap__icon">📦</span>
                <span className="workflow-beap__title">BEAP™ Packaging</span>
                <code className="workflow-beap__id">{workflow.sender.packaging.capsuleId}</code>
              </div>
              <div className="workflow-beap__artefacts">
                <div className="workflow-beap__artefacts-title">Artefacts (read-only)</div>
                {workflow.sender.packaging.artefacts.map((art, idx) => (
                  <div key={idx} className="workflow-artefact">
                    <span className="workflow-artefact__icon">📄</span>
                    <span className="workflow-artefact__name">{art.name}</span>
                    <span className="workflow-artefact__type">{art.type}</span>
                    <span className="workflow-artefact__size">{art.size}</span>
                    <code className="workflow-artefact__hash">{art.hash.slice(0, 16)}...</code>
                  </div>
                ))}
              </div>
            </div>
          </div>
          
          {/* Automation Steps (Middle) */}
          <div className="workflow-section workflow-section--automation">
            <div className="workflow-section__header">
              <span className="workflow-section__icon">⚙️</span>
              <h3 className="workflow-section__title">Automation Execution</h3>
              <button 
                className="workflow-section__template-btn"
                onClick={onToggleTemplates}
              >
                {showTemplates ? '▲ Hide Template' : '▼ View Template'}
              </button>
            </div>
            
            {showTemplates && (
              <div className="workflow-template">
                <div className="workflow-template__header">
                  <span className="workflow-template__name">{workflow.automationTemplate.name}</span>
                  <span className="workflow-template__version">v{workflow.automationTemplate.version}</span>
                </div>
                <div className="workflow-template__steps">
                  <div className="workflow-template__label">Template Steps:</div>
                  {workflow.automationTemplate.steps.map((step, idx) => (
                    <div key={idx} className="workflow-template__step">
                      <span className="workflow-template__step-num">{idx + 1}</span>
                      <code className="workflow-template__step-name">{step}</code>
                    </div>
                  ))}
                </div>
                <div className="workflow-template__policies">
                  <div className="workflow-template__label">Applied Policies:</div>
                  {workflow.automationTemplate.policies.map((policy, idx) => (
                    <code key={idx} className="workflow-template__policy">{policy}</code>
                  ))}
                </div>
              </div>
            )}
            
            <div className="workflow-steps">
              {workflow.automationSteps.map((step, idx) => (
                <div key={step.id} className="workflow-step">
                  <div className="workflow-step__connector">
                    <div className="workflow-step__dot" />
                    {idx < workflow.automationSteps.length - 1 && <div className="workflow-step__line" />}
                  </div>
                  <div className="workflow-step__content">
                    <div className="workflow-step__header">
                      <span className="workflow-step__num">{step.id}</span>
                      <span className="workflow-step__name">{step.name}</span>
                      <span className="workflow-step__duration">{step.duration}</span>
                      <span className="workflow-step__status">✓</span>
                    </div>
                    <code className="workflow-step__hash">{step.hash}</code>
                  </div>
                </div>
              ))}
            </div>
          </div>
          
          {/* Receiver Side */}
          <div className="workflow-section workflow-section--receiver">
            <div className="workflow-section__header">
              <span className="workflow-section__icon">📥</span>
              <div className="workflow-section__title-group">
                <h3 className="workflow-section__title">Receiver: {workflow.receiver.organization}</h3>
                <span className="workflow-section__user">{workflow.receiver.user}</span>
              </div>
            </div>
            
            {/* Receiver Authorization PoAE™ */}
            <div className="workflow-poae workflow-poae--highlight">
              <div className="workflow-poae__badge">🔐 PoAE™ Authorization</div>
              <div className="workflow-poae__details">
                <div className="workflow-poae__row">
                  <span className="workflow-poae__label">Action:</span>
                  <span className="workflow-poae__value">{workflow.receiver.authorization.action}</span>
                </div>
                <div className="workflow-poae__row">
                  <span className="workflow-poae__label">Time:</span>
                  <span className="workflow-poae__value">{new Date(workflow.receiver.authorization.timestamp).toLocaleString()}</span>
                </div>
                <div className="workflow-poae__row">
                  <span className="workflow-poae__label">Hash:</span>
                  <code className="workflow-poae__hash">{workflow.receiver.authorization.hash}</code>
                </div>
              </div>
              <span className="workflow-poae__verified">✓ Verified</span>
            </div>
            
            {/* BEAP™ Un-Packaging */}
            <div className="workflow-beap">
              <div className="workflow-beap__header">
                <span className="workflow-beap__icon">📂</span>
                <span className="workflow-beap__title">BEAP™ Un-Packaging</span>
                <code className="workflow-beap__id">{workflow.receiver.unpackaging.capsuleId}</code>
              </div>
              <div className="workflow-beap__artefacts">
                <div className="workflow-beap__artefacts-title">Artefacts (read-only)</div>
                {workflow.receiver.unpackaging.artefacts.map((art, idx) => (
                  <div key={idx} className="workflow-artefact">
                    <span className="workflow-artefact__icon">📄</span>
                    <span className="workflow-artefact__name">{art.name}</span>
                    <span className="workflow-artefact__type">{art.type}</span>
                    <span className="workflow-artefact__size">{art.size}</span>
                    <code className="workflow-artefact__hash">{art.hash.slice(0, 16)}...</code>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        
        <div className="workflow-modal__footer">
          <div className="workflow-modal__summary">
            <span className="workflow-modal__summary-item">
              <span className="workflow-modal__summary-icon">✓</span>
              2 PoAE™ Authorizations
            </span>
            <span className="workflow-modal__summary-item">
              <span className="workflow-modal__summary-icon">✓</span>
              {workflow.automationSteps.length} Automation Steps
            </span>
            <span className="workflow-modal__summary-item">
              <span className="workflow-modal__summary-icon">✓</span>
              {workflow.receiver.unpackaging.artefacts.length} Artefacts
            </span>
          </div>
          <button className="workflow-modal__close-btn" onClick={onClose}>
            Close Analysis
          </button>
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// Panel Components
// =============================================================================

function PanelHeader({ title, badge, status }: { title: string; badge?: string; status?: 'recorded' | 'verified' }) {
  return (
    <div className="post-panel-header">
      <span className="post-panel-title">{title}</span>
      {status === 'recorded' && (
        <span className="post-panel-badge post-panel-badge--recorded">Recorded</span>
      )}
      {status === 'verified' && (
        <span className="post-panel-badge post-panel-badge--verified">Verified</span>
      )}
      {badge && <span className="post-panel-badge post-panel-badge--info">{badge}</span>}
    </div>
  )
}

function ExecutionSummary() {
  return (
    <div className="post-panel">
      <PanelHeader title="Execution Summary" status="recorded" />
      <div className="post-panel-content">
        <div className="summary-grid">
          <div className="summary-row">
            <span className="summary-key">Execution ID</span>
            <code className="summary-value">{mockExecutionRecord.executionId}</code>
          </div>
          <div className="summary-row">
            <span className="summary-key">Template</span>
            <span className="summary-value">
              {mockExecutionRecord.templateName} v{mockExecutionRecord.templateVersion}
            </span>
          </div>
          <div className="summary-row">
            <span className="summary-key">Status</span>
            <span className="summary-value">
              <span className="status-badge status-badge--completed">Completed</span>
            </span>
          </div>
          <div className="summary-row">
            <span className="summary-key">Started</span>
            <span className="summary-value">{new Date(mockExecutionRecord.startedAt).toLocaleString()}</span>
          </div>
          <div className="summary-row">
            <span className="summary-key">Completed</span>
            <span className="summary-value">{new Date(mockExecutionRecord.completedAt).toLocaleString()}</span>
          </div>
          <div className="summary-row">
            <span className="summary-key">Duration</span>
            <span className="summary-value">{(mockExecutionRecord.durationMs / 1000).toFixed(3)}s</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function ExecutionTimeline() {
  return (
    <div className="post-panel post-panel--timeline">
      <PanelHeader title="Execution Timeline" status="recorded" badge="Immutable" />
      <div className="post-panel-content">
        <div className="post-timeline">
          {mockTimelineSteps.map((step, index) => (
            <div key={step.id} className="post-timeline-step">
              <div className="post-timeline-step__marker">
                <div className="post-timeline-step__dot" />
                {index < mockTimelineSteps.length - 1 && <div className="post-timeline-step__line" />}
              </div>
              <div className="post-timeline-step__content">
                <div className="post-timeline-step__header">
                  <span className="post-timeline-step__number">{step.id}</span>
                  <span className="post-timeline-step__name">{step.name}</span>
                  <span className="post-timeline-step__duration">{step.durationMs}ms</span>
                </div>
                <div className="post-timeline-step__meta">
                  <span className="post-timeline-step__time">
                    {new Date(step.startedAt).toLocaleTimeString()}
                  </span>
                  <code className="post-timeline-step__hash">{step.hash}</code>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function EvidenceBundle() {
  return (
    <div className="post-panel">
      <PanelHeader title="Evidence Bundle" status="recorded" />
      <div className="post-panel-content">
        {/* Capsule Evidence */}
        <div className="evidence-section">
          <div className="evidence-section__title">Capsule Evidence</div>
          <div className="evidence-grid">
            <div className="evidence-item">
              <div className="evidence-item__label">Input Capsule</div>
              <div className="evidence-item__row">
                <span className="evidence-key">ID:</span>
                <code>{mockCapsuleEvidence.input.capsuleId}</code>
              </div>
              <div className="evidence-item__row">
                <span className="evidence-key">Hash:</span>
                <code className="evidence-hash">{mockCapsuleEvidence.input.hash}</code>
              </div>
              <div className="evidence-item__row">
                <span className="evidence-key">Size:</span>
                <span>{mockCapsuleEvidence.input.size.toLocaleString()} bytes</span>
              </div>
            </div>
            <div className="evidence-item">
              <div className="evidence-item__label">Output Capsule</div>
              <div className="evidence-item__row">
                <span className="evidence-key">ID:</span>
                <code>{mockCapsuleEvidence.output.capsuleId}</code>
              </div>
              <div className="evidence-item__row">
                <span className="evidence-key">Hash:</span>
                <code className="evidence-hash">{mockCapsuleEvidence.output.hash}</code>
              </div>
              <div className="evidence-item__row">
                <span className="evidence-key">Size:</span>
                <span>{mockCapsuleEvidence.output.size.toLocaleString()} bytes</span>
              </div>
            </div>
          </div>
        </div>

        {/* Artefact Evidence */}
        <div className="evidence-section">
          <div className="evidence-section__title">Artefact Hashes</div>
          <table className="evidence-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Type</th>
                <th>Hash</th>
                <th>Size</th>
              </tr>
            </thead>
            <tbody>
              {mockArtefactEvidence.map(art => (
                <tr key={art.id}>
                  <td><code>{art.id}</code></td>
                  <td>{art.type}</td>
                  <td><code className="evidence-hash">{art.hash}</code></td>
                  <td>{art.size}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Policy Snapshot */}
        <div className="evidence-section">
          <div className="evidence-section__title">Policy Snapshot</div>
          <table className="evidence-table">
            <thead>
              <tr>
                <th>Policy ID</th>
                <th>Version</th>
                <th>Result</th>
                <th>Hash</th>
              </tr>
            </thead>
            <tbody>
              {mockPolicySnapshot.map(policy => (
                <tr key={policy.policyId}>
                  <td><code>{policy.policyId}</code></td>
                  <td>{policy.version}</td>
                  <td>
                    <span className={`policy-result policy-result--${policy.result.toLowerCase()}`}>
                      {policy.result}
                    </span>
                  </td>
                  <td><code className="evidence-hash">{policy.hash}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function PoAEHeroSection({ 
  showAllLogs, 
  onToggleShowAll,
  onExportLatest,
  onAnalyse
}: { 
  showAllLogs: boolean
  onToggleShowAll: () => void
  onExportLatest: () => void
  onAnalyse: (logId: string) => void 
}) {
  const latestLog = mockPoAELogHistory[0]
  
  return (
    <div className="poae-hero">
      <div className="poae-hero__header">
        <div className="poae-hero__icon">🔐</div>
        <div className="poae-hero__title-group">
          <h2 className="poae-hero__title">Latest PoAE™ Log</h2>
          <p className="poae-hero__subtitle">Proof of Authenticated Execution™ Verification</p>
        </div>
        <div className="poae-hero__status">
          <span className="poae-hero__status-badge poae-hero__status-badge--verified">
            ✓ Verified
          </span>
        </div>
      </div>

      {/* Latest Log Summary */}
      <div className="poae-hero__latest">
        <div className="poae-hero__latest-meta">
          <div className="poae-hero__meta-item">
            <span className="poae-hero__meta-label">Template</span>
            <span className="poae-hero__meta-value">{latestLog.templateName}</span>
          </div>
          <div className="poae-hero__meta-item">
            <span className="poae-hero__meta-label">Execution</span>
            <code className="poae-hero__meta-value">{latestLog.executionId}</code>
          </div>
          <div className="poae-hero__meta-item">
            <span className="poae-hero__meta-label">Timestamp</span>
            <span className="poae-hero__meta-value">{new Date(latestLog.timestamp).toLocaleString()}</span>
          </div>
          <div className="poae-hero__meta-item">
            <span className="poae-hero__meta-label">Events</span>
            <span className="poae-hero__meta-value">{latestLog.eventCount}</span>
          </div>
        </div>

        {/* Event Chain Preview */}
        <div className="poae-hero__chain">
          <div className="poae-hero__chain-title">Event Chain</div>
          <div className="poae-hero__chain-events">
            {mockPoAEPlaceholder.demoEvents.map((event, index) => (
              <div key={index} className="poae-hero__chain-event">
                <span className="poae-hero__chain-dot" />
                <span className="poae-hero__chain-type">{event.type}</span>
                <span className="poae-hero__chain-time">{new Date(event.timestamp).toLocaleTimeString()}</span>
                <code className="poae-hero__chain-hash">{event.demoValue}</code>
                <span className="poae-hero__chain-check">✓</span>
              </div>
            ))}
          </div>
          <div className="poae-hero__chain-footer">
            <span className="poae-hero__chain-hash-label">Chain Hash:</span>
            <code className="poae-hero__chain-hash-value">{latestLog.chainHash}</code>
          </div>
        </div>
      </div>

      {/* Primary Action Buttons */}
      <div className="poae-hero__actions">
        <button className="poae-hero__btn poae-hero__btn--analyse" onClick={() => onAnalyse(latestLog.id)}>
          <span className="poae-hero__btn-icon">🔍</span>
          Analyse PoAE™
        </button>
        <button className="poae-hero__btn poae-hero__btn--primary" onClick={onExportLatest}>
          <span className="poae-hero__btn-icon">📤</span>
          Export Latest PoAE™
        </button>
        <button className="poae-hero__btn poae-hero__btn--secondary" onClick={onToggleShowAll}>
          {showAllLogs ? '▲ Hide History' : '▼ Show All'}
        </button>
      </div>

      {/* All Logs History */}
      {showAllLogs && (
        <div className="poae-hero__history">
          <div className="poae-hero__history-title">PoAE™ Log History</div>
          <div className="poae-hero__history-list">
            {mockPoAELogHistory.map((log) => (
              <div key={log.id} className="poae-hero__history-item">
                <div className="poae-hero__history-item-main">
                  <span className="poae-hero__history-status">✓</span>
                  <div className="poae-hero__history-info">
                    <span className="poae-hero__history-template">{log.templateName}</span>
                    <code className="poae-hero__history-exec">{log.executionId}</code>
                  </div>
                  <span className="poae-hero__history-time">
                    {new Date(log.timestamp).toLocaleString()}
                  </span>
                </div>
                <div className="poae-hero__history-item-meta">
                  <span className="poae-hero__history-events">{log.eventCount} events</span>
                  <code className="poae-hero__history-hash">{log.chainHash.slice(0, 24)}...</code>
                  <button className="poae-hero__history-analyse" onClick={() => onAnalyse(log.id)}>Analyse</button>
                  <button className="poae-hero__history-export">Export</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function AuditTrailSection() {
  return (
    <div className="post-panel">
      <PanelHeader title="Audit Trail" status="verified" />
      <div className="post-panel-content">
        <div className="audit-chain-status">
          <div className="audit-chain-status__content">
            <div className="audit-chain-row">
              <span className="audit-chain-key">Chain ID:</span>
              <code>chain_exec_9f8e7d6c5b4a3210</code>
            </div>
            <div className="audit-chain-row">
              <span className="audit-chain-key">Events:</span>
              <span>7 recorded</span>
            </div>
            <div className="audit-chain-row">
              <span className="audit-chain-key">Integrity:</span>
              <span className="audit-chain-integrity audit-chain-integrity--verified">
                <span className="integrity-indicator">✓</span>
                All events verified
              </span>
            </div>
            <div className="audit-chain-row">
              <span className="audit-chain-key">PoAE™:</span>
              <span className="audit-chain-integrity audit-chain-integrity--verified">
                <span className="integrity-indicator">✓</span>
                Attestation complete
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// Main Component
// =============================================================================

export default function PostExecutionVerification({ flags = DEFAULT_VERIFICATION_FLAGS }: PostExecutionVerificationProps) {
  const [showAllLogs, setShowAllLogs] = useState(false)
  const [analysisModalOpen, setAnalysisModalOpen] = useState(false)
  const [analysisLogId, setAnalysisLogId] = useState<string>('')
  const [showTemplates, setShowTemplates] = useState(false)
  
  // Check flags before making any verification claims
  const isVerified = canClaimVerified(flags)
  
  const handleExportLatestPoAE = () => {
    console.log('[PostExecution] Exporting latest PoAE log...')
  }
  
  const handleAnalyse = (logId: string) => {
    setAnalysisLogId(logId)
    setAnalysisModalOpen(true)
    setShowTemplates(false)
  }
  
  const handleCloseAnalysis = () => {
    setAnalysisModalOpen(false)
  }
  
  return (
    <div className="post-execution-verification" data-verified={isVerified}>
      {/* Workflow Analysis Modal */}
      <WorkflowAnalysisModal 
        isOpen={analysisModalOpen}
        onClose={handleCloseAnalysis}
        logId={analysisLogId}
        showTemplates={showTemplates}
        onToggleTemplates={() => setShowTemplates(!showTemplates)}
      />
      
      {/* PoAE™ Hero Section - Primary Focus */}
      <PoAEHeroSection 
        showAllLogs={showAllLogs}
        onToggleShowAll={() => setShowAllLogs(!showAllLogs)}
        onExportLatest={handleExportLatestPoAE}
        onAnalyse={handleAnalyse}
      />

      {/* Execution Details Grid */}
      <div className="post-grid">
        <div className="post-col post-col--left">
          <ExecutionSummary />
          <ExecutionTimeline />
        </div>
        <div className="post-col post-col--right">
          <EvidenceBundle />
          <AuditTrailSection />
        </div>
      </div>
    </div>
  )
}

