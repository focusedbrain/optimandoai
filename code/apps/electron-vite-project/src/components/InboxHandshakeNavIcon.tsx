/**
 * Subtle clickable handshake affordance for inbox rows/cards.
 * Does not fire row selection — use with stopPropagation on click/mousedown.
 */

import { showHandshakeNavIcon } from '../lib/inboxMessageKind'
import type { InboxMessage } from '../stores/useEmailInboxStore'

export function InboxHandshakeNavIconButton({
  message,
  onNavigateToHandshake,
}: {
  message: Pick<InboxMessage, 'handshake_id' | 'source_type'>
  onNavigateToHandshake: (handshakeId: string) => void
}) {
  if (!showHandshakeNavIcon(message)) return null
  const id = String(message.handshake_id ?? '').trim()
  if (!id) return null

  return (
    <button
      type="button"
      className="inbox-handshake-nav-btn"
      title="Open handshake"
      aria-label="Open handshake"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        e.preventDefault()
        onNavigateToHandshake(id)
      }}
    >
      <span aria-hidden>🤝</span>
    </button>
  )
}
