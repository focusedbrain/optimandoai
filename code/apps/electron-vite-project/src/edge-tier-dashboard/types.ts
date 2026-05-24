export type ReplicaHealth = 'healthy' | 'unhealthy' | 'unknown'

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
}

export interface VerificationEvent {
  timestamp: string
  edge_pod_id: string
  sub: string
  result: string
  phase: 'shallow' | 'deep'
}

export interface DashboardUpdatePayload {
  edge_tier_enabled: boolean
  replicas: ReplicaStatus[]
  verifications: VerificationEvent[]
}
