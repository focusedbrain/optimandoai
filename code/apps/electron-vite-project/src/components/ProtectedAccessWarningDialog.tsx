/**
 * ProtectedAccessWarningDialog — Mandatory warning before opening originals or external links
 *
 * Shows security-oriented copy and requires explicit acknowledgement before proceeding.
 */

import React from 'react'

export type DialogKind = 'original' | 'link'

interface Props {
  kind: DialogKind
  targetLabel: string
  open: boolean
  onClose: () => void
  onAcknowledge: () => void
}

const ORIGINAL_COPY = {
  title: 'View Original Document',
  intro: 'Opening raw binaries or documents may carry security risk.',
  recommend: 'The extracted text version is the recommended safe representation and is contextually the same for normal usage.',
  sandbox: 'If the original must be opened, it is strongly recommended to open it outside the host environment in a physically separated sandbox or orchestrator.',
}

const LINK_COPY = {
  title: 'Open External Link',
  intro: 'External destinations may be unsafe.',
  recommend: 'We recommend relying on the structured or parsing-safe context when possible.',
  sandbox: 'If you must open this link, ensure you trust the destination. Approval is required before opening.',
}

export default function ProtectedAccessWarningDialog({
  kind,
  targetLabel,
  open,
  onClose,
  onAcknowledge,
}: Props) {
  if (!open) return null
  const copy = kind === 'original' ? ORIGINAL_COPY : LINK_COPY
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="protected-access-dialog-title"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2000,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div
        style={{
          background: 'var(--color-surface, #1e293b)',
          border: '1px solid var(--color-border, rgba(255,255,255,0.12))',
          borderRadius: '12px',
          maxWidth: '420px',
          width: '90%',
          padding: '20px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}
      >
        <h3 id="protected-access-dialog-title" style={{ margin: '0 0 12px', fontSize: '16px', fontWeight: 600, color: 'var(--color-text, #e2e8f0)' }}>
          {copy.title}
        </h3>
        {targetLabel && (
          <div style={{ fontSize: '12px', color: 'var(--color-text-muted, #94a3b8)', marginBottom: '12px', wordBreak: 'break-all' }}>
            {targetLabel}
          </div>
        )}
        <p style={{ margin: '0 0 10px', fontSize: '13px', lineHeight: 1.5, color: 'var(--color-text-secondary, #cbd5e1)' }}>
          {copy.intro}
        </p>
        <p style={{ margin: '0 0 10px', fontSize: '13px', lineHeight: 1.5, color: 'var(--color-text-secondary, #cbd5e1)' }}>
          {copy.recommend}
        </p>
        <p style={{ margin: '0 0 16px', fontSize: '13px', lineHeight: 1.5, color: 'var(--color-text-secondary, #cbd5e1)' }}>
          {copy.sandbox}
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '8px 16px',
              fontSize: '13px',
              background: 'transparent',
              border: '1px solid var(--color-border, rgba(255,255,255,0.2))',
              borderRadius: '6px',
              color: 'var(--color-text-muted, #94a3b8)',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onAcknowledge}
            style={{
              padding: '8px 16px',
              fontSize: '13px',
              fontWeight: 600,
              background: 'rgba(139,92,246,0.3)',
              border: '1px solid rgba(139,92,246,0.5)',
              borderRadius: '6px',
              color: '#a78bfa',
              cursor: 'pointer',
            }}
          >
            I understand, proceed
          </button>
        </div>
      </div>
    </div>
  )
}
