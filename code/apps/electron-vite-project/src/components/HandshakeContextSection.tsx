/**
 * HandshakeContextSection — Context blocks + attach button + policies
 * Shown in RelationshipDetail when state is ACCEPTED or ACTIVE.
 * Per-item governance badges and edit action.
 */

import { useState } from 'react'
import type { VerifiedContextBlock } from './contextEscaping'
import PolicyCheckboxes, { type PolicySelection } from './PolicyCheckboxes'
import ContextItemEditor, { type ContextItemGovernanceEdit } from './ContextItemEditor'

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
  onContextBlocksRefresh?: () => void
}

function GovernanceBadge({ label, value }: { label: string; value: boolean }) {
  return (
    <span
      style={{
        fontSize: '9px',
        padding: '2px 4px',
        borderRadius: '3px',
        marginRight: '4px',
        background: value ? 'rgba(34,197,94,0.15)' : 'rgba(107,114,128,0.2)',
        color: value ? '#22c55e' : '#6b7280',
      }}
    >
      {label}:{value ? '✓' : '—'}
    </span>
  )
}

export default function HandshakeContextSection({
  record,
  isVaultUnlocked,
  policies,
  onPolicyChange,
  onAttachData,
  contextBlocks,
  readOnly,
  onContextBlocksRefresh,
}: HandshakeContextSectionProps) {
  const [editingBlock, setEditingBlock] = useState<VerifiedContextBlock | null>(null)

  const handleSaveGovernance = async (block: VerifiedContextBlock, edit: ContextItemGovernanceEdit) => {
    const handshakeId = record.handshake_id
    const blockHash = block.block_hash ?? ''
    const senderUserId = block.sender_wrdesk_user_id
    const existing = block.governance as Record<string, unknown> | undefined
    const governance = {
      ...(existing ?? {}),
      content_type: edit.content_type,
      sensitivity: edit.sensitivity,
      usage_policy: edit.usage_policy,
      origin: existing?.origin ?? 'local',
      provenance: existing?.provenance ?? { publisher_id: senderUserId, sender_wrdesk_user_id: senderUserId },
      verification: existing?.verification ?? { hash_present: true, signature_present: false, commitment_linked: true },
    }
    const result = await window.handshakeView?.updateContextItemGovernance?.(
      handshakeId,
      block.block_id,
      blockHash,
      senderUserId,
      governance,
    )
    if (result?.success) {
      setEditingBlock(null)
      onContextBlocksRefresh?.()
    }
  }

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
          {contextBlocks.map((block) => {
            const g = block.governance
            const policy = g?.usage_policy
            return (
              <div
                key={block.block_id}
                style={{
                  padding: '8px 10px',
                  marginBottom: '6px',
                  background: 'rgba(255,255,255,0.04)',
                  borderRadius: '4px',
                  fontSize: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '6px',
                }}
              >
                <div>
                  <span style={{ fontWeight: 600, marginRight: '6px' }}>
                    {g?.content_type ?? block.type}
                  </span>
                  <span style={{ color: '#94a3b8' }}>{block.block_id.slice(0, 14)}…</span>
                  <div style={{ marginTop: '4px' }}>
                    <GovernanceBadge label="local AI" value={policy?.local_ai_allowed ?? false} />
                    <GovernanceBadge label="cloud AI" value={policy?.cloud_ai_allowed ?? false} />
                    <GovernanceBadge label="search" value={policy?.searchable ?? false} />
                    <GovernanceBadge label="export" value={policy?.export_allowed ?? false} />
                    <span style={{ fontSize: '9px', color: '#6b7280', marginLeft: '4px' }}>
                      {g?.sensitivity ?? 'internal'}
                    </span>
                  </div>
                </div>
                {!readOnly && (
                  <button
                    onClick={() => setEditingBlock(block)}
                    style={{
                      padding: '4px 8px',
                      fontSize: '10px',
                      background: 'rgba(59,130,246,0.15)',
                      color: '#3b82f6',
                      border: '1px solid rgba(59,130,246,0.3)',
                      borderRadius: '4px',
                      cursor: 'pointer',
                    }}
                  >
                    Edit
                  </button>
                )}
              </div>
            )
          })}
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

      {editingBlock && (
        <ContextItemEditor
          block={editingBlock}
          onSave={(edit) => handleSaveGovernance(editingBlock, edit)}
          onClose={() => setEditingBlock(null)}
        />
      )}
    </div>
  )
}
