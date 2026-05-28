/**
 * Backfill edge_ingestor handshake rows from legacy replica stopgap fields (PR6/PR7 dev data).
 */

import { readFileSync, existsSync } from 'node:fs'

import {
  getEdgeTierSettingsPath,
  loadEdgeTierSettings,
  saveEdgeTierSettings,
  type EdgeReplica,
  type EdgeTierSettings,
} from '../edge-tier/settings.js'
import { getCachedUserInfo } from '../../../src/auth/session.js'
import { persistEdgeIngestorHandshake } from './persistEdgeIngestorHandshake.js'

interface LegacyAgentReplicaFields {
  handshake_id?: string
  agent_encryption_public_key_b64?: string
  p2p_endpoint?: string
  agent_p2p_auth_token?: string
  orchestrator_p2p_auth_token?: string
}

function readLegacyReplicaFields(replica: EdgeReplica): LegacyAgentReplicaFields | null {
  if (replica.deployment_type !== 'agent') return null
  try {
    const path = getEdgeTierSettingsPath()
    if (!existsSync(path)) return null
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { replicas?: unknown[] }
    if (!Array.isArray(raw.replicas)) return null
    const match = raw.replicas.find((r) => {
      if (typeof r !== 'object' || r === null) return false
      const o = r as Record<string, unknown>
      return o.edge_pod_id === replica.edge_pod_id
    }) as Record<string, unknown> | undefined
    if (!match) return null
    return {
      handshake_id: typeof match.handshake_id === 'string' ? match.handshake_id : undefined,
      agent_encryption_public_key_b64:
        typeof match.agent_encryption_public_key_b64 === 'string'
          ? match.agent_encryption_public_key_b64
          : undefined,
      p2p_endpoint: typeof match.p2p_endpoint === 'string' ? match.p2p_endpoint : undefined,
      agent_p2p_auth_token:
        typeof match.agent_p2p_auth_token === 'string' ? match.agent_p2p_auth_token : undefined,
      orchestrator_p2p_auth_token:
        typeof match.orchestrator_p2p_auth_token === 'string'
          ? match.orchestrator_p2p_auth_token
          : undefined,
    }
  } catch {
    return null
  }
}

function replicaNeedsMigration(replica: EdgeReplica): boolean {
  if (replica.deployment_type !== 'agent' || replica.handshake_id?.trim()) return false
  const legacy = readLegacyReplicaFields(replica)
  if (!legacy) return false
  return (
    !!legacy.agent_encryption_public_key_b64?.trim() &&
    !!legacy.p2p_endpoint?.trim() &&
    !!(legacy.orchestrator_p2p_auth_token?.trim() || legacy.agent_p2p_auth_token?.trim())
  )
}

export function migrateAgentReplicaStopgapsToHandshake(db: unknown): boolean {
  const settings = loadEdgeTierSettings()
  if (!settings.replicas.some(replicaNeedsMigration)) return false

  const info = getCachedUserInfo()
  if (!info?.sub) return false

  const nextReplicas = settings.replicas.map((replica) => {
    if (!replicaNeedsMigration(replica)) return replica
    const legacy = readLegacyReplicaFields(replica)!
    const orchToken =
      legacy.orchestrator_p2p_auth_token?.trim() ?? legacy.agent_p2p_auth_token!.trim()

    const handshakeId = persistEdgeIngestorHandshake(db, {
      orchestratorSub: info.sub,
      orchestratorEmail: info.email ?? info.sub,
      orchestratorWrdeskUserId: info.wrdesk_user_id ?? info.sub,
      orchestratorIss: info.iss ?? 'migration',
      orchestratorPublicKey: '0'.repeat(64),
      agentPublicKey: '1'.repeat(64),
      fingerprint: '0000-0000-0000-0000',
      p2pEndpoint: legacy.p2p_endpoint!.trim(),
      orchestratorP2pAuthToken: orchToken,
      agentP2pAuthToken: legacy.agent_p2p_auth_token!.trim(),
      agentEncryptionPublicKeyB64: legacy.agent_encryption_public_key_b64!.trim(),
      handshakeId: legacy.handshake_id,
    })

    const migrated: EdgeReplica = {
      host: replica.host,
      port: replica.port,
      edge_pod_id: replica.edge_pod_id,
      edge_public_key: replica.edge_public_key,
      sso_attestation_jwt: replica.sso_attestation_jwt,
      deployment_type: 'agent',
      handshake_id: handshakeId,
    }
    return migrated
  })

  const next: EdgeTierSettings = { ...settings, replicas: nextReplicas }
  saveEdgeTierSettings(next)
  return true
}
