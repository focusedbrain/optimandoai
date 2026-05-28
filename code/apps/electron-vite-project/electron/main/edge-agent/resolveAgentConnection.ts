/**
 * Resolve Agent P2P connection fields from the authoritative edge_ingestor handshake row (PR8).
 */

import { getHandshakeRecord } from '../handshake/db.js'
import type { EdgeReplica } from '../edge-tier/settings.js'
import { isAgentEdgeReplica } from '../edge-tier/settings.js'

export interface AgentConnectionContext {
  readonly handshakeId: string
  readonly p2pEndpoint: string
  readonly orchestratorBearerToken: string
  readonly agentEncryptionPublicKeyB64: string
}

export function resolveAgentConnection(
  replica: EdgeReplica,
  db: unknown,
): AgentConnectionContext {
  if (!isAgentEdgeReplica(replica)) {
    throw new Error('Replica is not an Agent deployment')
  }
  const handshakeId = replica.handshake_id?.trim()
  if (!handshakeId) {
    throw new Error('Agent replica is missing handshake_id')
  }
  const record = getHandshakeRecord(db as Parameters<typeof getHandshakeRecord>[0], handshakeId)
  if (!record) {
    throw new Error(`Handshake record not found: ${handshakeId}`)
  }
  if (record.handshake_type !== 'edge_ingestor') {
    throw new Error('Handshake is not edge_ingestor')
  }
  const p2pEndpoint = record.p2p_endpoint?.trim()
  const token = record.local_p2p_auth_token?.trim()
  const encPub = record.peer_x25519_public_key_b64?.trim()
  if (!p2pEndpoint) throw new Error('edge_ingestor handshake is missing p2p_endpoint')
  if (!token) throw new Error('edge_ingestor handshake is missing orchestrator P2P bearer token')
  if (!encPub) throw new Error('edge_ingestor handshake is missing agent encryption public key')
  return {
    handshakeId,
    p2pEndpoint,
    orchestratorBearerToken: token,
    agentEncryptionPublicKeyB64: encPub,
  }
}
