/**
 * Edge tier status snapshot for dashboard (Phase 3, P3.10 — strategy §4.2 seed data).
 */

import {
  loadEdgeTierSettings,
  isEdgeTierActiveForRouting,
  isEdgeTierSetupPending,
  deriveEdgeConfigurationState,
  type EdgeConfigurationState,
  type EdgeReplica,
} from './settings.js'
import { getReplicaVerificationStats, type ReplicaVerificationStats } from './verificationAudit.js'

export type LocalPodMode = 'LOCAL_HOST' | 'LOCAL_VERIFY'

export interface EdgeReplicaStatusView {
  host: string
  port: number
  edge_pod_id: string
  edge_public_key: string
  last_success_at?: string
  last_failure_at?: string
  last_failure_reason?: string
}

export interface EdgeTierStatusSnapshot {
  mode: LocalPodMode
  edge_tier_enabled: boolean
  edge_setup_pending: boolean
  edge_configuration_state: EdgeConfigurationState
  fallback_policy: 'reject' | 'local_only'
  replicas: EdgeReplicaStatusView[]
  jwks_last_refreshed_at: string | null
}

function mergeReplicaStats(
  replica: EdgeReplica,
  stats: Record<string, ReplicaVerificationStats>,
): EdgeReplicaStatusView {
  const s = stats[replica.edge_pod_id.toLowerCase()] ?? {}
  return {
    host: replica.host,
    port: replica.port,
    edge_pod_id: replica.edge_pod_id,
    edge_public_key: replica.edge_public_key,
    last_success_at: s.last_success_at,
    last_failure_at: s.last_failure_at,
    last_failure_reason: s.last_failure_reason,
  }
}

export function getEdgeTierStatusSnapshot(): EdgeTierStatusSnapshot {
  const settings = loadEdgeTierSettings()
  const stats = getReplicaVerificationStats()
  const mode: LocalPodMode = isEdgeTierActiveForRouting(settings) ? 'LOCAL_VERIFY' : 'LOCAL_HOST'
  return {
    mode,
    edge_tier_enabled: isEdgeTierActiveForRouting(settings),
    edge_setup_pending: isEdgeTierSetupPending(settings),
    edge_configuration_state: deriveEdgeConfigurationState(settings),
    fallback_policy: settings.fallback_policy,
    replicas: settings.replicas.map((r) => mergeReplicaStats(r, stats)),
    jwks_last_refreshed_at: settings.cached_jwks_fetched_at ?? null,
  }
}
