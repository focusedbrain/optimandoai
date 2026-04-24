/**
 * Host-only Sandbox clone icon. Does not apply crypto; main IPC still enforces host + target.
 *
 * - Every actionable inbox message on a Host orchestrator can show the icon; connected vs offline
 *   only changes what happens on click (clone vs unavailable dialog).
 * - When `internalSandboxes.listAvailable` has succeeded and marks this device as the Sandbox side,
 *   the icon is hidden (fail closed vs mis-set global mode).
 */

import type { AuthoritativeDeviceInternalRole } from '../types/sandboxOrchestratorAvailability'
import type { InboxMessage } from '../stores/useEmailInboxStore'
import { isInboxMessageActionable } from './inboxMessageActionable'

export type CanShowSandboxCloneIconParams = {
  modeReady: boolean
  orchestratorMode: 'host' | 'sandbox' | null
  message: InboxMessage | null | undefined
  authoritativeDeviceInternalRole: AuthoritativeDeviceInternalRole
  /**
   * After a successful `internalSandboxes.listAvailable`, `authoritative` is trusted.
   * While false (loading or RPC error), we do not treat the device as Sandbox unless mode says so.
   */
  internalSandboxListReady: boolean
}

/** @deprecated use {@link CanShowSandboxCloneIconParams} */
export type CanShowSandboxCloneActionParams = CanShowSandboxCloneIconParams

export type SandboxCloneEligibilityDetail = {
  show: boolean
  reason: string
  orchestratorMode: 'host' | 'sandbox' | null
  authoritativeDeviceInternalRole: AuthoritativeDeviceInternalRole
  internalSandboxListReady: boolean
}

export function getSandboxCloneEligibilityDetail(
  p: CanShowSandboxCloneIconParams,
): SandboxCloneEligibilityDetail {
  const { modeReady, orchestratorMode, message, authoritativeDeviceInternalRole, internalSandboxListReady } = p
  if (!modeReady) {
    return { show: false, reason: 'mode_not_ready', orchestratorMode, authoritativeDeviceInternalRole, internalSandboxListReady }
  }
  if (orchestratorMode !== 'host') {
    return { show: false, reason: 'orchestrator_not_host', orchestratorMode, authoritativeDeviceInternalRole, internalSandboxListReady }
  }
  if (internalSandboxListReady && authoritativeDeviceInternalRole === 'sandbox') {
    return {
      show: false,
      reason: 'authoritative_device_is_sandbox_orchestrator',
      orchestratorMode,
      authoritativeDeviceInternalRole,
      internalSandboxListReady,
    }
  }
  if (!isInboxMessageActionable(message)) {
    return { show: false, reason: 'message_not_actionable', orchestratorMode, authoritativeDeviceInternalRole, internalSandboxListReady }
  }
  return {
    show: true,
    reason: 'eligible',
    orchestratorMode,
    authoritativeDeviceInternalRole,
    internalSandboxListReady,
  }
}

export function canShowSandboxCloneIcon(p: CanShowSandboxCloneIconParams): boolean {
  return getSandboxCloneEligibilityDetail(p).show
}

/** @deprecated use {@link canShowSandboxCloneIcon} */
export const canShowSandboxCloneAction = canShowSandboxCloneIcon
/** @deprecated */
export const canShowSandboxAction = canShowSandboxCloneIcon

const DEBUG_PREFIX = '[sandbox-clone-ui]'

export function logSandboxCloneEligibilityDebug(
  p: CanShowSandboxCloneIconParams,
  extra?: { selectedHandshakeId?: string | null },
): void {
  if (!import.meta.env.DEV) return
  const d = getSandboxCloneEligibilityDetail(p)
  const { message } = p
  const firstHs = extra?.selectedHandshakeId ?? null
  // eslint-disable-next-line no-console
  console.info(DEBUG_PREFIX, {
    show: d.show,
    reason: d.reason,
    orchestratorMode: p.orchestratorMode,
    authoritativeDeviceInternalRole: p.authoritativeDeviceInternalRole,
    internalSandboxListReady: p.internalSandboxListReady,
    selectedInternalSandboxHandshakeId: firstHs,
    messageId: message?.id,
  })
}
