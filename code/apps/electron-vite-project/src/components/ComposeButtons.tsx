/**
 * ComposeButtons — [+] BEAP and [✉+] Email floating action buttons.
 * Bottom-right corner, side by side, 12px gap.
 * BEAP always visible; Email only when account connected.
 */

import { useState, useEffect } from 'react'

interface ComposeButtonsProps {
  onBeapClick: () => void
  onEmailClick: () => void
}

export default function ComposeButtons({ onBeapClick, onEmailClick }: ComposeButtonsProps) {
  const [hasEmail, setHasEmail] = useState(false)

  useEffect(() => {
    const check = async () => {
      if (typeof window.emailAccounts?.listAccounts !== 'function') return
      try {
        const res = await window.emailAccounts!.listAccounts()
        setHasEmail(Boolean(res.ok && res.data && res.data.length > 0))
      } catch {
        setHasEmail(false)
      }
    }
    check()
  }, [])

  const btnStyle = (bg: string) => ({
    width: 48,
    height: 48,
    borderRadius: '50%',
    border: 'none',
    background: bg,
    color: 'white',
    fontSize: 20,
    fontWeight: 700,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
  })

  return (
    <div style={{
      position: 'absolute',
      bottom: 12,
      right: 12,
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      zIndex: 10,
    }}>
      <button
        onClick={onBeapClick}
        title="New BEAP Message"
        style={btnStyle('rgba(139,92,246,0.9)')}
      >
        +
      </button>
      {hasEmail && (
        <button
          onClick={onEmailClick}
          title="New Email"
          style={btnStyle('#2563eb')}
        >
          ✉+
        </button>
      )}
    </div>
  )
}
