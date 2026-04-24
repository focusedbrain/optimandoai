/**
 * Shown when the user chooses Sandbox on a received BEAP message in Host mode
 * but there is no clone-eligible (live) Sandbox path — with copy that depends on
 * whether a handshake + keys exist vs not configured.
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
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 500,
        background: DIALOG.overlay,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 'min(500px, 100%)',
          maxHeight: 'min(90vh, 640px)',
          overflow: 'auto',
          background: DIALOG.cardBg,
          color: DIALOG.body,
          border: `1px solid ${DIALOG.cardBorder}`,
          borderRadius: 12,
          padding: 0,
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(15, 23, 42, 0.06) inset',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: '24px 24px 20px' }}>
          <h2
            id="beap-sandbox-unavailable-title"
            style={{
              margin: 0,
              fontSize: 20,
              fontWeight: 700,
              lineHeight: 1.3,
              letterSpacing: '-0.02em',
              color: DIALOG.title,
            }}
          >
            {isOffline ? 'Sandbox orchestrator is offline' : 'No Sandbox orchestrator available'}
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
            <strong style={{ color: DIALOG.bodyStrong, fontWeight: 600 }}>Sandbox</strong> sends a{' '}
            <strong style={{ color: DIALOG.bodyStrong, fontWeight: 600 }}>clone</strong> of this BEAP message to
            your Sandbox orchestrator. The <strong style={{ color: DIALOG.bodyStrong, fontWeight: 600 }}>original
            message stays unchanged</strong>.
          </p>

          {isOffline ? (
            <div
              role="region"
              aria-label="Offline status"
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
                  fontSize: 15,
                  lineHeight: 1.5,
                  fontWeight: 600,
                  color: DIALOG.bodyStrong,
                }}
              >
                A Sandbox handshake is set up, but the Sandbox device is not connected right now (offline or the
                coordination relay is down).
              </p>
              <p
                style={{
                  margin: '10px 0 0',
                  fontSize: 14,
                  lineHeight: 1.55,
                  fontWeight: 500,
                  color: DIALOG.body,
                }}
              >
                Start the Sandbox orchestrator on that device, ensure it can reach the network, and wait for the relay
                to connect—then use Sandbox again from this message.
              </p>
            </div>
          ) : (
            <>
              <p
                style={{
                  margin: '0 0 14px',
                  fontSize: 15,
                  lineHeight: 1.55,
                  fontWeight: 500,
                  color: DIALOG.body,
                }}
              >
                To use Sandbox, sign in to a <strong style={{ color: DIALOG.bodyStrong, fontWeight: 600 }}>Sandbox
                orchestrator under the same identity</strong> as this Host, then create and activate an internal{' '}
                <strong style={{ color: DIALOG.bodyStrong, fontWeight: 600 }}>Host ↔ Sandbox</strong> handshake.
              </p>

              <p
                style={{
                  margin: '0 0 8px',
                  fontSize: 13,
                  fontWeight: 700,
                  textTransform: 'uppercase' as const,
                  letterSpacing: '0.04em',
                  color: DIALOG.supporting,
                }}
              >
                Next steps
              </p>
              <ol
                style={{
                  margin: '0 0 16px',
                  padding: '12px 16px 12px 32px',
                  fontSize: 14,
                  lineHeight: 1.55,
                  fontWeight: 500,
                  color: DIALOG.body,
                  background: DIALOG.stepBg,
                  border: `1px solid ${DIALOG.stepBorder}`,
                  borderRadius: 8,
                }}
              >
                <li style={{ marginBottom: 8 }}>
                  In Handshakes, add or <strong style={{ color: DIALOG.bodyStrong, fontWeight: 600 }}>activate</strong>
                  the internal Host ↔ Sandbox relationship for this account.
                </li>
                <li style={{ marginBottom: 0 }}>
                  Keep the <strong style={{ color: DIALOG.bodyStrong, fontWeight: 600 }}>Sandbox orchestrator
                  running</strong> and connected so the coordination relay can deliver the clone.
                </li>
              </ol>
              <p
                style={{
                  margin: 0,
                  fontSize: 14,
                  lineHeight: 1.5,
                  fontWeight: 500,
                  color: DIALOG.supporting,
                }}
              >
                After setup, the Sandbox action will send a test copy without changing this inbox message.
              </p>
            </>
          )}
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
