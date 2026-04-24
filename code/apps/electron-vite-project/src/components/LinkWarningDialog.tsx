/**
 * LinkWarningDialog — Mandatory gate before opening external links from BEAP inbox bodies.
 * Open link is disabled until the user checks the risk acknowledgement.
 */

import React, { useEffect, useState } from 'react'
import { BeapInboxSandboxCloneIcon } from './BeapInboxSandboxCloneIcon'

export interface LinkWarningDialogProps {
  isOpen: boolean
  url: string
  /** Resets the risk checkbox when the user opens a different link or message (e.g. `${messageId}:${url}`). */
  contextKey: string
  onConfirm: () => void
  onCancel: () => void
  /** Host orchestrator only; hidden on Sandbox or until mode is known. */
  showSandboxAction?: boolean
  /** Clone full message via existing sandbox prepare/send (not URL-only). */
  onSandbox?: () => void
  sandboxBusy?: boolean
}

const BODY_PRIMARY =
  'External links and original artifacts can be unsafe. Treat every link, PDF, attachment, or downloaded file as untrusted content.'

const BODY_SANDBOX =
  'For security reasons, it is strongly recommended to open links and original artifacts only inside a connected Sandbox orchestrator running on isolated hardware, such as a separate mini PC.'

const BODY_KVM =
  'A KVM switch with hotkeys is the recommended setup, so you can inspect risky content in the Sandbox environment without interrupting your normal workflow.'

const RISK_CHECK_LABEL = 'I understand the risks of opening external links.'

const SANDBOX_ACTION_TOOLTIP =
  'Clone the entire BEAP message to your Sandbox orchestrator so links, PDFs, attachments, and original artifacts can be inspected on isolated hardware. If the Sandbox is offline, the clone will be queued.'

export default function LinkWarningDialog({
  isOpen,
  url,
  contextKey,
  onConfirm,
  onCancel,
  showSandboxAction = false,
  onSandbox,
  sandboxBusy = false,
}: LinkWarningDialogProps) {
  const [riskAccepted, setRiskAccepted] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    setRiskAccepted(false)
  }, [isOpen, url, contextKey])

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
      className="link-warning-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="link-warning-title"
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="link-warning-dialog" onClick={(e) => e.stopPropagation()}>
        <h2 id="link-warning-title" className="link-warning-title">
          Open external link?
        </h2>
        <div className="link-warning-body">
          <p className="link-warning-para link-warning-para--primary">{BODY_PRIMARY}</p>
          <p className="link-warning-para">{BODY_SANDBOX}</p>
          <p className="link-warning-para">{BODY_KVM}</p>
        </div>
        <div className="link-warning-url-label">Target URL</div>
        <div className="link-warning-url-block" title={url}>
          {url}
        </div>

        <div className="link-warning-risk-row">
          <label className="link-warning-risk-label">
            <input
              type="checkbox"
              className="link-warning-risk-check"
              checked={riskAccepted}
              onChange={(e) => setRiskAccepted(e.target.checked)}
            />
            <span>{RISK_CHECK_LABEL}</span>
          </label>
        </div>

        <div className="link-warning-actions">
          {showSandboxAction && onSandbox ? (
            <button
              type="button"
              className="link-warning-btn-sandbox"
              onClick={() => void onSandbox()}
              disabled={sandboxBusy}
              aria-busy={sandboxBusy}
              title={SANDBOX_ACTION_TOOLTIP}
            >
              <span className="link-warning-btn-sandbox__icon" aria-hidden>
                <BeapInboxSandboxCloneIcon />
              </span>
              <span className="link-warning-btn-sandbox__label">Sandbox</span>
            </button>
          ) : null}
          <button
            type="button"
            className="link-warning-btn-open"
            onClick={onConfirm}
            disabled={!riskAccepted}
            aria-disabled={!riskAccepted}
            title={!riskAccepted ? 'Confirm the checkbox above to enable opening this link' : 'Open in your default browser (controlled app path when available)'}
          >
            Open link
          </button>
          <button type="button" className="link-warning-btn-cancel" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

export { SANDBOX_ACTION_TOOLTIP, RISK_CHECK_LABEL }
