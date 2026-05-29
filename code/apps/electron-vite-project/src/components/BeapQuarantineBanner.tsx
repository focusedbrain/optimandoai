/**
 * Host-visible notice when an inbound BEAP message was quarantined (decrypt/validation failure).
 */

import { useCallback, useEffect, useState } from 'react'

export type BeapQuarantineNotice = {
  handshakeId: string
  quarantineId: string
  reasonCode: string
  rejectionReason: string
}

export default function BeapQuarantineBanner() {
  const [notice, setNotice] = useState<BeapQuarantineNotice | null>(null)

  useEffect(() => {
    const onQuarantine = window.emailInbox?.onBeapQuarantine
    if (!onQuarantine) return
    return onQuarantine((data) => {
      setNotice(data)
    })
  }, [])

  const dismiss = useCallback(() => setNotice(null), [])

  if (!notice) return null

  const reasonLabel =
    notice.reasonCode === 'decrypt_failed'
      ? 'could not decrypt'
      : notice.reasonCode === 'validator_unhealthy'
        ? 'validator rejected'
        : notice.reasonCode === 'inner_vault_locked'
          ? 'vault locked'
          : notice.reasonCode

  return (
    <div
      role="alert"
      style={{
        margin: '8px 12px 0',
        padding: '10px 12px',
        borderRadius: 8,
        background: '#fffbeb',
        border: '1px solid #fcd34d',
        color: '#92400e',
        fontSize: 13,
        flexShrink: 0,
      }}
    >
      <strong>BEAP message quarantined</strong>
      <div style={{ marginTop: 4 }}>
        Handshake <code>{notice.handshakeId.slice(0, 8)}…</code> — {reasonLabel}
        {notice.rejectionReason ? ` (${notice.rejectionReason})` : ''}. Row{' '}
        <code>{notice.quarantineId.slice(0, 8)}…</code> is in quarantine; unlock vault or review keys to retry.
      </div>
      <button
        type="button"
        onClick={dismiss}
        style={{
          marginTop: 8,
          fontSize: 12,
          padding: '4px 10px',
          borderRadius: 6,
          border: '1px solid #fcd34d',
          background: '#fff',
          cursor: 'pointer',
        }}
      >
        Dismiss
      </button>
    </div>
  )
}
