/**
 * Shown when the user chooses Sandbox on a received BEAP message in Host mode
 * but there is no clone-eligible (live) Sandbox path — with copy that depends on
 * whether a handshake + keys exist vs not configured.
 */

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

export default function BeapSandboxUnavailableDialog({
  isOpen,
  onClose,
  variant,
  onOpenHandshakes,
}: BeapSandboxUnavailableDialogProps) {
  if (!isOpen) return null

  const isOffline = variant === 'exists_but_offline'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="beap-sandbox-unavailable-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 500,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 'min(520px, 100%)',
          maxHeight: '90vh',
          overflow: 'auto',
          background: 'var(--color-surface-elevated, #1e293b)',
          border: '1px solid var(--color-border, rgba(255,255,255,0.1))',
          borderRadius: 10,
          padding: 20,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="beap-sandbox-unavailable-title" style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>
          {isOffline ? 'Sandbox orchestrator not currently connected' : 'No Sandbox orchestrator connected'}
        </h2>
        <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--color-text-muted, #94a3b8)', lineHeight: 1.6 }}>
          The Sandbox action sends a clone of this BEAP message to a Sandbox orchestrator for testing. The original
          message stays unchanged.
        </p>
        {isOffline ? (
          <p
            style={{
              margin: '0 0 16px',
              fontSize: 12,
              color: 'var(--color-text, #e2e8f0)',
              lineHeight: 1.6,
              fontWeight: 600,
            }}
          >
            A Sandbox handshake exists, but the Sandbox orchestrator is currently offline or unavailable.
          </p>
        ) : (
          <>
            <p
              style={{
                margin: '0 0 12px',
                fontSize: 12,
                color: 'var(--color-text, #e2e8f0)',
                lineHeight: 1.6,
                fontWeight: 600,
              }}
            >
              To use Sandbox, sign in to a Sandbox orchestrator with the same identity and create an internal
              handshake.
            </p>
            <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--color-text-muted, #94a3b8)', lineHeight: 1.6 }}>
              Then:
            </p>
            <ol
              style={{
                margin: '0 0 16px 18px',
                padding: 0,
                fontSize: 12,
                color: 'var(--color-text-muted, #94a3b8)',
                lineHeight: 1.6,
              }}
            >
              <li>Activate the internal handshake between Host and Sandbox.</li>
              <li>Make sure the Sandbox orchestrator is running and the coordination relay can connect.</li>
            </ol>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-muted, #94a3b8)', lineHeight: 1.6 }}>
              Once connected, you can use Sandbox to test automations safely without changing the original message.
            </p>
          </>
        )}
        {isOffline ? (
          <p style={{ margin: '16px 0 0', fontSize: 12, color: 'var(--color-text-muted, #94a3b8)', lineHeight: 1.6 }}>
            When the relay reconnects and the sandbox device is available, try Sandbox again.
          </p>
        ) : null}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              fontSize: 12,
              padding: '8px 14px',
              borderRadius: 6,
              cursor: 'pointer',
              background: 'rgba(255,255,255,0.06)',
              color: 'var(--color-text, #e2e8f0)',
              border: '1px solid rgba(255,255,255,0.12)',
            }}
          >
            Close
          </button>
          <button
            type="button"
            onClick={() => {
              onOpenHandshakes()
              onClose()
            }}
            style={{ ...UI_BUTTON.primary, fontSize: 12, padding: '8px 14px', borderRadius: 6, cursor: 'pointer' }}
          >
            Open Handshakes
          </button>
        </div>
      </div>
    </div>
  )
}
