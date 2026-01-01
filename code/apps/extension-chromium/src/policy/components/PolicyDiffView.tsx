/**
 * Policy Diff View Component
 * 
 * Shows visual differences between two policies.
 */

import type { CanonicalPolicy } from '../schema'
import { RiskLabel } from './RiskLabel'

interface PolicyDiffViewProps {
  policyA: CanonicalPolicy
  policyB: CanonicalPolicy
  onClose: () => void
  theme?: 'default' | 'dark' | 'professional'
}

interface DiffItem {
  path: string
  label: string
  valueA: unknown
  valueB: unknown
  changeType: 'added' | 'removed' | 'modified' | 'unchanged'
}

export function PolicyDiffView({ policyA, policyB, onClose, theme = 'default' }: PolicyDiffViewProps) {
  const isDark = theme === 'default' || theme === 'dark'
  const bgColor = isDark ? '#1e293b' : 'white'
  const textColor = isDark ? '#e5e5e5' : '#1f2937'
  const mutedColor = isDark ? '#9ca3af' : '#6b7280'
  const borderColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'

  // Generate diff items
  const diffs = computeDiffs(policyA, policyB)

  return (
    <div style={{
      background: bgColor,
      borderRadius: '12px',
      border: `1px solid ${borderColor}`,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 20px',
        borderBottom: `1px solid ${borderColor}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <h3 style={{ margin: 0, color: textColor, fontSize: '16px', fontWeight: 600 }}>
          📊 Policy Comparison
        </h3>
        <button
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            color: mutedColor,
            fontSize: '20px',
            cursor: 'pointer',
          }}
        >
          ×
        </button>
      </div>

      {/* Policy Headers */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '200px 1fr 1fr',
        gap: '1px',
        background: borderColor,
      }}>
        <div style={{ padding: '12px 16px', background: bgColor }} />
        <div style={{ 
          padding: '12px 16px', 
          background: isDark ? 'rgba(239, 68, 68, 0.1)' : 'rgba(239, 68, 68, 0.05)',
        }}>
          <div style={{ fontWeight: 600, color: textColor, marginBottom: '4px' }}>
            {policyA.name}
          </div>
          <RiskLabel tier={policyA.riskTier} size="sm" />
        </div>
        <div style={{ 
          padding: '12px 16px', 
          background: isDark ? 'rgba(34, 197, 94, 0.1)' : 'rgba(34, 197, 94, 0.05)',
        }}>
          <div style={{ fontWeight: 600, color: textColor, marginBottom: '4px' }}>
            {policyB.name}
          </div>
          <RiskLabel tier={policyB.riskTier} size="sm" />
        </div>
      </div>

      {/* Diff Rows */}
      <div style={{ maxHeight: '400px', overflow: 'auto' }}>
        {diffs.length === 0 ? (
          <div style={{ 
            padding: '40px', 
            textAlign: 'center', 
            color: mutedColor,
          }}>
            No differences found
          </div>
        ) : (
          diffs.map((diff, i) => (
            <div
              key={i}
              style={{
                display: 'grid',
                gridTemplateColumns: '200px 1fr 1fr',
                gap: '1px',
                background: borderColor,
                borderTop: i > 0 ? `1px solid ${borderColor}` : 'none',
              }}
            >
              <div style={{
                padding: '10px 16px',
                background: bgColor,
                color: mutedColor,
                fontSize: '13px',
                fontWeight: 500,
              }}>
                {diff.label}
              </div>
              <div style={{
                padding: '10px 16px',
                background: diff.changeType === 'removed' || diff.changeType === 'modified'
                  ? isDark ? 'rgba(239, 68, 68, 0.1)' : 'rgba(239, 68, 68, 0.05)'
                  : bgColor,
              }}>
                <ValueDisplay value={diff.valueA} theme={theme} />
              </div>
              <div style={{
                padding: '10px 16px',
                background: diff.changeType === 'added' || diff.changeType === 'modified'
                  ? isDark ? 'rgba(34, 197, 94, 0.1)' : 'rgba(34, 197, 94, 0.05)'
                  : bgColor,
              }}>
                <ValueDisplay value={diff.valueB} theme={theme} />
              </div>
            </div>
          ))
        )}
      </div>

      {/* Summary */}
      <div style={{
        padding: '12px 16px',
        borderTop: `1px solid ${borderColor}`,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <span style={{ color: mutedColor, fontSize: '12px' }}>
          {diffs.filter(d => d.changeType !== 'unchanged').length} differences found
        </span>
        <div style={{ display: 'flex', gap: '8px' }}>
          <span style={{ 
            padding: '2px 8px', 
            borderRadius: '4px', 
            background: 'rgba(239, 68, 68, 0.1)',
            color: '#ef4444',
            fontSize: '11px',
          }}>
            {diffs.filter(d => d.changeType === 'removed').length} removed
          </span>
          <span style={{ 
            padding: '2px 8px', 
            borderRadius: '4px', 
            background: 'rgba(234, 179, 8, 0.1)',
            color: '#eab308',
            fontSize: '11px',
          }}>
            {diffs.filter(d => d.changeType === 'modified').length} modified
          </span>
          <span style={{ 
            padding: '2px 8px', 
            borderRadius: '4px', 
            background: 'rgba(34, 197, 94, 0.1)',
            color: '#22c55e',
            fontSize: '11px',
          }}>
            {diffs.filter(d => d.changeType === 'added').length} added
          </span>
        </div>
      </div>
    </div>
  )
}

function ValueDisplay({ value, theme }: { value: unknown; theme?: string }) {
  const isDark = theme === 'default' || theme === 'dark'
  const textColor = isDark ? '#e5e5e5' : '#1f2937'
  const mutedColor = isDark ? '#9ca3af' : '#6b7280'

  if (value === undefined || value === null) {
    return <span style={{ color: mutedColor, fontStyle: 'italic' }}>—</span>
  }

  if (typeof value === 'boolean') {
    return (
      <span style={{ 
        color: value ? '#22c55e' : '#ef4444',
        fontWeight: 500,
      }}>
        {value ? '✓ Yes' : '✕ No'}
      </span>
    )
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span style={{ color: mutedColor, fontStyle: 'italic' }}>None</span>
    }
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
        {value.slice(0, 5).map((v, i) => (
          <span
            key={i}
            style={{
              padding: '2px 6px',
              background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
              borderRadius: '4px',
              fontSize: '11px',
              color: textColor,
            }}
          >
            {String(v)}
          </span>
        ))}
        {value.length > 5 && (
          <span style={{ color: mutedColor, fontSize: '11px' }}>
            +{value.length - 5} more
          </span>
        )}
      </div>
    )
  }

  if (typeof value === 'number') {
    // Format bytes nicely
    if (value >= 1_000_000) {
      return <span style={{ color: textColor }}>{(value / 1_000_000).toFixed(0)} MB</span>
    }
    return <span style={{ color: textColor }}>{value}</span>
  }

  return <span style={{ color: textColor }}>{String(value)}</span>
}

function computeDiffs(a: CanonicalPolicy, b: CanonicalPolicy): DiffItem[] {
  const diffs: DiffItem[] = []
  
  // Helper to add diff
  const addDiff = (path: string, label: string, valueA: unknown, valueB: unknown) => {
    const changeType = getChangeType(valueA, valueB)
    if (changeType !== 'unchanged') {
      diffs.push({ path, label, valueA, valueB, changeType })
    }
  }

  // Compare ingress
  if (a.ingress || b.ingress) {
    const ai = a.ingress
    const bi = b.ingress
    addDiff('ingress.allowedArtefactTypes', 'Allowed Artefacts', ai?.allowedArtefactTypes, bi?.allowedArtefactTypes)
    addDiff('ingress.maxSizeBytes', 'Max Size', ai?.maxSizeBytes, bi?.maxSizeBytes)
    addDiff('ingress.allowDynamicContent', 'Dynamic Content', ai?.allowDynamicContent, bi?.allowDynamicContent)
    addDiff('ingress.allowReconstruction', 'Allow Reconstruction', ai?.allowReconstruction, bi?.allowReconstruction)
    addDiff('ingress.allowExternalResources', 'External Resources', ai?.allowExternalResources, bi?.allowExternalResources)
    addDiff('ingress.requireSourceVerification', 'Source Verification', ai?.requireSourceVerification, bi?.requireSourceVerification)
    addDiff('ingress.parsingConstraint', 'Parsing Mode', ai?.parsingConstraint, bi?.parsingConstraint)
  }

  // Compare egress
  if (a.egress || b.egress) {
    const ae = a.egress
    const be = b.egress
    addDiff('egress.allowedChannels', 'Allowed Channels', ae?.allowedChannels, be?.allowedChannels)
    addDiff('egress.allowedDataCategories', 'Data Categories', ae?.allowedDataCategories, be?.allowedDataCategories)
    addDiff('egress.allowedDestinations', 'Destinations', ae?.allowedDestinations, be?.allowedDestinations)
    addDiff('egress.requireApproval', 'Require Approval', ae?.requireApproval, be?.requireApproval)
    addDiff('egress.requireEncryption', 'Require Encryption', ae?.requireEncryption, be?.requireEncryption)
    addDiff('egress.allowBulkExport', 'Bulk Export', ae?.allowBulkExport, be?.allowBulkExport)
    addDiff('egress.auditAllEgress', 'Audit All', ae?.auditAllEgress, be?.auditAllEgress)
    addDiff('egress.maxOperationsPerHour', 'Rate Limit', ae?.maxOperationsPerHour, be?.maxOperationsPerHour)
  }

  return diffs
}

function getChangeType(a: unknown, b: unknown): 'added' | 'removed' | 'modified' | 'unchanged' {
  const aEmpty = a === undefined || a === null || (Array.isArray(a) && a.length === 0)
  const bEmpty = b === undefined || b === null || (Array.isArray(b) && b.length === 0)
  
  if (aEmpty && !bEmpty) return 'added'
  if (!aEmpty && bEmpty) return 'removed'
  if (JSON.stringify(a) !== JSON.stringify(b)) return 'modified'
  return 'unchanged'
}



