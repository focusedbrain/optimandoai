/**
 * Premium status badge for Sandbox clone — Standard theme, WCAG-friendly contrast
 * (pastel background + strong foreground from UI_BADGE).
 * Keep visually distinct from BEAP Redirect (icon pipeline in InboxActionIcons / App.css).
 */
import { UI_BADGE } from '../styles/uiContrastTokens'
import type { SandboxCloneFeedbackVariant, SandboxCloneFeedbackView } from '../lib/sandboxCloneFeedbackUi'

const VARIANT_STYLES: Record<
  SandboxCloneFeedbackVariant,
  { surface: (typeof UI_BADGE)[keyof typeof UI_BADGE]; iconBg: string; iconFg: string }
> = {
  success: { surface: UI_BADGE.green, iconBg: 'rgba(22, 101, 52, 0.12)', iconFg: '#166534' },
  queued: { surface: UI_BADGE.blue, iconBg: 'rgba(30, 64, 175, 0.12)', iconFg: '#1e40af' },
  info: { surface: UI_BADGE.purple, iconBg: 'rgba(76, 29, 149, 0.1)', iconFg: '#4c1d95' },
  error: { surface: UI_BADGE.red, iconBg: 'rgba(153, 27, 27, 0.1)', iconFg: '#991b1b' },
  warning: { surface: UI_BADGE.amber, iconBg: 'rgba(146, 64, 14, 0.12)', iconFg: '#92400e' },
  loading: { surface: UI_BADGE.gray, iconBg: 'rgba(55, 65, 81, 0.1)', iconFg: '#374151' },
}

function IconGlyph({ variant }: { variant: SandboxCloneFeedbackVariant }) {
  const s = VARIANT_STYLES[variant]
  const common = { fontSize: 13, fontWeight: 800 as const, lineHeight: 1 }
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 24,
        height: 24,
        borderRadius: 9999,
        flexShrink: 0,
        background: s.iconBg,
        color: s.iconFg,
        ...common,
      }}
    >
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
  const st = VARIANT_STYLES[view.variant]
  const detail = [view.screenReaderDetail, view.message].filter(Boolean).join(' — ')
  return (
    <div
      className={className}
      role="status"
      aria-live="polite"
      aria-label={detail}
      style={{
        ...st.surface,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '10px 12px',
        borderRadius: 12,
        maxWidth,
        width: '100%',
        boxShadow: '0 4px 16px rgba(15, 23, 42, 0.1)',
        fontSize: 13,
        lineHeight: 1.45,
        fontWeight: 600,
        boxSizing: 'border-box' as const,
      }}
    >
      <IconGlyph variant={view.variant} />
      <p style={{ margin: 0, flex: 1, minWidth: 0, wordBreak: 'break-word' as const, color: st.surface.color }}>{view.message}</p>
      {view.persistUntilDismiss && onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss Sandbox clone message"
          style={{
            flexShrink: 0,
            border: st.surface.border,
            background: 'rgba(255,255,255,0.6)',
            color: st.surface.color,
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 700,
            padding: '4px 8px',
            cursor: 'pointer',
            lineHeight: 1,
          }}
        >
          ×
        </button>
      ) : null}
    </div>
  )
}
