/**
 * Dedicated delegated host → sandbox ingestion poll trigger (PROMPT 2).
 */

import { randomUUID } from 'crypto'
import { listHandshakeRecords } from '../../handshake/db'
import { HandshakeState, type HandshakeRecord } from '../../handshake/types'
import {
  assertHostSendsResultToSandbox,
  assertRecordForServiceRpc,
  deriveInternalHostAiPeerRoles,
  outboundP2pBearerToCounterpartyIngest,
} from '../../internalInference/policy'
import { getInstanceId, getOrchestratorMode } from '../../orchestrator/orchestratorModeStore'
import {
  hostnameFromP2pUrl,
  isLoopbackP2pHost,
  resolveSandboxTopologyKind,
  type SandboxPairingKind,
  type SandboxTopologyKind,
} from '../../handshake/sandboxTopologyKind'
import {
  resolveIngestionOwnershipWithLedger,
  type IngestionOwnership,
} from '../ingestionOwnership'
import {
  INGESTION_POLL_SCHEMA_VERSION,
  type IngestionPollResultWire,
} from './wire'
import { httpIngestionPollTransport, type IngestionPollTransport } from './send'
import {
  recordHostIngestionPollAck,
  recordHostIngestionPollUnreachable,
} from './hostAckStore'
import { resolveSandboxPeerDirectBeapIngestEndpoint } from '../../handshake/resolvePeerDirectBeapIngestEndpoint'

const DEFAULT_POLL_TIMEOUT_MS = (() => {
  const raw = Number(process.env.WRDESK_INGESTION_POLL_TRIGGER_TIMEOUT_MS)
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 120_000
})()

export interface IngestionPollTriggerCounts {
  requestId: string
  pollStatus: string
  fetched: number
  depackaged: number
  delivered: number
  held: number
}

export type SendDedicatedSandboxIngestionPollTriggerResult =
  | { ok: true; trigger: IngestionPollTriggerCounts }
  | { ok: false; code: string; message: string }

export type IngestionTriggerDecision = 'trigger' | 'delegate'

export interface IngestionTriggerDecisionContext {
  topologyKind: SandboxTopologyKind
  twoDevicePair: boolean
  hostDeviceId: string
  peerSandboxDeviceId: string
  p2pEndpointHost: string | null
  topologyPairingKind: SandboxPairingKind | null
  linkedPairingKind: SandboxPairingKind | null
  decision: IngestionTriggerDecision
}

function peerCoordinationId(record: HandshakeRecord, thisId: string): string {
  const ini = (record.initiator_coordination_device_id ?? '').trim()
  const acc = (record.acceptor_coordination_device_id ?? '').trim()
  if (ini && ini !== thisId) return ini
  if (acc && acc !== thisId) return acc
  return acc || ini || ''
}

function linkedPairingKindForHandshake(handshakeId: string): SandboxPairingKind | null {
  try {
    const linked = getOrchestratorMode().linked ?? []
    const entry = linked.find((e) => e.handshakeId === handshakeId)
    if (entry?.pairingKind === 'local_inner_vm' || entry?.pairingKind === 'remote_dedicated') {
      return entry.pairingKind
    }
  } catch {
    /* missing/parse-failed config */
  }
  return null
}

function endpointHostPort(url: string): string {
  const ep = url.trim()
  if (!ep) return '(none)'
  try {
    const u = new URL(ep)
    return u.port ? `${u.hostname}:${u.port}` : u.hostname
  } catch {
    return '(invalid)'
  }
}

/**
 * True when the ACTIVE host→sandbox handshake proves separate hardware orchestrators:
 * both coordination device ids are present, distinct, and the sandbox peer id differs
 * from this host's id.
 *
 * In-host VM pairs are excluded when the peer endpoint is strict loopback AND the pair
 * carries a deliberate `local_inner_vm` marker (installer / provisioning). That pattern
 * is co-located self-poll — not a misclassified two-device LAN pair where the endpoint
 * was transiently stored as a host-local LAN address during pairing.
 */
export function isGenuineTwoDeviceHostSandboxPairForTrigger(
  record: HandshakeRecord | null,
  localDeviceId: string,
): boolean {
  if (!record?.internal_coordination_identity_complete) return false

  const localId = localDeviceId.trim()
  if (!localId) return false

  const dr = deriveInternalHostAiPeerRoles(record, localId)
  if (!dr.ok || dr.localRole !== 'host' || dr.peerRole !== 'sandbox') return false

  const ini = (record.initiator_coordination_device_id ?? '').trim()
  const acc = (record.acceptor_coordination_device_id ?? '').trim()
  if (!ini || !acc || ini === acc) return false

  const peerId = peerCoordinationId(record, localId)
  if (!peerId || peerId === localId) return false

  const peerHost = hostnameFromP2pUrl(record.p2p_endpoint)
  if (peerHost && isLoopbackP2pHost(peerHost)) {
    const linkedKind = linkedPairingKindForHandshake(record.handshake_id)
    const explicitKind = linkedKind ?? record.topology_pairing_kind ?? null
    if (explicitKind === 'local_inner_vm') return false
  }

  return true
}

/** ACTIVE internal row where this device is Host and peer is Sandbox. */
export function findActiveHostToSandboxHandshakeRecord(db: unknown): HandshakeRecord | null {
  if (!db) return null
  const localId = getInstanceId().trim()
  const rows = listHandshakeRecords(db as never, {
    state: HandshakeState.ACTIVE,
    handshake_type: 'internal',
  })
  for (const r of rows) {
    const dr = deriveInternalHostAiPeerRoles(r, localId)
    if (!dr.ok || dr.localRole !== 'host' || dr.peerRole !== 'sandbox') continue
    if (!r.internal_coordination_identity_complete) continue
    const gate = assertRecordForServiceRpc(r)
    if (!gate.ok) continue
    return gate.record
  }
  return null
}

export function evaluateHostIngestionPollTriggerDecision(
  db: unknown,
  ownership: IngestionOwnership,
): IngestionTriggerDecisionContext {
  const hostDeviceId = getInstanceId().trim()
  const record = findActiveHostToSandboxHandshakeRecord(db)
  const peerSandboxDeviceId = record ? peerCoordinationId(record, hostDeviceId) : ''
  const topologyKind = resolveSandboxTopologyKind(db)
  const topologyPairingKind = record?.topology_pairing_kind ?? null
  const linkedPairingKind = record ? linkedPairingKindForHandshake(record.handshake_id) : null
  const twoDevicePair = isGenuineTwoDeviceHostSandboxPairForTrigger(record, hostDeviceId)
  const p2pEndpointHost = hostnameFromP2pUrl(record?.p2p_endpoint ?? null)

  const shouldTrigger =
    topologyKind === 'dedicated' || (topologyKind === 'single_machine' && twoDevicePair)

  return {
    topologyKind,
    twoDevicePair,
    hostDeviceId,
    peerSandboxDeviceId,
    p2pEndpointHost,
    topologyPairingKind,
    linkedPairingKind,
    decision: shouldTrigger ? 'trigger' : 'delegate',
  }
}

function logIngestionTriggerDecision(ctx: IngestionTriggerDecisionContext): void {
  console.log(
    `[IngestionTriggerDecision] topology=${ctx.topologyKind} two_device_pair=${ctx.twoDevicePair} ` +
      `host_device_id=${ctx.hostDeviceId || '(none)'} peer_sandbox_device_id=${ctx.peerSandboxDeviceId || '(none)'} ` +
      `p2p_endpoint_host=${ctx.p2pEndpointHost ?? '(none)'} ` +
      `topology_pairing_kind=${ctx.topologyPairingKind ?? '(null)'} ` +
      `linked_pairing_kind=${ctx.linkedPairingKind ?? '(null)'} decision=${ctx.decision}`,
  )
}

/**
 * Dedicated delegated host only: host must not read-poll locally and topology
 * must be separate-machine dedicated (not single_machine inner-VM), with a
 * decision-time override when distinct host/sandbox device ids prove two-device.
 */
export async function shouldHostTriggerDedicatedSandboxPoll(
  db?: unknown,
  ownership?: IngestionOwnership,
): Promise<boolean> {
  const o = ownership ?? (await resolveIngestionOwnershipWithLedger())
  if (o.thisNodeRole !== 'host' || o.hostShouldReadPoll) return false

  const ctx = evaluateHostIngestionPollTriggerDecision(db, o)
  logIngestionTriggerDecision(ctx)
  return ctx.decision === 'trigger'
}

export async function sendDedicatedSandboxIngestionPollTrigger(
  db: unknown,
  opts: {
    accountId: string
    pullMore?: boolean
    transport?: IngestionPollTransport
    timeoutMs?: number
  },
): Promise<SendDedicatedSandboxIngestionPollTriggerResult> {
  const accountId = typeof opts.accountId === 'string' ? opts.accountId.trim() : ''
  if (!accountId) {
    return { ok: false, code: 'E_INGESTION_POLL_INVALID', message: 'accountId required' }
  }

  if (!(await shouldHostTriggerDedicatedSandboxPoll(db))) {
    return { ok: false, code: 'E_INGESTION_POLL_NOT_APPLICABLE', message: 'not a dedicated delegated host' }
  }

  const record = findActiveHostToSandboxHandshakeRecord(db)
  if (!record) {
    return { ok: false, code: 'E_INGESTION_POLL_NO_HANDSHAKE', message: 'no active host→sandbox handshake' }
  }

  const sendGate = assertHostSendsResultToSandbox(record)
  if (!sendGate.ok) {
    return { ok: false, code: sendGate.code, message: 'host role gate failed' }
  }

  const ledgerEndpoint = typeof record.p2p_endpoint === 'string' ? record.p2p_endpoint.trim() : ''
  const endpoint = resolveSandboxPeerDirectBeapIngestEndpoint(db, record.handshake_id, ledgerEndpoint)
  if (!endpoint) {
    const detail =
      ledgerEndpoint && ledgerEndpoint.includes('/beap/ingest')
        ? 'sandbox direct ingest endpoint could not be resolved from handshake — re-pair or refresh the internal handshake'
        : 'sandbox endpoint missing on handshake'
    return { ok: false, code: 'E_INGESTION_POLL_PEER_ENDPOINT', message: detail }
  }

  const bearer = outboundP2pBearerToCounterpartyIngest(record)
  if (!bearer) {
    return { ok: false, code: 'E_INGESTION_POLL_AUTH', message: 'counterparty ingest bearer missing' }
  }

  const thisId = getInstanceId().trim()
  const requestId = randomUUID()
  const nowMs = Date.now()
  const timeoutMs = opts.timeoutMs ?? DEFAULT_POLL_TIMEOUT_MS
  const targetHostPort = endpointHostPort(endpoint)
  const ledgerHostPort = ledgerEndpoint ? endpointHostPort(ledgerEndpoint) : '(none)'
  if (ledgerHostPort !== targetHostPort) {
    console.log(
      `[IngestionPollTrigger] peer ingest endpoint resolved. handshake=${record.handshake_id} ` +
        `ledger=${ledgerHostPort} resolved=${targetHostPort}`,
    )
  }
  const wire = {
    type: 'ingestion_poll_request' as const,
    schema_version: INGESTION_POLL_SCHEMA_VERSION,
    request_id: requestId,
    handshake_id: record.handshake_id,
    sender_device_id: thisId,
    target_device_id: peerCoordinationId(record, thisId),
    created_at: new Date(nowMs).toISOString(),
    account_id: accountId,
    ...(opts.pullMore ? { pull_more: true } : {}),
    expires_at: new Date(nowMs + timeoutMs).toISOString(),
  }

  console.log(
    `[IngestionPollTrigger] host sending trigger. request_id=${requestId} account=${accountId} ` +
      `handshake=${record.handshake_id} target=${targetHostPort}`,
  )

  const transport = opts.transport ?? httpIngestionPollTransport
  const sent = await transport({ endpoint, bearer, wire, timeoutMs })
  if (!sent.ok) {
    const outcome =
      sent.code === 'E_INGESTION_POLL_PROTOCOL' || sent.code === 'E_INGESTION_POLL_AUTH'
        ? 'rejected'
        : 'unreachable'
    console.warn(
      `[IngestionPollTrigger] host trigger ${outcome}. request_id=${requestId} target=${targetHostPort} ` +
        `code=${sent.code} message=${sent.message}`,
    )
    if (sent.code === 'E_INGESTION_POLL_LINK_DOWN' || sent.code === 'E_INGESTION_POLL_PEER_ENDPOINT') {
      recordHostIngestionPollUnreachable(accountId, requestId)
    }
    return { ok: false, code: sent.code, message: sent.message }
  }

  if (sent.body.request_id !== requestId) {
    return { ok: false, code: 'E_INGESTION_POLL_PROTOCOL', message: 'response request_id mismatch' }
  }

  if (sent.body.type === 'ingestion_poll_error') {
    console.warn(
      `[IngestionPollTrigger] host trigger error ack. request_id=${requestId} target=${targetHostPort} ` +
        `code=${sent.body.code} message=${sent.body.message}`,
    )
    return { ok: false, code: sent.body.code, message: sent.body.message }
  }

  const body = sent.body as IngestionPollResultWire
  console.log(
    `[IngestionPollTrigger] host trigger ack. request_id=${requestId} target=${targetHostPort} ` +
      `status=${body.poll_status} fetched=${body.fetched} delivered=${body.delivered} held=${body.held}`,
  )

  recordHostIngestionPollAck({
    accountId,
    requestId,
    pollStatus: body.poll_status,
    fetched: body.fetched,
    depackaged: body.depackaged,
    delivered: body.delivered,
    held: body.held,
    at: Date.now(),
  })

  return {
    ok: true,
    trigger: {
      requestId,
      pollStatus: body.poll_status,
      fetched: body.fetched,
      depackaged: body.depackaged,
      delivered: body.delivered,
      held: body.held,
    },
  }
}
