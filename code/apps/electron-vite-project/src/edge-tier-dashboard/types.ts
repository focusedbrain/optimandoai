export type ReplicaHealth = 'healthy' | 'unhealthy' | 'unknown'

export type DashboardFallbackPolicy = 'reject' | 'downgrade_with_badge'

export interface QuarantineReplicaSummary {
  replica_id: string
  count: number
  latest_at: string | null
}

export interface QuarantineDashboardSummary {
  total_count: number
  by_replica: QuarantineReplicaSummary[]
  recent_failures: Array<{
    replica_id: string
    hash: string
    quarantined_at: string
    failed_role: string
  }>
}

export interface QuarantineListItem {
  replica_id: string
  hash: string
  quarantined_at: string
  envelope_from: string
  envelope_subject_filtered: string
  failed_role: string
  report_filename: string | null
}

export interface ReplicaStatus {
  host: string
  port: number
  edge_pod_id: string
  edge_public_key: string
  health: ReplicaHealth
  health_checked_at: string | null
  health_error?: string
  last_cert_timestamp: string | null
  certs_per_minute: number
  degraded?: boolean
  supervisor_containers?: Array<{
    role: string
    container_name: string
    state: string
  }>
}

export interface ReplacementBudgetNotification {
  replica_id: string
  container_role: string
  container_name: string
  message: string
  created_at: string
}

export interface VerificationEvent {
  timestamp: string
  edge_pod_id: string
  sub: string
  result: string
  phase: 'shallow' | 'deep'
}

import type { EdgeConfigurationState } from '../edge-tier/configurationState.js'

export interface DashboardUpdatePayload {
  edge_tier_enabled: boolean
  edge_configuration_state: EdgeConfigurationState
  fallback_policy: DashboardFallbackPolicy
  replicas: ReplicaStatus[]
  verifications: VerificationEvent[]
  quarantine_summary?: QuarantineDashboardSummary
  replacement_budget_notifications?: ReplacementBudgetNotification[]
}
