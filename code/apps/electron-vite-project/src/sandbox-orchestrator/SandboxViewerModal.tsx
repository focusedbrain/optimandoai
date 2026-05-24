import type { SandboxViewContent } from './types.js'
import {
  sandboxViewerOverlayStyle,
  sandboxViewerPanelStyle,
  sandboxViewerPreStyle,
  SANDBOX_AUDIT_PALETTE,
  quarantineMonoStyle,
} from './sandboxAuditStyles.js'

export interface SandboxViewerModalProps {
  view: SandboxViewContent | null
  onClose: () => void
}

/**
 * Isolated structured-text viewer — no HTML rendering, no link buttons.
 */
export function SandboxViewerModal({ view, onClose }: SandboxViewerModalProps) {
  if (!view) return null

  return (
    <div
      data-testid="sandbox-viewer-modal"
      data-sandbox-mode={view.mode}
      style={sandboxViewerOverlayStyle}
      role="dialog"
      aria-modal="true"
      aria-label={view.title}
    >
      <div data-testid="sandbox-viewer-panel" style={sandboxViewerPanelStyle}>
        <header
          style={{
            padding: '12px 16px',
            borderBottom: `1px solid ${SANDBOX_AUDIT_PALETTE.panelBorder}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div>
            <h2
              style={{
                margin: 0,
                fontSize: 14,
                fontWeight: 600,
                color: SANDBOX_AUDIT_PALETTE.header,
                fontFamily: SANDBOX_AUDIT_PALETTE.mono,
              }}
            >
              {view.title}
            </h2>
            <p style={{ ...quarantineMonoStyle, margin: '4px 0 0' }}>
              Sandbox-isolated view — plain text only
            </p>
          </div>
          <button
            type="button"
            data-testid="sandbox-viewer-close"
            onClick={onClose}
            style={{
              padding: '4px 10px',
              fontSize: 11,
              borderRadius: 4,
              border: `1px solid ${SANDBOX_AUDIT_PALETTE.panelBorder}`,
              background: '#e4e4e7',
              color: SANDBOX_AUDIT_PALETTE.text,
              cursor: 'pointer',
              fontFamily: SANDBOX_AUDIT_PALETTE.mono,
            }}
          >
            Close
          </button>
        </header>
        <pre data-testid="sandbox-viewer-content" style={sandboxViewerPreStyle}>
          {view.textContent}
        </pre>
      </div>
    </div>
  )
}
