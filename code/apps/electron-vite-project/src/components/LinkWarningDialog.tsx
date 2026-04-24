/**
 * LinkWarningDialog — Confirmation before opening external links from BEAP inbox bodies.
 * Strongly encourages cloning the full message to a Sandbox orchestrator before opening risky URLs.
 */

import React, { useEffect } from 'react'
import { BeapInboxSandboxCloneIcon } from './BeapInboxSandboxCloneIcon'

export interface LinkWarningDialogProps {
  isOpen: boolean
  url: string
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

export default function LinkWarningDialog({
  isOpen,
  url,
  onConfirm,
  onCancel,
  showSandboxAction = false,
  onSandbox,
  sandboxBusy = false,
}: LinkWarningDialogProps) {
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
      <div className="link-warning-dialog">
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
        <div className="link-warning-actions">
          {showSandboxAction && onSandbox ? (
            <button
              type="button"
              className="link-warning-btn-sandbox"
              onClick={() => void onSandbox()}
              disabled={sandboxBusy}
              aria-busy={sandboxBusy}
            >
              <span className="link-warning-btn-sandbox__icon" aria-hidden>
                <BeapInboxSandboxCloneIcon />
              </span>
              <span className="link-warning-btn-sandbox__label">Sandbox</span>
            </button>
          ) : null}
          <button type="button" className="link-warning-btn-open" onClick={onConfirm}>
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
