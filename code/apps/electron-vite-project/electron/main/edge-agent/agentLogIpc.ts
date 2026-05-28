/**
 * IPC for Agent activity log stream (PR7).
 */

import { ipcMain } from 'electron'

import { getEdgeTierUserDataDir } from '../edge-tier/settings.js'
import {
  getAgentLogReceiverStatus,
  refreshAgentLogReceiver,
  startAgentLogReceiver,
  triggerAgentRecover,
} from './agentLogReceiver.js'
import { openAgentLogStore, queryAgentLogEvents } from './agentLogStore.js'

import { getHandshakeDbForInternalInference } from '../internalInference/dbAccess.js'
import { migrateAgentReplicaStopgapsToHandshake } from './agentReplicaStopgapMigration.js'

export function initAgentLogIpc(): void {
  void getHandshakeDbForInternalInference().then((db) => {
    if (db) migrateAgentReplicaStopgapsToHandshake(db)
  })
  startAgentLogReceiver()
}

export function registerAgentLogIpcHandlers(): void {
  ipcMain.handle('edge-agent:get-activity', async (_e, raw: unknown) => {
    const q = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
    const handshakeId = typeof q.handshake_id === 'string' ? q.handshake_id : ''
    if (!handshakeId) return { ok: false, error: 'handshake_id required' }

    const db = openAgentLogStore(getEdgeTierUserDataDir())
    if (!db) return { ok: false, error: 'Database unavailable' }

    const events = queryAgentLogEvents(db, {
      handshakeId,
      limit: typeof q.limit === 'number' ? q.limit : 100,
      offset: typeof q.offset === 'number' ? q.offset : 0,
      levels: Array.isArray(q.levels) ? (q.levels as string[]) : undefined,
      sources: Array.isArray(q.sources) ? (q.sources as string[]) : undefined,
      eventCodeContains: typeof q.event_code === 'string' ? q.event_code : undefined,
      sinceIso: typeof q.since_iso === 'string' ? q.since_iso : undefined,
      untilIso: typeof q.until_iso === 'string' ? q.until_iso : undefined,
    })

    const status = getAgentLogReceiverStatus()
    return { ok: true, data: { events, ...status } }
  })

  ipcMain.handle('edge-agent:recover', async (_e, raw: unknown) => {
    const reason =
      typeof raw === 'object' && raw !== null && typeof (raw as { reason?: string }).reason === 'string'
        ? (raw as { reason: string }).reason
        : 'user initiated recovery'
    try {
      const result = await triggerAgentRecover(reason)
      return { ok: true, data: result }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  })

  ipcMain.handle('edge-agent:export-activity', async (_e, raw: unknown) => {
    const q = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
    const handshakeId = typeof q.handshake_id === 'string' ? q.handshake_id : ''
    if (!handshakeId) return { ok: false, error: 'handshake_id required' }
    const db = openAgentLogStore(getEdgeTierUserDataDir())
    if (!db) return { ok: false, error: 'Database unavailable' }
    const events = queryAgentLogEvents(db, {
      handshakeId,
      limit: 500,
      levels: Array.isArray(q.levels) ? (q.levels as string[]) : undefined,
    })
    return { ok: true, data: events }
  })

  refreshAgentLogReceiver()
}
