/**
 * Status banner for Sandbox clone outcomes — uses theme tokens (App.css `.sandbox-clone-fb*`), not page-inherited colors.
 */
import type { SandboxCloneFeedbackVariant, SandboxCloneFeedbackView } from '../lib/sandboxCloneFeedbackUi'
import { openAppExternalUrl } from '../lib/openAppExternalUrl'

const VARIANT_CLASS: Record<SandboxCloneFeedbackVariant, string> = {
  success: 'sandbox-clone-fb--success',
  queued: 'sandbox-clone-fb--queued',
  info: 'sandbox-clone-fb--info',
  error: 'sandbox-clone-fb--error',
  warning: 'sandbox-clone-fb--warning',
  loading: 'sandbox-clone-fb--loading',
}

function IconGlyph({ variant }: { variant: SandboxCloneFeedbackVariant }) {
  return (
    <span className="sandbox-clone-fb__icon" aria-hidden>
      {variant === 'success' ? '✓' : null}
      {variant === 'queued' ? '⏱' : null}
      {variant === 'info' ? 'ℹ' : null}
      {variant === 'error' ? '!' : null}
      {variant === 'warning' ? '!' : null}
      {variant === 'loading' ? '…' : null}
    </span>
  )
}

export type SandboxCloneFeedbackBadgeProps = {
  view: SandboxCloneFeedbackView
  onDismiss?: () => void
  className?: string
  /** e.g. message detail top-right: narrow column */
  maxWidth?: number | string
}

export default function SandboxCloneFeedbackBadge({ view, onDismiss, className, maxWidth = 400 }: SandboxCloneFeedbackBadgeProps) {
  const detail = [view.screenReaderDetail, view.title, view.message].filter(Boolean).join(' — ')
  const vClass = VARIANT_CLASS[view.variant]
  return (
    <div
      className={['sandbox-clone-fb', vClass, className].filter(Boolean).join(' ')}
      style={{ maxWidth: typeof maxWidth === 'number' ? `${maxWidth}px` : maxWidth }}
      role="status"
      aria-live="polite"
      aria-label={detail}
    >
      <IconGlyph variant={view.variant} />
      {view.title ? <p className="sandbox-clone-fb__title">{view.title}</p> : null}
      <p className="sandbox-clone-fb__msg">{view.message}</p>
      {view.actionUrl && view.actionLabel ? (
        <button
          type="button"
          className="sandbox-clone-fb__action"
          onClick={() => { void openAppExternalUrl(view.actionUrl!) }}
          aria-label={view.actionLabel}
        >
          {view.actionLabel}
        </button>
      ) : null}
      {view.persistUntilDismiss && onDismiss ? (
        <button type="button" className="sandbox-clone-fb__dismiss" onClick={onDismiss} aria-label="Dismiss Sandbox clone message">
          ×
        </button>
      ) : null}
    </div>
  )
}
