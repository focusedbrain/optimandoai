/**
 * Podman setup visibility — blocking in-app modal (not a dismissible OS toast).
 *
 * BEAP receive stays hard-blocked until {@link getLocalPodSetupError} is cleared.
 */

import { broadcastPodmanSetupState } from './podmanSetupBroadcast.js'
import { getPodSetupErrorRef } from './podStatus.js'

/** Runtime pod faults after Podman is present — not the install gate modal. */
export function notifyLocalPodSupervisorIssue(message: string): void {
  console.error(`[LOCAL_POD] ${message}`)
}

export function notifyLocalPodSetupIssue(message: string): void {
  console.error(`[LOCAL_POD] ${message}`)
  broadcastPodmanSetupState(getPodSetupErrorRef())
}
