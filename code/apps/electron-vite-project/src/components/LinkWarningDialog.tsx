/**
 * LinkWarningDialog — Confirmation before opening external links.
 * Warns that links may be untrusted/executable content.
 */

import React, { useEffect } from 'react'

export interface LinkWarningDialogProps {
  isOpen: boolean
  url: string
  onConfirm: () => void
  onCancel: () => void
}

const WARNING_TEXT = `Opening links is potentially risky. Each external link should be treated as potential code or untrusted content.

It is recommended to view links in a connected sandbox orchestrator on a separate mini PC when possible.`

export default function LinkWarningDialog({
  isOpen,
  url,
  onConfirm,
  onCancel,
}: LinkWarningDialogProps) {
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
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
        <p className="link-warning-body">{WARNING_TEXT}</p>
        <p className="link-warning-url" title={url}>
          {url.length > 80 ? url.slice(0, 77) + '…' : url}
        </p>
        <div className="link-warning-actions">
          <button type="button" className="link-warning-btn-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="link-warning-btn-confirm" onClick={onConfirm}>
            Open anyway
          </button>
        </div>
      </div>
    </div>
  )
}
