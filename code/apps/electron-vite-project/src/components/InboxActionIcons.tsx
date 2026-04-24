/**
 * Inbox list + detail: Redirect and Sandbox use one visual system (`BeapActionIconButton` / App.css).
 */

import { BeapActionIconButton, type BeapActionIconButtonProps } from './BeapActionIconButton'

type RedirectProps = Omit<BeapActionIconButtonProps, 'kind'>

/** Redirect — same control in list row and message detail. */
export function InboxRedirectActionIcon(props: RedirectProps) {
  return <BeapActionIconButton kind="redirect" {...props} />
}

type SandboxProps = Omit<BeapActionIconButtonProps, 'kind'>

/** Sandbox Host clone — same control in list row and message detail. */
export function InboxSandboxCloneActionIcon(props: SandboxProps) {
  return <BeapActionIconButton kind="sandbox" {...props} />
}
