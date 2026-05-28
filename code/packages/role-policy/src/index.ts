/**
 * Pure send/receive role policy — host orchestrator vs edge mail-fetcher (Stream B).
 * No I/O. Shared by Electron main process and BEAP mail-fetcher role.
 */

export type EdgeFetchState =
  | 'not_on_edge'
  | 'migrating'
  | 'migrating_back'
  | 'awaiting_key'
  | 'active'
  | 'degraded'

export type IngestionModeForPolicy =
  | 'EdgeActive'
  | 'HostPodActive'
  | 'LegacyInProcess'
  | 'Blocked'

export type RolePolicyContext = 'host_orchestrator' | 'edge_mail_fetcher'

export type RolePolicyReason =
  | 'host_mode'
  | 'edge_active_for_account'
  | 'edge_pending_treat_as_disabled'
  | 'edge_blocked_holding'
  | 'edge_role_send_forbidden'
  | 'host_pod_halted'

export interface AccountSummary {
  readonly id: string
  readonly edgeFetchState?: EdgeFetchState
}

export interface RolePolicyModeSnapshot {
  readonly mode: IngestionModeForPolicy
  readonly hostPodVariant?: 'halted_by_anomaly' | null
  readonly context?: RolePolicyContext
}

export interface RolePolicyDecision {
  readonly allowed: boolean
  readonly reason: RolePolicyReason
}

/** Sentinel account for edge-role startup assertion. */
export const EDGE_ROLE_POLICY_ACCOUNT: AccountSummary = {
  id: '__edge_mail_fetcher__',
  edgeFetchState: 'active',
}

function edgeState(account: AccountSummary): EdgeFetchState {
  return account.edgeFetchState ?? 'not_on_edge'
}

/** Host must not pull mail when account is on edge or in migration. */
export function hostFetchDisabledByAccount(state: EdgeFetchState): boolean {
  return (
    state === 'active' ||
    state === 'awaiting_key' ||
    state === 'migrating' ||
    state === 'migrating_back' ||
    state === 'degraded'
  )
}

/** Send held when edge tier unreachable and account is fully edge-routed. */
export function hostSendBlockedWhenEdgeUnreachable(state: EdgeFetchState): boolean {
  return state === 'active' || state === 'degraded'
}

function canFetchHostOrchestrator(
  account: AccountSummary,
  mode: RolePolicyModeSnapshot,
): RolePolicyDecision {
  if (mode.hostPodVariant === 'halted_by_anomaly') {
    return { allowed: false, reason: 'host_pod_halted' }
  }

  const state = edgeState(account)

  if (mode.mode === 'HostPodActive' || mode.mode === 'LegacyInProcess') {
    if (hostFetchDisabledByAccount(state)) {
      return { allowed: false, reason: 'edge_active_for_account' }
    }
    return { allowed: true, reason: 'host_mode' }
  }

  if (mode.mode === 'EdgeActive' || mode.mode === 'Blocked') {
    if (hostFetchDisabledByAccount(state)) {
      if (state === 'awaiting_key' || state === 'migrating' || state === 'migrating_back') {
        return { allowed: false, reason: 'edge_pending_treat_as_disabled' }
      }
      if (mode.mode === 'Blocked') {
        return { allowed: false, reason: 'edge_blocked_holding' }
      }
      return { allowed: false, reason: 'edge_active_for_account' }
    }
    return { allowed: true, reason: 'host_mode' }
  }

  return { allowed: true, reason: 'host_mode' }
}

function canSendHostOrchestrator(
  account: AccountSummary,
  mode: RolePolicyModeSnapshot,
): RolePolicyDecision {
  if (mode.hostPodVariant === 'halted_by_anomaly') {
    return { allowed: false, reason: 'host_pod_halted' }
  }

  const state = edgeState(account)

  if (mode.mode === 'Blocked' && hostSendBlockedWhenEdgeUnreachable(state)) {
    return { allowed: false, reason: 'edge_blocked_holding' }
  }

  return { allowed: true, reason: 'host_mode' }
}

function canSendEdgeRole(): RolePolicyDecision {
  return { allowed: false, reason: 'edge_role_send_forbidden' }
}

export interface RolePolicy {
  canFetch(account: AccountSummary, mode: RolePolicyModeSnapshot): RolePolicyDecision
  canSend(account: AccountSummary, mode: RolePolicyModeSnapshot): RolePolicyDecision
}

export const rolePolicy: RolePolicy = {
  canFetch(account, mode) {
    if (mode.context === 'edge_mail_fetcher') {
      return { allowed: true, reason: 'host_mode' }
    }
    return canFetchHostOrchestrator(account, mode)
  },

  canSend(account, mode) {
    if (mode.context === 'edge_mail_fetcher') {
      return canSendEdgeRole()
    }
    return canSendHostOrchestrator(account, mode)
  },
}

/** HTTP paths/bodies that indicate a send operation on the mail-fetcher role. */
export function isMailFetcherSendShapedRequest(
  method: string,
  urlPath: string,
  _body?: unknown,
): boolean {
  const m = method.toUpperCase()
  const p = urlPath.toLowerCase()
  if (p.includes('send')) return true
  if (m === 'POST' && (p.includes('/smtp') || p.includes('/outbound') || p.includes('/deliver_outbound'))) {
    return true
  }
  return false
}
