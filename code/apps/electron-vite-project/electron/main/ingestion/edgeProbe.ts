/**
 * Edge + general connectivity probes and local host pod readiness.
 */

import { loadEdgeTierSettings, isEdgeTierActiveForRouting } from '../edge-tier/settings.js'
import type { EdgeReachableState } from './modeResolver.js'

const EDGE_PROBE_CACHE_MS = 15_000
const CONNECTIVITY_PROBE_CACHE_MS = 60_000
const HOST_POD_PROBE_TIMEOUT_MS = 3_000
const DEFAULT_CONNECTIVITY_URL =
  process.env['WR_CONNECTIVITY_PROBE_URL'] ?? 'https://www.cloudflare.com/cdn-cgi/trace'

export interface ProbeSnapshot {
  edgeReachable: EdgeReachableState
  generalConnectivity: boolean
  hostPodReady: boolean
  lastEdgeProbeAt: number | null
  lastEdgeSuccessAt: number | null
  lastConnectivityProbeAt: number | null
}

let _edgeCache: { at: number; reachable: boolean } | null = null
let _connectivityCache: { at: number; ok: boolean } | null = null
let _hostPodReady = false
let _lastEdgeSuccessAt: number | null = null
let _lastEdgeProbeAt: number | null = null
let _lastConnectivityProbeAt: number | null = null

export function getHostPodBaseUrl(): string {
  return process.env['WR_POD_BASE_URL'] ?? 'http://127.0.0.1:18100'
}

async function probeUrl(url: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { method: 'GET', signal: controller.signal })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

export async function probeEdgeReplicaHealth(host: string, port: number): Promise<boolean> {
  return probeUrl(`http://${host}:${port}/health`, HOST_POD_PROBE_TIMEOUT_MS)
}

export async function probeAnyEdgeReplica(force = false): Promise<EdgeReachableState> {
  const settings = loadEdgeTierSettings()
  if (!isEdgeTierActiveForRouting(settings) || settings.replicas.length === 0) {
    return false
  }

  const now = Date.now()
  if (!force && _edgeCache && now - _edgeCache.at < EDGE_PROBE_CACHE_MS) {
    return _edgeCache.reachable
  }

  _lastEdgeProbeAt = now
  let anyOk = false
  for (const replica of settings.replicas) {
    if (await probeEdgeReplicaHealth(replica.host, replica.port)) {
      anyOk = true
      break
    }
  }

  _edgeCache = { at: now, reachable: anyOk }
  if (anyOk) _lastEdgeSuccessAt = now
  return anyOk
}

export async function probeGeneralConnectivity(force = false): Promise<boolean> {
  const now = Date.now()
  if (!force && _connectivityCache && now - _connectivityCache.at < CONNECTIVITY_PROBE_CACHE_MS) {
    return _connectivityCache.ok
  }
  _lastConnectivityProbeAt = now
  const ok = await probeUrl(DEFAULT_CONNECTIVITY_URL, HOST_POD_PROBE_TIMEOUT_MS)
  _connectivityCache = { at: now, ok }
  return ok
}

export async function probeHostPodReady(force = false): Promise<boolean> {
  try {
    const { getHostPodSupervisorState } = await import('../local-pod/supervisor/hostPodState.js')
    if (getHostPodSupervisorState() !== 'healthy') {
      _hostPodReady = false
      return false
    }
  } catch {
    /* supervisor optional in tests */
  }
  if (!force && _hostPodReady) return true
  try {
    const { getActiveLocalPodName } = await import('../local-pod/index.js')
    const { checkRequiredPodContainersReady } = await import(
      '../local-pod/podContainerCompleteness.js'
    )
    const podName = getActiveLocalPodName()
    if (!podName) {
      _hostPodReady = false
      return false
    }
    const complete = await checkRequiredPodContainersReady(podName)
    _hostPodReady = complete.ok
    if (complete.ok) {
      const ingestorOk = await probeUrl(`${getHostPodBaseUrl()}/health`, HOST_POD_PROBE_TIMEOUT_MS)
      if (!ingestorOk) {
        console.warn(
          '[EDGE_PROBE] Host pod containers ready; ingestor host /health unreachable (optional)',
        )
      }
    }
    return complete.ok
  } catch {
    _hostPodReady = false
    return false
  }
}

export function invalidateHostPodReadyCache(): void {
  _hostPodReady = false
}

export function invalidateEdgeProbeCache(): void {
  _edgeCache = null
}

export async function runAllProbes(force = false): Promise<ProbeSnapshot> {
  const [edgeReachable, generalConnectivity, hostPodReady] = await Promise.all([
    probeAnyEdgeReplica(force),
    probeGeneralConnectivity(force),
    probeHostPodReady(force),
  ])
  return {
    edgeReachable,
    generalConnectivity,
    hostPodReady,
    lastEdgeProbeAt: _lastEdgeProbeAt,
    lastEdgeSuccessAt: _lastEdgeSuccessAt,
    lastConnectivityProbeAt: _lastConnectivityProbeAt,
  }
}

export function getProbeSnapshot(): ProbeSnapshot {
  return {
    edgeReachable: _edgeCache?.reachable ?? 'unknown',
    generalConnectivity: _connectivityCache?.ok ?? true,
    hostPodReady: _hostPodReady,
    lastEdgeProbeAt: _lastEdgeProbeAt,
    lastEdgeSuccessAt: _lastEdgeSuccessAt,
    lastConnectivityProbeAt: _lastConnectivityProbeAt,
  }
}

/** Tests only. */
export function _resetProbesForTest(): void {
  _edgeCache = null
  _connectivityCache = null
  _hostPodReady = false
  _lastEdgeSuccessAt = null
  _lastEdgeProbeAt = null
  _lastConnectivityProbeAt = null
}
