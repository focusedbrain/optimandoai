/**
 * HandshakeContextSection — Context blocks + attach button + policies
 * Shown in RelationshipDetail when state is ACCEPTED or ACTIVE.
 */

import type { VerifiedContextBlock } from './contextEscaping'
import PolicyCheckboxes, { type PolicySelection } from './PolicyCheckboxes'

interface HandshakeRecord {
  handshake_id: string
  state: string
}

interface HandshakeContextSectionProps {
  record: HandshakeRecord
  isVaultUnlocked: boolean
  policies: PolicySelection
  onPolicyChange: (policies: PolicySelection) => void
  onAttachData: () => void
  contextBlocks: VerifiedContextBlock[]
  readOnly: boolean
}

export default function HandshakeContextSection({
  record,
  isVaultUnlocked,
  policies,
  onPolicyChange,
  onAttachData,
  contextBlocks,
  readOnly,
}: HandshakeContextSectionProps) {
  return (
    <div
      style={{
        marginTop: '16px',
        padding: '16px',
        background: 'rgba(255,255,255,0.03)',
        borderRadius: '8px',
        border: '1px solid rgba(255,255,255,0.08)',
        marginBottom: '16px',
      }}
    >
      <h4
        style={{
          margin: '0 0 12px',
          fontSize: '13px',
          fontWeight: 600,
          color: '#e0e0e0',
        }}
      >
        Handshake Context
      </h4>

      {contextBlocks.length > 0 ? (
        <div style={{ marginBottom: '12px' }}>
          {contextBlocks.map((block) => (
            <div
              key={block.block_id}
              style={{
                padding: '6px 10px',
                marginBottom: '4px',
                background: 'rgba(255,255,255,0.04)',
                borderRadius: '4px',
                fontSize: '12px',
              }}
            >
              {block.type} — {block.block_id.slice(0, 12)}…
            </div>
          ))}
        </div>
      ) : (
        <p style={{ fontSize: '12px', color: '#888', margin: '0 0 12px' }}>
          No context data attached yet.
        </p>
      )}

      {!readOnly && (
        <button
          onClick={onAttachData}
          disabled={!isVaultUnlocked}
          title={!isVaultUnlocked ? 'Unlock vault to attach context data' : 'Attach context data'}
          style={{
            padding: '6px 12px',
            fontSize: '11px',
            fontWeight: 600,
            background: isVaultUnlocked ? 'rgba(59,130,246,0.2)' : 'rgba(107,114,128,0.2)',
            color: isVaultUnlocked ? '#3b82f6' : '#6b7280',
            border: `1px solid ${isVaultUnlocked ? 'rgba(59,130,246,0.4)' : 'rgba(107,114,128,0.3)'}`,
            borderRadius: '6px',
            cursor: isVaultUnlocked ? 'pointer' : 'not-allowed',
          }}
        >
          + Attach Context Data
        </button>
      )}

      <PolicyCheckboxes policies={policies} onChange={onPolicyChange} readOnly={readOnly} />
    </div>
  )
}
