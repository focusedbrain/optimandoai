/**
 * Host-only Sandbox clone icon. Does not apply crypto; main IPC still enforces host + target.
 *
 * - Shown when the Host has at least one **ACTIVE internal** Host↔Sandbox handshake (from
 *   `listAvailable` / `hasActiveInternalSandboxHandshake`), the list RPC has completed, the row is
 *   actionable, and this device is not the Sandbox orchestrator. **Not** gated on live relay
 *   or `beap_clone_eligible`.
 * - When the same list marks this device as the Sandbox side, the icon is hidden.
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
  /**
   * At least one ACTIVE internal Host↔Sandbox handshake (same identity) from `listAvailable` — not relay-connected.
   * While list is not ready, icon stays hidden (fail closed).
   */
  hasActiveInternalSandboxHandshake: boolean
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
  const {
    modeReady,
    orchestratorMode,
    message,
    authoritativeDeviceInternalRole,
    internalSandboxListReady,
    hasActiveInternalSandboxHandshake,
  } = p
  logOrchestratorRoleModeConflict(p)
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
  if (!internalSandboxListReady) {
    return {
      show: false,
      reason: 'internal_sandbox_list_not_ready',
      orchestratorMode,
      authoritativeDeviceInternalRole,
      internalSandboxListReady,
    }
  }
  if (!hasActiveInternalSandboxHandshake) {
    return {
      show: false,
      reason: 'no_active_internal_sandbox_handshake',
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

/**
 * When persisted orchestrator mode and internal same-principal handshake role disagree, fail closed
 * (Sandbox icon hidden) and surface a single console warning for support/debug.
 */
let warnedHostVsAuthSandbox: boolean | undefined
let warnedSandboxVsAuthHost: boolean | undefined

function logOrchestratorRoleModeConflict(p: CanShowSandboxCloneIconParams): void {
  const { orchestratorMode, authoritativeDeviceInternalRole, internalSandboxListReady } = p
  if (!internalSandboxListReady) return
  if (orchestratorMode === 'host' && authoritativeDeviceInternalRole === 'sandbox') {
    if (warnedHostVsAuthSandbox) return
    warnedHostVsAuthSandbox = true
    // eslint-disable-next-line no-console
    console.warn(
      DEBUG_PREFIX,
      'Orchestrator mode is host but internal handshake marks this device as Sandbox — hiding Sandbox clone icon.',
    )
  }
  if (orchestratorMode === 'sandbox' && authoritativeDeviceInternalRole === 'host') {
    if (warnedSandboxVsAuthHost) return
    warnedSandboxVsAuthHost = true
    // eslint-disable-next-line no-console
    console.warn(
      DEBUG_PREFIX,
      'Orchestrator mode is sandbox but internal handshake marks this device as Host — Sandbox clone icon hidden.',
    )
  }
}

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
    hasActiveInternalSandboxHandshake: p.hasActiveInternalSandboxHandshake,
    selectedInternalSandboxHandshakeId: firstHs,
    messageId: message?.id,
  })
}
