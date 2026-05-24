/**
 * SafeLinkModal — P2.7 link-open confirmation flow.
 *
 * Always shown before opening any external link from a BEAP inbox message.
 * Defaults to "Open in sandbox" (the safe path). "Open in browser" is always
 * available but gated by a credential-phishing acknowledgment checkbox when
 * the URL is flagged as a credential-request attempt.
 *
 * The caller is responsible for logging the user's final action (audit trail).
 */

import React, { useEffect, useState } from 'react'
import type { LinkOpenDecision } from '../utils/safeLinks'

export interface SafeLinkModalProps {
  isOpen: boolean
  url: string
  /**
   * Resets checkbox state when the user opens a different link or message.
   * Recommended: `${messageId}:${url}`.
   */
  contextKey: string
  /** Pre-computed from `interceptClick`. */
  decision: LinkOpenDecision
  /** Clone the full message to the sandbox orchestrator with this URL as context. */
  onOpenInSandbox: () => void
  /** Open in the OS default browser via the controlled app path. */
  onOpenInBrowser: () => void
  onCancel: () => void
  /** Whether sandbox clone is available on this device. When false the button is shown but disabled. */
  sandboxAvailable?: boolean
  sandboxBusy?: boolean
  /** On a sandbox orchestrator: show extra "treat as compromised" guidance. */
  showSandboxOrchestratorWarning?: boolean
}

const WARN_PRIMARY =
  'External links can be unsafe. The sandbox orchestrator opens the link in isolated hardware — the recommended path.'

const WARN_SANDBOX_ORC =
  'This device is a Sandbox orchestrator. Treat it as potentially compromised. Only enter passwords on websites where two-factor authentication is enabled.'

const CREDENTIAL_ACK_LABEL =
  'I understand this URL may be a credential phishing attempt and accept full responsibility for opening it in a browser.'

const SANDBOX_UNAVAILABLE_HINT =
  'Sandbox not connected. Connect a sandbox orchestrator in Handshakes to enable this option.'

function tryExtractDomain(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url.slice(0, 80)
  }
}

export default function SafeLinkModal({
  isOpen,
  url,
  contextKey,
  decision,
  onOpenInSandbox,
  onOpenInBrowser,
  onCancel,
  sandboxAvailable = true,
  sandboxBusy = false,
  showSandboxOrchestratorWarning = false,
}: SafeLinkModalProps) {
  const [credentialAcknowledged, setCredentialAcknowledged] = useState(false)
  const hasFlaggedInfo = !!decision.flaggedUrl
  const browserDisabled = decision.requiresCredentialAck && !credentialAcknowledged

  useEffect(() => {
    if (!isOpen) return
    setCredentialAcknowledged(false)
  }, [isOpen, contextKey])

  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen, onCancel])

  if (!isOpen) return null

  return (
    <div
      className="safe-link-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="safe-link-modal-title"
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="safe-link-modal-panel" onClick={(e) => e.stopPropagation()}>
        <h2 id="safe-link-modal-title" className="safe-link-modal-title">
          Open external link?
        </h2>

        {/* ── URL section ─────────────────────────────────────────────────── */}
        <div className="safe-link-modal-url-block">
          <div className="safe-link-modal-url-label">Target URL</div>
          <div className="safe-link-modal-url-value" title={url} data-testid="safe-link-url">
            {url}
          </div>
          <div className="safe-link-modal-url-note" data-testid="safe-link-redirects-note">
            Redirect resolution not available — URL shown as-is.
          </div>
        </div>

        {/* ── AI flagged-URL assessment ────────────────────────────────────── */}
        {hasFlaggedInfo && (
          <div
            className="safe-link-modal-flagged-block"
            role="note"
            data-testid="safe-link-flagged-block"
          >
            <div className="safe-link-modal-flagged-heading">
              <span
                className="safe-link-modal-flagged-badge"
                data-testid={
                  decision.requiresCredentialAck
                    ? 'safe-link-credential-badge'
                    : 'safe-link-flagged-badge'
                }
              >
                {decision.requiresCredentialAck ? 'CREDENTIAL RISK' : 'FLAGGED BY AI'}
              </span>
              <span className="safe-link-modal-flagged-domain">
                {tryExtractDomain(url)}
              </span>
            </div>
            <div className="safe-link-modal-flagged-reason" data-testid="safe-link-flagged-reason">
              {decision.flaggedUrl!.reason}
            </div>
          </div>
        )}

        {/* ── Standard safety warning ─────────────────────────────────────── */}
        <div className="safe-link-modal-warn-body">
          <p className="safe-link-modal-warn-para">{WARN_PRIMARY}</p>
          {showSandboxOrchestratorWarning && (
            <p className="safe-link-modal-warn-para safe-link-modal-warn-para--orc" role="note">
              {WARN_SANDBOX_ORC}
            </p>
          )}
        </div>

        {/* ── Credential acknowledgment (only for credential-risk URLs) ──── */}
        {decision.requiresCredentialAck && (
          <div className="safe-link-modal-ack-row" data-testid="safe-link-credential-ack-row">
            <label className="safe-link-modal-ack-label">
              <input
                type="checkbox"
                className="safe-link-modal-ack-check"
                data-testid="safe-link-credential-ack-checkbox"
                checked={credentialAcknowledged}
                onChange={(e) => setCredentialAcknowledged(e.target.checked)}
              />
              <span>{CREDENTIAL_ACK_LABEL}</span>
            </label>
          </div>
        )}

        {/* ── Actions ──────────────────────────────────────────────────────── */}
        <div className="safe-link-modal-actions">
          <button
            type="button"
            className="safe-link-modal-btn safe-link-modal-btn--sandbox"
            data-testid="safe-link-btn-sandbox"
            onClick={onOpenInSandbox}
            disabled={!sandboxAvailable || sandboxBusy}
            aria-busy={sandboxBusy}
            title={
              !sandboxAvailable
                ? SANDBOX_UNAVAILABLE_HINT
                : sandboxBusy
                  ? 'Cloning to sandbox…'
                  : 'Clone this message to the sandbox orchestrator for isolated link inspection (recommended)'
            }
          >
            Open in sandbox
          </button>
          <button
            type="button"
            className="safe-link-modal-btn safe-link-modal-btn--browser"
            data-testid="safe-link-btn-browser"
            onClick={onOpenInBrowser}
            disabled={browserDisabled}
            aria-disabled={browserDisabled}
            title={
              browserDisabled
                ? 'Check the acknowledgment above to enable this option'
                : 'Open in your OS default browser'
            }
          >
            Open in browser
          </button>
          <button
            type="button"
            className="safe-link-modal-btn safe-link-modal-btn--cancel"
            data-testid="safe-link-btn-cancel"
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

export { CREDENTIAL_ACK_LABEL, WARN_PRIMARY }
