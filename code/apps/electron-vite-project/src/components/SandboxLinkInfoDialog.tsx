/**
 * Shown from the external-link warning when the user picks Sandbox but no connected Sandbox
 * orchestrator is available. Copy is specific to the link/Sandbox flow (separate from toolbar unavailable).
 */

import { useEffect } from 'react'
import { UI_BUTTON } from '../styles/uiContrastTokens'

export interface SandboxLinkInfoDialogProps {
  isOpen: boolean
  onClose: () => void
  onOpenHandshakes: () => void
}

const CARD = {
  overlay: 'rgba(15, 23, 42, 0.55)',
  title: '#0f172a',
  body: '#1e293b',
} as const

export default function SandboxLinkInfoDialog({ isOpen, onClose, onOpenHandshakes }: SandboxLinkInfoDialogProps) {
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="sandbox-link-info-title"
      className="wrdesk-modal__backdrop"
      style={{ background: CARD.overlay, zIndex: 1200 }}
      onClick={onClose}
    >
      <div
        className="wrdesk-modal__panel wrdesk-modal__panel--sandbox-wide"
        onClick={(e) => e.stopPropagation()}
        style={{ boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.2)' }}
      >
        <div style={{ padding: '24px 24px 0' }}>
          <h2 id="sandbox-link-info-title" className="wrdesk-modal__title" style={{ color: CARD.title, fontSize: 20, letterSpacing: '-0.02em' }}>
            No Sandbox orchestrator connected
          </h2>
        </div>
        <div style={{ padding: '8px 24px 20px' }}>
          <p style={{ margin: '0 0 16px', fontSize: 15, lineHeight: 1.6, color: CARD.body, fontWeight: 500 }}>
            Sandbox sends a clone of the entire BEAP message to a connected Sandbox orchestrator. This lets you inspect risky links, PDFs, attachments, and
            original artifacts in an isolated environment without changing the original message.
          </p>
          <p style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700, color: CARD.title }}>To use Sandbox:</p>
          <ol style={{ margin: '0 0 16px', paddingLeft: 22, fontSize: 14, lineHeight: 1.65, color: CARD.body, fontWeight: 500 }}>
            <li>Start a Sandbox orchestrator under the same identity.</li>
            <li>Create or activate an internal Host ↔ Sandbox handshake.</li>
            <li>Keep the Sandbox orchestrator online and connected to the coordination relay.</li>
          </ol>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: CARD.body, fontWeight: 500 }}>
            Recommended setup: run the Sandbox orchestrator on isolated hardware such as a mini PC. A KVM switch with hotkeys is recommended so you can inspect
            risky content without interrupting your normal workflow.
          </p>
        </div>
        <div
          className="wrdesk-modal__footer"
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 10,
            padding: '16px 24px 22px',
            borderTop: '1px solid #e2e8f0',
            background: '#f8fafc',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              ...UI_BUTTON.secondary,
              fontSize: 13,
              padding: '8px 16px',
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
              fontSize: 13,
              padding: '8px 16px',
            }}
          >
            Open Handshakes
          </button>
        </div>
      </div>
    </div>
  )
}
