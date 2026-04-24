import type { CSSProperties, MouseEventHandler } from 'react'
import { BeapInboxRedirectIcon } from './BeapInboxRedirectIcon'
import { BeapInboxSandboxCloneIcon } from './BeapInboxSandboxCloneIcon'

export type BeapActionIconKind = 'redirect' | 'sandbox'

export type BeapActionIconButtonProps = {
  kind: BeapActionIconKind
  title: string
  ariaLabel: string
  onClick: MouseEventHandler<HTMLButtonElement>
  disabled?: boolean
  /** Inbox list row: same look, slightly smaller control */
  row?: boolean
  style?: CSSProperties
  className?: string
}

/**
 * Filled, high-contrast BEAP toolbar actions (Redirect = blue, Sandbox = purple).
 * Sibling to matching `.beap-action-icon--*` in App.css.
 */
export function BeapActionIconButton({
  kind,
  title,
  ariaLabel,
  onClick,
  disabled,
  row,
  style,
  className = '',
}: BeapActionIconButtonProps) {
  const base = 'beap-action-icon'
  const mod = `beap-action-icon--${kind}`
  const rowC = row ? 'beap-action-icon--row' : ''
  return (
    <button
      type="button"
      className={`${base} ${mod} ${rowC} ${className}`.trim()}
      title={title}
      aria-label={ariaLabel}
      onClick={onClick}
      disabled={disabled}
      style={style}
    >
      {kind === 'redirect' ? <BeapInboxRedirectIcon /> : <BeapInboxSandboxCloneIcon />}
    </button>
  )
}
