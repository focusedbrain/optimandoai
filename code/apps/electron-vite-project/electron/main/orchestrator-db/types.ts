/**
 * Type definitions for orchestrator database
 * All data structures designed to be easily serializable to JSON/YAML/MD
 */

/**
 * Orchestrator session (active when database is unlocked)
 * Similar to VaultSession but for orchestrator data
 */
export interface OrchestratorSession {
  dek: Buffer              // Data Encryption Key
  lastActivity: number     // Timestamp for potential autolock
  connected: boolean       // Connection status
}

/**
 * Database status
 */
export interface OrchestratorStatus {
  exists: boolean
  connected: boolean
  dbPath: string
}

/**
 * Session configuration (stored in sessions table)
 */
export interface Session {
  id: string
  name: string
  config: Record<string, any>  // Arbitrary session configuration
  created_at: number
  updated_at: number
  tags?: string[]  // For filtering/categorization
}

/**
 * Setting entry (key-value store)
 */
export interface Setting {
  key: string
  value: any  // Arbitrary JSON-serializable value
  updated_at: number
}

/**
 * UI state entry (temporary states)
 */
export interface UIState {
  key: string
  value: any
  updated_at: number
}

/**
 * Session template (for future export/import)
 */
export interface SessionTemplate {
  id: string
  name: string
  type: string  // e.g., 'automation', 'analysis', 'custom'
  data: Record<string, any>
  created_at: number
}

/**
 * Export/Import format
 */
export type ExportFormat = 'json' | 'yaml' | 'md'

/**
 * Export options
 */
export interface ExportOptions {
  format: ExportFormat
  includeSessions?: boolean
  includeSettings?: boolean
  includeUIState?: boolean
  includeTemplates?: boolean
  sessionFilter?: string[]  // Filter by session IDs
}

/**
 * Export data structure
 */
export interface ExportData {
  version: string
  exported_at: number
  sessions?: Session[]
  settings?: Setting[]
  ui_state?: UIState[]
  templates?: SessionTemplate[]
}

/**
 * KDF parameters (same as vault for consistency)
 */
export interface KDFParams {
  memoryCost: number
  timeCost: number
  parallelism: number
}

