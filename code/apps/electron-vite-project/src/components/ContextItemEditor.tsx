/**
 * ContextItemEditor — Compact drawer for per-item governance policy
 *
 * Allows editing item-level content_type, sensitivity, and usage policy.
 * Enterprise tone, minimal layout.
 */

import { useState } from 'react'
import type { VerifiedContextBlock } from './contextEscaping' // uses governance from contextEscaping

export interface ContextItemGovernanceEdit {
  content_type: string
  sensitivity: string
  usage_policy: {
    searchable: boolean
    local_ai_allowed: boolean
    cloud_ai_allowed: boolean
    auto_reply_allowed: boolean
    export_allowed: boolean
    transmit_to_peer_allowed: boolean
  }
}

const CONTENT_TYPES = ['message', 'plaintext', 'document', 'user_manual', 'contract', 'pii', 'signature_material', 'api_credential', 'graph_metadata', 'profile_document', 'other'] as const
const SENSITIVITIES = ['public', 'internal', 'confidential', 'restricted'] as const

interface Props {
  block: VerifiedContextBlock
  onSave: (governance: ContextItemGovernanceEdit) => void
  onClose: () => void
}

export default function ContextItemEditor({ block, onSave, onClose }: Props) {
  const g = block.governance
  const [contentType, setContentType] = useState(g?.content_type ?? block.type ?? 'plaintext')
  const [sensitivity, setSensitivity] = useState(g?.sensitivity ?? 'internal')
  const [searchable, setSearchable] = useState(g?.usage_policy?.searchable ?? false)
  const [localAi, setLocalAi] = useState(g?.usage_policy?.local_ai_allowed ?? false)
  const [cloudAi, setCloudAi] = useState(g?.usage_policy?.cloud_ai_allowed ?? false)
  const [autoReply, setAutoReply] = useState(g?.usage_policy?.auto_reply_allowed ?? false)
  const [exportAllowed, setExportAllowed] = useState(g?.usage_policy?.export_allowed ?? false)
  const [transmitToPeer, setTransmitToPeer] = useState(g?.usage_policy?.transmit_to_peer_allowed ?? true)

  const handleSave = () => {
    onSave({
      content_type: contentType,
      sensitivity,
      usage_policy: {
        searchable,
        local_ai_allowed: localAi,
        cloud_ai_allowed: cloudAi,
        auto_reply_allowed: autoReply,
        export_allowed: exportAllowed,
        transmit_to_peer_allowed: transmitToPeer,
      },
    })
    onClose()
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        width: '320px',
        maxWidth: '100%',
        height: '100%',
        background: 'var(--color-surface, #1e293b)',
        borderLeft: '1px solid var(--color-border, rgba(255,255,255,0.08))',
        boxShadow: '-4px 0 24px rgba(0,0,0,0.3)',
        zIndex: 1100,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '16px', borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.08))', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--color-text, #e2e8f0)' }}>
          Context item policy
        </h4>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '18px', padding: '4px' }}
        >
          ×
        </button>
      </div>

      <div style={{ padding: '16px', overflowY: 'auto', flex: 1 }}>
        <div style={{ marginBottom: '12px', fontSize: '11px', color: '#94a3b8' }}>
          {block.block_id.slice(0, 20)}…
        </div>

        <label style={{ display: 'block', marginBottom: '12px' }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Content type</span>
          <select
            value={contentType}
            onChange={(e) => setContentType(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 10px',
              fontSize: '12px',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '6px',
              color: '#e2e8f0',
            }}
          >
            {CONTENT_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>

        <label style={{ display: 'block', marginBottom: '12px' }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Sensitivity</span>
          <select
            value={sensitivity}
            onChange={(e) => setSensitivity(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 10px',
              fontSize: '12px',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '6px',
              color: '#e2e8f0',
            }}
          >
            {SENSITIVITIES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>

        <div style={{ marginTop: '16px', fontSize: '11px', fontWeight: 600, color: '#94a3b8', marginBottom: '8px' }}>Usage policy</div>

        {[
          { label: 'Searchable', value: searchable, set: setSearchable },
          { label: 'Local AI usage', value: localAi, set: setLocalAi },
          { label: 'Cloud AI usage', value: cloudAi, set: setCloudAi },
          { label: 'Auto-reply allowed', value: autoReply, set: setAutoReply },
          { label: 'Export allowed', value: exportAllowed, set: setExportAllowed },
          { label: 'Transmit to peer', value: transmitToPeer, set: setTransmitToPeer },
        ].map(({ label, value, set }) => (
          <label key={label} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', cursor: 'pointer' }}>
            <input type="checkbox" checked={value} onChange={() => set(!value)} style={{ margin: 0 }} />
            <span style={{ fontSize: '12px', color: '#d0d0d0' }}>{label}</span>
          </label>
        ))}
      </div>

      <div style={{ padding: '16px', borderTop: '1px solid var(--color-border, rgba(255,255,255,0.08))' }}>
        <button
          onClick={handleSave}
          style={{
            width: '100%',
            padding: '10px 16px',
            fontSize: '12px',
            fontWeight: 600,
            background: 'rgba(59,130,246,0.2)',
            color: '#3b82f6',
            border: '1px solid rgba(59,130,246,0.4)',
            borderRadius: '6px',
            cursor: 'pointer',
          }}
        >
          Save
        </button>
      </div>
    </div>
  )
}
