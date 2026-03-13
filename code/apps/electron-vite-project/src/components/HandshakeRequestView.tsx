/**
 * HandshakeRequestView — directly uses SendHandshakeDelivery from extension-chromium.
 * Same exact code, same exact UI. Only the RPC layer is shimmed via @ext alias.
 */

import { useState, useEffect } from 'react'
import { SendHandshakeDelivery } from '@ext/handshake/components/SendHandshakeDelivery'

interface Props {
  onBack: () => void
}

export default function HandshakeRequestView({ onBack }: Props) {
  const [isVaultUnlocked, setIsVaultUnlocked] = useState(false)
  const [canUseHsContextProfiles, setCanUseHsContextProfiles] = useState(false)

  useEffect(() => {
    const check = async () => {
      try {
        const s = await window.handshakeView?.getVaultStatus?.()
        setIsVaultUnlocked(s?.isUnlocked ?? false)
        setCanUseHsContextProfiles(s?.canUseHsContextProfiles ?? false)
      } catch {
        setIsVaultUnlocked(false)
        setCanUseHsContextProfiles(false)
      }
    }
    check()
    const h = () => check()
    window.addEventListener('vault-status-changed', h)
    return () => window.removeEventListener('vault-status-changed', h)
  }, [])

  return (
    <div style={{ maxWidth: '600px', margin: '40px auto', background: 'white', borderRadius: '12px', border: '1px solid rgba(147,51,234,0.14)', overflow: 'hidden' }}>
      <SendHandshakeDelivery
        theme="standard"
        onBack={onBack}
        isVaultUnlocked={isVaultUnlocked}
        fromAccountId=""
        canUseHsContextProfiles={canUseHsContextProfiles}
      />
    </div>
  )
}
