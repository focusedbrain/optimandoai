export interface PauseEdgeTierModalProps {
  running?: boolean
  onClose: () => void
  onConfirm: () => void
}

export function PauseEdgeTierModal({ running, onClose, onConfirm }: PauseEdgeTierModalProps) {
  return (
    <div
      data-testid="pause-edge-tier-modal"
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15,23,42,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1150,
      }}
      onClick={running ? undefined : onClose}
    >
      <div
        style={{
          width: 'min(480px, 92vw)',
          background: 'var(--bg-primary, #fff)',
          borderRadius: 10,
          border: '1px solid #fecaca',
          padding: 20,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ marginTop: 0, fontSize: 16, color: '#b91c1c' }}>Pause edge tier?</h2>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          Paid-tier edge protection will stop. Incoming messages will no longer receive edge certificates
          before local verification. The local pod will restart in LOCAL_HOST mode.
        </p>
        <p style={{ fontSize: 13, fontWeight: 600, color: '#b91c1c' }}>
          Your remote replicas will keep running, but Electron will not route through them until you
          re-enable edge tier.
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" onClick={onClose} disabled={running}>
            Cancel
          </button>
          <button
            type="button"
            data-testid="pause-edge-tier-confirm"
            disabled={running}
            onClick={onConfirm}
            style={{
              padding: '8px 14px',
              borderRadius: 6,
              border: 'none',
              background: '#dc2626',
              color: '#fff',
            }}
          >
            {running ? 'Pausing…' : 'Pause edge tier'}
          </button>
        </div>
      </div>
    </div>
  )
}
