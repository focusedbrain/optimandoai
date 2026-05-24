/**
 * Edge tier status dashboard — Phase 4 (P4.6).
 *
 * Periodic replica /health probes, verification log ring buffer, IPC snapshot.
 */

import { ipcMain, type WebContents } from 'electron'
import { loadEdgeTierSettings, type EdgeReplica } from './settings.js'
import { toDashboardFallbackPolicy, type DashboardFallbackPolicy } from './globalActions.js'
import {
  getRecentEdgeVerifications,
  getReplicaVerificationStats,
  countVerifiedSince,
  type EdgeVerificationRecord,
  MAX_EDGE_VERIFICATIONS,
} from './verificationAudit.js'

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
  /** Verified certs per minute over the last 5 minutes. */
  certs_per_minute: number
}

export type VerificationEvent = EdgeVerificationRecord

export interface DashboardUpdatePayload {
  edge_tier_enabled: boolean
  fallback_policy: DashboardFallbackPolicy
  replicas: ReplicaStatus[]
  verifications: VerificationEvent[]
}

export const HEALTH_PROBE_INTERVAL_MS = 30_000
const CERT_RATE_WINDOW_MS = 5 * 60 * 1000
const HEALTH_FETCH_TIMEOUT_MS = 5_000

export type HealthFetchFn = (
  url: string,
  init: RequestInit,
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

export interface DashboardDeps {
  fetchHealth: HealthFetchFn
  now: () => number
}

const defaultDeps: DashboardDeps = {
  fetchHealth: async (url, init) => {
    const res = await fetch(url, init)
    return {
      ok: res.ok,
      status: res.status,
      json: () => res.json(),
    }
  },
  now: () => Date.now(),
}

let _deps: DashboardDeps = defaultDeps
let _healthCache = new Map<
  string,
  { health: ReplicaHealth; checked_at: string; error?: string }
>()
let _pollTimer: ReturnType<typeof setInterval> | null = null
const _subscribers = new Set<WebContents>()

function replicaKey(replica: Pick<EdgeReplica, 'edge_pod_id'>): string {
  return replica.edge_pod_id.toLowerCase()
}

export async function probeReplicaHealth(
  host: string,
  port: number,
  deps: DashboardDeps = _deps,
): Promise<{ health: ReplicaHealth; error?: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HEALTH_FETCH_TIMEOUT_MS)
  try {
    const res = await deps.fetchHealth(`http://${host}:${port}/health`, {
      signal: controller.signal,
    })
    if (!res.ok) {
      return { health: 'unhealthy', error: `HTTP ${res.status}` }
    }
    try {
      const body = (await res.json()) as Record<string, unknown>
      if (body['status'] != null && body['status'] !== 'ok') {
        return { health: 'unhealthy', error: String(body['status']) }
      }
    } catch {
      /* 200 without JSON is acceptable */
    }
    return { health: 'healthy' }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { health: 'unhealthy', error: message }
  } finally {
    clearTimeout(timer)
  }
}

function certsPerMinute(edgePodId: string, nowMs: number): number {
  return countVerifiedSince(edgePodId, CERT_RATE_WINDOW_MS, nowMs) / 5
}

export function buildReplicaStatus(
  replica: EdgeReplica,
  nowMs: number = _deps.now(),
): ReplicaStatus {
  const key = replicaKey(replica)
  const cached = _healthCache.get(key)
  const stats = getReplicaVerificationStats()[key]

  return {
    host: replica.host,
    port: replica.port,
    edge_pod_id: replica.edge_pod_id,
    edge_public_key: replica.edge_public_key,
    health: cached?.health ?? 'unknown',
    health_checked_at: cached?.checked_at ?? null,
    health_error: cached?.error,
    last_cert_timestamp: stats?.last_success_at ?? null,
    certs_per_minute: certsPerMinute(replica.edge_pod_id, nowMs),
  }
}

export function getDashboardReplicas(): ReplicaStatus[] {
  const settings = loadEdgeTierSettings()
  const nowMs = _deps.now()
  return settings.replicas.map((r) => buildReplicaStatus(r, nowMs))
}

export function getDashboardVerifications(limit = MAX_EDGE_VERIFICATIONS): VerificationEvent[] {
  return getRecentEdgeVerifications(limit)
}

export function onVerifierVerificationIngested(_record: VerificationEvent): void {
  notifyDashboardUpdated()
}

export function buildDashboardUpdatePayload(): DashboardUpdatePayload {
  const settings = loadEdgeTierSettings()
  return {
    edge_tier_enabled: settings.enabled,
    fallback_policy: toDashboardFallbackPolicy(settings.fallback_policy),
    replicas: getDashboardReplicas(),
    verifications: getDashboardVerifications(),
  }
}

export async function refreshReplicaHealthCache(): Promise<void> {
  const settings = loadEdgeTierSettings()
  const checkedAt = new Date(_deps.now()).toISOString()
  await Promise.all(
    settings.replicas.map(async (replica) => {
      const result = await probeReplicaHealth(replica.host, replica.port)
      _healthCache.set(replicaKey(replica), {
        health: result.health,
        checked_at: checkedAt,
        error: result.error,
      })
    }),
  )
  notifyDashboardUpdated()
}

export function startDashboardHealthPolling(): void {
  stopDashboardHealthPolling()
  void refreshReplicaHealthCache()
  _pollTimer = setInterval(() => {
    void refreshReplicaHealthCache()
  }, HEALTH_PROBE_INTERVAL_MS)
}

export function stopDashboardHealthPolling(): void {
  if (_pollTimer) {
    clearInterval(_pollTimer)
    _pollTimer = null
  }
}

export function notifyDashboardUpdated(): void {
  const payload = buildDashboardUpdatePayload()
  for (const wc of _subscribers) {
    if (!wc.isDestroyed()) {
      wc.send('dashboard:updates', payload)
    }
  }
}

export function _clearReplicaHealthCacheEntry(replicaId: string): void {
  _healthCache.delete(replicaId.toLowerCase())
}

export async function fetchReplicaLogs(
  edgePodId: string,
): Promise<{ ok: true; lines: string[] } | { ok: false; error: string }> {
  const settings = loadEdgeTierSettings()
  const replica = settings.replicas.find(
    (r) => r.edge_pod_id.toLowerCase() === edgePodId.toLowerCase(),
  )
  if (!replica) {
    return { ok: false, error: 'Replica not found' }
  }
  return {
    ok: false,
    error:
      'Remote logs require SSH access. Credentials are not retained after deploy — log viewing arrives in P4.7.',
  }
}

export function registerDashboardIpcHandlers(): void {
  ipcMain.handle('dashboard:getReplicas', async () => getDashboardReplicas())
  ipcMain.handle('dashboard:getVerifications', async (_event, limit?: unknown) => {
    const n =
      typeof limit === 'number' && limit > 0 ? Math.min(limit, MAX_EDGE_VERIFICATIONS) : MAX_EDGE_VERIFICATIONS
    return getDashboardVerifications(n)
  })
  ipcMain.handle('dashboard:subscribeUpdates', async (event) => {
    const wc = event.sender
    _subscribers.add(wc)
    const onDestroyed = () => {
      _subscribers.delete(wc)
    }
    wc.once('destroyed', onDestroyed)
    wc.send('dashboard:updates', buildDashboardUpdatePayload())
    return { ok: true }
  })
  ipcMain.handle('dashboard:fetchReplicaLogs', async (_event, edgePodId: unknown) => {
    if (typeof edgePodId !== 'string' || edgePodId.length === 0) {
      throw new Error('edgePodId: expected non-empty string')
    }
    return fetchReplicaLogs(edgePodId)
  })

  startDashboardHealthPolling()
  console.log(
    '[MAIN] IPC handlers registered: dashboard:getReplicas, dashboard:getVerifications, dashboard:subscribeUpdates, dashboard:fetchReplicaLogs',
  )
}

/** Test seam */
export function _setDashboardDepsForTest(deps: Partial<DashboardDeps> | null): void {
  _deps = deps ? { ...defaultDeps, ...deps } : defaultDeps
}

export function _resetDashboardForTest(): void {
  stopDashboardHealthPolling()
  _healthCache.clear()
  _subscribers.clear()
  _deps = defaultDeps
}
