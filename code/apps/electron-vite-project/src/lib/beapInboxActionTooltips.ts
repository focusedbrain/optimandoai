/**
 * Host orchestrator — Sandbox clone (received BEAP). Native `title` hover; not Redirect.
 * Tri-state copy from `useInternalSandboxesList().sandboxAvailability` (click still opens dialogs when needed).
 */

import type { SandboxOrchestratorAvailability } from '../types/sandboxOrchestratorAvailability'

/** Sandbox relay/path up — clone can be sent when prepare succeeds. */
export const BEAP_HOST_SANDBOX_CLONE_TOOLTIP_CONNECTED =
  'Send a clone of this BEAP message to your connected Sandbox orchestrator. The original stays unchanged.'

/** No internal Sandbox handshake under this identity yet (or not listed as available). */
export const BEAP_HOST_SANDBOX_CLONE_TOOLTIP_NOT_CONFIGURED =
  'Sandbox clone is available after connecting a Sandbox orchestrator under the same identity.'

/** Handshake exists but orchestrator is offline / path down. */
export const BEAP_HOST_SANDBOX_CLONE_TOOLTIP_OFFLINE =
  'Your Sandbox orchestrator exists but is offline. Start it to receive cloned BEAP messages.'

/**
 * Spread onto Sandbox buttons for native hover text (`title`) and a short `aria-label`.
 */
export function beapHostSandboxCloneTooltipForAvailability(
  availability: SandboxOrchestratorAvailability,
): { title: string; 'aria-label': string } {
  switch (availability.status) {
    case 'connected':
      return {
        title: BEAP_HOST_SANDBOX_CLONE_TOOLTIP_CONNECTED,
        'aria-label': 'Send clone to Sandbox',
      }
    case 'exists_but_offline':
      return {
        title: BEAP_HOST_SANDBOX_CLONE_TOOLTIP_OFFLINE,
        'aria-label': 'Sandbox offline — start orchestrator to receive clones',
      }
    case 'not_configured':
    default:
      return {
        title: BEAP_HOST_SANDBOX_CLONE_TOOLTIP_NOT_CONFIGURED,
        'aria-label': 'Connect a Sandbox under the same identity to clone',
      }
  }
}

/** Inbox message detail — compact Reply icon (`title` / screen reader). */
export const BEAP_INBOX_REPLY_TOOLTIP = 'Reply'

export function beapInboxReplyTooltipProps(): { title: string; 'aria-label': string } {
  return { title: BEAP_INBOX_REPLY_TOOLTIP, 'aria-label': BEAP_INBOX_REPLY_TOOLTIP }
}
