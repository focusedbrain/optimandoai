/**
 * Orchestrator session key helpers — shared by list/get/import paths.
 * Keeps KV session_* resolution aligned with Sessions History / listAllSessionsForUi.
 */

import type { Session } from './types'

const MAX_SESSION_KEY_LEN = 512

/** Keys under which WR Chat / extension store session JSON in the settings KV table. */
export function isOrchestratorKvSessionKey(id: string): boolean {
  if (!id || id.length > MAX_SESSION_KEY_LEN) return false
  return id.startsWith('session_') || id.startsWith('archive_session_')
}

function nonEmptyString(x: unknown): string | null {
  if (x == null || typeof x !== 'string') return null
  const t = x.trim()
  return t.length > 0 ? t : null
}

/**
 * Display label for a KV session blob — mirrors extension `sessionDisplayLabel` priority.
 */
export function resolveOrchestratorSessionDisplayName(
  key: string,
  v: Record<string, unknown>,
): string {
  const baseName =
    nonEmptyString(v.sessionAlias) ??
    nonEmptyString(v.tabName) ??
    nonEmptyString(v.name) ??
    nonEmptyString(v.sessionName) ??
    nonEmptyString(key) ??
    'Unnamed session'
  return key.startsWith('archive_session_') ? `Archived: ${baseName}` : baseName
}

function parseKvSessionTimestamp(v: Record<string, unknown>): number {
  const iso =
    (typeof v.timestamp === 'string' && v.timestamp) ||
    (typeof v.lastOpenedAt === 'string' && v.lastOpenedAt) ||
    (typeof v.createdAt === 'string' && v.createdAt) ||
    null
  if (iso) {
    const ms = Date.parse(iso)
    if (!Number.isNaN(ms)) return ms
  }
  return Date.now()
}

/**
 * Map a settings KV session blob to the orchestrator `Session` shape used by getSession IPC
 * and buildSessionImportArtefact (agents/agentBoxes live on config).
 */
export function kvBlobToOrchestratorSession(key: string, kv: Record<string, unknown>): Session {
  const ts = parseKvSessionTimestamp(kv)
  return {
    id: key,
    name: resolveOrchestratorSessionDisplayName(key, kv),
    config: { ...kv },
    created_at: ts,
    updated_at: ts,
  }
}
