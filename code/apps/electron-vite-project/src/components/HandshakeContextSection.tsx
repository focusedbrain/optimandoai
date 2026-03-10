/**
 * HandshakeContextSection — Context blocks + attach button + policies
 * Shown in RelationshipDetail when state is ACCEPTED or ACTIVE.
 * User-first layout: show actual content prominently, governance as secondary detail.
 */

import { useState } from 'react'
import type { VerifiedContextBlock } from './contextEscaping'
import PolicyRadioGroup, { type PolicySelection } from './PolicyRadioGroup'
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

// ── Helpers ──

function contentTypeLabel(type: string | undefined): string {
  if (!type) return 'Data'
  const map: Record<string, string> = {
    text: 'Text',
    document: 'Document',
    url: 'Link',
    email: 'Email',
    json: 'Structured Data',
    image: 'Image',
    file: 'File',
    note: 'Note',
    profile: 'Profile',
    contact: 'Contact',
  }
  return map[type.toLowerCase()] ?? type.charAt(0).toUpperCase() + type.slice(1)
}

function sensitivityColor(sensitivity: string | undefined): { bg: string; text: string } {
  switch (sensitivity?.toLowerCase()) {
    case 'public': return { bg: 'rgba(34,197,94,0.12)', text: '#22c55e' }
    case 'internal': return { bg: 'rgba(59,130,246,0.12)', text: '#3b82f6' }
    case 'confidential': return { bg: 'rgba(245,158,11,0.12)', text: '#f59e0b' }
    case 'secret':
    case 'restricted': return { bg: 'rgba(239,68,68,0.12)', text: '#ef4444' }
    default: return { bg: 'rgba(107,114,128,0.12)', text: '#6b7280' }
  }
}

function ContextBlockCard({
  block,
  showEdit,
  onEdit,
}: {
  block: VerifiedContextBlock
  showEdit: boolean
  onEdit: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const g = block.governance
  const type = g?.content_type ?? block.type
  const sensitivity = g?.sensitivity ?? 'internal'
  const sensColors = sensitivityColor(sensitivity)
  const payload = block.payload_ref ?? ''
  const isLong = payload.length > 280
  const displayPayload = isLong && !expanded ? payload.slice(0, 280) + '…' : payload
  const isReceived = block.source === 'received'

  return (
    <div
      style={{
        marginBottom: '10px',
        background: isReceived ? 'rgba(139,92,246,0.06)' : 'rgba(255,255,255,0.04)',
        border: isReceived
          ? '1px solid rgba(139,92,246,0.2)'
          : '1px solid rgba(255,255,255,0.08)',
        borderRadius: '8px',
        overflow: 'hidden',
      }}
    >
      {/* Card header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          gap: '8px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
          <span style={{ fontSize: '16px', lineHeight: 1, flexShrink: 0 }}>
            {typeIcon(type)}
          </span>
          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text, #e2e8f0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {contentTypeLabel(type)}
          </span>
          <span style={{
            fontSize: '9px', fontWeight: 600, padding: '2px 6px',
            borderRadius: '3px', background: sensColors.bg, color: sensColors.text,
            textTransform: 'uppercase', flexShrink: 0,
          }}>
            {sensitivity}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          <span style={{
            fontSize: '9px', padding: '2px 6px', borderRadius: '3px',
            background: isReceived ? 'rgba(139,92,246,0.15)' : 'rgba(34,197,94,0.1)',
            color: isReceived ? '#a78bfa' : '#22c55e',
            fontWeight: 600,
          }}>
            {isReceived ? '↓ Received' : '↑ Sent'}
          </span>
          {showEdit && (
            <button
              onClick={onEdit}
              style={{
                padding: '3px 8px', fontSize: '10px',
                background: 'rgba(59,130,246,0.15)', color: '#3b82f6',
                border: '1px solid rgba(59,130,246,0.3)', borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              Edit
            </button>
          )}
        </div>
      </div>

      {/* Payload content — the actual data */}
      {payload ? (
        <div style={{ padding: '10px 12px' }}>
          <pre
            style={{
              margin: 0, fontSize: '12px', lineHeight: 1.6,
              color: 'var(--color-text, #e2e8f0)',
              fontFamily: type === 'json' || type === 'code' ? 'monospace' : 'inherit',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}
          >
            {displayPayload}
          </pre>
          {isLong && (
            <button
              onClick={() => setExpanded(!expanded)}
              style={{
                marginTop: '6px', padding: '0', border: 'none', background: 'transparent',
                color: '#a78bfa', fontSize: '11px', cursor: 'pointer', fontWeight: 600,
              }}
            >
              {expanded ? '↑ Show less' : '↓ Show more'}
            </button>
          )}
        </div>
      ) : (
        <div style={{ padding: '10px 12px', fontSize: '12px', color: 'var(--color-text-muted, #94a3b8)', fontStyle: 'italic' }}>
          (no content preview available)
        </div>
      )}

      {/* Governance footer — compact, secondary info */}
      <div style={{
        display: 'flex', gap: '6px', flexWrap: 'wrap',
        padding: '6px 12px',
        borderTop: '1px solid rgba(255,255,255,0.04)',
        background: 'rgba(0,0,0,0.15)',
      }}>
        <PolicyPip label="AI" on={g?.usage_policy?.local_ai_allowed ?? false} />
        <PolicyPip label="Cloud AI" on={g?.usage_policy?.cloud_ai_allowed ?? false} />
        <PolicyPip label="Search" on={g?.usage_policy?.searchable ?? false} />
        <PolicyPip label="Export" on={g?.usage_policy?.export_allowed ?? false} />
        {block.embedding_status === 'complete' && (
          <span style={{ fontSize: '9px', color: '#22c55e', marginLeft: 'auto', alignSelf: 'center' }}>
            ✓ indexed
          </span>
        )}
        {block.embedding_status === 'pending' && (
          <span style={{ fontSize: '9px', color: '#f59e0b', marginLeft: 'auto', alignSelf: 'center' }}>
            ⏳ indexing…
          </span>
        )}
      </div>
    </div>
  )
}

function typeIcon(type: string | undefined): string {
  switch (type?.toLowerCase()) {
    case 'document': return '📄'
    case 'url':
    case 'link': return '🔗'
    case 'email': return '✉️'
    case 'image': return '🖼️'
    case 'json':
    case 'structured data': return '🗂️'
    case 'note': return '📝'
    case 'profile': return '👤'
    case 'contact': return '📇'
    case 'file': return '📎'
    default: return '📋'
  }
}

function PolicyPip({ label, on }: { label: string; on: boolean }) {
  return (
    <span style={{
      fontSize: '9px', padding: '1px 5px', borderRadius: '3px',
      background: on ? 'rgba(34,197,94,0.1)' : 'rgba(107,114,128,0.12)',
      color: on ? '#22c55e' : '#4b5563',
    }}>
      {label}: {on ? '✓' : '—'}
    </span>
  )
}

// ── Main Component ──

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
  const [viewMode, setViewMode] = useState<'received' | 'sent' | 'all'>('received')

  const receivedCount = contextBlocks.filter((b) => b.source === 'received').length
  const sentCount = contextBlocks.filter((b) => b.source === 'sent').length
  const filteredBlocks =
    viewMode === 'all' ? contextBlocks : contextBlocks.filter((b) => b.source === viewMode)

  const handleRequestUnlock = () => {
    window.dispatchEvent(new CustomEvent('vault-status-changed'))
    window.handshakeView?.requestUnlockVault?.().then((r) => {
      if (r?.needsUnlock) {
        window.dispatchEvent(new CustomEvent('vault-status-changed'))
      }
    })
  }

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

  // ── Vault Locked State ──
  if (!isVaultUnlocked) {
    return (
      <div style={{
        marginBottom: '16px',
        padding: '28px 24px',
        background: 'rgba(59,130,246,0.06)',
        borderRadius: '10px',
        border: '1px solid rgba(59,130,246,0.2)',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: '32px', marginBottom: '12px' }}>🔒</div>
        <div style={{ fontSize: '14px', fontWeight: 700, color: '#3b82f6', marginBottom: '8px' }}>
          Vault Locked
        </div>
        <div style={{ fontSize: '12px', color: 'var(--color-text-muted, #94a3b8)', lineHeight: 1.6, marginBottom: '16px', maxWidth: '300px', margin: '0 auto 16px' }}>
          Unlock your vault to view shared context data. This data is protected and requires vault access.
        </div>
        <button
          onClick={handleRequestUnlock}
          style={{
            padding: '9px 20px', fontSize: '12px', fontWeight: 600,
            background: 'rgba(59,130,246,0.2)', color: '#3b82f6',
            border: '1px solid rgba(59,130,246,0.4)', borderRadius: '7px',
            cursor: 'pointer',
          }}
        >
          Unlock Vault
        </button>
      </div>
    )
  }

  // ── Context Display ──
  return (
    <div style={{ marginBottom: '16px' }}>

      {/* Section header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: '12px',
      }}>
        <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: 'var(--color-text, #e2e8f0)' }}>
          Shared Context
          {contextBlocks.length > 0 && (
            <span style={{ marginLeft: '8px', fontSize: '12px', fontWeight: 400, color: 'var(--color-text-muted, #94a3b8)' }}>
              ({contextBlocks.length} block{contextBlocks.length !== 1 ? 's' : ''})
            </span>
          )}
        </h4>
        {!readOnly && (
          <button
            onClick={onAttachData}
            disabled={!isVaultUnlocked}
            title={!isVaultUnlocked ? 'Unlock vault to attach context data' : 'Attach context data'}
            style={{
              padding: '6px 14px', fontSize: '11px', fontWeight: 600,
              background: 'rgba(139,92,246,0.2)', color: '#a78bfa',
              border: '1px solid rgba(139,92,246,0.4)', borderRadius: '6px',
              cursor: isVaultUnlocked ? 'pointer' : 'not-allowed',
              opacity: isVaultUnlocked ? 1 : 0.5,
            }}
          >
            + Add Context
          </button>
        )}
      </div>

      {/* Tabs — only shown when there are blocks */}
      {contextBlocks.length > 0 && (
        <div style={{
          display: 'flex', gap: '2px',
          background: 'rgba(255,255,255,0.04)',
          borderRadius: '7px', padding: '3px',
          marginBottom: '14px',
        }}>
          {(['received', 'sent', 'all'] as const).map((mode) => {
            const isActive = viewMode === mode
            const count = mode === 'received' ? receivedCount : mode === 'sent' ? sentCount : contextBlocks.length
            const label = mode === 'received' ? '↓ Received' : mode === 'sent' ? '↑ Sent' : 'All'
            return (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                style={{
                  flex: 1, padding: '6px 10px', fontSize: '11px', fontWeight: isActive ? 700 : 500,
                  background: isActive ? 'rgba(139,92,246,0.2)' : 'transparent',
                  border: isActive ? '1px solid rgba(139,92,246,0.35)' : '1px solid transparent',
                  borderRadius: '5px',
                  color: isActive ? '#a78bfa' : 'var(--color-text-muted, #94a3b8)',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {label} ({count})
              </button>
            )
          })}
        </div>
      )}

      {/* Block list */}
      {contextBlocks.length === 0 ? (
        <div style={{
          padding: '24px 16px', textAlign: 'center',
          background: 'rgba(255,255,255,0.03)', borderRadius: '8px',
          border: '1px solid rgba(255,255,255,0.06)',
        }}>
          <div style={{ fontSize: '24px', marginBottom: '8px', opacity: 0.4 }}>📭</div>
          <div style={{ fontSize: '12px', color: 'var(--color-text-muted, #94a3b8)' }}>
            No context blocks yet.
          </div>
          {!readOnly && (
            <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '4px' }}>
              Use "+ Add Context" to share data with your counterparty.
            </div>
          )}
        </div>
      ) : filteredBlocks.length === 0 ? (
        <div style={{
          padding: '20px 16px', textAlign: 'center',
          background: 'rgba(255,255,255,0.03)', borderRadius: '8px',
          border: '1px solid rgba(255,255,255,0.06)',
        }}>
          <div style={{ fontSize: '12px', color: 'var(--color-text-muted, #94a3b8)' }}>
            {viewMode === 'received'
              ? 'No context received from counterparty yet.'
              : 'No context sent to counterparty yet.'}
          </div>
        </div>
      ) : (
        <div>
          {filteredBlocks.map((block) => (
            <ContextBlockCard
              key={block.block_id}
              block={block}
              showEdit={!readOnly}
              onEdit={() => setEditingBlock(block)}
            />
          ))}
        </div>
      )}

      {/* AI Policy settings */}
      <PolicyRadioGroup value={policies} onChange={onPolicyChange} readOnly={readOnly} />

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
