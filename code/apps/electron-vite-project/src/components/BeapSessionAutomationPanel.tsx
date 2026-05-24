import type { CSSProperties } from 'react'
import type { InboxMessage } from '../stores/useEmailInboxStore'
import {
  canShowInboxRunAutomation,
  inboxValidationState,
  resolveInboxSessionArtefact,
} from '../lib/inboxSessionArtefact'

export type BeapSessionAutomationPanelProps = {
  message: InboxMessage
  importStatus: Record<string, 'importing' | 'imported' | 'error'>
  onRunAutomation: (ref: Record<string, unknown>) => void
  className?: string
  style?: CSSProperties
}

export default function BeapSessionAutomationPanel({
  message,
  importStatus,
  onRunAutomation,
  className,
  style,
}: BeapSessionAutomationPanelProps) {
  const resolution = resolveInboxSessionArtefact(message)
  const validationState = inboxValidationState(message)
  const showPanel = canShowInboxRunAutomation(message, resolution)

  if (!showPanel) {
    if (validationState === 'rejected') {
      return (
        <div
          className={`beap-body-section beap-validation-banner beap-validation-rejected ${className ?? ''}`.trim()}
          style={style}
        >
          <strong>Validation rejected</strong>
          {' — '}
          This message did not pass security validation and cannot be acted on.
        </div>
      )
    }
    if (validationState === 'pending' && resolution.artefact) {
      return (
        <div
          className={`beap-body-section beap-validation-banner beap-validation-pending ${className ?? ''}`.trim()}
          style={style}
        >
          Validation status unknown for this message.
        </div>
      )
    }
    return null
  }

  return (
    <div className={`beap-body-section beap-session-indicator ${className ?? ''}`.trim()} style={style}>
      <div className="beap-body-label">⚙️ Attached Session</div>
      {resolution.refs.map((ref, i) => {
        const sessionId = ref.sessionId
        const sessionName = ref.sessionName || sessionId || 'Session'
        const cap = ref.requiredCapability
        const capLabel =
          cap != null && typeof cap === 'object'
            ? JSON.stringify(cap)
            : cap != null
              ? String(cap)
              : ''
        const status = importStatus[sessionId]
        return (
          <div key={`${sessionId}-${i}`} className="beap-session-ref">
            <span className="beap-session-name">{sessionName || sessionId}</span>
            {capLabel ? <span className="beap-session-capability">Requires: {capLabel}</span> : null}
            {status === 'imported' ? (
              <span className="beap-session-imported">✓ Imported</span>
            ) : (
              <>
                {status === 'error' ? (
                  <span className="beap-session-import-error">Import failed</span>
                ) : null}
                <button
                  type="button"
                  className="beap-session-import-btn beap-session-run-automation-btn"
                  onClick={() =>
                    onRunAutomation({
                      sessionId,
                      sessionName,
                    })
                  }
                  disabled={status === 'importing'}
                >
                  {status === 'importing' ? 'Running…' : status === 'error' ? 'Retry Run Automation' : 'Run Automation'}
                </button>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
