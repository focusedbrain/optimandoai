/**
 * Loads orchestrator session history via preload IPC and caches it in useProjectStore.
 */

import { useProjectStore } from '../stores/useProjectStore'
import type { OrchestratorSession } from '../types/projectTypes'

function mapRow(r: unknown): OrchestratorSession | null {
  if (!r || typeof r !== 'object') return null
  const o = r as Record<string, unknown>
  const id = typeof o.id === 'string' ? o.id : null
  if (!id) return null
  const name = typeof o.name === 'string' ? o.name : 'Session'
  const createdAt =
    typeof o.created_at === 'string'
      ? o.created_at
      : typeof o.updated_at === 'string'
        ? o.updated_at
        : new Date().toISOString()
  return { id, name, createdAt }
}

export function refreshOrchestratorSessionsFromBridge(): Promise<void> {
  const o = window.orchestrator
  if (!o?.connect || !o?.listSessions) return Promise.resolve()
  return (async () => {
    try {
      const conn = await o.connect()
      if (!conn?.success) return
      const res = await o.listSessions()
      if (!res?.success || !Array.isArray(res.data)) return
      const sessions = res.data.map(mapRow).filter((s): s is OrchestratorSession => s !== null)
      useProjectStore.getState().setOrchestratorSessions(sessions)
    } catch {
      /* noop */
    }
  })()
}
