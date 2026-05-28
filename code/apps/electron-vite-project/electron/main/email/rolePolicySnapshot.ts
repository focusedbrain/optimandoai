/**
 * Sync mode snapshot for role policy (no I/O).
 */

import type { AccountSummary, EdgeFetchState, RolePolicyModeSnapshot } from '@repo/role-policy'

import { getIngestionModeSnapshot } from '../ingestion/ingestionModeService.js'
import type { EdgeFetchLocalState } from './edgeFetch/types.js'

export function edgeFetchStateForPolicy(state: EdgeFetchLocalState | undefined): EdgeFetchState {
  return (state ?? 'not_on_edge') as EdgeFetchState
}

export function accountSummaryForPolicy(account: {
  id: string
  edgeFetch?: { state?: EdgeFetchLocalState }
}): AccountSummary {
  return {
    id: account.id,
    edgeFetchState: edgeFetchStateForPolicy(account.edgeFetch?.state),
  }
}

export function accountSummaryFromConfig(
  accountId: string,
  cfg: { edgeFetch?: { state?: EdgeFetchLocalState } } | null | undefined,
): AccountSummary {
  return {
    id: accountId,
    edgeFetchState: edgeFetchStateForPolicy(cfg?.edgeFetch?.state),
  }
}

/** Latest stable ingestion mode for policy gates (non-blocking). */
export function currentRolePolicyModeSnapshot(): RolePolicyModeSnapshot {
  const snap = getIngestionModeSnapshot()
  if (!snap) {
    return { mode: 'LegacyInProcess', hostPodVariant: null, context: 'host_orchestrator' }
  }
  return {
    mode: snap.mode,
    hostPodVariant:
      snap.hostPodVariant === 'halted_by_anomaly' ? 'halted_by_anomaly' : null,
    context: 'host_orchestrator',
  }
}
