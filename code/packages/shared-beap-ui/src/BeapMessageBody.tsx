import React from 'react'
import type { BeapMessageBodySessionRef } from './types'

export interface BeapMessageBodyProps {
  publicBody?: string
  encryptedBody?: string
  automationTags?: string[]
  sessionRefs?: BeapMessageBodySessionRef[]
  onSessionImport?: (sessionRef: BeapMessageBodySessionRef) => void
  compact?: boolean
  className?: string
}

/**
 * Structured BEAP message body display: public section, confidential section,
 * automation tags, and session references.
 * Renders only sections that have content.
 */
export function BeapMessageBody({
  publicBody,
  encryptedBody,
  automationTags,
  sessionRefs,
  onSessionImport,
  compact = false,
  className,
}: BeapMessageBodyProps) {
  const rootClass = [
    'beap-ui-message-body',
    compact ? 'beap-ui--compact' : '',
    className || '',
  ]
    .filter(Boolean)
    .join(' ')

  const hasContent = publicBody || encryptedBody || automationTags?.length || sessionRefs?.length
  if (!hasContent) return null

  return (
    <div className={rootClass}>
      {/* PUBLIC MESSAGE */}
      {publicBody && (
        <div className="beap-ui-body-section">
          <div className="beap-ui-body-label">📨 Public Message (pBEAP)</div>
          <div className="beap-ui-body-content">
            <pre className="beap-ui-body-pre">{publicBody}</pre>
          </div>
        </div>
      )}

      {/* ENCRYPTED / AUTHORITATIVE */}
      {encryptedBody && (
        <div className="beap-ui-body-section">
          <div className="beap-ui-body-label beap-ui-body-label--confidential">
            🔒 CONFIDENTIAL (qBEAP — Encrypted Content)
          </div>
          <div className="beap-ui-body-content beap-ui-body-content--confidential">
            <pre className="beap-ui-body-pre">{encryptedBody}</pre>
          </div>
        </div>
      )}

      {/* AUTOMATION TAGS */}
      {automationTags && automationTags.length > 0 && (
        <div className="beap-ui-body-section">
          <div className="beap-ui-body-label">🏷️ Automation Tags</div>
          <div className="beap-ui-tags">
            {automationTags.map((tag, i) => (
              <span key={i} className="beap-ui-tag">
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* SESSION REFERENCES */}
      {sessionRefs && sessionRefs.length > 0 && (
        <div className="beap-ui-body-section beap-ui-body-section--session">
          <div className="beap-ui-body-label">⚙️ Attached Session</div>
          {sessionRefs.map((ref, i) => (
            <div key={ref.sessionId || i} className="beap-ui-session-ref">
              <span className="beap-ui-session-name">
                {ref.sessionName || ref.sessionId}
              </span>
              {ref.requiredCapability && (
                <span className="beap-ui-session-capability">
                  Requires: {ref.requiredCapability}
                </span>
              )}
              {onSessionImport && (
                <button
                  type="button"
                  className="beap-ui-session-import-btn"
                  onClick={() => onSessionImport(ref)}
                >
                  ▶ Import
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
