/**
 * Edge ingestor handshake record shape produced by PR4 pairing (PR4.5).
 * Agent persists this in encrypted state; orchestrator creates the ledger row in PR8.
 */

import { randomUUID } from 'node:crypto'

/** Must match @shared/core handshakeType.ts and orchestrator ledger. */
export const EDGE_INGESTOR_HANDSHAKE_TYPE = 'edge_ingestor' as const

export type EdgeIngestorHandshakeType = typeof EDGE_INGESTOR_HANDSHAKE_TYPE

export interface EdgeIngestorHandshakeRecord {
  handshake_id: string
  handshake_type: typeof EDGE_INGESTOR_HANDSHAKE_TYPE
  orchestrator_sub: string
  orchestrator_public_key: string
  agent_public_key: string
  orchestrator_nonce: string
  agent_nonce: string
  fingerprint: string
  confirmed_at: string
  initiator_device_role: 'host'
  acceptor_device_role: 'edge_agent'
}

export function buildEdgeIngestorHandshakeFromPairing(input: {
  orchestratorSub: string
  orchestratorPublicKey: string
  agentPublicKey: string
  orchestratorNonce: string
  agentNonce: string
  fingerprint: string
  confirmedAt?: string
}): EdgeIngestorHandshakeRecord {
  return {
    handshake_id: randomUUID(),
    handshake_type: EDGE_INGESTOR_HANDSHAKE_TYPE,
    orchestrator_sub: input.orchestratorSub,
    orchestrator_public_key: input.orchestratorPublicKey,
    agent_public_key: input.agentPublicKey,
    orchestrator_nonce: input.orchestratorNonce,
    agent_nonce: input.agentNonce,
    fingerprint: input.fingerprint,
    confirmed_at: input.confirmedAt ?? new Date().toISOString(),
    initiator_device_role: 'host',
    acceptor_device_role: 'edge_agent',
  }
}
