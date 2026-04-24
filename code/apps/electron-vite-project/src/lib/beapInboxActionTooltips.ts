/**
 * Host orchestrator — Sandbox clone (received BEAP). Tri-state for screen readers; short `title` for hover.
 * Does not include Redirect.
 */

import type { SandboxOrchestratorAvailability } from '../types/sandboxOrchestratorAvailability'

const SANDBOX_CLONE_TIP_SHORT = 'Send a clone to Sandbox'

/** Long context for a11y (tri-state) — not shown as primary visible label. */
export const BEAP_HOST_SANDBOX_CLONE_ARIA_SUFFIX_CONNECTED =
  'Sends a clone of this BEAP message to your connected Sandbox orchestrator. The original stays unchanged.'

export const BEAP_HOST_SANDBOX_CLONE_ARIA_SUFFIX_NOT_CONFIGURED =
  'Sandbox clone is available after connecting a Sandbox orchestrator under the same identity.'

export const BEAP_HOST_SANDBOX_CLONE_ARIA_SUFFIX_OFFLINE =
  'Your Sandbox orchestrator exists but is offline. Start the Sandbox app or wait for the coordination relay, then try again.'

/**
 * `title` — short native tooltip. `aria-label` — short + long sentence for screen readers.
 */
export function beapHostSandboxCloneTooltipForAvailability(
  availability: SandboxOrchestratorAvailability,
): { title: string; 'aria-label': string } {
  const short = SANDBOX_CLONE_TIP_SHORT
  let long: string
  switch (availability.status) {
    case 'connected':
      long = BEAP_HOST_SANDBOX_CLONE_ARIA_SUFFIX_CONNECTED
      break
    case 'exists_but_offline':
      long = BEAP_HOST_SANDBOX_CLONE_ARIA_SUFFIX_OFFLINE
      break
    case 'not_configured':
    default:
      long = BEAP_HOST_SANDBOX_CLONE_ARIA_SUFFIX_NOT_CONFIGURED
      break
  }
  return {
    title: short,
    'aria-label': `${short}. ${long}`,
  }
}

/** BEAP redirect to another recipient — short hover; long `aria-label`. */
export const BEAP_INBOX_REDIRECT_TIP = 'Redirect'
export const BEAP_INBOX_REDIRECT_TIP_DESC = 'Redirect this BEAP message to another recipient.'

export function beapInboxRedirectTooltipProps(): { title: string; 'aria-label': string } {
  return {
    title: `${BEAP_INBOX_REDIRECT_TIP}\n${BEAP_INBOX_REDIRECT_TIP_DESC}`,
    'aria-label': BEAP_INBOX_REDIRECT_TIP,
  }
}

/** Inbox message detail — compact Reply icon (`title` / screen reader). */
export const BEAP_INBOX_REPLY_TOOLTIP = 'Reply'

export function beapInboxReplyTooltipProps(): { title: string; 'aria-label': string } {
  return { title: BEAP_INBOX_REPLY_TOOLTIP, 'aria-label': BEAP_INBOX_REPLY_TOOLTIP }
}
