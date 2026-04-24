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
          background: '#0f172a',
          color: '#e2e8f0',
          border: '1px solid rgba(148, 163, 184, 0.35)',
          borderRadius: 12,
          padding: 22,
          boxShadow: '0 20px 50px rgba(0,0,0,0.45)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="beap-sandbox-unavailable-title"
          style={{ margin: '0 0 14px', fontSize: 17, fontWeight: 700, color: '#f8fafc', letterSpacing: '-0.01em' }}
        >
          {isOffline ? 'Sandbox orchestrator not currently connected' : 'No Sandbox orchestrator connected'}
        </h2>
        <p style={{ margin: '0 0 14px', fontSize: 13, color: '#e2e8f0', lineHeight: 1.65, fontWeight: 500 }}>
          The Sandbox action sends a <strong style={{ color: '#f8fafc' }}>clone</strong> of this BEAP message to a
          Sandbox orchestrator for testing. Your <strong style={{ color: '#f8fafc' }}>original message is not
          changed</strong>.
        </p>
        <p style={{ margin: '0 0 16px', fontSize: 12, color: '#cbd5e1', lineHeight: 1.6 }}>
          A Sandbox device must use the <strong style={{ color: '#e2e8f0' }}>same identity</strong> as this Host, with an
          active internal Host↔Sandbox handshake and coordination connectivity.
        </p>
        {isOffline ? (
          <p
            style={{
              margin: '0 0 16px',
              fontSize: 13,
              color: '#f1f5f9',
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
                margin: '0 0 10px',
                fontSize: 13,
                color: '#f1f5f9',
                lineHeight: 1.6,
                fontWeight: 600,
              }}
            >
              To use Sandbox, sign in to a Sandbox orchestrator with the same identity and create an internal
              handshake.
            </p>
            <p style={{ margin: '0 0 6px', fontSize: 12, color: '#94a3b8', lineHeight: 1.5, fontWeight: 600 }}>
              Then:
            </p>
            <ol
              style={{
                margin: '0 0 16px 18px',
                padding: 0,
                fontSize: 12,
                color: '#cbd5e1',
                lineHeight: 1.65,
              }}
            >
              <li>Activate the internal handshake between Host and Sandbox.</li>
              <li>Run the Sandbox orchestrator and ensure the coordination relay can connect.</li>
            </ol>
            <p style={{ margin: 0, fontSize: 12, color: '#94a3b8', lineHeight: 1.6 }}>
              Once connected, use Sandbox to test automations safely without modifying the original message.
            </p>
          </>
        )}
        {isOffline ? (
          <p style={{ margin: '16px 0 0', fontSize: 12, color: '#94a3b8', lineHeight: 1.6 }}>
            When the relay reconnects and the sandbox device is available, try Sandbox again.
          </p>
        ) : null}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 22, paddingTop: 4 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              fontSize: 12,
              fontWeight: 600,
              padding: '8px 14px',
              borderRadius: 8,
              cursor: 'pointer',
              background: 'rgba(255,255,255,0.08)',
              color: '#f1f5f9',
              border: '1px solid rgba(255,255,255,0.2)',
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
            style={{
              ...UI_BUTTON.primary,
              fontSize: 12,
              fontWeight: 600,
              padding: '8px 16px',
              borderRadius: 8,
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(124, 58, 237, 0.35)',
            }}
          >
            Open Handshakes
          </button>
        </div>
      </div>
    </div>
  )
}
