/**
 * HandshakeInitiateModal — wraps the exact same SendHandshakeDelivery
 * component from extension-chromium in a light modal overlay.
 * This mirrors the docked sidepanel handshake view with theme='standard'.
 */

import { SendHandshakeDelivery } from '@ext/handshake/components/SendHandshakeDelivery'

interface Props {
  onClose: () => void
  onSuccess?: () => void
  onSubmit?: (data: { recipientEmail: string; deliveryMode: string }) => void
}

export default function HandshakeInitiateModal({ onClose, onSuccess }: Props) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.4)',
        backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: '16px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: '520px',
          background: '#ffffff',
          borderRadius: '12px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
          overflow: 'hidden',
          maxHeight: 'calc(100vh - 60px)',
          overflowY: 'auto',
        }}
      >
        <SendHandshakeDelivery
          theme="standard"
          onBack={onClose}
          fromAccountId=""
          emailAccounts={[]}
          onSuccess={onSuccess ?? onClose}
        />
      </div>
    </div>
  )
}
