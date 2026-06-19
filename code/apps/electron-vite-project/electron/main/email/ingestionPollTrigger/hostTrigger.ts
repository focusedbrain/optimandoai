/**
 * Dedicated delegated host → sandbox ingestion poll trigger (PROMPT 2 / A3 relay).
 */

import { randomUUID } from 'crypto'
import { listHandshakeRecords } from '../../handshake/db'
import { HandshakeState, type HandshakeRecord } from '../../handshake/types'
import {
  assertHostSendsResultToSandbox,
  assertRecordForServiceRpc,
  deriveInternalHostAiPeerRoles,
} from '../../internalInference/policy'
import { getInstanceId } from '../../orchestrator/orchestratorModeStore'
import { resolveSandboxTopologyKind, type SandboxTopologyKind } from '../../handshake/sandboxTopologyKind'
import {
  resolveIngestionOwnershipWithLedger,
  type IngestionOwnership,
} from '../ingestionOwnership'
import { INGESTION_POLL_SCHEMA_VERSION, type IngestionPollRequestWire } from './wire'
import { recordHostIngestionPollUnreachable } from './hostAckStore'
import {
  cancelHostIngestionPollPending,
  getHostIngestionPollPending,
  registerHostIngestionPollPending,
} from './hostPendingStore'
import {
  sealServiceRpcForRelay,
  sendSealedServiceRpcViaCoordinationRelay,
  type SealedRelayCapsuleSender,
  type SealedRelaySendResult,
} from './relaySend'

export const DEFAULT_INGESTION_POLL_TRIGGER_TIMEOUT_MS = (() => {
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
  hostDeviceId: string
  peerSandboxDeviceId: string
  decision: IngestionTriggerDecision
}

export interface SealedRelayPollTriggerDeps {
  sendSealedRelay?: (
    db: unknown,
    record: HandshakeRecord,
    envelope: Parameters<typeof sendSealedServiceRpcViaCoordinationRelay>[2],
    deps?: { sendCapsule?: SealedRelayCapsuleSender },
  ) => Promise<SealedRelaySendResult>
}

function peerCoordinationId(record: HandshakeRecord, thisId: string): string {
  const ini = (record.initiator_coordination_device_id ?? '').trim()
  const acc = (record.acceptor_coordination_device_id ?? '').trim()
  if (ini && ini !== thisId) return ini
  if (acc && acc !== thisId) return acc
  return acc || ini || ''
}

function buildIngestionPollRequestWire(
  record: HandshakeRecord,
  opts: { accountId: string; pullMore?: boolean; timeoutMs: number },
): IngestionPollRequestWire {
  const thisId = getInstanceId().trim()
  const requestId = randomUUID()
  const nowMs = Date.now()
  const timeoutMs = opts.timeoutMs
  return {
    type: 'ingestion_poll_request',
    schema_version: INGESTION_POLL_SCHEMA_VERSION,
    request_id: requestId,
    handshake_id: record.handshake_id,
    sender_device_id: thisId,
    target_device_id: peerCoordinationId(record, thisId),
    created_at: new Date(nowMs).toISOString(),
    account_id: opts.accountId,
    ...(opts.pullMore ? { pull_more: true } : {}),
    expires_at: new Date(nowMs + timeoutMs).toISOString(),
  }
}

function pendingTriggerCounts(requestId: string): IngestionPollTriggerCounts {
  return {
    requestId,
    pollStatus: 'pending',
    fetched: 0,
    depackaged: 0,
    delivered: 0,
    held: 0,
  }
}

function classifySendFailureOutcome(code: string): 'rejected' | 'unreachable' {
  return code === 'E_INGESTION_POLL_PROTOCOL' || code === 'E_INGESTION_POLL_AUTH' ? 'rejected' : 'unreachable'
}

function shouldRecordUnreachableOnSendFailure(code: string): boolean {
  return (
    code === 'E_INGESTION_POLL_LINK_DOWN' ||
    code === 'E_INGESTION_POLL_PEER_ENDPOINT' ||
    code === 'E_INGESTION_POLL_RELAY_UNAVAILABLE'
  )
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
  _ownership: IngestionOwnership,
): IngestionTriggerDecisionContext {
  const hostDeviceId = getInstanceId().trim()
  const record = findActiveHostToSandboxHandshakeRecord(db)
  const peerSandboxDeviceId = record ? peerCoordinationId(record, hostDeviceId) : ''
  const topologyKind = resolveSandboxTopologyKind(db)
  const shouldTrigger = topologyKind === 'dedicated'

  return {
    topologyKind,
    hostDeviceId,
    peerSandboxDeviceId,
    decision: shouldTrigger ? 'trigger' : 'delegate',
  }
}

function logIngestionTriggerDecision(ctx: IngestionTriggerDecisionContext): void {
  console.log(
    `[IngestionTriggerDecision] topology=${ctx.topologyKind} ` +
      `host_device_id=${ctx.hostDeviceId || '(none)'} peer_sandbox_device_id=${ctx.peerSandboxDeviceId || '(none)'} ` +
      `decision=${ctx.decision}`,
  )
}

/**
 * Dedicated delegated host only: host must not read-poll locally and topology
 * must be separate-machine dedicated (not single_machine inner-VM).
 * Poll routing uses relay device identity — no direct-LAN endpoint resolution.
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

/**
 * Dedicated delegated host poll trigger — sealed relay (A3). Async pending; result arrives in A5.
 * INV-ENCRYPT: sealing failure fails loud — no plaintext, no direct-HTTP fallback.
 */
export async function sendDedicatedSandboxIngestionPollTrigger(
  db: unknown,
  opts: {
    accountId: string
    pullMore?: boolean
    timeoutMs?: number
    relayDeps?: SealedRelayPollTriggerDeps
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

  const timeoutMs = opts.timeoutMs ?? DEFAULT_INGESTION_POLL_TRIGGER_TIMEOUT_MS
  const wire = buildIngestionPollRequestWire(record, {
    accountId,
    pullMore: opts.pullMore,
    timeoutMs,
  })
  const receiverDeviceId = wire.target_device_id

  console.log(
    `[IngestionPollTrigger] host sealing relay trigger. request_id=${wire.request_id} account=${accountId} ` +
      `handshake=${record.handshake_id} receiver=${receiverDeviceId}`,
  )

  const sealed = sealServiceRpcForRelay(record, {
    handshake_id: record.handshake_id,
    sender_device_id: wire.sender_device_id,
    receiver_device_id: receiverDeviceId,
    plaintextJson: wire,
  })
  if (!sealed.ok) {
    console.warn(
      `[IngestionPollTrigger] seal failed — no plaintext fallback. request_id=${wire.request_id} ` +
        `code=${sealed.code} message=${sealed.message}`,
    )
    return { ok: false, code: sealed.code, message: sealed.message }
  }

  registerHostIngestionPollPending({
    requestId: wire.request_id,
    accountId,
    timeoutMs,
  })

  const sendSealedRelay = opts.relayDeps?.sendSealedRelay ?? sendSealedServiceRpcViaCoordinationRelay
  const sent = await sendSealedRelay(db, record, sealed.envelope, opts.relayDeps)
  if (!sent.ok) {
    cancelHostIngestionPollPending(wire.request_id)
    const outcome = classifySendFailureOutcome(sent.code)
    console.warn(
      `[IngestionPollTrigger] host sealed relay ${outcome}. request_id=${wire.request_id} ` +
        `code=${sent.code} message=${sent.message}`,
    )
    if (shouldRecordUnreachableOnSendFailure(sent.code)) {
      recordHostIngestionPollUnreachable(accountId, wire.request_id)
    }
    return { ok: false, code: sent.code, message: sent.message }
  }

  console.log(
    `[IngestionPollTrigger] host sealed relay accepted (async pending). request_id=${wire.request_id} ` +
      `handshake=${record.handshake_id}`,
  )

  return {
    ok: true,
    trigger: pendingTriggerCounts(wire.request_id),
  }
}

export { getHostIngestionPollPending }
