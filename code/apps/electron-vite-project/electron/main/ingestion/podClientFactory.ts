/**
 * Pod client factory — edge-tier routing for ingestion paths.
 */

import { createPodClient, type PodClient, type EdgeReplica } from '@repo/pod-client'

import {
  loadEdgeTierSettings,
  isEdgeTierActiveForRouting,
  type EdgeReplica as SettingsReplica,
} from '../edge-tier/settings.js'
import { INGESTION_CONSTANTS } from './types.js'

export type IngestPodClientRoute = 'default' | 'native_beap'

function getPodBaseUrl(): string {
  return process.env['WR_POD_BASE_URL'] ?? 'http://127.0.0.1:18100'
}

function mapEdgeReplicasFromSettings(replicas: SettingsReplica[]): EdgeReplica[] {
  return replicas.map((r) => ({
    host: r.host,
    port: r.port,
    edge_pod_id: r.edge_pod_id,
    public_key: r.edge_public_key,
    attestation_jwt: r.sso_attestation_jwt,
  }))
}

/**
 * Build a pod client for ingestion.
 *
 * - `default`: email, handshake capsules, and other routes use edge when enabled.
 * - `native_beap`: respects `native_beap_routing` — direct P2P skips edge relay.
 */
export function buildIngestPodClient(route: IngestPodClientRoute = 'default'): PodClient {
  const client = createPodClient({
    baseUrl: getPodBaseUrl(),
    requestTimeoutMs: INGESTION_CONSTANTS.PIPELINE_TIMEOUT_MS + 2_000,
  })

  const settings = loadEdgeTierSettings()
  if (!isEdgeTierActiveForRouting(settings) || settings.replicas.length === 0) {
    return client
  }

  if (route === 'native_beap' && settings.native_beap_routing === 'direct') {
    return client
  }

  client.configureEdgeTier(mapEdgeReplicasFromSettings(settings.replicas), settings.fallback_policy)
  return client
}
