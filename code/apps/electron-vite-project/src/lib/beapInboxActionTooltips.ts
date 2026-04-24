/**
 * Host orchestrator — Sandbox clone (received BEAP). Tri-state for screen readers; short `title` for hover.
 * Does not include Redirect.
 */

import type { SandboxOrchestratorAvailability } from '../types/sandboxOrchestratorAvailability'

const SANDBOX_CLONE_TIP_SHORT = 'Send a clone to Sandbox'

/** List row — short hover label */
export const BEAP_INBOX_SANDBOX_TIP_ROW = 'Clone to Sandbox'
/** Message detail — primary hover line */
export const BEAP_INBOX_SANDBOX_TIP_DETAIL = 'Clone this BEAP message to the connected Sandbox orchestrator'

/** Long context for a11y (tri-state) — not shown as primary visible label. */
export const BEAP_HOST_SANDBOX_CLONE_ARIA_SUFFIX_CONNECTED =
  'Sends a clone of this BEAP message to your connected Sandbox orchestrator. The original stays unchanged.'

export const BEAP_HOST_SANDBOX_CLONE_ARIA_SUFFIX_NOT_CONFIGURED =
  'Sandbox clone is available after connecting a Sandbox orchestrator under the same identity.'

export const BEAP_HOST_SANDBOX_CLONE_ARIA_SUFFIX_OFFLINE =
  'Your Sandbox orchestrator exists but is offline. Start the Sandbox app or wait for the coordination relay, then try again.'

/**
 * `title` — native tooltip (row vs detail wording). `aria-label` — short + long for screen readers.
 * @param variant `row` = “Clone to Sandbox”; `detail` = long single-line when connected, else with status second line
 */
export function beapHostSandboxCloneTooltipForAvailability(
  availability: SandboxOrchestratorAvailability,
  variant: 'row' | 'detail' = 'detail',
): { title: string; 'aria-label': string } {
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

  const ariaShort = variant === 'row' ? BEAP_INBOX_SANDBOX_TIP_ROW : SANDBOX_CLONE_TIP_SHORT
  const ariaLabel = `${ariaShort}. ${long}`

  if (variant === 'row') {
    const title =
      availability.status === 'connected'
        ? BEAP_INBOX_SANDBOX_TIP_ROW
        : `${BEAP_INBOX_SANDBOX_TIP_ROW}\n${long}`
    return { title, 'aria-label': ariaLabel }
  }

  const title =
    availability.status === 'connected'
      ? BEAP_INBOX_SANDBOX_TIP_DETAIL
      : `${BEAP_INBOX_SANDBOX_TIP_DETAIL}\n${long}`
  return { title, 'aria-label': ariaLabel }
}

export const BEAP_INBOX_REDIRECT_TIP = 'Redirect'
export const BEAP_INBOX_REDIRECT_TIP_DESC = 'Redirect this BEAP message to another recipient.'
export const BEAP_INBOX_REDIRECT_TIP_DETAIL = 'Redirect this BEAP message'

/** List row: short title “Redirect”. */
export function beapInboxRedirectTooltipPropsForRow(): { title: string; 'aria-label': string } {
  return {
    title: BEAP_INBOX_REDIRECT_TIP,
    'aria-label': `${BEAP_INBOX_REDIRECT_TIP}. ${BEAP_INBOX_REDIRECT_TIP_DESC}`,
  }
}

/** Message detail: one-line primary hover. */
export function beapInboxRedirectTooltipPropsForDetail(): { title: string; 'aria-label': string } {
  return {
    title: BEAP_INBOX_REDIRECT_TIP_DETAIL,
    'aria-label': `${BEAP_INBOX_REDIRECT_TIP_DETAIL}. ${BEAP_INBOX_REDIRECT_TIP_DESC}`,
  }
}

/** Inbox message detail — compact Reply icon (`title` / screen reader). */
export const BEAP_INBOX_REPLY_TOOLTIP = 'Reply'

export function beapInboxReplyTooltipProps(): { title: string; 'aria-label': string } {
  return { title: BEAP_INBOX_REPLY_TOOLTIP, 'aria-label': BEAP_INBOX_REPLY_TOOLTIP }
}
