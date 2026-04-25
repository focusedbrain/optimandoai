/**
 * List/detail chip: B = normal BEAP inbox message, S = sandbox clone from another inbox.
 */

import type { InboxMessage } from '../stores/useEmailInboxStore'
import {
  INBOX_DIRECT_BEAP_BADGE_TOOLTIP,
  INBOX_SANDBOX_CLONE_BADGE_TOOLTIP,
  inboxMessageIsSandboxBeapClone,
} from '../lib/inboxMessageSandboxClone'

function cn(...parts: (string | false | undefined)[]) {
  return parts.filter(Boolean).join(' ')
}

export function InboxBeapSourceBadgeListRow({ message }: { message: InboxMessage }) {
  const sandbox = inboxMessageIsSandboxBeapClone(message)
  return (
    <div
      className={cn(
        'inbox-beap-source-badge--row',
        'inbox-beap-source-badge',
        sandbox ? 'inbox-beap-source-badge--sandbox' : 'inbox-beap-source-badge--direct',
      )}
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
      className={cn('inbox-beap-source-badge', sandbox ? 'inbox-beap-source-badge--sandbox' : 'inbox-beap-source-badge--direct')}
      title={sandbox ? INBOX_SANDBOX_CLONE_BADGE_TOOLTIP : INBOX_DIRECT_BEAP_BADGE_TOOLTIP}
    >
      {sandbox ? 'S' : 'B'}
    </span>
  )
}
