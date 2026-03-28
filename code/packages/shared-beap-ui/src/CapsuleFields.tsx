import React from 'react'

export interface CapsuleFieldsProps {
  publicText: string
  encryptedText: string
  onPublicChange: (text: string) => void
  onEncryptedChange: (text: string) => void
  compact?: boolean
  readOnly?: boolean
  publicLabel?: string
  encryptedLabel?: string
  publicPlaceholder?: string
  encryptedPlaceholder?: string
  /** Show "authoritative when present" hint below encrypted field. Default: true */
  showEncryptedHint?: boolean
}

/**
 * Two-field capsule draft editor: public (pBEAP) + encrypted (qBEAP).
 * Presentation-only — no send logic, no IPC, no store.
 */
export function CapsuleFields({
  publicText,
  encryptedText,
  onPublicChange,
  onEncryptedChange,
  compact = false,
  readOnly = false,
  publicLabel = 'BEAP™ Message (public)',
  encryptedLabel = '🔒 Encrypted Message (Private · QBEAP)',
  publicPlaceholder = 'Public capsule text — transport-visible message body.',
  encryptedPlaceholder = 'This message is encrypted, capsule-bound, and never transported outside the BEAP package.',
  showEncryptedHint = true,
}: CapsuleFieldsProps) {
  const rootClass = `beap-ui-capsule-fields${compact ? ' beap-ui--compact' : ''}`

  return (
    <div className={rootClass}>
      {/* PUBLIC MESSAGE */}
      <div className="beap-ui-field">
        <label className="beap-ui-field-label">{publicLabel}</label>
        <textarea
          className="beap-ui-textarea"
          placeholder={publicPlaceholder}
          value={publicText}
          onChange={(e) => onPublicChange(e.target.value)}
          readOnly={readOnly}
          rows={compact ? 2 : 3}
        />
      </div>

      {/* ENCRYPTED MESSAGE */}
      <div className="beap-ui-field beap-ui-field--encrypted">
        <label className="beap-ui-field-label beap-ui-field-label--encrypted">
          {encryptedLabel}
        </label>
        <textarea
          className="beap-ui-textarea beap-ui-textarea--encrypted"
          placeholder={encryptedPlaceholder}
          value={encryptedText}
          onChange={(e) => onEncryptedChange(e.target.value)}
          readOnly={readOnly}
          rows={compact ? 3 : 4}
        />
        {showEncryptedHint && (
          <div className="beap-ui-field-hint">
            ⚠ This content is authoritative when present and never leaves the encrypted capsule.
          </div>
        )}
      </div>
    </div>
  )
}
