/**
 * Inbox Redirect + Sandbox: shared hover / screen reader strings (list and detail use the same primary line).
 */

import type { SandboxOrchestratorAvailability } from '../types/sandboxOrchestratorAvailability'

/** List + detail: icon-only; no live-relay requirement for showing the icon. */
const BEAP_SANDBOX_CLONE_TIP =
  'Clone the entire BEAP message to your Sandbox orchestrator so content can be inspected on isolated hardware. If the Sandbox is offline, the clone will be queued.'

const SANDBOX_ARIA_SHORT = 'Clone to Sandbox'

/**
 * @param _availability — retained for call sites; tri-state (relay live vs offline) does not change the copy.
 * @param _variant — retained for call sites; row and detail use the same primary line.
 */
export function beapHostSandboxCloneTooltipForAvailability(
  _availability: SandboxOrchestratorAvailability,
  _variant: 'row' | 'detail' = 'detail',
): { title: string; 'aria-label': string } {
  const ariaLabel = `${SANDBOX_ARIA_SHORT}. ${BEAP_SANDBOX_CLONE_TIP} The original message stays in your inbox.`
  return { title: BEAP_SANDBOX_CLONE_TIP, 'aria-label': ariaLabel }
}

export const BEAP_INBOX_REDIRECT_TIP = 'Redirect this BEAP message.'

export const BEAP_INBOX_REDIRECT_ARIA = 'Redirect this BEAP message'

/** List row. */
export function beapInboxRedirectTooltipPropsForRow(): { title: string; 'aria-label': string } {
  return { title: BEAP_INBOX_REDIRECT_TIP, 'aria-label': BEAP_INBOX_REDIRECT_ARIA }
}

/** Message detail. */
export function beapInboxRedirectTooltipPropsForDetail(): { title: string; 'aria-label': string } {
  return { title: BEAP_INBOX_REDIRECT_TIP, 'aria-label': BEAP_INBOX_REDIRECT_ARIA }
}

export const BEAP_INBOX_REPLY_TOOLTIP = 'Reply'

export function beapInboxReplyTooltipProps(): { title: string; 'aria-label': string } {
  return { title: BEAP_INBOX_REPLY_TOOLTIP, 'aria-label': BEAP_INBOX_REPLY_TOOLTIP }
}
