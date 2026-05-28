/**
 * Persist orchestrator ledger row for edge_ingestor pairing (PR4.5 / PR8).
 */

import { randomUUID } from 'node:crypto'

import { isAllowedRolePairForHandshakeType } from '../../../../../packages/shared/src/handshake/internalEndpointValidation.js'
import { EDGE_INGESTOR_HANDSHAKE_TYPE } from './edgeIngestorHandshakeContract.js'
import { insertHandshakeRecord } from '../handshake/db.js'
import { generateSigningKeypair } from '../handshake/signatureKeys.js'
import { HandshakeState, buildDefaultReceiverPolicy } from '../handshake/types.js'
import type { HandshakeRecord, PartyIdentity } from '../handshake/types.js'
import { resolveEffectivePolicyFn } from '../handshake/steps/policyResolution.js'

export interface PersistEdgeIngestorInput {
  readonly orchestratorSub: string
  readonly orchestratorEmail: string
  readonly orchestratorWrdeskUserId: string
  readonly orchestratorIss: string
  readonly orchestratorPublicKey: string
  readonly agentPublicKey: string
  readonly fingerprint: string
  readonly p2pEndpoint: string
  readonly orchestratorP2pAuthToken: string
  readonly agentP2pAuthToken: string
  readonly agentEncryptionPublicKeyB64: string
  readonly handshakeId?: string
}

export function buildEdgeIngestorHandshakeRecord(input: PersistEdgeIngestorInput): HandshakeRecord {
  if (
    !isAllowedRolePairForHandshakeType(EDGE_INGESTOR_HANDSHAKE_TYPE, 'host', 'edge_agent')
  ) {
    throw new Error('edge_ingestor role-pair binding rejected')
  }

  const signing = generateSigningKeypair()
  const receiverPolicy = buildDefaultReceiverPolicy()
  const effectivePolicyResult = resolveEffectivePolicyFn(null, receiverPolicy)
  if ('unsatisfiable' in effectivePolicyResult) {
    throw new Error('Policy resolution failed for edge ingestor handshake')
  }

  const party: PartyIdentity = {
    email: input.orchestratorEmail,
    wrdesk_user_id: input.orchestratorWrdeskUserId,
    iss: input.orchestratorIss,
    sub: input.orchestratorSub,
  }

  const now = new Date().toISOString()
  const handshakeId = input.handshakeId?.trim() || randomUUID()

  return {
    handshake_id: handshakeId,
    relationship_id: randomUUID(),
    state: HandshakeState.ACTIVE,
    initiator: party,
    acceptor: { ...party },
    local_role: 'initiator',
    sharing_mode: null,
    reciprocal_allowed: false,
    tier_snapshot: { plan: 'free' },
    current_tier_signals: {},
    last_seq_sent: 0,
    last_seq_received: 0,
    last_capsule_hash_sent: '',
    last_capsule_hash_received: '',
    effective_policy: effectivePolicyResult,
    external_processing: 'none',
    created_at: now,
    activated_at: now,
    expires_at: null,
    revoked_at: null,
    revocation_source: null,
    initiator_wrdesk_policy_hash: '',
    initiator_wrdesk_policy_version: '1.0',
    acceptor_wrdesk_policy_hash: null,
    acceptor_wrdesk_policy_version: null,
    initiator_context_commitment: null,
    acceptor_context_commitment: null,
    p2p_endpoint: input.p2pEndpoint.trim(),
    local_p2p_auth_token: input.orchestratorP2pAuthToken.trim(),
    counterparty_p2p_token: input.agentP2pAuthToken.trim(),
    local_public_key: signing.publicKey,
    local_private_key: signing.privateKey,
    counterparty_public_key: input.agentPublicKey.trim().replace(/^ed25519:/i, '').toLowerCase(),
    peer_x25519_public_key_b64: input.agentEncryptionPublicKeyB64.trim(),
    handshake_type: EDGE_INGESTOR_HANDSHAKE_TYPE,
    initiator_device_role: 'host',
    acceptor_device_role: 'edge_agent',
  }
}

export function persistEdgeIngestorHandshake(db: unknown, input: PersistEdgeIngestorInput): string {
  const record = buildEdgeIngestorHandshakeRecord(input)
  insertHandshakeRecord(db, record)
  return record.handshake_id
}
