/**
 * Production wiring for sandbox A2 email ingestion (Prompt 1).
 *
 * Connects `runSandboxIngestionPoll` to real fetch (provider router), custody key
 * (sandbox local X25519 public key), and host delivery (`postSandboxEmailDelivery`
 * over the same direct BEAP ingest path Host AI uses).
 *
 * INV-2: read token and P2P bearer never appear in job specs or wire payloads.
 * INV-5: metadata-only logs (handshake ids, counts, deny codes).
 */

import { postSandboxEmailDelivery, type SandboxDeliveryTransport } from '../critical-jobs/remote/sandboxEmailDelivery'
import { listHandshakeRecords } from '../handshake/db'
import { HandshakeState, type HandshakeRecord } from '../handshake/types'
import {
  assertRecordForServiceRpc,
  deriveInternalHostAiPeerRoles,
  outboundP2pBearerToCounterpartyIngest,
} from '../internalInference/policy'
import { resolveSandboxToHostHttpDirectIngest } from '../internalInference/p2pEndpointRepair'
import { getInstanceId } from '../orchestrator/orchestratorModeStore'
import { fetchOpaqueForProviderAccount } from './sandboxOpaqueFetchRouter'
import type { SandboxIngestionDeps } from './sandboxIngestion'

export interface SandboxHostDeliveryContext {
  handshakeId: string
  hostEndpoint: string
  hostP2pToken: string
}

function isValidX25519PubB64(v: string): boolean {
  try {
    return Buffer.from(v, 'base64').length === 32
  } catch {
    return false
  }
}

/**
 * Active internal handshake where this device is Sandbox and peer is Host.
 * Uses ledger-derived roles (same source as Host AI / BEAP-ad resolution).
 */
export function findActiveSandboxToHostHandshakeRecord(db: unknown): HandshakeRecord | null {
  if (!db) return null
  const localId = getInstanceId().trim()
  const rows = listHandshakeRecords(db as never, {
    state: HandshakeState.ACTIVE,
    handshake_type: 'internal',
  })
  for (const r of rows) {
    const dr = deriveInternalHostAiPeerRoles(r, localId)
    if (!dr.ok || dr.localRole !== 'sandbox' || dr.peerRole !== 'host') continue
    if (!r.internal_coordination_identity_complete) continue
    const gate = assertRecordForServiceRpc(r)
    if (!gate.ok) continue
    return gate.record
  }
  return null
}

/** Sandbox's own custody public key (sealing target for depackage artifacts). */
export function resolveSandboxCustodyPubKeyB64(db: unknown): string | null {
  const record = findActiveSandboxToHostHandshakeRecord(db)
  const pub = record?.local_x25519_public_key_b64?.trim()
  if (!pub || !isValidX25519PubB64(pub)) return null
  return pub
}

/**
 * Host delivery target: direct `/beap/ingest` URL + outbound Bearer
 * (`local_p2p_auth_token` — same as Host AI / inference transport).
 */
export function resolveSandboxHostDeliveryContext(db: unknown): SandboxHostDeliveryContext | null {
  const record = findActiveSandboxToHostHandshakeRecord(db)
  if (!record) {
    console.warn('[SandboxIngestion] host delivery context missing — no active sandbox→host handshake')
    return null
  }
  const hid = String(record.handshake_id ?? '').trim()
  const ingest = resolveSandboxToHostHttpDirectIngest(db, hid, record, '')
  if (!ingest.ok) {
    console.warn(
      `[SandboxIngestion] host delivery endpoint unresolved. handshake=${hid} code=${ingest.code} category=${ingest.resolutionCategory}`,
    )
    return null
  }
  const hostP2pToken = outboundP2pBearerToCounterpartyIngest(record)
  if (!hostP2pToken) {
    console.warn(`[SandboxIngestion] host delivery auth missing (local_p2p_auth_token). handshake=${hid}`)
    return null
  }
  return { handshakeId: hid, hostEndpoint: ingest.url, hostP2pToken }
}

/**
 * Production deps for `runSandboxIngestionPoll` — used by auto-sync on sandbox owner nodes.
 */
export function buildProductionSandboxIngestionDeps(
  db: unknown,
  opts?: { deliveryTransport?: SandboxDeliveryTransport },
): SandboxIngestionDeps {
  const custodyPubKeyB64 = resolveSandboxCustodyPubKeyB64(db) ?? undefined
  const deliveryCtx = resolveSandboxHostDeliveryContext(db)

  return {
    custodyPubKeyB64,
    fetchOpaque: (id, tokenRecord) => fetchOpaqueForProviderAccount(id, tokenRecord),
    deliverToHost: async (readAccountId, msg, outcome) => {
      if (!deliveryCtx) return { delivered: false }
      if (!outcome.ok) return { delivered: false }
      return postSandboxEmailDelivery(msg, outcome, {
        accountId: readAccountId,
        handshakeId: deliveryCtx.handshakeId,
        hostEndpoint: deliveryCtx.hostEndpoint,
        hostP2pToken: deliveryCtx.hostP2pToken,
        transport: opts?.deliveryTransport,
      })
    },
  }
}
