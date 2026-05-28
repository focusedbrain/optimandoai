export const AGENT_LOG_SCHEMA_VERSION = 1 as const

export type AgentLogLevel = 'debug' | 'info' | 'warn' | 'error' | 'critical'

export type AgentLogSource =
  | 'agent'
  | 'supervisor'
  | 'pod_manager'
  | `pod:${string}`
  | 'sso'
  | 'pairing'
  | 'recovery'

export type JsonScalar = string | number | boolean | null

export interface AgentLogEvent {
  event_id: string
  timestamp_iso: string
  level: AgentLogLevel
  source: AgentLogSource
  event_code: string
  message: string
  fields: Record<string, JsonScalar>
  schema_version: typeof AGENT_LOG_SCHEMA_VERSION
}

export type AgentLogEventInput = Omit<
  AgentLogEvent,
  'event_id' | 'timestamp_iso' | 'schema_version'
>
