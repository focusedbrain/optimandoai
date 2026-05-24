/** Shared inline styles for edge tier wizard (matches EdgeTierAdminPanel palette). */

import type { CSSProperties } from 'react'

export const wizardPanelStyle: CSSProperties = {
  fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  fontSize: 13,
  color: '#e2e8f0',
  lineHeight: 1.5,
}

export const wizardOverlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 10000,
  background: 'rgba(0,0,0,0.55)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
}

export const wizardCardStyle: CSSProperties = {
  width: '100%',
  maxWidth: 640,
  maxHeight: '90vh',
  overflow: 'auto',
  background: '#0f172a',
  border: '1px solid #475569',
  borderRadius: 10,
  boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
  padding: 20,
}

export const btnPrimary: CSSProperties = {
  padding: '8px 14px',
  borderRadius: 6,
  border: '1px solid #6366f1',
  background: '#4f46e5',
  color: '#fff',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
}

export const btnSecondary: CSSProperties = {
  padding: '8px 14px',
  borderRadius: 6,
  border: '1px solid #475569',
  background: '#1e293b',
  color: '#e2e8f0',
  cursor: 'pointer',
  fontSize: 13,
}

export const btnDanger: CSSProperties = {
  ...btnSecondary,
  borderColor: '#b91c1c',
  color: '#fca5a5',
}

export const errorBox: CSSProperties = {
  padding: 10,
  borderRadius: 6,
  background: 'rgba(239,68,68,0.12)',
  border: '1px solid rgba(239,68,68,0.35)',
  color: '#fecaca',
  marginBottom: 12,
}

export const helpBox: CSSProperties = {
  padding: 10,
  borderRadius: 6,
  background: 'rgba(30,41,59,0.8)',
  border: '1px solid rgba(148,163,184,0.25)',
  color: '#94a3b8',
  fontSize: 12,
  marginBottom: 12,
}
