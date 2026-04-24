/**
 * Host orchestrator — Sandbox clone (received BEAP). Native `title` hover; not Redirect.
 * Same string whether or not a sandbox is currently connected (click may open the help dialog).
 */
export const BEAP_HOST_SANDBOX_CLONE_TOOLTIP =
  'Send a clone of this BEAP message to your connected Sandbox orchestrator for testing. The original message stays unchanged.'

/**
 * Spread onto Sandbox buttons for native hover text (browser `title` tooltip).
 */
export function beapHostSandboxCloneTooltipProps(): { title: string } {
  return { title: BEAP_HOST_SANDBOX_CLONE_TOOLTIP }
}
