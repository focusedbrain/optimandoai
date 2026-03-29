import type { CSSProperties } from 'react'

type ComposerAttachmentButtonProps = {
  onClick: () => void
  label?: string
  disabled?: boolean
  /** Stretch to container width (e.g. AI context rail). */
  fullWidth?: boolean
}

const base: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 10,
  padding: '10px 16px',
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: '0.01em',
  cursor: 'pointer',
  borderRadius: 10,
  border: '1px solid rgba(99, 102, 241, 0.45)',
  background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
  color: '#0f172a',
  boxShadow: '0 1px 2px rgba(15, 23, 42, 0.06)',
  transition: 'border-color 0.15s ease, box-shadow 0.15s ease, transform 0.1s ease',
}

/**
 * Shared premium-style attachment control for BEAP and Email inline composers.
 */
export function ComposerAttachmentButton({ onClick, label = 'Add attachments', disabled, fullWidth }: ComposerAttachmentButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      style={{
        ...base,
        width: fullWidth ? '100%' : undefined,
        justifyContent: fullWidth ? 'flex-start' : undefined,
        boxSizing: 'border-box',
        opacity: disabled ? 0.55 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
      onMouseEnter={(e) => {
        if (disabled) return
        e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.85)'
        e.currentTarget.style.boxShadow = '0 4px 14px rgba(99, 102, 241, 0.18)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.45)'
        e.currentTarget.style.boxShadow = '0 1px 2px rgba(15, 23, 42, 0.06)'
      }}
      onFocus={(e) => {
        e.currentTarget.style.outline = 'none'
        e.currentTarget.style.boxShadow = '0 0 0 3px rgba(99, 102, 241, 0.35)'
      }}
      onBlur={(e) => {
        e.currentTarget.style.boxShadow = '0 1px 2px rgba(15, 23, 42, 0.06)'
      }}
    >
      <span
        aria-hidden
        style={{
          display: 'inline-flex',
          width: 22,
          height: 22,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 6,
          background: 'linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%)',
          border: '1px solid rgba(99, 102, 241, 0.25)',
          fontSize: 13,
        }}
      >
        📎
      </span>
      <span>{label}</span>
    </button>
  )
}
