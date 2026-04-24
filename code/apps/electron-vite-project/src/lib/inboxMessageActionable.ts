/**
 * Inbox list/detail actions (Redirect, Sandbox) — one predicate for all message shapes.
 * Does not inspect source_type: every stored inbox row the user can open is actionable unless excluded below.
 */

import type { InboxMessage } from '../stores/useEmailInboxStore'

/**
 * `true` for every real message in the main inbox (list + detail).
 * `false` for missing row, or rows explicitly marked deleted in the local store.
 */
export function isInboxMessageActionable(message: InboxMessage | null | undefined): boolean {
  if (!message?.id) return false
  if (message.deleted === 1) return false
  return true
}
