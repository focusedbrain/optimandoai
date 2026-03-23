/**
 * AttachmentStatusBadge
 *
 * Matches HsContextDocumentUpload StatusBadge for consistent UX.
 * Shows: Extracting… | Text ready | Failed
 *
 * @version 1.0.0
 */

import React from 'react'

export type AttachmentParseStatus = 'pending' | 'success' | 'failed'

const CONFIGS: Record<AttachmentParseStatus, { label: string; bg: string; color: string; border: string }> = {
  pending: { label: 'Extracting…', bg: 'rgba(251,191,36,0.15)', color: '#d97706', border: 'rgba(251,191,36,0.35)' },
  success: { label: 'Text ready', bg: 'rgba(34,197,94,0.12)', color: '#16a34a', border: 'rgba(34,197,94,0.35)' },
  failed:  { label: 'Failed',     bg: 'rgba(239,68,68,0.12)',  color: '#dc2626', border: 'rgba(239,68,68,0.35)' },
}

export interface AttachmentStatusBadgeProps {
  status: AttachmentParseStatus
  theme?: 'standard' | 'dark'
}

export const AttachmentStatusBadge: React.FC<AttachmentStatusBadgeProps> = ({ status }) => {
  const cfg = CONFIGS[status]
  return (
    <span style={{
      fontSize: '10px', fontWeight: 600, padding: '2px 8px',
      borderRadius: '99px', background: cfg.bg, color: cfg.color,
      border: `1px solid ${cfg.border}`,
    }}>
      {cfg.label}
    </span>
  )
}

export default AttachmentStatusBadge
