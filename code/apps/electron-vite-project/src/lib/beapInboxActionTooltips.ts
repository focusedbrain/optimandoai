/**
 * Inbox Redirect + Sandbox: shared hover / screen reader strings (list and detail use the same primary line).
 */

import type { SandboxOrchestratorAvailability } from '../types/sandboxOrchestratorAvailability'

const SANDBOX_HOVER = 'Clone this message and send it to your Sandbox orchestrator for safe testing.'

const SANDBOX_ARIA_SHORT = 'Clone message to Sandbox'

const SANDBOX_ARIA_SUFFIX_CONNECTED =
  'Sends a clone to your connected Sandbox orchestrator. The original message stays in your inbox.'

const SANDBOX_ARIA_SUFFIX_NOT_CONFIGURED =
  'Connect a Sandbox orchestrator under the same identity, then try again. You can open setup from this action.'

const SANDBOX_ARIA_SUFFIX_OFFLINE =
  'Your Sandbox exists but the coordination path is offline. Start the Sandbox app or check the relay, then try again.'

/**
 * @param variant `row` and `detail` use the same primary `title` per product spec; list adds status on a second line when not connected.
 */
export function beapHostSandboxCloneTooltipForAvailability(
  availability: SandboxOrchestratorAvailability,
  variant: 'row' | 'detail' = 'detail',
): { title: string; 'aria-label': string } {
  let long: string
  switch (availability.status) {
    case 'connected':
      long = SANDBOX_ARIA_SUFFIX_CONNECTED
      break
    case 'exists_but_offline':
      long = SANDBOX_ARIA_SUFFIX_OFFLINE
      break
    case 'not_configured':
    default:
      long = SANDBOX_ARIA_SUFFIX_NOT_CONFIGURED
      break
  }

  const ariaLabel = `${SANDBOX_ARIA_SHORT}. ${long}`

  if (variant === 'row' && availability.status !== 'connected') {
    return {
      title: `${SANDBOX_HOVER}\n${long}`,
      'aria-label': ariaLabel,
    }
  }

  if (variant === 'detail' && availability.status !== 'connected') {
    return {
      title: `${SANDBOX_HOVER}\n${long}`,
      'aria-label': ariaLabel,
    }
  }

  return { title: SANDBOX_HOVER, 'aria-label': ariaLabel }
}

export const BEAP_INBOX_REDIRECT_TIP = 'Redirect'

export const BEAP_INBOX_REDIRECT_ARIA = 'Redirect message'

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
