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
  const createdAt = pickSessionIsoDate(o)
  return { id, name, createdAt }
}

/** IPC / HTTP may send `created_at` as ISO string or ms number (legacy Session rows). */
function pickSessionIsoDate(o: Record<string, unknown>): string {
  const ca = o.created_at
  if (typeof ca === 'string' && ca) return ca
  if (typeof ca === 'number' && Number.isFinite(ca)) return new Date(ca).toISOString()
  const ua = o.updated_at
  if (typeof ua === 'string' && ua) return ua
  if (typeof ua === 'number' && Number.isFinite(ua)) return new Date(ua).toISOString()
  return new Date().toISOString()
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
