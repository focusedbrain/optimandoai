/**
 * Host-only Sandbox clone **visibility** (list row + detail). Does not apply crypto; main IPC
 * enforces host + target on send.
 *
 * - **Row/detail icon**: Show on Host for actionable BEAP rows. Not gated on internal sandbox list
 *   loading, relay, `beap_clone_eligible`, or active handshake count (no icon flash while the list
 *   loads; setup vs clone is **click** behavior).
 * - **Hide** only when local orchestrator is Sandbox (persisted `orchestratorMode` or, when the
 *   internal list has loaded, authoritative role says this device is the Sandbox side).
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
   * When true, trusted from `internalSandboxes.listAvailable`: if this device is the Sandbox
   * side of an active internal handshake, Host-only clone UI is hidden. Does not gate visibility
   * on list loading (when false, we do not hide based on “no rows yet”).
   */
  internalSandboxListReady: boolean
}

/** @deprecated use {@link CanShowSandboxCloneIconParams} */
export type CanShowSandboxCloneActionParams = CanShowSandboxCloneIconParams

export type SandboxCloneEligibilityDetail = {
  show: boolean
  /** Internal debug slug. */
  reason: string
  orchestratorMode: 'host' | 'sandbox' | null
  authoritativeDeviceInternalRole: AuthoritativeDeviceInternalRole
  internalSandboxListReady: boolean
}

export type SandboxActionHiddenReason =
  | 'orchestrator_mode_not_ready'
  | 'local_orchestrator_is_sandbox'
  | 'row_not_actionable'

export function getSandboxCloneEligibilityDetail(
  p: CanShowSandboxCloneIconParams,
): SandboxCloneEligibilityDetail {
  const { modeReady, orchestratorMode, message, authoritativeDeviceInternalRole, internalSandboxListReady } = p
  logOrchestratorRoleModeConflict(p)
  if (!modeReady) {
    return { show: false, reason: 'orchestrator_mode_not_ready', orchestratorMode, authoritativeDeviceInternalRole, internalSandboxListReady }
  }
  if (orchestratorMode === 'sandbox') {
    return { show: false, reason: 'orchestrator_sandbox_mode', orchestratorMode, authoritativeDeviceInternalRole, internalSandboxListReady }
  }
  if (orchestratorMode === 'host' && internalSandboxListReady && authoritativeDeviceInternalRole === 'sandbox') {
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

/** Maps internal `reason` to the diagnostic `hiddenReason` (null = visible). */
export function toSandboxActionHiddenReason(
  d: SandboxCloneEligibilityDetail,
): SandboxActionHiddenReason | null {
  if (d.show) return null
  if (d.reason === 'orchestrator_mode_not_ready') return 'orchestrator_mode_not_ready'
  if (d.reason === 'orchestrator_sandbox_mode' || d.reason === 'authoritative_device_is_sandbox_orchestrator') {
    return 'local_orchestrator_is_sandbox'
  }
  if (d.reason === 'message_not_actionable') return 'row_not_actionable'
  return 'row_not_actionable'
}

export function canShowSandboxCloneIcon(p: CanShowSandboxCloneIconParams): boolean {
  return getSandboxCloneEligibilityDetail(p).show
}

/** @deprecated use {@link canShowSandboxCloneIcon} */
export const canShowSandboxCloneAction = canShowSandboxCloneIcon
/** @deprecated */
export const canShowSandboxAction = canShowSandboxCloneIcon

const DEBUG_PREFIX = '[sandbox-clone-ui]'

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
    selectedInternalSandboxHandshakeId: firstHs,
    messageId: message?.id,
  })
}

/**
 * Dev-only: structured visibility for inbox row debugging (per user spec).
 * Does not use loading / relay / beap_clone_eligible as icon gates.
 */
export function logSandboxActionVisibility(
  p: {
    message_id: string
    modeReady: boolean
    orchestratorMode: 'host' | 'sandbox' | null
    activeInternalSandboxHandshakeCount: number
    internalSandboxesLoading: boolean
    canShowParams: CanShowSandboxCloneIconParams
  },
): void {
  if (!import.meta.env.DEV) return
  const d = getSandboxCloneEligibilityDetail(p.canShowParams)
  const iconVisible = d.show
  const hiddenReason = toSandboxActionHiddenReason(d)
  // eslint-disable-next-line no-console
  console.log('[SANDBOX_ACTION_VISIBILITY]', {
    message_id: p.message_id,
    modeReady: p.modeReady,
    orchestratorMode: p.orchestratorMode,
    isHost: p.orchestratorMode === 'host',
    activeInternalSandboxHandshakeCount: p.activeInternalSandboxHandshakeCount,
    internalSandboxesLoading: p.internalSandboxesLoading,
    iconVisible,
    hiddenReason,
  })
}
