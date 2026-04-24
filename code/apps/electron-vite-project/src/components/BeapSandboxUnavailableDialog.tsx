/**
 * Shown when the user chooses Sandbox in Host mode but there is no **active internal**
 * Host↔Sandbox handshake. Live relay / queue status does not use this dialog.
 *
 * Styling: explicit light card on dim overlay (no theme inheritance for body text).
 */

import { useEffect } from 'react'
import type { SandboxOrchestratorAvailabilityStatus } from '../types/sandboxOrchestratorAvailability'
import { UI_BUTTON } from '../styles/uiContrastTokens'
import './handshakeViewTypes'

export type BeapSandboxUnavailableVariant = Extract<
  SandboxOrchestratorAvailabilityStatus,
  'not_configured' | 'exists_but_offline'
>

export interface BeapSandboxUnavailableDialogProps {
  isOpen: boolean
  onClose: () => void
  /** Drives title/body. `connected` is not used (dialog not shown). */
  variant: BeapSandboxUnavailableVariant
  /** Navigates to the Handshakes view (e.g. create or review internal handshakes). */
  onOpenHandshakes: () => void
}

/** Explicit light-surface dialog tokens — readable on dim backdrop without CSS variables. */
const DIALOG = {
  overlay: 'rgba(15, 23, 42, 0.72)',
  cardBg: '#ffffff',
  cardBorder: '#e2e8f0',
  title: '#0f172a',
  body: '#1e293b',
  bodyStrong: '#0f172a',
  /** Secondary but still high contrast (not “muted” grays for primary copy). */
  supporting: '#334155',
  stepBg: '#f8fafc',
  stepBorder: '#e2e8f0',
  offlineBandBg: '#fffbeb',
  offlineBandBorder: '#fcd34d',
  closeBg: '#ffffff',
  closeBorder: '#cbd5e1',
  closeText: '#1e293b',
} as const

export default function BeapSandboxUnavailableDialog({
  isOpen,
  onClose,
  variant,
  onOpenHandshakes,
}: BeapSandboxUnavailableDialogProps) {
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const isOffline = variant === 'exists_but_offline'
  const descId = 'beap-sandbox-unavailable-desc'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="beap-sandbox-unavailable-title"
      aria-describedby={descId}
      className="wrdesk-modal__backdrop"
      onClick={onClose}
    >
      <div
        className="wrdesk-modal__panel wrdesk-modal__panel--sandbox-wide"
        style={{ overflow: 'auto', color: DIALOG.body, boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.2)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: '24px 24px 20px' }}>
          <h2 id="beap-sandbox-unavailable-title" className="wrdesk-modal__title" style={{ fontSize: 20, letterSpacing: '-0.02em' }}>
            No active Sandbox handshake found
          </h2>
        </div>

        <div
          id={descId}
          style={{ padding: '0 24px 8px' }}
        >
          <p
            style={{
              margin: '0 0 16px',
              fontSize: 15,
              lineHeight: 1.55,
              fontWeight: 500,
              color: DIALOG.body,
            }}
          >
            Sandbox requires an <strong style={{ color: DIALOG.bodyStrong, fontWeight: 600 }}>ACTIVE internal Host ↔
            Sandbox</strong> handshake under the same identity. Once this handshake exists, BEAP messages can be cloned
            to the Sandbox. If the Sandbox is temporarily offline, the clone can still be queued for delivery.
          </p>

          {isOffline ? (
            <div
              role="region"
              aria-label="Coordination status"
              style={{
                marginBottom: 16,
                padding: 14,
                borderRadius: 8,
                background: DIALOG.offlineBandBg,
                border: `1px solid ${DIALOG.offlineBandBorder}`,
              }}
            >
              <p
                style={{
                  margin: 0,
                  fontSize: 14,
                  lineHeight: 1.55,
                  fontWeight: 500,
                  color: DIALOG.body,
                }}
              >
                The coordination relay may be disconnected — that does not remove your handshake. Create or open an
                active internal Host ↔ Sandbox pairing in Handshakes if you still need setup.
              </p>
            </div>
          ) : null}
        </div>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 10,
            justifyContent: 'flex-end',
            padding: '20px 24px 24px',
            borderTop: `1px solid ${DIALOG.stepBorder}`,
            background: '#fafafa',
            borderRadius: '0 0 12px 12px',
          }}
        >
          <button
            type="button"
            className="beap-sandbox-unavail-dialog__btn beap-sandbox-unavail-dialog__btn--secondary"
            onClick={onClose}
            style={{
              fontSize: 13,
              fontWeight: 600,
              padding: '10px 16px',
              borderRadius: 8,
              cursor: 'pointer',
              background: DIALOG.closeBg,
              color: DIALOG.closeText,
              border: `1px solid ${DIALOG.closeBorder}`,
              boxShadow: '0 1px 2px rgba(15, 23, 42, 0.06)',
            }}
          >
            Close
          </button>
          <button
            type="button"
            className="beap-sandbox-unavail-dialog__btn beap-sandbox-unavail-dialog__btn--primary"
            onClick={() => {
              onOpenHandshakes()
              onClose()
            }}
            style={{
              ...UI_BUTTON.primary,
              fontSize: 13,
              fontWeight: 600,
              padding: '10px 18px',
              borderRadius: 8,
              cursor: 'pointer',
              color: '#ffffff',
              background: UI_BUTTON.primary.background,
              border: UI_BUTTON.primary.border,
              boxShadow: '0 2px 8px rgba(124, 58, 237, 0.4)',
            }}
          >
            Open Handshakes
          </button>
        </div>
      </div>
    </div>
  )
}
