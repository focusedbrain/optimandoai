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
import { getInstanceId } from '../../orchestrator/orchestratorModeStore'
import { resolveSandboxTopologyKind } from '../../handshake/sandboxTopologyKind'
import {
  resolveIngestionOwnershipWithLedger,
  type IngestionOwnership,
} from '../ingestionOwnership'
import {
  INGESTION_POLL_SCHEMA_VERSION,
  type IngestionPollResultWire,
} from './wire'
import { httpIngestionPollTransport, type IngestionPollTransport } from './send'

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

function peerCoordinationId(record: HandshakeRecord, thisId: string): string {
  const ini = (record.initiator_coordination_device_id ?? '').trim()
  const acc = (record.acceptor_coordination_device_id ?? '').trim()
  if (ini && ini !== thisId) return ini
  if (acc && acc !== thisId) return acc
  return acc || ini || ''
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

/**
 * Dedicated delegated host only: host must not read-poll locally and topology
 * must be separate-machine dedicated (not single_machine inner-VM).
 */
export async function shouldHostTriggerDedicatedSandboxPoll(
  db?: unknown,
  ownership?: IngestionOwnership,
): Promise<boolean> {
  const o = ownership ?? (await resolveIngestionOwnershipWithLedger())
  if (o.thisNodeRole !== 'host' || o.hostShouldReadPoll) return false
  return resolveSandboxTopologyKind(db) === 'dedicated'
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

  const endpoint = typeof record.p2p_endpoint === 'string' ? record.p2p_endpoint.trim() : ''
  if (!endpoint) {
    return { ok: false, code: 'E_INGESTION_POLL_LINK_DOWN', message: 'sandbox endpoint missing on handshake' }
  }

  const bearer = outboundP2pBearerToCounterpartyIngest(record)
  if (!bearer) {
    return { ok: false, code: 'E_INGESTION_POLL_AUTH', message: 'counterparty ingest bearer missing' }
  }

  const thisId = getInstanceId().trim()
  const requestId = randomUUID()
  const nowMs = Date.now()
  const timeoutMs = opts.timeoutMs ?? DEFAULT_POLL_TIMEOUT_MS
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
    `[IngestionPollTrigger] host sending trigger. request_id=${requestId} account=${accountId} handshake=${record.handshake_id}`,
  )

  const transport = opts.transport ?? httpIngestionPollTransport
  const sent = await transport({ endpoint, bearer, wire, timeoutMs })
  if (!sent.ok) {
    return { ok: false, code: sent.code, message: sent.message }
  }

  if (sent.body.request_id !== requestId) {
    return { ok: false, code: 'E_INGESTION_POLL_PROTOCOL', message: 'response request_id mismatch' }
  }

  if (sent.body.type === 'ingestion_poll_error') {
    return { ok: false, code: sent.body.code, message: sent.body.message }
  }

  const body = sent.body as IngestionPollResultWire
  console.log(
    `[IngestionPollTrigger] host trigger ack. request_id=${requestId} status=${body.poll_status} fetched=${body.fetched} delivered=${body.delivered} held=${body.held}`,
  )

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
