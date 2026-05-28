/**
 * Poll loop for Agent structured log stream (PR7).
 */

import { BrowserWindow } from 'electron'

import type { AgentLogEvent } from '@repo/agent-log-events'

import { getEdgeTierUserDataDir, loadEdgeTierSettings, type EdgeReplica } from '../edge-tier/settings.js'
import {
  ackAgentLogStream,
  pollAgentLogStream,
  requestAgentRecover,
} from './agentApiClient.js'
import {
  getAgentLogPollCursor,
  insertAgentLogEvents,
  openAgentLogStore,
  saveAgentLogPollCursor,
} from './agentLogStore.js'

const DEFAULT_POLL_MS = 10_000
const MIN_POLL_MS = 5_000
const MAX_POLL_MS = 60_000

export type AgentReachability = 'unknown' | 'reachable' | 'unreachable'

interface PollState {
  timer: ReturnType<typeof setInterval> | null
  pollMs: number
  reachability: AgentReachability
  lastError: string | null
  consecutiveFailures: number
}

const stateByReplica = new Map<string, PollState>()

function agentReplica(): EdgeReplica | null {
  const settings = loadEdgeTierSettings()
  const replica = settings.replicas.find((r) => r.deployment_type === 'agent')
  return replica ?? null
}

function notifyActivityUpdated(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('edge-agent:activity-updated')
    }
  }
}

async function pollOnce(replica: EdgeReplica): Promise<void> {
  const userData = getEdgeTierUserDataDir()
  const db = openAgentLogStore(userData)
  if (!db) return

  const replicaKey = replica.edge_pod_id
  const handshakeId = replica.handshake_id ?? replicaKey
  let cursor = getAgentLogPollCursor(userData, handshakeId)
  let hasMore = true

  let receivedCount = 0
  try {
    while (hasMore) {
      const res = await pollAgentLogStream(replica, {
        after_event_id: cursor,
        max_count: 200,
      })
      const events = (res.events ?? []) as AgentLogEvent[]
      if (events.length > 0) {
        receivedCount += events.length
        insertAgentLogEvents(db, handshakeId, events)
        cursor = res.next_after_event_id ?? events[events.length - 1]!.event_id
        saveAgentLogPollCursor(userData, handshakeId, cursor)
        if (cursor) {
          await ackAgentLogStream(replica, cursor)
        }
        notifyActivityUpdated()
      }
      hasMore = Boolean(res.has_more)
      if (!hasMore) break
    }

    const st = stateByReplica.get(replicaKey) ?? {
      timer: null,
      pollMs: DEFAULT_POLL_MS,
      reachability: 'unknown' as AgentReachability,
      lastError: null,
      consecutiveFailures: 0,
    }
    st.reachability = 'reachable'
    st.lastError = null
    st.consecutiveFailures = 0
    st.pollMs = receivedCount > 0 ? MIN_POLL_MS : Math.min(st.pollMs + 2000, MAX_POLL_MS)
    stateByReplica.set(replicaKey, st)
  } catch (err) {
    const st = stateByReplica.get(replicaKey) ?? {
      timer: null,
      pollMs: DEFAULT_POLL_MS,
      reachability: 'unknown' as AgentReachability,
      lastError: null,
      consecutiveFailures: 0,
    }
    st.consecutiveFailures += 1
    st.reachability = 'unreachable'
    st.lastError = err instanceof Error ? err.message : String(err)
    st.pollMs = Math.min(DEFAULT_POLL_MS * 2 ** Math.min(st.consecutiveFailures, 4), MAX_POLL_MS)
    stateByReplica.set(replicaKey, st)
    console.error(
      JSON.stringify({
        level: 'warn',
        source: 'agent-log-receiver',
        event: 'poll_failed',
        replica_id: replicaKey,
        message: st.lastError,
      }),
    )
  }
}

function scheduleReplica(replica: EdgeReplica): void {
  const replicaKey = replica.edge_pod_id
  const existing = stateByReplica.get(replicaKey)
  if (existing?.timer) clearInterval(existing.timer)

  const st: PollState = existing ?? {
    timer: null,
    pollMs: DEFAULT_POLL_MS,
    reachability: 'unknown',
    lastError: null,
    consecutiveFailures: 0,
  }

  void pollOnce(replica)
  st.timer = setInterval(() => void pollOnce(replica), st.pollMs)
  st.timer.unref?.()
  stateByReplica.set(replicaKey, st)
}

export function startAgentLogReceiver(): void {
  const replica = agentReplica()
  if (!replica) return
  scheduleReplica(replica)
}

export function stopAgentLogReceiver(): void {
  for (const st of stateByReplica.values()) {
    if (st.timer) clearInterval(st.timer)
  }
  stateByReplica.clear()
}

export function getAgentLogReceiverStatus(): {
  reachability: AgentReachability
  lastError: string | null
} {
  const replica = agentReplica()
  if (!replica) return { reachability: 'unknown', lastError: null }
  const st = stateByReplica.get(replica.edge_pod_id)
  return {
    reachability: st?.reachability ?? 'unknown',
    lastError: st?.lastError ?? null,
  }
}

export async function triggerAgentRecover(reason: string): Promise<Record<string, unknown>> {
  const replica = agentReplica()
  if (!replica) throw new Error('No Agent replica configured')
  return requestAgentRecover(replica, reason)
}

export function refreshAgentLogReceiver(): void {
  stopAgentLogReceiver()
  startAgentLogReceiver()
}
