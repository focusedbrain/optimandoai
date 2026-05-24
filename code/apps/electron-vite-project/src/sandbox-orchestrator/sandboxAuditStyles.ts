/**
 * Muted audit-trail styling for sandbox and quarantine UI (P5.6).
 */

import type { CSSProperties } from 'react'

export const SANDBOX_AUDIT_PALETTE = {
  panelBg: '#f4f4f5',
  panelBorder: '#d4d4d8',
  text: '#52525b',
  textMuted: '#71717a',
  header: '#3f3f46',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
} as const

export const quarantinePanelStyle: CSSProperties = {
  background: SANDBOX_AUDIT_PALETTE.panelBg,
  border: `1px solid ${SANDBOX_AUDIT_PALETTE.panelBorder}`,
  borderRadius: 6,
  padding: 16,
  color: SANDBOX_AUDIT_PALETTE.text,
  fontSize: 12,
}

export const quarantineMonoStyle: CSSProperties = {
  fontFamily: SANDBOX_AUDIT_PALETTE.mono,
  fontSize: 11,
  color: SANDBOX_AUDIT_PALETTE.textMuted,
}

export const sandboxViewerOverlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(24, 24, 27, 0.72)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 10000,
  padding: 24,
}

export const sandboxViewerPanelStyle: CSSProperties = {
  width: 'min(920px, 100%)',
  maxHeight: '85vh',
  background: SANDBOX_AUDIT_PALETTE.panelBg,
  border: `1px solid ${SANDBOX_AUDIT_PALETTE.panelBorder}`,
  borderRadius: 8,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
}

export const sandboxViewerPreStyle: CSSProperties = {
  margin: 0,
  padding: 16,
  overflow: 'auto',
  flex: 1,
  fontFamily: SANDBOX_AUDIT_PALETTE.mono,
  fontSize: 11,
  lineHeight: 1.45,
  color: SANDBOX_AUDIT_PALETTE.text,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  background: '#fafafa',
}
