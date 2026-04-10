/**
 * Dedicated surface for Project Assistant **setup / edit** — same DOM subtree as the former inline
 * block in {@link ProjectOptimizationPanel}, portaled so the dashboard hero is not permanently occupied.
 *
 * Does not own form state; children are rendered by the panel to preserve `window.__wrdeskInsertDraft`
 * and `data-field` / `data-milestone-id` wiring unchanged.
 */

import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import './ProjectAssistantConfigModal.css'

export type ProjectAssistantConfigModalProps = {
  onClose: () => void
  children: ReactNode
}

export function ProjectAssistantConfigModal({ onClose, children }: ProjectAssistantConfigModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div
      className="pa-config-modal__overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="pa-config-modal__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pa-config-modal-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="pa-config-modal__chrome">
          <h2 id="pa-config-modal-title" className="pa-config-modal__chrome-title">
            Project WIKI setup
          </h2>
          <button type="button" className="pa-config-modal__chrome-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="pa-config-modal__scroll">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
