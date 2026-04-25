/**
 * List/detail chip: B = normal BEAP inbox message, S = sandbox clone from another inbox.
 */

import type { InboxMessage } from '../stores/useEmailInboxStore'
import {
  INBOX_DIRECT_BEAP_BADGE_TOOLTIP,
  INBOX_SANDBOX_CLONE_BADGE_TOOLTIP,
  inboxMessageIsSandboxBeapClone,
} from '../lib/inboxMessageSandboxClone'

const ROW_BOX = {
  width: 24,
  height: 24,
  borderRadius: 4,
  display: 'flex' as const,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
  fontSize: 12,
  fontWeight: 700,
  color: '#fff',
  flexShrink: 0,
}

export function InboxBeapSourceBadgeListRow({ message }: { message: InboxMessage }) {
  const sandbox = inboxMessageIsSandboxBeapClone(message)
  return (
    <div
      style={{
        ...ROW_BOX,
        background: sandbox
          ? 'var(--inbox-sandbox-clone-badge-bg, #0ea5e9)'
          : 'var(--purple-accent, #9333ea)',
      }}
      title={sandbox ? INBOX_SANDBOX_CLONE_BADGE_TOOLTIP : INBOX_DIRECT_BEAP_BADGE_TOOLTIP}
    >
      {sandbox ? 'S' : 'B'}
    </div>
  )
}

export function InboxBeapSourceBadgeDetail({ message }: { message: InboxMessage }) {
  const sandbox = inboxMessageIsSandboxBeapClone(message)
  return (
    <span
      className="inbox-beap-source-badge"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 24,
        height: 24,
        padding: '0 6px',
        borderRadius: 4,
        fontSize: 12,
        fontWeight: 700,
        color: '#fff',
        background: sandbox
          ? 'var(--inbox-sandbox-clone-badge-bg, #0ea5e9)'
          : 'var(--purple-accent, #9333ea)',
        flexShrink: 0,
        verticalAlign: 'middle',
      }}
      title={sandbox ? INBOX_SANDBOX_CLONE_BADGE_TOOLTIP : INBOX_DIRECT_BEAP_BADGE_TOOLTIP}
    >
      {sandbox ? 'S' : 'B'}
    </span>
  )
}
