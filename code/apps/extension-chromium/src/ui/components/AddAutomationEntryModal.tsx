/**
 * First step of Add Automation: choose Custom mode (wizard) vs Project Assistant (WR Desk Analysis).
 * Custom mode path is unchanged; Project Assistant is only offered when `window.analysisDashboard` exists (desktop shell).
 */

import React, { useEffect, useRef } from 'react'
import {
  getThemeTokens,
  overlayStyle,
  panelStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  closeButtonStyle,
} from '../../shared/ui/lightboxTheme'
import type { LightboxTheme } from '../../shared/ui/lightboxTheme'

export interface AddAutomationEntryModalProps {
  open: boolean
  theme: LightboxTheme
  onClose: () => void
  /** User chose the existing multi-step custom mode wizard. */
  onChooseCustomMode: () => void
  /** User chose Project Assistant — host dispatches desktop event. */
  onChooseProjectAssistant: () => void
  /** When false, Project Assistant is hidden (e.g. browser extension without Analysis). */
  showProjectAssistant: boolean
}

export function AddAutomationEntryModal({
  open,
  theme,
  onClose,
  onChooseCustomMode,
  onChooseProjectAssistant,
  showProjectAssistant,
}: AddAutomationEntryModalProps) {
  const t = getThemeTokens(theme)
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = 'add-automation-entry-title'

  useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLButtonElement>('button[data-autofocus="true"]')?.focus()
    })
  }, [open])

  if (!open) return null

  const panelSx = {
    ...panelStyle(t),
    maxWidth: 440,
    width: 'min(440px, calc(100vw - 32px))',
  }

  return (
    <div
      role="presentation"
      style={overlayStyle(t)}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onClose()
        }
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={panelSx}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'stretch',
            justifyContent: 'space-between',
            gap: 0,
            borderBottom: `1px solid ${t.border}`,
            flexShrink: 0,
            background: t.headerBg,
          }}
        >
          <div
            style={{
              width: 4,
              flexShrink: 0,
              background: t.accentGradient,
              borderRadius: '16px 0 0 0',
            }}
            aria-hidden
          />
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 12,
              padding: '18px 20px 16px 14px',
            }}
          >
            <div>
              <h2
                id={titleId}
                style={{
                  margin: 0,
                  fontSize: 18,
                  fontWeight: 700,
                  letterSpacing: '-0.02em',
                  color: t.text,
                  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
                }}
              >
                Add automation
              </h2>
              <p style={{ margin: '8px 0 0', fontSize: 12, color: t.textMuted, lineHeight: 1.45 }}>
                Choose what to create. Custom modes use the existing wizard. Project Assistant opens project setup on
                the Analysis dashboard.
              </p>
            </div>
            <button type="button" onClick={onClose} style={closeButtonStyle(t)} aria-label="Close">
              ×
            </button>
          </div>
        </div>

        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <button
            type="button"
            data-autofocus="true"
            onClick={onChooseCustomMode}
            style={{
              ...primaryButtonStyle(t),
              width: '100%',
              justifyContent: 'center',
              padding: '12px 16px',
              fontSize: 13,
            }}
          >
            Custom mode (wizard)
          </button>
          {showProjectAssistant ? (
            <button
              type="button"
              onClick={onChooseProjectAssistant}
              style={{
                ...secondaryButtonStyle(t),
                width: '100%',
                justifyContent: 'center',
                padding: '12px 16px',
                fontSize: 13,
                borderWidth: 2,
              }}
            >
              Project Assistant
            </button>
          ) : (
            <p style={{ margin: 0, fontSize: 11, color: t.textMuted, lineHeight: 1.4 }}>
              Project Assistant is available in the WR Desk desktop app (Analysis tab).
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
