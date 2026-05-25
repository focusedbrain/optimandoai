import { SWITCH_BACK_CONFIRM_TITLE, switchBackConfirmBody } from './emailVerificationCopy.js'

export interface SwitchBackToLocalModalProps {
  host: string
  running?: boolean
  onClose: () => void
  onConfirm: () => void
}

export function SwitchBackToLocalModal({
  host,
  running,
  onClose,
  onConfirm,
}: SwitchBackToLocalModalProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="switch-back-local-modal"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 12000,
        background: 'rgba(15, 23, 42, 0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
      onClick={running ? undefined : onClose}
    >
      <div
        style={{
          width: 'min(480px, 100%)',
          padding: 24,
          borderRadius: 12,
          background: '#fff',
          border: '1px solid #e2e8f0',
          boxShadow: '0 16px 40px rgba(15, 23, 42, 0.18)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ margin: '0 0 12px', fontSize: 18, color: '#0f172a' }}>{SWITCH_BACK_CONFIRM_TITLE}</h2>
        <p style={{ margin: '0 0 20px', color: '#64748b', fontSize: 14, lineHeight: 1.5 }}>
          {switchBackConfirmBody(host)}
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} disabled={running}>
            Cancel
          </button>
          <button
            type="button"
            data-testid="switch-back-local-confirm"
            disabled={running}
            onClick={onConfirm}
            style={{
              padding: '8px 14px',
              borderRadius: 6,
              border: 'none',
              background: '#dc2626',
              color: '#fff',
              cursor: running ? 'not-allowed' : 'pointer',
            }}
          >
            {running ? 'Switching…' : 'Switch back'}
          </button>
        </div>
      </div>
    </div>
  )
}
