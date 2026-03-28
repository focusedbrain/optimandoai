import React, { useRef } from 'react'
import type { AttachmentItem } from './types'

export interface AttachmentPickerProps {
  attachments: AttachmentItem[]
  onAdd: (files: File[]) => void
  onRemove: (index: number) => void
  accept?: string
  compact?: boolean
  multiple?: boolean
  label?: string
}

/**
 * File attachment picker with chip display and remove.
 * Presentation-only — file reading happens in the consumer.
 */
export function AttachmentPicker({
  attachments,
  onAdd,
  onRemove,
  accept = '.pdf,.txt,.json',
  compact = false,
  multiple = true,
  label = 'Attachments',
}: AttachmentPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const rootClass = `beap-ui-attachment-picker${compact ? ' beap-ui--compact' : ''}`

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onAdd(Array.from(e.target.files))
      // Reset input so re-selecting same file triggers change
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className={rootClass}>
      <label className="beap-ui-field-label">{label}</label>

      {compact ? (
        <>
          <button
            type="button"
            className="beap-ui-attachment-add-btn"
            onClick={() => inputRef.current?.click()}
          >
            + Add{attachments.length > 0 ? ` (${attachments.length})` : ''}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            multiple={multiple}
            onChange={handleChange}
            style={{ display: 'none' }}
            aria-hidden="true"
            tabIndex={-1}
          />
        </>
      ) : (
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          onChange={handleChange}
          className="beap-ui-file-input"
        />
      )}

      {attachments.length > 0 && (
        <div className="beap-ui-attachment-list">
          {attachments.map((att, i) => (
            <div key={att.id || `${att.name}-${i}`} className="beap-ui-attachment-chip">
              <span className="beap-ui-attachment-name">📎 {att.name}</span>
              <button
                type="button"
                className="beap-ui-attachment-remove"
                onClick={() => onRemove(i)}
                aria-label={`Remove ${att.name}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
