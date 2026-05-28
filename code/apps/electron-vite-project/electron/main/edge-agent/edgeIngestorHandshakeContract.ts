/**
 * PR8 contract: orchestrator creates ledger handshake rows from Agent pairing (PR4.5).
 *
 * When the orchestrator pairing wizard completes, persist a HandshakeRecord with:
 *   handshake_type: 'edge_ingestor'
 *   initiator_device_role: 'host' (local orchestrator)
 *   acceptor_device_role: 'edge_agent' (verification server)
 *   Same SSO sub on both sides; pairing keys + fingerprint from Agent pair record.
 *
 * Do not use handshake_type 'internal' for edge Agents — sandbox inference relay must not apply.
 */

export const EDGE_INGESTOR_HANDSHAKE_TYPE = 'edge_ingestor' as const

export interface AgentPairRecordWire {
  handshakeId: string
  handshakeType: 'edge_ingestor'
  orchestratorSub: string
  orchestratorPublicKey: string
  agentPublicKey: string
  fingerprint: string
  confirmedAt: string
  /** PR6 — credential relay envelope */
  agentEncryptionPublicKeyB64?: string
  p2pEndpoint?: string
  agentP2pAuthToken?: string
  orchestratorP2pAuthToken?: string
}
