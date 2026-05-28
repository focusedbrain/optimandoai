/**
 * Finish wizard pairing: handshake row + edge replica + pending tier state.
 */

import { URL } from 'node:url'

import { ensureSession, getCachedUserInfo } from '../../../src/auth/session.js'
import { requestSsoAttestation } from '../edge-tier/attestation.js'
import {
  setEdgeTierPending,
  upsertEdgeReplica,
  type EdgeReplica,
} from '../edge-tier/settings.js'
import type { EdgeTierPodVault } from '../edge-tier/podLifecycle.js'
import { getHandshakeDbForInternalInference } from '../internalInference/dbAccess.js'

import type { PairInitiateResult } from './orchestratorPairing.js'
import { agentApiRequest } from './agentApiClient.js'
import { persistEdgeIngestorHandshake } from './persistEdgeIngestorHandshake.js'
import { migrateAgentReplicaStopgapsToHandshake } from './agentReplicaStopgapMigration.js'

const EDGE_INGEST_PORT = 18_100

export interface CompleteAgentPairingInput extends PairInitiateResult {
  readonly pairingAddress: string
  readonly orchestratorSub: string
}

function ingestHostFromPairingAddress(address: string): string {
  const url = new URL(address.includes('://') ? address : `https://${address}`)
  return url.hostname
}

function normalizeEdgePublicKey(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.startsWith('ed25519:')) return trimmed
  return `ed25519:${trimmed.replace(/^ed25519:/i, '')}`
}

function publicKeyHexFromClaim(claim: string): string {
  return claim.replace(/^ed25519:/i, '').trim()
}

async function fetchAgentEdgeIdentity(
  replica: EdgeReplica,
  db: unknown,
): Promise<{ edgePodId: string; edgePublicKey: string }> {
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    try {
      const res = await agentApiRequest(replica, 'GET', '/agent/edge/status', undefined, db)
      if (res.status === 200) {
        const podId = typeof res.json.edge_pod_id === 'string' ? res.json.edge_pod_id : ''
        const pubHex =
          typeof res.json.edge_public_key_hex === 'string'
            ? res.json.edge_public_key_hex
            : typeof res.json.edge_public_key === 'string'
              ? res.json.edge_public_key
              : ''
        if (podId && pubHex) {
          return { edgePodId: podId, edgePublicKey: normalizeEdgePublicKey(pubHex) }
        }
      }
    } catch {
      /* pod may still be starting */
    }
    await new Promise((r) => setTimeout(r, 2_000))
  }
  throw new Error(
    'Verification server pod is not ready yet. Confirm pairing on the server, wait for the pod to start, then retry.',
  )
}

export async function completeAgentPairing(
  _vault: EdgeTierPodVault,
  input: CompleteAgentPairingInput,
): Promise<{ handshakeId: string; replica: EdgeReplica }> {
  const db = await getHandshakeDbForInternalInference()
  if (!db) throw new Error('Handshake database is not available — sign in and try again.')
  migrateAgentReplicaStopgapsToHandshake(db)

  await ensureSession(false)
  const info = getCachedUserInfo()
  if (!info?.sub) throw new Error('No active SSO session')

  const handshakeId = persistEdgeIngestorHandshake(db, {
    orchestratorSub: input.orchestratorSub,
    orchestratorEmail: info.email ?? info.sub,
    orchestratorWrdeskUserId: info.wrdesk_user_id ?? info.sub,
    orchestratorIss: info.iss ?? '',
    orchestratorPublicKey: input.orchestratorPublicKey,
    agentPublicKey: input.agentPublicKey,
    fingerprint: input.fingerprint,
    p2pEndpoint: input.p2pEndpoint,
    orchestratorP2pAuthToken: input.orchestratorP2pAuthToken,
    agentP2pAuthToken: input.agentP2pAuthToken,
    agentEncryptionPublicKeyB64: input.agentEncryptionPublicKeyB64,
  })

  const host = ingestHostFromPairingAddress(input.pairingAddress)
  const placeholder: EdgeReplica = {
    host,
    port: EDGE_INGEST_PORT,
    edge_pod_id: handshakeId,
    edge_public_key: `ed25519:${'0'.repeat(64)}`,
    sso_attestation_jwt: 'pending',
    deployment_type: 'agent',
    handshake_id: handshakeId,
  }

  const identity = await fetchAgentEdgeIdentity(placeholder, db)
  const session = await ensureSession(false)
  const { jwt } = await requestSsoAttestation(
    publicKeyHexFromClaim(identity.edgePublicKey),
    identity.edgePodId,
    session.accessToken,
  )

  const replica: EdgeReplica = {
    host,
    port: EDGE_INGEST_PORT,
    edge_pod_id: identity.edgePodId,
    edge_public_key: identity.edgePublicKey,
    sso_attestation_jwt: jwt,
    deployment_type: 'agent',
    handshake_id: handshakeId,
  }

  setEdgeTierPending()
  upsertEdgeReplica(replica)
  return { handshakeId, replica }
}
