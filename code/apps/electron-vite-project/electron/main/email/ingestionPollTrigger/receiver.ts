/**
 * Sandbox-side handler for inbound `ingestion_poll_request` (host→sandbox control).
 */

import { randomUUID } from 'crypto'
import type { HandshakeRecord } from '../../handshake/types'
import {
  assertRecordForServiceRpc,
  assertSandboxReceivesResultFromHost,
} from '../../internalInference/policy'
import { getInstanceId } from '../../orchestrator/orchestratorModeStore'
import { runSandboxIngestionPoll } from '../sandboxIngestion'
import { buildProductionSandboxIngestionDeps } from '../sandboxIngestionProduction'
import {
  INGESTION_POLL_SCHEMA_VERSION,
  type IngestionPollErrorWire,
  type IngestionPollRequestWire,
  type IngestionPollResultWire,
} from './wire'

export type IngestionPollReceiverDeps = {
  getRecord: (handshakeId: string) => HandshakeRecord | null | undefined
  runPoll?: typeof runSandboxIngestionPoll
  buildDeps?: typeof buildProductionSandboxIngestionDeps
  db: unknown
  now?: () => number
}

function errorWire(
  req: IngestionPollRequestWire,
  localDeviceId: string,
  code: string,
  message: string,
): IngestionPollErrorWire {
  return {
    type: 'ingestion_poll_error',
    schema_version: INGESTION_POLL_SCHEMA_VERSION,
    request_id: req.request_id,
    handshake_id: req.handshake_id,
    sender_device_id: localDeviceId,
    target_device_id: req.sender_device_id,
    created_at: new Date().toISOString(),
    code,
    message,
  }
}

function resultWire(
  req: IngestionPollRequestWire,
  localDeviceId: string,
  poll: Awaited<ReturnType<typeof runSandboxIngestionPoll>>,
): IngestionPollResultWire {
  return {
    type: 'ingestion_poll_result',
    schema_version: INGESTION_POLL_SCHEMA_VERSION,
    request_id: req.request_id,
    handshake_id: req.handshake_id,
    sender_device_id: localDeviceId,
    target_device_id: req.sender_device_id,
    created_at: new Date().toISOString(),
    account_id: req.account_id,
    poll_status: poll.status,
    fetched: poll.fetched,
    depackaged: poll.depackaged,
    delivered: poll.delivered,
    held: poll.held,
  }
}

/**
 * Handle one inbound host trigger. Never throws — every path returns a wire outcome.
 */
export async function handleIngestionPollRequest(
  req: IngestionPollRequestWire,
  localDeviceId: string,
  deps: IngestionPollReceiverDeps,
): Promise<IngestionPollResultWire | IngestionPollErrorWire> {
  const now = deps.now ?? Date.now
  const expires = Date.parse(req.expires_at)
  if (Number.isFinite(expires) && now > expires) {
    return errorWire(req, localDeviceId, 'E_INGESTION_POLL_EXPIRED', 'request expired')
  }

  if (req.target_device_id.trim() !== localDeviceId.trim()) {
    return errorWire(req, localDeviceId, 'E_INGESTION_POLL_FORBIDDEN', 'target_device_id mismatch')
  }

  const accountId = typeof req.account_id === 'string' ? req.account_id.trim() : ''
  if (!accountId) {
    return errorWire(req, localDeviceId, 'E_INGESTION_POLL_INVALID', 'account_id required')
  }

  const record = deps.getRecord(req.handshake_id)
  const gate = assertRecordForServiceRpc(record ?? null)
  if (!gate.ok) {
    return errorWire(req, localDeviceId, gate.code, 'handshake gate failed')
  }

  const recv = assertSandboxReceivesResultFromHost(gate.record, req.sender_device_id)
  if (!recv.ok) {
    return errorWire(req, localDeviceId, recv.code, 'sender not authorized host peer')
  }

  const runPoll = deps.runPoll ?? runSandboxIngestionPoll
  const buildDeps = deps.buildDeps ?? buildProductionSandboxIngestionDeps
  console.log(
    `[IngestionPollTrigger] host trigger received. request_id=${req.request_id} account=${accountId} handshake=${req.handshake_id}`,
  )

  const poll = await runPoll({
    accountId,
    deps: buildDeps(accountId, deps.db),
  })

  console.log(
    `[IngestionPollTrigger] poll complete. request_id=${req.request_id} status=${poll.status} fetched=${poll.fetched} delivered=${poll.delivered} held=${poll.held}`,
  )

  return resultWire(req, localDeviceId, poll)
}

/** Convenience for tests — mint a valid request envelope. */
export function makeIngestionPollRequestWire(
  partial: Partial<IngestionPollRequestWire> & Pick<IngestionPollRequestWire, 'handshake_id' | 'account_id'>,
): IngestionPollRequestWire {
  const now = Date.now()
  return {
    type: 'ingestion_poll_request',
    schema_version: INGESTION_POLL_SCHEMA_VERSION,
    request_id: partial.request_id ?? randomUUID(),
    handshake_id: partial.handshake_id,
    sender_device_id: partial.sender_device_id ?? 'host-dev',
    target_device_id: partial.target_device_id ?? getInstanceId(),
    created_at: partial.created_at ?? new Date(now).toISOString(),
    account_id: partial.account_id,
    pull_more: partial.pull_more,
    expires_at: partial.expires_at ?? new Date(now + 120_000).toISOString(),
  }
}
