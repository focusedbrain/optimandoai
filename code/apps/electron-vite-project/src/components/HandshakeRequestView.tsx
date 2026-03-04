/**
 * HandshakeRequestView — directly uses SendHandshakeDelivery from extension-chromium.
 * Same exact code, same exact UI. Only the RPC layer is shimmed via @ext alias.
 */

import { SendHandshakeDelivery } from '@ext/handshake/components/SendHandshakeDelivery'

interface Props {
  onBack: () => void
}

export default function HandshakeRequestView({ onBack }: Props) {
  return (
    <div style={{ maxWidth: '600px', margin: '40px auto', background: 'white', borderRadius: '12px', border: '1px solid rgba(147,51,234,0.14)', overflow: 'hidden' }}>
      <SendHandshakeDelivery
        theme="standard"
        onBack={onBack}
        fromAccountId=""
      />
    </div>
  )
}
